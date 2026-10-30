// 回归：原有接口路径和返回结构只增不改
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, prisma } from './helpers/fixtures.mjs'

let t, me
before(async () => { t = await boot(); me = await t.createUser('reg') })
after(async () => { await t.cleanup(); await t.close() })

test('POST /ai/resolve：返回数组，原字段和取值不变，只多 missing', async () => {
  const r = await t.data('POST', '/ai/resolve', me.token, { items: [
    { type: 'transaction', date: '2026-10-05', direction: 'OUT', amount: '45.456', account: '微信零钱', categoryCode: 'B1', counterparty: '海底捞', description: '火锅' },
    { type: 'transfer', amount: 100, account: '招商银行', toAccount: '光大信用卡' },
    { type: 'nonsense', amount: 1 }
  ] })
  assert.ok(Array.isArray(r))
  const [a, b, c] = r
  assert.deepEqual(Object.keys(a).sort(), ['account', 'accountId', 'aiCategoryCode', 'amount', 'categoryCode', 'categoryId', 'counterparty', 'date', 'description', 'direction', 'missing', 'type', 'warnings'].sort())
  assert.equal(a.amount, 45.46)
  assert.equal(a.accountId, String(me.wx.id))
  assert.equal(a.categoryId, String(me.cat.B1.id))
  assert.equal(a.aiCategoryCode, 'B1')
  assert.deepEqual(a.warnings, [])
  assert.equal(b.accountId, String(me.bank.id))
  assert.equal(b.toAccountId, String(me.card.id))
  assert.equal(c.type, 'transaction', '不认识的类型仍回落成收支')
})

test('POST /ai/resolve 不落库、不要求 draftId', async () => {
  const before = await prisma.aiDraft.count({ where: { userId: me.id } })
  const [r] = await t.data('POST', '/ai/resolve', me.token, { items: [{ type: 'transaction', amount: 1 }] })
  assert.equal(r.draftId, undefined)
  assert.equal(await prisma.aiDraft.count({ where: { userId: me.id } }), before)
})

test('POST /ai/commit 老接口还在：一条成功一条失败的结果结构不变', async () => {
  const r = await t.data('POST', '/ai/commit', me.token, { items: [
    { type: 'transaction', date: '2026-10-05', direction: 'OUT', amount: 21, accountId: String(me.wx.id) },
    { type: 'nonsense' }
  ] })
  assert.equal(r[0].ok, true)
  assert.equal(typeof r[0].ref, 'string')
  assert.match(r[0].ref, /^T-202610-/)
  assert.equal(r[1].ok, false)
  assert.match(r[1].error, /不支持的类型/)
})

test('POST /ai/parse：原有 logId/provider/error/ms/items 都在，多 question', async () => {
  const r = await t.parse(me.token, '午饭 45')
  for (const k of ['logId', 'provider', 'error', 'ms', 'items', 'question']) assert.ok(k in r.data, k)
})

test('POST /ai/parse 不带 context 照常工作；什么都没有时报 9002', async () => {
  assert.equal((await t.parse(me.token, '午饭 45')).code, 0)
  assert.equal((await t.parse(me.token, '   ')).code, 9002)
})

test('GET /ai/status：enabled/provider/types 都在，无模型（stub）也能跑', async () => {
  const s = await t.data('GET', '/ai/status', me.token)
  assert.equal(s.enabled, true)
  assert.equal(s.provider, 'stub')
  assert.equal(s.types.transaction, '收支')
  assert.equal(s.types.update_transaction, '修改流水')
})

test('PUT /transactions/:id：手工改流水行为不变（改账户两边余额都重算）', async () => {
  const x = await t.data('POST', '/transactions', me.token, { direction: 'OUT', amount: 50, txnDate: '2026-10-05', accountId: String(me.bank.id) })
  const u = await t.data('PUT', `/transactions/${x.id}`, me.token, { accountId: String(me.wx.id), amount: '-60', isBusiness: true })
  assert.equal(u.account.name, '微信零钱')
  assert.equal(Number(u.amount), 60)
  assert.equal(u.bizStatus, 'PENDING')
  assert.equal(Number((await prisma.account.findUnique({ where: { id: me.bank.id } })).balance), 10000)
  assert.equal((await t.call('PUT', '/transactions/999999999', me.token, {})).code, 9004)
})

test('清理后残留 0', async () => {
  await t.cleanup()
  assert.equal(await t.residual(), 0)
})
