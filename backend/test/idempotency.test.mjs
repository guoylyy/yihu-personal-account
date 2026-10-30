// 提交幂等：同一草稿重复提交 → 一笔；内容相同的另一张草稿 60 秒内 → 重复；超过 60 秒 → 新的一笔；失败不标记已提交
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, prisma } from './helpers/fixtures.mjs'
import { canonical, contentOf, fingerprint, DUP_WINDOW_MS } from '../src/lib/aiDrafts.js'

let t, me, other, seq = 0
before(async () => { t = await boot(); me = await t.createUser('idem'); other = await t.createUser('idem2') })
after(async () => { await t.cleanup(); await t.close() })

// 每条用例自己的内容：金额不同，互不触发 60 秒判重
const amount = () => 1000 + ++seq
const item = (u, extra = {}) => ({ type: 'transaction', date: '2026-10-05', direction: 'OUT', amount: amount(), accountId: String(u.wx.id), categoryId: String(u.cat.B1.id), counterparty: '测试商户', description: 'x', ...extra })
const draft = async (u, it) => (await t.data('POST', '/ai/drafts', u.token, { items: [it] })).items[0]
const submit = (u, id, it) => t.call('POST', `/ai/drafts/${id}/submit`, u.token, it ? { item: it } : {})
const count = (u, amt) => prisma.transaction.count({ where: { userId: u.id, amount: amt, deletedAt: null } })
const age = (ms) => prisma.aiSubmission.updateMany({ where: { userId: me.id }, data: { claimedAt: new Date(Date.now() - ms) } })

test('POST /drafts 返回 draftId，GET 查到未提交状态', async () => {
  const d = await draft(me, item(me))
  const g = await t.data('GET', `/ai/drafts/${d.draftId}`, me.token)
  assert.equal(g.status, 'PENDING')
  assert.equal(g.submitted, false)
  assert.equal(g.id, null)
  assert.equal(g.payload.amount, d.amount)
})

test('同一 draftId 顺序提交两次：同 id、第二次 duplicate，库里 1 条', async () => {
  const it = item(me)
  const d = await draft(me, it)
  const a = await submit(me, d.draftId)
  const b = await submit(me, d.draftId)
  assert.equal(a.code, 0, a.message)
  assert.equal(a.data.duplicate, false)
  assert.equal(b.code, 0)
  assert.equal(b.data.duplicate, true)
  assert.equal(b.data.id, a.data.id)
  assert.equal(b.data.code, a.data.code)
  assert.equal(await count(me, it.amount), 1)
  const g = await t.data('GET', `/ai/drafts/${d.draftId}`, me.token)
  assert.equal(g.status, 'SUBMITTED')
  assert.equal(g.id, a.data.id)
})

test('同一 draftId 并发提交两次：库里 1 条，一个 duplicate', async () => {
  const it = item(me)
  const d = await draft(me, it)
  const rs = await Promise.all([submit(me, d.draftId), submit(me, d.draftId)])
  assert.ok(rs.every((r) => r.code === 0), JSON.stringify(rs))
  assert.equal(rs[0].data.id, rs[1].data.id)
  assert.deepEqual(rs.map((r) => r.data.duplicate).sort(), [false, true])
  assert.equal(await count(me, it.amount), 1)
})

test('同一 draftId 并发 8 次：库里仍 1 条，余额只动一次', async () => {
  const it = item(me, { accountId: String(me.bank.id) })
  const d = await draft(me, it)
  const before = Number((await prisma.account.findUnique({ where: { id: me.bank.id } })).balance)
  const rs = await Promise.all(Array.from({ length: 8 }, () => submit(me, d.draftId)))
  assert.ok(rs.every((r) => r.code === 0))
  assert.equal(rs.filter((r) => !r.data.duplicate).length, 1)
  assert.equal(await count(me, it.amount), 1)
  assert.equal(Number((await prisma.account.findUnique({ where: { id: me.bank.id } })).balance), before - it.amount)
})

test('同内容不同草稿 60 秒内：第二次 duplicate，指向第一次', async () => {
  const it = item(me)
  const [d1, d2] = [await draft(me, it), await draft(me, it)]
  const a = await submit(me, d1.draftId)
  const b = await submit(me, d2.draftId)
  assert.equal(b.data.duplicate, true)
  assert.equal(b.data.id, a.data.id)
  assert.equal(b.data.originalDraftId, d1.draftId)
  assert.equal(await count(me, it.amount), 1)
})

test('同内容不同草稿并发：库里 1 条（靠唯一索引，不靠先查再写）', async () => {
  const it = item(me)
  const ds = await Promise.all(Array.from({ length: 4 }, () => draft(me, it)))
  const rs = await Promise.all(ds.map((d) => submit(me, d.draftId)))
  assert.ok(rs.every((r) => r.code === 0), JSON.stringify(rs))
  assert.equal(rs.filter((r) => !r.data.duplicate).length, 1)
  assert.equal(new Set(rs.map((r) => r.data.id)).size, 1)
  assert.equal(await count(me, it.amount), 1)
  const fp = fingerprint({ type: 'transaction', userId: me.id, item: it })
  assert.equal(await prisma.aiSubmission.count({ where: { fingerprint: fp } }), 1)
})

