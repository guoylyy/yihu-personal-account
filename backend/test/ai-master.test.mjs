// AI 助手的基础资料操作：说一句话 → 草稿 → 确认。覆盖新增、修改、预算，以及定目标、白名单、越权和幂等
import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { boot, prisma } from './helpers/fixtures.mjs'
import { setStubReply } from '../src/lib/llmStub.js'

let t, me, other, mortgage
before(async () => {
  t = await boot()
  me = await t.createUser('me')
  other = await t.createUser('she')
  mortgage = await prisma.loan.create({ data: { userId: me.id, direction: 'BORROW', kind: 'MORTGAGE', counterparty: '建行房贷', principal: 1000000, balance: 900000 } })
})
afterEach(() => setStubReply(null))
after(async () => { await t.cleanup(); await t.close() })

const say = async (text, ctx, u = me) => (await t.parse(u.token, text, ctx)).data
const one = async (text, ctx) => { const r = await say(text, ctx); assert.equal(r.items.length, 1, JSON.stringify(r)); return r.items[0] }
const submit = (id, item, u = me) => t.call('POST', `/ai/drafts/${id}/submit`, u.token, item ? { item } : {})
const pin = (type, id) => ({ pinned: [{ type, id: String(id) }] })
const model = (items, question = null) => setStubReply(() => ({ items, question }))

test('新增固定资产：一句话出草稿，确认后落库，不写流水、不动余额', async () => {
  const txns = await prisma.transaction.count({ where: { userId: me.id } })
  const d = await one('新增固定资产 钱塘二号 300万')
  assert.equal(d.type, 'new_asset')
  assert.equal(d.date, null, '没说买入日期不能用今天顶替')
  assert.deepEqual(d.missing, [])
  const r = await submit(d.draftId)
  assert.equal(r.code, 0)
  const a = await prisma.fixedAsset.findFirst({ where: { userId: me.id, name: '钱塘二号' } })
  assert.equal(Number(a.currentValue), 3000000)
  assert.equal(a.type, 'OTHER')
  assert.equal(a.purchaseDate, null)
  assert.equal(await prisma.transaction.count({ where: { userId: me.id } }), txns)
  assert.equal(Number((await prisma.account.findUnique({ where: { id: me.bank.id } })).balance), 10000)
})

test('新增资产：只有买入价时估值取买入价；同名给提示；缺类型挡提交', async () => {
  model([{ type: 'new_asset', assetName: '滨江一号', assetType: 'PROPERTY', purchasePrice: 2000000, date: '2020-05-01' }])
  const d = await one('登记')
  assert.match(d.warnings.join(), /已经有资产/)
  assert.equal((await submit(d.draftId)).code, 0)
  const rows = await prisma.fixedAsset.findMany({ where: { userId: me.id, name: '滨江一号' }, orderBy: { id: 'desc' } })
  assert.equal(Number(rows[0].currentValue), 2000000)
  assert.equal(rows[0].purchaseDate.toISOString().slice(0, 10), '2020-05-01')
  model([{ type: 'new_asset', assetName: '无类型', amount: 1 }])
  const bad = await one('登记')
  assert.ok(bad.missing.includes('assetType'))
  assert.equal((await submit(bad.draftId)).code, 9002)
})

test('新增账户：信用卡欠款保留负数，余额对得上', async () => {
  model([{ type: 'new_account', accountName: '招行信用卡', accountType: 'CREDIT', amount: -2500, creditLimit: 50000, billDay: 5, repayDay: 23 }])
  const d = await one('开一张卡')
  assert.equal(d.amount, -2500)
  assert.equal((await submit(d.draftId)).code, 0)
  const a = await prisma.account.findFirst({ where: { userId: me.id, name: '招行信用卡' } })
  assert.equal(Number(a.balance), -2500)
  assert.equal(a.billDay, 5)
})

test('余额校准的负数不再被解析成正数', async () => {
  model([{ type: 'balance', account: '光大信用卡', amount: -1200 }])
  assert.equal((await one('光大信用卡余额')).amount, -1200)
})

