// 自由天数：口径（纯函数）+ 接口（租户隔离、模拟不落账、看板只增字段）
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, prisma } from './helpers/fixtures.mjs'
import { computeFreedom, simulateFreedom, monthlyPrincipal } from '../src/lib/freedom.js'

const NOW = new Date('2026-10-30T12:00:00')
// 2025-10 ~ 2026-09，共 365 天
const PERIODS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

const sheetOf = (o = {}) => ({ cash: 0, investments: 0, creditDebt: 0, equity: 0, fixedAssets: 0, receivables: 0, investByType: {}, staleAccounts: [], ...o })
const monthOf = (period, necessary, flexible = 0, dividend = 0, o = {}) => ({
  period, expense: necessary + flexible, uncategorized: 0,
  byCategory: [
    { code: 'A1', group: '必要', amount: necessary }, { code: 'B1', group: '弹性', amount: flexible },
    ...(dividend ? [{ code: 'I5', group: '收入', amount: dividend }] : [])
  ], ...o
})
const year = (necessary, flexible, dividend) => PERIODS.map((p) => monthOf(p, necessary / 12, flexible / 12, dividend / 12))
const mortgage = { id: 1n, direction: 'BORROW', kind: 'MORTGAGE', counterparty: '建行房贷', balance: 1000000, monthlyPayment: 6000, annualRate: 3.6 }

// 设计文档第 3.6 节的算例
const sample = (o = {}) => computeFreedom({
  sheet: sheetOf({ cash: 200000, investments: 450000, creditDebt: 10000, investByType: { INSURANCE: 50000, FUND: 400000 } }),
  months: year(250000, 115000, 14600), loans: [mortgage], now: NOW, ...o
})

test('算例：生活线 557 天，生存线 793 天', () => {
  const f = sample()
  assert.equal(f.state, 'OK')
  assert.equal(f.available, 590000)
  assert.deepEqual(f.breakdown, { cash: 200000, investments: 400000, creditDebt: 10000, unsecuredDebt: 0 })
  assert.equal(f.excluded.insurance, 50000)
  assert.deepEqual(f.window, { from: '2025-10', to: '2026-09', months: 12, days: 365 })
  assert.deepEqual(f.daily, { living: 1058.63, survival: 743.56, principal: 98.63, passive: 40 })
  assert.deepEqual(f.days, { living: 557, survival: 793 })
  assert.deepEqual(f.depleteDate, { living: '2028-05-09', survival: '2028-12-31' })
  assert.equal(f.passiveCoverage, 3.6)
})

test('分子：股权、固定资产、应收不计', () => {
  const f = computeFreedom({
    sheet: sheetOf({ cash: 100, investments: 200, equity: 5e6, fixedAssets: 3e6, receivables: 50000 }),
    months: year(36500, 0, 0), loans: [], now: NOW
  })
  assert.equal(f.available, 300)
  assert.deepEqual(f.excluded, { insurance: 0, equity: 5e6, fixedAssets: 3e6, receivables: 50000 })
})

test('借款：无月供的无抵押借款扣分子，有月供进分母，不重复计算', () => {
  const sheet = sheetOf({ cash: 100000 })
  const base = { direction: 'BORROW', counterparty: '老王', balance: 30000 }
  const months = year(36500, 0, 0)
  const unsecured = computeFreedom({ sheet, months, now: NOW, loans: [{ ...base, id: 2n, kind: 'PERSONAL' }] })
  assert.equal(unsecured.available, 70000)
  assert.equal(unsecured.totals.principal, 0)
  const paying = computeFreedom({ sheet, months, now: NOW, loans: [{ ...base, id: 2n, kind: 'PERSONAL', monthlyPayment: 1000, annualRate: 0 }] })
  assert.equal(paying.available, 100000)
  assert.equal(paying.totals.principal, 12000)
})

