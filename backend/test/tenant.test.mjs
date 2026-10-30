// 越权：草稿、入账都不能碰到别人的数据
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, prisma } from './helpers/fixtures.mjs'

let t, me, other, hers
before(async () => {
  t = await boot()
  me = await t.createUser('me')
  other = await t.createUser('she')
  hers = await t.data('POST', '/transactions', other.token, { direction: 'OUT', amount: 77, txnDate: '2026-10-02', accountId: String(other.wx.id), categoryId: String(other.cat.A1.id) })
})
after(async () => { await t.cleanup(); await t.close() })

const draft = async (u, it) => (await t.data('POST', '/ai/drafts', u.token, { items: [it] })).items[0]
const submit = (u, id, it) => t.call('POST', `/ai/drafts/${id}/submit`, u.token, it ? { item: it } : {})
const base = (o = {}) => ({ type: 'transaction', date: '2026-10-05', direction: 'OUT', amount: 33, ...o })

test('未登录访问草稿接口：401', async () => {
  assert.equal((await t.call('POST', '/ai/drafts', null, { items: [base()] })).status, 401)
  assert.equal((await t.call('GET', '/ai/drafts/1', null)).status, 401)
  assert.equal((await t.call('POST', '/ai/drafts/1/submit', null, {})).status, 401)
})

test('看不到、提交不了别人的草稿，响应和不存在相同', async () => {
  const d = await draft(other, base())
  assert.equal((await t.call('GET', `/ai/drafts/${d.draftId}`, me.token)).code, 9004)
  assert.equal((await submit(me, d.draftId)).code, 9004)
  assert.equal((await t.data('GET', `/ai/drafts/${d.draftId}`, other.token)).status, 'PENDING')
  assert.equal((await t.call('GET', '/ai/drafts/abc', me.token)).code, 9004)
})

test('入账时带别人的账户：拒绝，没写流水，对方余额不动', async () => {
  const d = await draft(me, base({ amount: 34 }))
  const r = await submit(me, d.draftId, { ...d, accountId: String(other.bank.id) })
  assert.equal(r.code, 9002)
  assert.match(r.message, /账户不存在或无权访问/)
  assert.equal(await prisma.transaction.count({ where: { accountId: other.bank.id } }), 0)
  assert.equal((await t.data('GET', `/ai/drafts/${d.draftId}`, me.token)).status, 'PENDING')
})

test('入账时带别人的科目：拒绝', async () => {
  const d = await draft(me, base({ amount: 35 }))
  const r = await submit(me, d.draftId, { ...d, categoryId: String(other.cat.A1.id) })
  assert.equal(r.code, 9002)
  assert.match(r.message, /科目不存在或无权访问/)
})

test('转账转到别人账户：拒绝，一条流水都不留', async () => {
  const d = await draft(me, { type: 'transfer', date: '2026-10-05', amount: 36, accountId: String(me.bank.id), toAccountId: String(other.bank.id) })
  const r = await submit(me, d.draftId)
  assert.equal(r.code, 9002)
  assert.equal(await prisma.transaction.count({ where: { userId: me.id, amount: 36 } }), 0)
})

test('买卖持仓带别人的资金账户：拒绝，持仓不动', async () => {
  const d = await draft(me, { type: 'trade', date: '2026-10-05', holdingId: String(me.holding.id), action: 'BUY', amount: 10, accountId: String(other.bank.id), holding: 'x' })
  const before = await prisma.holding.findUnique({ where: { id: me.holding.id } })
  assert.equal((await submit(me, d.draftId)).code, 9002)
  assert.equal(String((await prisma.holding.findUnique({ where: { id: me.holding.id } })).costAmount), String(before.costAmount))
})

test('新增持仓带别人的资金账户：拒绝，不留半截持仓', async () => {
  const d = await draft(me, { type: 'new_holding', date: '2026-10-05', holding: '半截持仓', amount: 10, accountId: String(other.bank.id) })
  assert.equal((await submit(me, d.draftId)).code, 9002)
  assert.equal(await prisma.holding.count({ where: { userId: me.id, name: '半截持仓' } }), 0)
})

test('POST /drafts 直接造修改别人流水的草稿：没有 @ 不出草稿', async () => {
  const r = await t.data('POST', '/ai/drafts', me.token, { items: [{ type: 'update_transaction', targetId: String(hers.id), categoryCode: 'B1' }] })
  assert.deepEqual(r.items, [])
  assert.ok(r.question)
})

test('POST /drafts 带 @ 别人的流水：9004', async () => {
  const r = await t.call('POST', '/ai/drafts', me.token, { items: [{ type: 'update_transaction', categoryCode: 'B1' }], context: { pinned: [{ type: 'transaction', id: String(hers.id) }] } })
  assert.equal(r.code, 9004)
})

test('提交时把修改目标换成别人的流水：不生效，只认落库的目标', async () => {
  const mine = await t.data('POST', '/transactions', me.token, { direction: 'OUT', amount: 12, txnDate: '2026-10-02' })
  const { items: [d] } = await t.data('POST', '/ai/drafts', me.token, { items: [{ type: 'update_transaction', categoryCode: 'B1' }], context: { pinned: [{ type: 'transaction', id: String(mine.id) }] } })
  const r = await submit(me, d.draftId, { ...d, targetId: String(hers.id) })
  assert.equal(r.code, 0, r.message)
  assert.equal(r.data.id, String(mine.id))
  assert.equal((await prisma.transaction.findUnique({ where: { id: BigInt(hers.id) } })).categoryId, other.cat.A1.id)
})

test('普通草稿提交时不能摇身变成修改流水', async () => {
  const d = await draft(me, base({ amount: 37 }))
  const r = await submit(me, d.draftId, { ...d, type: 'update_transaction', targetId: String(hers.id) })
  assert.equal(r.code, 9002)
})

test('手工改流水接口同样挡住别人的账户', async () => {
  const mine = await t.data('POST', '/transactions', me.token, { direction: 'OUT', amount: 13, txnDate: '2026-10-02' })
  const r = await t.call('PUT', `/transactions/${mine.id}`, me.token, { accountId: String(other.bank.id) })
  assert.notEqual(r.code, 0)
  assert.equal((await t.call('POST', '/transactions', me.token, { direction: 'OUT', amount: 14, txnDate: '2026-10-02', accountId: String(other.bank.id) })).code === 0, false)
})

test('清理后残留 0', async () => {
  await t.cleanup()
  assert.equal(await t.residual(), 0)
})
