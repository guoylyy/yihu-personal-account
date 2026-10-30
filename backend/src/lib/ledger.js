// 记账业务动作：手工录入、AI 录入、导入共用这一层，保证口径一致
// 硬约定：写流水后必须重算账户余额；动持仓/借贷时同步写对应的现金流水（选了资金账户才写）
import prisma from './prisma.js'
import { Prisma } from '@prisma/client'
import { nextTxnCode } from './code.js'
import { recalcAccountBalance } from './balance.js'
import { toDate } from './period.js'
import { categoryByCode, learnRule } from './classify.js'
import { logAudit } from './audit.js'
import { round2 } from './money.js'
import { resolveUid, tenantWhere } from './tenant.js'
import crypto from 'node:crypto'

const D = (v) => new Prisma.Decimal(v || 0)
const big = (v) => (v === undefined || v === null || v === '' ? null : BigInt(v))

// 引用的账户/科目必须属于当前用户：请求和草稿里的 id 都是前端传的，不校验就会把流水挂到别人的账户上
const ownId = (v, label) => {
  if (!/^[1-9]\d{0,18}$/.test(String(v))) throw new Error(`${label}不存在或无权访问`)
  return BigInt(v)
}
export async function assertOwnRefs({ accountIds = [], categoryId }, userId) {
  for (const a of accountIds) {
    if (a === undefined || a === null || a === '') continue
    if (!(await prisma.account.findFirst({ where: { id: ownId(a, '账户'), userId, deletedAt: null }, select: { id: true } }))) throw new Error('账户不存在或无权访问')
  }
  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    if (!(await prisma.category.findFirst({ where: { id: ownId(categoryId, '科目'), userId, deletedAt: null }, select: { id: true } }))) throw new Error('科目不存在或无权访问')
  }
}

export async function createTransaction(input, { source = 'MANUAL', recalc = true } = {}) {
  const amount = round2(Math.abs(Number(input.amount)))
  if (!amount) throw new Error('金额不能为 0')
  if (!['IN', 'OUT'].includes(input.direction)) throw new Error('收支方向只能是 IN / OUT')
  const txnDate = toDate(input.txnDate || new Date())
  const userId = resolveUid(input.userId)
  let categoryId = big(input.categoryId)
  if (!categoryId && input.categoryCode) categoryId = (await categoryByCode(input.categoryCode, userId))?.id || null
  await assertOwnRefs({ accountIds: [input.accountId], categoryId }, userId)

  // 编号是读最大值再加一，并发时撞唯一索引就重新取号
  const insert = async (code) => prisma.transaction.create({
    data: {
      userId,
      code,
      txnDate,
      txnTime: input.txnTime || null,
      direction: input.direction,
      amount,
      accountId: big(input.accountId),
      categoryId,
      counterparty: input.counterparty || null,
      description: input.description || null,
      channel: input.channel || null,
      payMethod: input.payMethod || null,
      isBusiness: !!input.isBusiness,
      businessOrg: input.isBusiness ? input.businessOrg || null : null,
      bizStatus: input.isBusiness ? input.bizStatus || 'PENDING' : null,
      transferGroup: input.transferGroup || null,
      source,
      importBatch: input.importBatch || null,
      externalId: input.externalId || null,
      refType: input.refType || null,
      refId: big(input.refId),
      remark: input.remark || null
    }
  })
  let row
  for (let attempt = 0; !row; attempt++) {
    try {
      row = await insert(input.code || (await nextTxnCode(txnDate, userId)))
    } catch (e) {
      if (input.code || e?.code !== 'P2002' || !String(e.meta?.target).includes('code') || attempt >= 5) throw e
    }
  }
  if (recalc && row.accountId) await recalcAccountBalance(row.accountId, userId)
  return row
}

const EDITABLE = ['txnDate', 'txnTime', 'direction', 'amount', 'accountId', 'categoryId', 'counterparty', 'description', 'channel', 'isBusiness', 'businessOrg', 'bizStatus', 'remark']