test('借款：TO_CONFIRM、不计净资产的、借出的都不算', () => {
  const loans = [
    { id: 1n, direction: 'BORROW', kind: 'PERSONAL', counterparty: 'a', balance: 100, status: 'TO_CONFIRM' },
    { id: 2n, direction: 'BORROW', kind: 'PERSONAL', counterparty: 'b', balance: 100, includeInNetWorth: false },
    { id: 3n, direction: 'LEND', kind: 'PERSONAL', counterparty: 'c', balance: 100 }
  ]
  assert.equal(computeFreedom({ sheet: sheetOf({ cash: 1000 }), months: year(36500, 0, 0), loans, now: NOW }).available, 1000)
})

test('房贷缺月供：不扣分子，按 0 计，给提示', () => {
  const f = sample({ loans: [{ ...mortgage, monthlyPayment: null }] })
  assert.equal(f.available, 590000)
  assert.equal(f.totals.principal, 0)
  assert.ok(f.warnings.some((w) => w.key === 'noMonthlyPayment'))
})

test('本金：年利率是百分数，只取本金；利率为空时整个月供算本金并提示', () => {
  assert.equal(monthlyPrincipal(6000, 1000000, 3.6), 3000)
  assert.equal(monthlyPrincipal(1000, 1000000, 3.6), 0) // 月供小于利息不出负数
  assert.equal(monthlyPrincipal(6000, 1000000, 0), 6000)
  const f = sample({ loans: [{ ...mortgage, annualRate: null }] })
  assert.equal(f.totals.principal, 72000)
  assert.ok(f.warnings.some((w) => w.key === 'noRate'))
})

test('分母：不足 12 个月按有效月算，天数和本金都跟着有效月', () => {
  const months = PERIODS.map((p, i) => (i < 9 ? monthOf(p, 0) : monthOf(p, 3000)))
  const f = computeFreedom({ sheet: sheetOf({ cash: 92000 }), months, loans: [mortgage], now: NOW })
  assert.deepEqual(f.window, { from: '2026-07', to: '2026-09', months: 3, days: 92 })
  assert.equal(f.totals.living, 9000)
  assert.equal(f.totals.principal, 9000)
  assert.equal(f.days.living, 470) // 92000 × 92 ÷ 18000
})

test('state：有效月不足、被动覆盖、资金见底', () => {
  const short = computeFreedom({ sheet: sheetOf({ cash: 1000 }), months: PERIODS.map((p, i) => monthOf(p, i > 9 ? 1000 : 0)), loans: [], now: NOW })
  assert.equal(short.state, 'INSUFFICIENT')
  assert.equal(short.need, 1)
  assert.equal(short.days, null)

  const covered = computeFreedom({ sheet: sheetOf({ cash: 1000 }), months: year(12000, 0, 12000), loans: [], now: NOW })
  assert.equal(covered.state, 'COVERED')
  assert.equal(covered.days.living, null)

  const empty = computeFreedom({ sheet: sheetOf({ cash: 1000, creditDebt: 5000 }), months: year(36500, 0, 0), loans: [], now: NOW })
  assert.equal(empty.state, 'DEPLETED')
  assert.equal(empty.days.living, 0)
  assert.equal(empty.available, -4000)
})

test('生活线正常、生存线被被动收入覆盖：生存线没有天数', () => {
  const f = computeFreedom({ sheet: sheetOf({ cash: 100000 }), months: year(10000, 26500, 12000), loans: [], now: NOW })
  assert.equal(f.state, 'OK')
  assert.equal(f.days.living, 1489) // 100000 × 365 ÷ 24500
  assert.equal(f.days.survival, null)
  assert.equal(f.depleteDate.survival, null)
})

test('提示：未归类、账户、持仓、公司款、异常大额', () => {
  const months = year(12000, 0, 0)
  months[3] = { ...monthOf(PERIODS[3], 40000), uncategorized: 500 }
  const f = computeFreedom({
    sheet: sheetOf({ cash: 1000, staleAccounts: [{ id: 1, name: 'x' }] }), months, loans: [], now: NOW, staleHoldings: 2, pendingBusiness: 1
  })
  assert.deepEqual(f.warnings.map((w) => w.key).sort(), ['pendingBusiness', 'spike', 'staleAccount', 'staleHolding', 'uncategorized'])
})

