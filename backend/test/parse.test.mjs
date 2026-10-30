// 草稿解析结构：多笔、类型识别、金额日期格式、缺字段 missing。模型走 stub，后面的 resolve 是真实路径
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import { boot } from './helpers/fixtures.mjs'
import { setStubReply } from '../src/lib/llmStub.js'
import { isEditLine, parseMoney, categoryByWord } from '../src/lib/aiIntent.js'

let t, me
before(async () => { t = await boot(); me = await t.createUser('parse') })
after(async () => { setStubReply(null); await t.cleanup(); await t.close() })
const items = async (text) => { const r = await t.parse(me.token, text); assert.equal(r.code, 0, r.message); return r.data.items }

test('一次多笔按换行拆成多条，每条都有 draftId', async () => {
  const list = await items('午饭 45 微信零钱\n打车 32 招商银行\n工资到账 3.5万 招商银行')
  assert.equal(list.length, 3)
  assert.ok(list.every((i) => /^\d+$/.test(i.draftId)))
  assert.equal(new Set(list.map((i) => i.draftId)).size, 3)
})

test('类型识别：收支 / 转账 / 还款 / 资产 / 余额 / 投资各归各类', async () => {
  const list = await items('午饭 45 微信零钱\n还光大信用卡 2000 从招商银行扣\n李新民还了 2万 招商银行\n滨江一号最新估值 360万\n招商银行现在余额 76543.21\n买入 沪深300基金 100股 价格 4 手续费 5 招商银行')
  assert.deepEqual(list.map((i) => i.type), ['transaction', 'transfer', 'loan_repay', 'asset_valuation', 'balance', 'trade'])
  const [, transfer, repay, asset, balance, trade] = list
  assert.equal(transfer.accountId, String(me.bank.id))
  assert.equal(transfer.toAccountId, String(me.card.id))
  assert.equal(repay.loanId, String(me.loan.id))
  assert.equal(asset.assetId, String(me.asset.id))
  assert.equal(balance.accountId, String(me.bank.id))
  assert.equal(trade.holdingId, String(me.holding.id))
})

test('金额：万/千/元角都换算成两位小数的数字', async () => {
  const list = await items('工资到账 3.5万 招商银行\n奖金 3千 招商银行\n午饭 128块5 微信零钱\n咖啡 12.345 微信零钱')
  assert.deepEqual(list.map((i) => i.amount), [35000, 3000, 128.5, 12.35])
  assert.ok(list.every((i) => typeof i.amount === 'number'))
})

test('日期：昨天/前天/具体日期归一成 YYYY-MM-DD，没说用今天', async () => {
  const list = await items('昨天午饭 45\n前天打车 32\n2026-03-05 买书 88\n午饭 20')
  assert.deepEqual(list.map((i) => i.date), [dayjs().subtract(1, 'day').format('YYYY-MM-DD'), dayjs().subtract(2, 'day').format('YYYY-MM-DD'), '2026-03-05', dayjs().format('YYYY-MM-DD')])
})

test('模型给的非法日期回落到今天，负数金额取绝对值', async () => {
  setStubReply(() => ({ items: [{ type: 'transaction', direction: 'OUT', amount: '-45', date: '不是日期', account: '微信零钱' }] }))
  const [it] = await items('随便')
  setStubReply(null)
  assert.equal(it.amount, 45)
  assert.equal(it.date, dayjs().format('YYYY-MM-DD'))
})

test('缺金额：missing 里有 amount，warnings 里仍有原提示', async () => {
  setStubReply(() => ({ items: [{ type: 'transaction', direction: 'OUT', account: '微信零钱', description: '午饭' }] }))
  const [it] = await items('午饭')
  setStubReply(null)
  assert.deepEqual(it.missing, ['amount'])
  assert.ok(it.warnings.includes('缺金额'))
})

test('转账缺转入账户：missing 指出 toAccountId', async () => {
  setStubReply(() => ({ items: [{ type: 'transfer', amount: 100, account: '招商银行' }] }))
  const [it] = await items('转 100')
  setStubReply(null)
  assert.deepEqual(it.missing, ['toAccountId'])
})

test('资料齐全：missing 为空数组', async () => {
  const [it] = await items('午饭 45 微信零钱')
  assert.deepEqual(it.missing, [])
})

test('截图：图片传到模型，出草稿，不要求有文字', async () => {
  const png = new Blob([Buffer.from('iVBORw0KGgo=', 'base64')], { type: 'image/png' })
  const r = await t.parse(me.token, '', undefined, [new File([png], 'a.png', { type: 'image/png' }), new File([png], 'b.png', { type: 'image/png' })])
  assert.equal(r.code, 0, r.message)
  assert.equal(r.data.items.length, 2)
  assert.ok(r.data.items[0].draftId)
})

test('学到的规则优先：按对方名自动套用科目', async () => {
  await t.data('POST', '/categories/rules', me.token, { pattern: '瑞幸', categoryId: String(me.cat.A12.id), isBusiness: false })
  setStubReply(() => ({ items: [{ type: 'transaction', direction: 'OUT', amount: 20, counterparty: '瑞幸', categoryCode: 'B1', account: '微信零钱' }] }))
  const [it] = await items('瑞幸 20')
  setStubReply(null)
  assert.equal(it.categoryCode, 'A12')
  assert.equal(it.matchedRule, '瑞幸')
})

test('模型挂了回落规则解析，并带上错误', async () => {
  setStubReply(() => { throw new Error('模型超时') })
  const r = await t.parse(me.token, '午饭 45 微信零钱')
  setStubReply(null)
  assert.equal(r.code, 0)
  assert.match(r.data.provider, /^rule/)
  assert.equal(r.data.error, '模型超时')
  assert.equal(r.data.items[0].amount, 45)
})

test('意图判断：「这个月」不是指代，「改天」不是改', () => {
  assert.equal(isEditLine('这个月房租 3000'), false)
  assert.equal(isEditLine('改天再付 300'), false)
  assert.equal(isEditLine('把这笔改成餐饮'), true)
  assert.equal(isEditLine('这笔还信用卡'), true)
  assert.equal(isEditLine('把 T-202610-00012 改成餐饮'), true)
  assert.equal(parseMoney('3千'), 3000)
})

test('「餐饮」不是科目名，靠关键字对到 B1；对不上返回 null', () => {
  const cats = Object.values({ a: { code: 'B1', name: '吃喝玩乐', keywords: '餐饮,饭' }, b: { code: 'A7', name: '车辆出行', keywords: '打车' } })
  assert.equal(categoryByWord('餐饮', cats).code, 'B1')
  assert.equal(categoryByWord('A7', cats).code, 'A7')
  assert.equal(categoryByWord('火星税', cats), null)
})

test('清理后残留 0', async () => {
  await t.cleanup()
  assert.equal(await t.residual(), 0)
})