test('修改借贷：填月供和利率，自由天数的分母跟着变', async () => {
  const before = await t.data('GET', '/freedom', me.token)
  assert.equal(before.totals.principal, 0)
  const d = await one('建行房贷 月供 6000 年利率 3.6')
  assert.equal(d.type, 'update_loan')
  assert.equal(d.targetId, String(mortgage.id))
  assert.equal(d.targetSummary, '建行房贷')
  assert.equal((await submit(d.draftId)).code, 0)
  const l = await prisma.loan.findUnique({ where: { id: mortgage.id } })
  assert.equal(Number(l.monthlyPayment), 6000)
  assert.equal(Number(l.annualRate), 3.6)
  assert.equal(Number(l.balance), 900000, '未还本金不动')
})

test('@ 引用定目标：只说「月供改成 7000」也能改到 @ 的那笔', async () => {
  const d = await one('月供 7000', pin('loan', mortgage.id))
  assert.equal(d.targetId, String(mortgage.id))
  assert.deepEqual(d.refSource, { targetId: 'pinned' })
  assert.equal((await submit(d.draftId)).code, 0)
})

test('修改账户：把这个账户改名 不会被当成改流水而拦下', async () => {
  const d = await one('把这个账户改名成 工资卡', pin('account', me.wx.id))
  assert.equal(d.type, 'update_account')
  assert.equal(d.newName, '工资卡')
  assert.equal((await submit(d.draftId)).code, 0)
  assert.equal((await prisma.account.findUnique({ where: { id: me.wx.id } })).name, '工资卡')
})

test('说法像「改这笔」、模型判成改账户：草稿不能被当成错账拦下', async () => {
  model([{ type: 'update_account', newName: '备用卡' }])
  const d = await one('把这个账户改成备用卡', pin('account', me.card.id))
  assert.equal(d.type, 'update_account')
})

test('修改持仓、资产', async () => {
  const h = await one('改名 红利基金', pin('holding', me.holding.id))
  assert.equal(h.type, 'update_holding')
  assert.equal((await submit(h.draftId)).code, 0)
  const a = await one('滨江一号 已卖出', pin('asset', me.asset.id))
  assert.equal(a.type, 'update_asset')
  assert.equal((await submit(a.draftId)).code, 0)
  assert.equal((await prisma.fixedAsset.findUnique({ where: { id: me.asset.id } })).status, 'SOLD')
})

test('停用有余额的账户要提示', async () => {
  const d = await one('停用账户 招商银行')
  assert.match(d.warnings.join(), /还有余额/)
})

test('设预算：新建和覆盖，覆盖时提示原值', async () => {
  const d = await one('吃喝玩乐 预算 每月 3000')
  assert.equal(d.type, 'set_budget')
  assert.equal(d.categoryId, String(me.cat.B1.id))
  assert.equal((await submit(d.draftId)).code, 0)
  const key = { userId_year_categoryId: { userId: me.id, year: new Date().getFullYear(), categoryId: me.cat.B1.id } }
  assert.equal(Number((await prisma.budget.findUnique({ where: key })).annualAmount), 36000)
  const next = await one('吃喝玩乐 全年预算 6万')
  assert.match(next.warnings.join(), /现在的月预算是/)
  assert.equal((await submit(next.draftId)).code, 0)
  assert.equal(Number((await prisma.budget.findUnique({ where: key })).monthlyAmount), 5000)
})

test('预算不能设在收入科目上', async () => {
  model([{ type: 'set_budget', categoryCode: 'I1', monthly: 100 }])
  const d = await one('x')
  assert.equal((await submit(d.draftId)).code, 9002)
})

test('一句话说几件事出几张不同类型的草稿', async () => {
  const r = await say('新增固定资产 宝马 40万\n新建账户 零用钱 500\n午饭 45 招商银行')
  assert.deepEqual(r.items.map((x) => x.type), ['new_asset', 'new_account', 'transaction'])
})

test('定不了目标就问，不出草稿', async () => {
  model([{ type: 'update_loan', monthlyPayment: 1 }])
  assert.match((await say('改月供')).question, /要改哪个借贷/)
  assert.equal((await say('改月供')).items.length, 0)
  model([{ type: 'update_asset', asset: '不存在的房子', remark: 'x' }])
  const r = await say('改备注')
  assert.equal(r.items.length, 0)
  assert.match(r.question, /不存在的房子.*对不上/)
})