test('把握度、备注不同的两次解析仍算同一笔；金额写法不同也算', async () => {
  const it = item(me)
  const [d1, d2] = [await draft(me, { ...it, confidence: 0.9, note: 'a' }), await draft(me, { ...it, amount: it.amount.toFixed(2), confidence: 0.4, note: 'b' })]
  await submit(me, d1.draftId)
  assert.equal((await submit(me, d2.draftId)).data.duplicate, true)
})

test('内容差一个字段不算重复', async () => {
  const it = item(me)
  const [d1, d2] = [await draft(me, it), await draft(me, { ...it, counterparty: '另一家' })]
  await submit(me, d1.draftId)
  assert.equal((await submit(me, d2.draftId)).data.duplicate, false)
})

test('超过 60 秒：同内容视为新的一笔，新 id', async () => {
  const it = item(me)
  const [d1, d2] = [await draft(me, it), await draft(me, it)]
  const a = await submit(me, d1.draftId)
  await age(DUP_WINDOW_MS + 1000)
  const b = await submit(me, d2.draftId)
  assert.equal(b.data.duplicate, false)
  assert.notEqual(b.data.id, a.data.id)
  assert.equal(await count(me, it.amount), 2)
})

test('窗口内（59 秒）仍按重复处理', async () => {
  const it = item(me)
  const [d1, d2] = [await draft(me, it), await draft(me, it)]
  await submit(me, d1.draftId)
  await age(DUP_WINDOW_MS - 1000)
  assert.equal((await submit(me, d2.draftId)).data.duplicate, true)
})

test('同一张草稿过了 60 秒再提交：还是第一次的结果，不会再记一笔', async () => {
  const it = item(me)
  const d = await draft(me, it)
  const a = await submit(me, d.draftId)
  await age(DUP_WINDOW_MS * 10)
  const b = await submit(me, d.draftId)
  assert.equal(b.data.duplicate, true)
  assert.equal(b.data.id, a.data.id)
  assert.equal(await count(me, it.amount), 1)
})

test('同一批里两笔一样的账都能入账（一次多笔不被判重复）', async () => {
  const it = item(me)
  const { items } = await t.data('POST', '/ai/drafts', me.token, { items: [it, { ...it }] })
  const rs = [await submit(me, items[0].draftId), await submit(me, items[1].draftId)]
  assert.deepEqual(rs.map((r) => r.data.duplicate), [false, false])
  assert.equal(await count(me, it.amount), 2)
})

test('同一批重新解析再提交：两笔都对上上一次，不会变成 4 笔', async () => {
  const it = item(me)
  const first = (await t.data('POST', '/ai/drafts', me.token, { items: [it, { ...it }] })).items
  for (const d of first) await submit(me, d.draftId)
  const again = (await t.data('POST', '/ai/drafts', me.token, { items: [it, { ...it }] })).items
  const rs = [await submit(me, again[0].draftId), await submit(me, again[1].draftId)]
  assert.deepEqual(rs.map((r) => r.data.duplicate), [true, true])
  assert.equal(await count(me, it.amount), 2)
})

test('不同用户内容相同互不影响', async () => {
  const shared = { type: 'new_loan', date: '2026-10-05', direction: 'LEND', counterparty: `共同内容${++seq}`, amount: 100 }
  const [a, b] = [await draft(me, shared), await draft(other, shared)]
  assert.equal((await submit(me, a.draftId)).data.duplicate, false)
  assert.equal((await submit(other, b.draftId)).data.duplicate, false)
})

test('提交失败（账户不存在）不标记已提交，改好同一张草稿能入账', async () => {
  const it = item(me, { accountId: '999999999999' })
  const d = await draft(me, it)
  const bad = await submit(me, d.draftId)
  assert.equal(bad.code, 9002)
  assert.match(bad.message, /账户不存在/)
  assert.equal((await t.data('GET', `/ai/drafts/${d.draftId}`, me.token)).status, 'PENDING')
  assert.equal(await count(me, it.amount), 0)
  const fixed = await submit(me, d.draftId, { ...d, accountId: String(me.wx.id) })
  assert.equal(fixed.code, 0, fixed.message)
  assert.equal(fixed.data.duplicate, false)
  assert.equal(await count(me, it.amount), 1)
})

test('失败后原样重试：指纹可接管，不被卡住', async () => {
  const it = item(me, { accountId: '999999999999' })
  const d = await draft(me, it)
  assert.equal((await submit(me, d.draftId)).code, 9002)
  const again = await submit(me, d.draftId)
  assert.equal(again.code, 9002)
  assert.match(again.message, /账户不存在/)
})

