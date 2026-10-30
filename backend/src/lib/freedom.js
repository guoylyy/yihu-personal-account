// 自由天数：不再有工作收入时，按现在的生活方式手上的钱能撑多少天。口径见 docs/设计-自由天数.md
// 页面、月结、AI 工具都从这里取，不各算各的。纯函数不碰数据库；取数函数全部带租户过滤
//   自由天数 = 可动用资金 ÷ 每日净消耗
//   可动用资金 = 现金 + 金融投资 − 储蓄险 − 信用卡欠款 − 无月供的无抵押借款
//   每日净消耗 =（支出 + 必还本金 − 被动收入）÷ 统计天数
import dayjs from 'dayjs'
import prisma from './prisma.js'
import { round2 } from './money.js'
import { balanceSheet, periodStats } from './networth.js'
import { lastPeriods, periodRange } from './period.js'
import { holdingMarketValue } from './ledger.js'
import { resolveUid } from './tenant.js'

const n = Number
const WINDOW = 12 // 近 12 个完整月，不含当月
const MIN_MONTHS = 3 // 有效月少于这个数不出数字
const STALE_DAYS = 35
const SPIKE_RATIO = 3
const LINES = ['living', 'survival']
const SECURED = ['MORTGAGE', 'CAR']

export class SimulateError extends Error {}

const counted = (x) => x.includeInNetWorth !== false && x.status !== 'TO_CONFIRM'
const hasPayment = (l) => l.monthlyPayment != null && n(l.monthlyPayment) > 0

/** 月供里的本金。annualRate 存的是百分数（3.85 = 3.85%），利息已在 A9 / B1 里，这里只取本金 */
export function monthlyPrincipal(payment, balance, annualRate) {
  const interest = annualRate == null ? 0 : (n(balance) * n(annualRate)) / 100 / 12
  return Math.max(0, n(payment) - interest)
}