test('模拟：一次性和长期的差别（设计文档第 7 节）', () => {
  const base = computeFreedom({ sheet: sheetOf({ cash: 600000 }), months: year(120000, 0, 0), loans: [], now: NOW })
  assert.equal(base.days.living, 1825)
  const once = simulateFreedom(base, { oneOff: 6000 })
  assert.equal(once.after.days.living, 1806)
  assert.equal(once.delta.living, -19)
  const monthly = simulateFreedom(base, { monthly: 500 })
  assert.equal(monthly.after.days.living, 1738)
  assert.equal(monthly.delta.living, -87)
  assert.deepEqual(simulateFreedom(base, {}).delta, { living: 0, survival: 0 })
})

test('模拟：提前还贷减分子，月供按比例减少', () => {
  const base = sample()
  const r = simulateFreedom(base, { loanId: '1', prepay: 100000 })
  assert.equal(r.after.available, 490000)
  // 少还 600/月：(365000 + 36000 − 14600 − 7200) ÷ 365
  assert.equal(r.after.days.living, Math.floor((490000 * 365) / (365000 + 36000 - 14600 - 7200)))
  assert.match(r.note, /以银行为准/)
})

test('模拟：还没填月供的无抵押借款，分子不变', () => {
  const loan = { id: 2n, direction: 'BORROW', kind: 'PERSONAL', counterparty: '老王', balance: 30000 }
  const base = computeFreedom({ sheet: sheetOf({ cash: 100000 }), months: year(36500, 0, 0), loans: [loan], now: NOW })
  assert.equal(simulateFreedom(base, { loanId: '2', prepay: 10000 }).after.available, 70000)
})

test('模拟：每月减少到被动收入能覆盖时，after 没有天数，delta 为 null', () => {
  const base = computeFreedom({ sheet: sheetOf({ cash: 100000 }), months: year(12000, 0, 6000), loans: [], now: NOW })
  const r = simulateFreedom(base, { monthly: -500 })
  assert.equal(r.state, 'COVERED')
  assert.equal(r.after.days.living, null)
  assert.equal(r.delta.living, null)
})

test('模拟：数据不够时不出数字', () => {
  const base = computeFreedom({ sheet: sheetOf({ cash: 1000 }), months: [], loans: [], now: NOW })
  const r = simulateFreedom(base, { oneOff: 100 })
  assert.equal(r.state, 'INSUFFICIENT')
  assert.equal(r.after, null)
})

// ---------- 接口 ----------

let t, me, other, ledger
const monthsAgo = (i) => {
  const d = new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() - i, 10)).toISOString().slice(0, 10)
}
const spend = (u, i, amount, code, o = {}) =>
  t.data('POST', '/transactions', u.token, { direction: 'OUT', amount, txnDate: monthsAgo(i), accountId: String(u.bank.id), categoryId: String(u.cat[code].id), ...o })

before(async () => {
  t = await boot()
  me = await t.createUser('me')
  other = await t.createUser('she')
  for (const i of [1, 2, 3]) {
    await spend(me, i, 1000, 'A1')
    await spend(me, i, 500, 'B1')
  }
  await spend(me, 0, 99999, 'B1') // 当月不进窗口
  await spend(me, 1, 7777, 'B1', { isBusiness: true, businessOrg: '公司' }) // 公司款不进分母
  await spend(me, 1, 8888, 'T5') // 转移类不进分母
  await prisma.account.update({ where: { id: me.bank.id }, data: { balance: 90000 } })
  ledger = async (u) => ({
    txns: await prisma.transaction.count({ where: { userId: u.id } }),
    drafts: await prisma.aiDraft.count({ where: { userId: u.id } }),
    bank: String((await prisma.account.findUnique({ where: { id: u.bank.id } })).balance)
  })
})
after(async () => { await t.cleanup(); await t.close() })