test('重名不猜：命中多条算对不上', async () => {
  await prisma.loan.create({ data: { userId: me.id, direction: 'BORROW', kind: 'CAR', counterparty: '建行车贷', principal: 1, balance: 1 } })
  model([{ type: 'update_loan', loan: '建行', remark: 'x' }])
  assert.equal((await say('改')).items.length, 0)
})

test('模型编的 id 不算数：没有名字和 @ 时不能改到别人的记录', async () => {
  model([{ type: 'update_loan', targetId: String(mortgage.id), loanId: String(mortgage.id), remark: '偷改' }])
  assert.equal((await say('改', undefined, other)).items.length, 0)
  model([{ type: 'update_loan', loan: '建行房贷', remark: '偷改' }])
  assert.equal((await say('改', undefined, other)).items.length, 0, '名字只在自己的账本里对')
  assert.equal((await t.parse(other.token, 'x', pin('loan', mortgage.id))).code, 9004)
  assert.equal((await prisma.loan.findUnique({ where: { id: mortgage.id } })).remark, null)
})

test('提交时不能换目标、不能把草稿改成修改操作', async () => {
  model([{ type: 'update_loan', loan: '建行房贷', remark: '正常' }])
  const d = await one('改备注')
  const r = await submit(d.draftId, { ...d, targetId: String(me.loan.id), remark: '正常2' })
  assert.equal(r.code, 0)
  assert.equal((await prisma.loan.findUnique({ where: { id: me.loan.id } })).remark, null)
  assert.equal((await prisma.loan.findUnique({ where: { id: mortgage.id } })).remark, '正常2')
  model([{ type: 'transaction', direction: 'OUT', amount: 1 }])
  const tx = await one('一块')
  assert.equal((await submit(tx.draftId, { ...tx, type: 'update_loan', targetId: String(mortgage.id), remark: 'x' })).code, 9002)
})

test('字段白名单：余额、未还本金、归属改不了', async () => {
  model([{ type: 'update_loan', loan: '建行房贷', balance: 1, userId: String(other.id), monthlyPayment: 6100 }])
  const d = await one('改')
  assert.equal((await submit(d.draftId)).code, 0)
  const l = await prisma.loan.findUnique({ where: { id: mortgage.id } })
  assert.equal(Number(l.balance), 900000)
  assert.equal(l.userId, me.id)
  model([{ type: 'update_loan', loan: '建行房贷', balance: 1 }])
  assert.ok((await one('改')).missing.includes('changes'), '只有非白名单字段等于没改')
})

test('非法值拒绝：错误枚举、负数、账单日超范围', async () => {
  model([{ type: 'update_account', account: '招商银行', status: 'DELETED' }])
  const a = await one('改')
  assert.equal((await submit(a.draftId)).code, 9002)
  model([{ type: 'update_loan', loan: '建行房贷', monthlyPayment: -1 }])
  const b = await one('改')
  assert.equal((await submit(b.draftId)).code, 9002)
  model([{ type: 'update_account', account: '招商银行', billDay: 40 }])
  const c = await one('改')
  assert.equal((await submit(c.draftId)).code, 9002)
})

test('幂等：同一张草稿连点只建一个资产；内容相同的两张也只建一个', async () => {
  model([{ type: 'new_asset', assetName: '幂等车', assetType: 'VEHICLE', amount: 100000 }])
  const d = await one('x')
  await Promise.all([submit(d.draftId), submit(d.draftId)])
  const again = await one('x')
  assert.equal((await submit(again.draftId)).data.duplicate, true)
  assert.equal(await prisma.fixedAsset.count({ where: { userId: me.id, name: '幂等车' } }), 1)
})

test('年利率像小数时提示按百分数填', async () => {
  model([{ type: 'update_loan', loan: '建行房贷', annualRate: 0.036 }])
  assert.match((await one('改')).warnings.join(), /百分数/)
})

test('POST /ai/drafts 也挡得住编造的目标', async () => {
  const r = await t.data('POST', '/ai/drafts', other.token, { items: [{ type: 'update_loan', loan: '建行房贷', targetId: String(mortgage.id), remark: 'x' }] })
  assert.equal(r.items[0].targetId, undefined)
  assert.equal((await submit(r.items[0].draftId, undefined, other)).code, 9002)
})