/** 改流水：手工编辑和 AI「把这笔改成…」共用。流水不存在或不属于当前用户时返回 null */
export async function updateTransaction(rawId, input, { include } = {}) {
  const id = BigInt(rawId)
  const userId = resolveUid()
  const before = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } })
  if (!before) return null
  const data = {}
  for (const k of EDITABLE) {
    if (input[k] === undefined) continue
    let v = input[k] === '' ? null : input[k]
    if (k === 'txnDate') v = toDate(v)
    if ((k === 'accountId' || k === 'categoryId') && v != null) v = BigInt(v)
    if (k === 'amount') v = round2(Math.abs(Number(v)))
    data[k] = v
  }
  // 账户已被软删的老流水，原值原样带回来时不算改动
  await assertOwnRefs({
    accountIds: data.accountId != null && data.accountId !== before.accountId ? [data.accountId] : [],
    categoryId: data.categoryId != null && data.categoryId !== before.categoryId ? data.categoryId : null
  }, userId)
  if (data.isBusiness === true && !before.bizStatus && !data.bizStatus) data.bizStatus = 'PENDING'
  if (data.isBusiness === false) { data.bizStatus = null; data.businessOrg = null }
  const row = await prisma.transaction.update({ where: { id }, data, include })
  for (const a of new Set([before.accountId, row.accountId].filter(Boolean).map(String))) await recalcAccountBalance(a)
  if (input.learn && row.counterparty && row.categoryId) await learnRule(row.counterparty, row.categoryId, row.isBusiness)
  await logAudit({ action: 'UPDATE', entity: '流水', entityId: id, summary: `修改流水 ${row.code}`, before, after: row })
  return row
}

/** 账户互转（含还信用卡、转余额宝）：生成互指的两条流水，科目为转移类，不计收支 */
export async function createTransfer({ fromAccountId, toAccountId, amount, txnDate, description, categoryCode }, opt = {}) {
  if (!fromAccountId || !toAccountId) throw new Error('转账需要转出和转入两个账户')
  if (String(fromAccountId) === String(toAccountId)) throw new Error('转出和转入不能是同一个账户')
  await assertOwnRefs({ accountIds: [fromAccountId, toAccountId] }, resolveUid())
  const [from, to] = await Promise.all([
    prisma.account.findFirst({ where: tenantWhere({ id: BigInt(fromAccountId) }) }),
    prisma.account.findFirst({ where: tenantWhere({ id: BigInt(toAccountId) }) })
  ])
  const code = categoryCode || (to.type === 'CREDIT' ? 'T2' : 'T1')
  const group = `TR-${crypto.randomBytes(5).toString('hex')}`
  const base = { amount, txnDate, categoryCode: code, transferGroup: group, description: description || `${from.name} → ${to.name}` }
  const out = await createTransaction({ ...base, direction: 'OUT', accountId: from.id, counterparty: to.name }, opt)
  const inn = await createTransaction({ ...base, direction: 'IN', accountId: to.id, counterparty: from.name }, opt)
  return [out, inn]
}

/** 余额校准：以今天（或指定日）的真实余额为新期初，之前的流水保留但不再影响余额 */
export async function calibrateBalance(accountId, actual, date) {
  const id = BigInt(accountId)
  const before = await prisma.account.findFirst({ where: tenantWhere({ id }) })
  if (!before) throw new Error('账户不存在')
  await prisma.account.update({ where: { id }, data: { initialBalance: round2(actual), initialDate: toDate(date || new Date()) } })
  const after = await recalcAccountBalance(id, before.userId)
  await logAudit({ action: 'CALIBRATE', entity: 'account', entityId: id, summary: `${before.name} 余额校准 ${before.balance} → ${actual}`, before, after })
  return after
}

// ─────────────── 投资 ───────────────

export function holdingMarketValue(h) {
  if (h.price != null && Number(h.quantity) > 0 && ['STOCK', 'FUND'].includes(h.type)) {
    return round2(Number(h.quantity) * Number(h.price))
  }
  return Number(h.marketValue)
}