function median(list) {
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 一条线的结果。向下取整；净消耗 ≤ 0 时没有天数，不给 ∞ */
function lineOf(available, total, days, today) {
  if (total <= 0) return { daily: round2(total / days), days: null, depleteDate: null }
  const d = available <= 0 ? 0 : Math.floor((available * days) / total + 1e-9)
  return { daily: round2(total / days), days: d, depleteDate: dayjs(today).add(d, 'day').format('YYYY-MM-DD') }
}

function linesOf(available, nets, days, today) {
  const out = {}
  for (const k of LINES) out[k] = lineOf(available, nets[k], days, today)
  return out
}

const stateOf = (available, living) => (living.days == null ? 'COVERED' : available <= 0 ? 'DEPLETED' : 'OK')

/**
 * 纯计算
 * months：窗口内每月的 periodStats；loans：计入与否在这里判断
 * staleHoldings / pendingBusiness 是取数时查好的提示用数字，不影响结果
 */
export function computeFreedom({ sheet, months, loans, now = new Date(), staleHoldings = 0, pendingBusiness = 0 }) {
  const insurance = n(sheet.investByType?.INSURANCE || 0)
  const investments = sheet.investments - insurance
  const borrowed = loans.filter((l) => l.direction === 'BORROW' && counted(l))
  const unsecuredDebt = borrowed.filter((l) => !hasPayment(l) && !SECURED.includes(l.kind)).reduce((s, l) => s + n(l.balance), 0)
  const available = round2(sheet.cash + investments - sheet.creditDebt - unsecuredDebt)

  const paying = borrowed.filter(hasPayment)
  const principalPerMonth = paying.reduce((s, l) => s + monthlyPrincipal(l.monthlyPayment, l.balance, l.annualRate), 0)

  const effective = months.filter((m) => m.expense > 0)
  const windowDays = effective.reduce((s, m) => s + dayjs(`${m.period}-01`).daysInMonth(), 0)
  const expense = effective.reduce((s, m) => s + m.expense, 0)
  const necessary = effective.reduce((s, m) => s + m.byCategory.filter((c) => c.group === '必要').reduce((x, c) => x + c.amount, 0), 0)
  const passive = effective.reduce((s, m) => s + m.byCategory.filter((c) => c.code === 'I5').reduce((x, c) => x + c.amount, 0), 0)
  const principal = principalPerMonth * effective.length

  const base = {
    available,
    breakdown: { cash: sheet.cash, investments: round2(investments), creditDebt: sheet.creditDebt, unsecuredDebt: round2(unsecuredDebt) },
    excluded: { insurance: round2(insurance), equity: sheet.equity, fixedAssets: sheet.fixedAssets, receivables: sheet.receivables },
    window: { from: effective[0]?.period || null, to: effective.at(-1)?.period || null, months: effective.length, days: windowDays },
    totals: { living: round2(expense), survival: round2(necessary), principal: round2(principal), passive: round2(passive) },
    loans: paying.concat(borrowed.filter((l) => !hasPayment(l))).map((l) => ({
      id: String(l.id), counterparty: l.counterparty, kind: l.kind, balance: n(l.balance),
      monthlyPayment: hasPayment(l) ? n(l.monthlyPayment) : null,
      monthlyPrincipal: hasPayment(l) ? round2(monthlyPrincipal(l.monthlyPayment, l.balance, l.annualRate)) : null
    })),
    warnings: warningsOf({ sheet, months, effective, borrowed, paying, staleHoldings, pendingBusiness })
  }

  if (effective.length < MIN_MONTHS) {
    return { state: 'INSUFFICIENT', need: MIN_MONTHS - effective.length, ...base, daily: null, days: null, depleteDate: null, passiveCoverage: null }
  }
  const nets = { living: expense + principal - passive, survival: necessary + principal - passive }
  const r = linesOf(available, nets, windowDays, now)
  const burn = expense + principal
  return {
    state: stateOf(available, r.living),
    ...base,
    daily: { living: r.living.daily, survival: r.survival.daily, principal: round2(principal / windowDays), passive: round2(passive / windowDays) },
    days: { living: r.living.days, survival: r.survival.days },
    depleteDate: { living: r.living.depleteDate, survival: r.survival.depleteDate },
    passiveCoverage: burn > 0 ? Math.round((passive / burn) * 1000) / 10 : null
  }
}

function warningsOf({ sheet, months, effective, borrowed, paying, staleHoldings, pendingBusiness }) {
  const out = []
  const add = (key, text, link) => out.push({ key, text, link })
  const uncategorized = round2(months.reduce((s, m) => s + m.uncategorized, 0))
  if (uncategorized > 0) add('uncategorized', `有 ¥${uncategorized.toLocaleString()} 支出还没归类，只保必要的天数偏高`, '/transactions?category_id=none')
  if (pendingBusiness) add('pendingBusiness', `${pendingBusiness} 笔公司款待剥离：支出已剔除，但垫付的钱还没回到账上`, '/transactions?scope=business&biz_status=PENDING')
  if (sheet.staleAccounts?.length) add('staleAccount', `${sheet.staleAccounts.length} 个账户超过 ${STALE_DAYS} 天没校准，可动用资金可能不准`, '/accounts')
  if (staleHoldings) add('staleHolding', `${staleHoldings} 个持仓的市值超过 ${STALE_DAYS} 天没更新，可动用资金可能不准`, '/holdings')
  const noPayment = borrowed.filter((l) => SECURED.includes(l.kind) && !hasPayment(l))
  if (noPayment.length) add('noMonthlyPayment', `${noPayment.map((l) => l.counterparty).join('、')} 没填月供，天数偏高`, '/loans')
  const noRate = paying.filter((l) => l.annualRate == null)
  if (noRate.length) add('noRate', `${noRate.map((l) => l.counterparty).join('、')} 没填年利率，整个月供按本金算，天数偏低`, '/loans')
  const usual = effective.length >= MIN_MONTHS ? median(effective.map((m) => m.expense)) : 0
  const spikes = effective.filter((m) => usual > 0 && m.expense > usual * SPIKE_RATIO).map((m) => m.period)
  if (spikes.length) add('spike', `${spikes.join('、')} 的支出超过平时 ${SPIKE_RATIO} 倍，一次性大额抬高了日均`, '/transactions')
  return out
}

/**
 * 模拟决策：只算不存。一次性支出只减分子；长期增减只改分母；提前还贷减分子，月供按比例减少
 * 返回 null 的 days 表示这条线的净消耗 ≤ 0（被动收入已覆盖）
 */
export function simulateFreedom(base, { oneOff = 0, monthly = 0, loanId = null, prepay = 0 } = {}) {
  const note = '估算，不写入账本'
  if (base.state === 'INSUFFICIENT') return { state: base.state, need: base.need, before: null, after: null, delta: null, note }
  const { months, days } = base.window
  const loan = prepay ? base.loans.find((l) => l.id === String(loanId)) : null
  // 没填月供的无抵押借款已从分子扣掉，还掉它现金和欠款同减，分子不变
  const alreadyDeducted = loan && loan.monthlyPayment == null && !SECURED.includes(loan.kind)
  const available = base.available - oneOff - (alreadyDeducted ? 0 : prepay)
  const savedPayment = loan?.monthlyPayment ? (loan.monthlyPayment * prepay) / loan.balance : 0
  const delta = (monthly - savedPayment) * months
  const { living, survival, principal, passive } = base.totals
  const carry = principal - passive + delta
  const after = linesOf(available, { living: living + carry, survival: survival + carry }, days, dayjs())
  const before = { available: base.available, days: base.days, depleteDate: base.depleteDate }
  const diff = (k) => (before.days[k] == null || after[k].days == null ? null : after[k].days - before.days[k])
  return {
    state: stateOf(available, after.living),
    before,
    after: {
      available: round2(available),
      days: { living: after.living.days, survival: after.survival.days },
      depleteDate: { living: after.living.depleteDate, survival: after.survival.depleteDate }
    },
    delta: { living: diff('living'), survival: diff('survival') },
    note: prepay ? `${note}；提前还贷后的月供按比例估算，具体以银行为准` : note
  }
}

// ---------- 取数 ----------

export async function freedomOverview(uid) {
  const userId = resolveUid(uid)
  const now = new Date()
  const periods = lastPeriods(WINDOW, dayjs(now).subtract(1, 'month'))
  const staleBefore = dayjs(now).subtract(STALE_DAYS, 'day').toDate()
  const [sheet, stats, loans, holdings, pendingBusiness] = await Promise.all([
    balanceSheet(userId),
    Promise.all(periods.map((p) => periodStats(p, userId))),
    prisma.loan.findMany({ where: { userId, deletedAt: null, status: { not: 'SETTLED' } }, orderBy: { id: 'asc' } }),
    prisma.holding.findMany({ where: { userId, deletedAt: null, status: 'HOLDING', type: { notIn: ['EQUITY', 'INSURANCE'] } } }),
    prisma.transaction.count({
      where: { userId, deletedAt: null, isBusiness: true, bizStatus: 'PENDING', txnDate: { gte: periodRange(periods[0]).start, lte: periodRange(periods.at(-1)).end } }
    })
  ])
  const staleHoldings = holdings.filter((h) => counted(h) && holdingMarketValue(h) > 0 && (!h.valuedAt || new Date(h.valuedAt) < staleBefore)).length
  return computeFreedom({ sheet, months: stats, loans, now, staleHoldings, pendingBusiness })
}

/** 校验并模拟。输入不合法抛 Error（message 给用户看），路由转成 9002 */
export async function freedomSimulate(query, uid) {
  const num = (k, { min } = {}) => {
    const raw = query[k]
    if (raw === undefined || raw === '') return 0
    const v = Number(raw)
    if (!Number.isFinite(v) || (min != null && v < min)) throw new SimulateError(`${k} 不合法`)
    return v
  }
  const input = { oneOff: num('oneOff', { min: 0 }), monthly: num('monthly'), prepay: num('prepay', { min: 0 }), loanId: query.loanId || null }
  const base = await freedomOverview(uid)
  if (input.prepay) {
    const loan = base.loans.find((l) => l.id === String(input.loanId))
    if (!loan) throw new SimulateError('提前还贷要选一笔借入的借款')
    if (input.prepay > loan.balance) throw new SimulateError(`提前还款金额超过未还本金 ¥${loan.balance.toLocaleString()}`)
  }
  return simulateFreedom(base, input)
}
