// 个人资产负债表 + 月度收支统计
// 口径：
//   现金类 = 非信用卡账户余额之和；信用卡欠款（余额为负）计入负债
//   金融投资 = 股票/基金/理财/定存/储蓄险 市值；股权单列
//   应收 = 我借出的未还本金；负债 = 我借入的未还本金 + 信用卡欠款
//   includeInNetWorth=false 或 TO_CONFIRM 的条目只展示不计入
//   个人支出不含：转移类科目（互转/还卡/买理财/借贷本金/夫妻划转）和公司款（isBusiness）
import prisma from './prisma.js'
import { round2 } from './money.js'
import { periodRange } from './period.js'
import { holdingMarketValue } from './ledger.js'

const n = Number

export async function balanceSheet() {
  const [accounts, holdings, assets, loans] = await Promise.all([
    prisma.account.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
    prisma.holding.findMany({ where: { deletedAt: null, status: 'HOLDING' } }),
    prisma.fixedAsset.findMany({ where: { deletedAt: null, status: 'HOLDING' } }),
    prisma.loan.findMany({ where: { deletedAt: null, status: { not: 'SETTLED' } } })
  ])

  let cash = 0
  let creditDebt = 0
  for (const a of accounts) {
    const b = n(a.balance)
    if (a.type === 'CREDIT') { if (b < 0) creditDebt += -b } else cash += b
  }
  const counted = (x) => x.includeInNetWorth !== false && x.status !== 'TO_CONFIRM'

  let investments = 0
  let equity = 0
  let investCost = 0
  const byType = {}
  for (const h of holdings) {
    const mv = holdingMarketValue(h)
    if (!counted(h)) continue
    if (h.type === 'EQUITY') equity += mv
    else { investments += mv; investCost += n(h.costAmount) }
    byType[h.type] = round2((byType[h.type] || 0) + mv)
  }
  const fixedAssets = assets.filter(counted).reduce((s, a) => s + n(a.currentValue), 0)
  const receivables = loans.filter((l) => l.direction === 'LEND' && counted(l)).reduce((s, l) => s + n(l.balance), 0)
  const loanDebt = loans.filter((l) => l.direction === 'BORROW' && counted(l)).reduce((s, l) => s + n(l.balance), 0)
  const pending = loans.filter((l) => !counted(l)).map((l) => ({ id: l.id, counterparty: l.counterparty, direction: l.direction, balance: n(l.balance), remark: l.remark }))

  const totalAssets = cash + investments + equity + receivables + fixedAssets
  const liabilities = loanDebt + creditDebt
  const liquid = cash + investments
  return {
    cash: round2(cash), investments: round2(investments), investCost: round2(investCost), equity: round2(equity),
    receivables: round2(receivables), fixedAssets: round2(fixedAssets),
    totalAssets: round2(totalAssets), loanDebt: round2(loanDebt), creditDebt: round2(creditDebt),
    liabilities: round2(liabilities), netWorth: round2(totalAssets - liabilities),
    liquid: round2(liquid),
    debtRatio: totalAssets ? round2((liabilities / totalAssets) * 100) : 0,
    fixedRatio: totalAssets ? round2((fixedAssets / totalAssets) * 100) : 0,
    investByType: byType,
    pendingItems: pending,
    staleAccounts: accounts.filter((a) => !a.initialDate || Date.now() - new Date(a.initialDate).getTime() > 35 * 86400e3)
      .map((a) => ({ id: a.id, name: a.name, since: a.initialDate }))
  }
}

/** 某月个人收支：收入、个人支出、公司款、转移，以及按科目明细 */
export async function periodStats(period) {
  const { start, end } = periodRange(period)
  const rows = await prisma.transaction.groupBy({
    by: ['categoryId', 'direction', 'isBusiness'],
    where: { deletedAt: null, txnDate: { gte: start, lte: end } },
    _sum: { amount: true }, _count: true
  })
  const cats = await prisma.category.findMany()
  const catMap = new Map(cats.map((c) => [String(c.id), c]))
  let income = 0, expense = 0, business = 0, transfer = 0, uncategorized = 0
  const byCategory = {}
  for (const r of rows) {
    const c = r.categoryId ? catMap.get(String(r.categoryId)) : null
    const amt = n(r._sum.amount)
    if (r.isBusiness) { if (r.direction === 'OUT') business += amt; continue }
    if (c?.kind === 'TRANSFER') { transfer += amt; continue }
    if (r.direction === 'IN') {
      if (!c || c.kind === 'INCOME') income += amt
      else expense -= amt // 支出科目上的退款：冲减支出
    } else {
      if (c?.kind === 'INCOME') income -= amt
      else expense += amt
      if (!c) uncategorized += amt
    }
    const kind = c?.kind || (r.direction === 'IN' ? 'INCOME' : 'EXPENSE')
    const key = c?.code || (kind === 'INCOME' ? '未分类收入' : '未分类')
    const o = (byCategory[key] ||= { code: key, name: c?.name || key, kind, group: c?.groupName || '', amount: 0, count: 0 })
    const sign = (kind === 'INCOME') === (r.direction === 'IN') ? 1 : -1
    o.amount = round2(o.amount + sign * amt)
    o.count += r._count
  }
  return {
    period, income: round2(income), expense: round2(expense), business: round2(business), transfer: round2(transfer),
    uncategorized: round2(uncategorized),
    net: round2(income - expense),
    savingRate: income > 0 ? round2(((income - expense) / income) * 100) : null,
    byCategory: Object.values(byCategory).sort((a, b) => b.amount - a.amount)
  }
}