/**
 * 持仓交易
 * BUY       数量+、成本+（金额+费用）；选了资金账户 → 账户 OUT（T3 投资买卖，不算消费）
 * SELL      数量−、按比例结转成本、实现收益 = 成交额 − 费用 − 结转成本；资金账户 IN
 * DIVIDEND  实现收益+；资金账户 IN（I5 投资收益）
 * VALUATION 更新现价/市值（理财、股权等没有份额的直接给市值）
 */
export async function holdingTrade(input, { source = 'MANUAL' } = {}) {
  const userId = resolveUid(input.userId)
  const h = await prisma.holding.findFirst({ where: tenantWhere({ id: BigInt(input.holdingId), deletedAt: null }) })
  if (!h) throw new Error('持仓不存在')
  await assertOwnRefs({ accountIds: [input.cashAccountId] }, userId)
  const action = input.action
  const qty = input.quantity != null && input.quantity !== '' ? Number(input.quantity) : null
  const price = input.price != null && input.price !== '' ? Number(input.price) : null
  const fee = Number(input.fee || 0)
  let amount = input.amount != null && input.amount !== '' ? Number(input.amount) : null
  if (amount == null && qty != null && price != null) amount = round2(qty * price)
  const tradeDate = toDate(input.tradeDate || new Date())

  const data = {}
  let pnl = null
  let cash = null // { direction, amount, categoryCode }

  if (action === 'BUY') {
    if (!amount) throw new Error('买入需要金额，或数量 × 价格')
    data.quantity = D(h.quantity).plus(qty || 0)
    data.costAmount = D(h.costAmount).plus(amount + fee)
    if (price != null) data.price = price
    if (!['STOCK', 'FUND'].includes(h.type) || price == null) data.marketValue = D(h.marketValue).plus(amount)
    cash = { direction: 'OUT', amount: amount + fee, categoryCode: 'T3' }
  } else if (action === 'SELL') {
    if (!amount) throw new Error('卖出需要金额，或数量 × 价格')
    const hq = Number(h.quantity)
    const ratio = hq > 0 && qty ? Math.min(qty / hq, 1) : Math.min(amount / Math.max(Number(h.marketValue), amount), 1)
    const costOut = round2(Number(h.costAmount) * ratio)
    pnl = round2(amount - fee - costOut)
    data.quantity = hq > 0 && qty ? D(h.quantity).minus(qty) : h.quantity
    data.costAmount = D(h.costAmount).minus(costOut)
    data.realizedPnl = D(h.realizedPnl).plus(pnl)
    if (price != null) data.price = price
    if (!['STOCK', 'FUND'].includes(h.type) || price == null) data.marketValue = Prisma.Decimal.max(D(h.marketValue).minus(amount), 0)
    if (ratio >= 0.9999) data.status = 'CLOSED'
    cash = { direction: 'IN', amount: amount - fee, categoryCode: 'T3' }
  } else if (action === 'DIVIDEND') {
    if (!amount) throw new Error('分红需要金额')
    pnl = amount
    data.realizedPnl = D(h.realizedPnl).plus(amount)
    cash = { direction: 'IN', amount, categoryCode: 'I5' }
  } else if (action === 'VALUATION') {
    if (price != null) data.price = price
    if (amount != null) data.marketValue = amount
    else if (price != null && Number(h.quantity) > 0) data.marketValue = round2(Number(h.quantity) * price)
    else throw new Error('估值需要新市值或新价格')
    data.valuedAt = tradeDate
  } else {
    throw new Error(`不支持的操作：${action}`)
  }

  const next = { ...h, ...data }
  if (['STOCK', 'FUND'].includes(h.type) && next.price != null && Number(next.quantity) > 0) {
    data.marketValue = round2(Number(next.quantity) * Number(next.price))
  }
  if (action !== 'VALUATION') data.valuedAt = tradeDate

  await prisma.holding.update({ where: { id: h.id }, data })
  const trade = await prisma.holdingTrade.create({
    data: {
      userId, holdingId: h.id, tradeDate, action, quantity: qty, price, amount: amount || 0, fee, pnl,
      cashAccountId: big(input.cashAccountId), source, remark: input.remark || null
    }
  })
  if (cash && input.cashAccountId) {
    const txn = await createTransaction({
      userId,
      direction: cash.direction, amount: cash.amount, txnDate: tradeDate, accountId: input.cashAccountId,
      categoryCode: cash.categoryCode, counterparty: h.platform || h.name,
      description: `${{ BUY: '买入', SELL: '卖出', DIVIDEND: '分红' }[action]} ${h.name}${qty ? ` ${qty}` : ''}`,
      refType: 'HOLDING_TRADE', refId: trade.id
    }, { source })
    await prisma.holdingTrade.update({ where: { id: trade.id }, data: { transactionId: txn.id } })
  }
  await logAudit({ action: 'TRADE', entity: 'holding', entityId: h.id, summary: `${h.name} ${action} ${amount ?? ''}`, before: h, after: data })
  return trade
}