test('GET /freedom：窗口不含当月，公司款和转移类不计', async () => {
  const f = await t.data('GET', '/freedom', me.token)
  assert.equal(f.state, 'OK')
  assert.equal(f.window.months, 3)
  assert.equal(f.totals.living, 4500)
  assert.equal(f.totals.survival, 3000)
  assert.equal(f.excluded.equity, 0)
  assert.equal(f.breakdown.creditDebt, 3000)
})

test('租户隔离：别人的流水不进我的结果，我的也不进别人的', async () => {
  const f = await t.data('GET', '/freedom', other.token)
  assert.equal(f.state, 'INSUFFICIENT')
  assert.equal(f.totals.living, 0)
  assert.equal(f.available, 7400) // 她自己的 1 万余额 + 400 基金 − 3000 卡
})

test('未登录：401', async () => {
  assert.equal((await t.call('GET', '/freedom', null)).status, 401)
  assert.equal((await t.call('GET', '/freedom/simulate', null)).status, 401)
})

test('simulate：结果可用，前后流水、草稿、余额都不变', async () => {
  const a = await ledger(me)
  const r = await t.data('GET', '/freedom/simulate?oneOff=6000&monthly=500', me.token)
  assert.ok(r.after.days.living < r.before.days.living)
  assert.match(r.note, /不写入账本/)
  assert.deepEqual(await ledger(me), a)
})

test('simulate：参数不合法、借款不是自己的、还款超过本金，都拒绝', async () => {
  assert.equal((await t.call('GET', '/freedom/simulate?oneOff=-1', me.token)).code, 9002)
  assert.equal((await t.call('GET', '/freedom/simulate?monthly=abc', me.token)).code, 9002)
  const hers = await prisma.loan.create({ data: { userId: other.id, direction: 'BORROW', kind: 'MORTGAGE', counterparty: '她的房贷', principal: 1000, balance: 1000 } })
  assert.equal((await t.call('GET', `/freedom/simulate?prepay=10&loanId=${hers.id}`, me.token)).code, 9002)
  const mine = await prisma.loan.create({ data: { userId: me.id, direction: 'BORROW', kind: 'MORTGAGE', counterparty: '我的房贷', principal: 1000, balance: 1000, monthlyPayment: 100, annualRate: 3 } })
  assert.match((await t.call('GET', `/freedom/simulate?prepay=2000&loanId=${mine.id}`, me.token)).message, /超过未还本金/)
  assert.equal((await t.call('GET', `/freedom/simulate?prepay=500&loanId=${mine.id}`, me.token)).code, 0)
  await prisma.loan.deleteMany({ where: { id: { in: [hers.id, mine.id] } } })
})

test('GET /transactions：带科目分组，前端靠它判断要不要显示「≈ N 天」', async () => {
  const { list } = await t.data('GET', '/transactions?page_size=50', me.token)
  assert.ok(list.some((r) => r.category?.groupName === '弹性'))
})

test('GET /dashboard：原字段都在，只多 freedom', async () => {
  const d = await t.data('GET', '/dashboard', me.token)
  assert.deepEqual(Object.keys(d).sort(), ['accounts', 'alerts', 'freedom', 'month', 'period', 'sheet', 'snapshots', 'trend'])
  assert.equal(d.freedom.state, 'OK')
  assert.ok('liquid' in d.sheet)
})

test('月结：快照冻结 freedom，摘要多一节', async () => {
  const period = monthsAgo(0).slice(0, 7)
  const row = await t.data('POST', '/close/snapshot', me.token, { period })
  assert.equal(row.detail.freedom.state, 'OK')
  assert.ok(row.detail.sheet && row.detail.stats)
  assert.match((await t.data('GET', `/close/summary?period=${period}`, me.token)).markdown, /## 五、自由天数/)
  assert.match((await t.data('GET', `/close/summary?period=${period}`, other.token)).markdown, /再记 3 个月/)
})