test('缺字段不入账，提示缺什么，改好可提交', async () => {
  const it = item(me)
  const d = await draft(me, { ...it, amount: null })
  assert.deepEqual(d.missing, ['amount'])
  const bad = await submit(me, d.draftId)
  assert.equal(bad.code, 9002)
  assert.match(bad.message, /还缺：金额/)
  const fixed = await submit(me, d.draftId, { ...d, amount: it.amount })
  assert.equal(fixed.code, 0, fixed.message)
})

test('提交时改过内容：按改后的入账；改了类型也认', async () => {
  const d = await draft(me, item(me))
  const amt = amount()
  const r = await submit(me, d.draftId, { ...d, type: 'new_loan', direction: 'BORROW', counterparty: '老王', amount: amt })
  assert.equal(r.code, 0, r.message)
  assert.equal(r.data.type, 'new_loan')
  assert.equal(await prisma.loan.count({ where: { userId: me.id, counterparty: '老王' } }), 1)
})

test('转账草稿幂等：两条流水只生成一次，余额各动一次', async () => {
  const amt = amount()
  const before = await prisma.account.findUnique({ where: { id: me.card.id } })
  const d = await draft(me, { type: 'transfer', date: '2026-10-05', amount: amt, accountId: String(me.bank.id), toAccountId: String(me.card.id), description: '还卡' })
  await Promise.all([submit(me, d.draftId), submit(me, d.draftId)])
  assert.equal(await prisma.transaction.count({ where: { userId: me.id, amount: amt } }), 2)
  assert.equal(Number((await prisma.account.findUnique({ where: { id: me.card.id } })).balance), Number(before.balance) + amt)
})

test('还款、估值、校准草稿都幂等', async () => {
  const cases = [
    [{ type: 'loan_repay', date: '2026-10-05', loanId: String(me.loan.id), principal: 100, accountId: String(me.bank.id), loan: '李新民' }, () => prisma.loanRepayment.count({ where: { userId: me.id } })],
    [{ type: 'asset_valuation', date: '2026-10-05', assetId: String(me.asset.id), amount: 2900000, asset: '滨江一号' }, () => prisma.assetValuation.count({ where: { userId: me.id } })],
    [{ type: 'trade', date: '2026-10-05', holdingId: String(me.holding.id), action: 'BUY', quantity: 1, price: 4, amount: 4, holding: '沪深300基金' }, () => prisma.holdingTrade.count({ where: { userId: me.id } })]
  ]
  for (const [it, n] of cases) {
    const before = await n()
    const d = await draft(me, it)
    await submit(me, d.draftId)
    assert.equal((await submit(me, d.draftId)).data.duplicate, true)
    assert.equal(await n(), before + 1, it.type)
  }
})

test('并发提交不同内容的草稿：流水编号不打架，全部成功', async () => {
  const its = Array.from({ length: 4 }, () => item(me))
  const ds = await Promise.all(its.map((i) => draft(me, i)))
  const rs = await Promise.all(ds.map((d) => submit(me, d.draftId)))
  assert.ok(rs.every((r) => r.code === 0), JSON.stringify(rs.map((r) => r.message)))
  assert.equal(new Set(rs.map((r) => r.data.code)).size, 4)
})

test('入账记到 AiEntryLog，/ai 页「已入账」的数不丢', async () => {
  const r = await t.parse(me.token, `午饭 ${amount()} 微信零钱`)
  await submit(me, r.data.items[0].draftId)
  const log = await prisma.aiEntryLog.findUnique({ where: { id: BigInt(r.data.logId) } })
  assert.equal(log.committed.filter((c) => c.ok).length, 1)
})

test('指纹：键顺序、空值不影响；类型、用户不同结果不同', () => {
  assert.equal(JSON.stringify(canonical({ b: 1, a: null, c: ' x ', d: false })), '{"b":1,"c":"x"}')
  assert.equal(contentOf({ type: 'transaction', amount: '45.00', accountId: 7 }).amount, 45)
  const it = { type: 'transaction', amount: 45, date: '2026-10-05' }
  const fp = fingerprint({ type: 'transaction', userId: 1n, item: it })
  assert.match(fp, /^[0-9a-f]{64}$/)
  assert.equal(fp, fingerprint({ type: 'transaction', userId: 1n, item: { date: '2026-10-05', amount: '45', note: 'x' } }))
  assert.notEqual(fp, fingerprint({ type: 'transaction', userId: 2n, item: it }))
  assert.notEqual(fp, fingerprint({ type: 'new_loan', userId: 1n, item: it }))
  assert.notEqual(fp, fingerprint({ type: 'transaction', userId: 1n, item: it, batchSeq: 1 }))
})

test('清理后残留 0', async () => {
  await t.cleanup()
  assert.equal(await t.residual(), 0)
})