// ─────────────── 固定资产 ───────────────

export async function assetValuation({ assetId, value, valDate, note }, { source = 'MANUAL' } = {}) {
  const userId = resolveUid()
  const a = await prisma.fixedAsset.findFirst({ where: tenantWhere({ id: BigInt(assetId), deletedAt: null }) })
  if (!a) throw new Error('资产不存在')
  const d = toDate(valDate || new Date())
  const v = await prisma.assetValuation.create({ data: { userId, assetId: a.id, valDate: d, value: round2(value), note: note || null, source } })
  await prisma.fixedAsset.update({ where: { id: a.id }, data: { currentValue: round2(value), valuedAt: d, valuationNote: note || a.valuationNote } })
  await logAudit({ action: 'VALUATION', entity: 'fixedAsset', entityId: a.id, summary: `${a.name} 估值 ${a.currentValue} → ${value}` })
  return v
}

// ─────────────── 借贷 ───────────────

/**
 * 还款 / 回款
 * BORROW（我欠别人）：本金 → 账户 OUT（T5 不算消费），利息 → 账户 OUT（A9 住房利息 / B1）
 * LEND（别人欠我）：本金 → 账户 IN（T5），利息 → 账户 IN（I4 其他收入）
 */
export async function loanRepay(input, { source = 'MANUAL' } = {}) {
  const userId = resolveUid(input.userId)
  const loan = await prisma.loan.findFirst({ where: tenantWhere({ id: BigInt(input.loanId), deletedAt: null }) })
  if (!loan) throw new Error('借贷记录不存在')
  const principal = round2(input.principalPart || 0)
  const interest = round2(input.interestPart || 0)
  if (!principal && !interest) throw new Error('本金和利息至少填一个')
  await assertOwnRefs({ accountIds: [input.accountId] }, userId)
  const repayDate = toDate(input.repayDate || new Date())
  const rep = await prisma.loanRepayment.create({
    data: { userId, loanId: loan.id, repayDate, principalPart: principal, interestPart: interest, accountId: big(input.accountId), source, remark: input.remark || null }
  })
  const balance = Prisma.Decimal.max(D(loan.balance).minus(principal), 0)
  await prisma.loan.update({ where: { id: loan.id }, data: { balance, status: balance.isZero() ? 'SETTLED' : loan.status } })

  if (input.accountId) {
    const dir = loan.direction === 'BORROW' ? 'OUT' : 'IN'
    const label = loan.direction === 'BORROW' ? '还款' : '回款'
    const common = { userId, direction: dir, txnDate: repayDate, accountId: input.accountId, counterparty: loan.counterparty, refType: 'LOAN_REPAY', refId: rep.id }
    if (principal) await createTransaction({ ...common, amount: principal, categoryCode: 'T5', description: `${label}本金` }, { source })
    if (interest) {
      const code = loan.direction === 'LEND' ? 'I4' : loan.kind === 'MORTGAGE' ? 'A9' : 'B1'
      await createTransaction({ ...common, amount: interest, categoryCode: code, description: `${label}利息` }, { source })
    }
  }
  await logAudit({ action: 'REPAY', entity: 'loan', entityId: loan.id, summary: `${loan.counterparty} 本金 ${principal} 利息 ${interest}` })
  return rep
}
