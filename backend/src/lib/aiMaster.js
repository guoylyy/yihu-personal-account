// AI 助手的基础资料操作：新增 / 修改账户、持仓、资产、借贷，设预算。和记账共用「草稿 → 确认 → 幂等提交」
// 这里不产生流水；能改哪些字段只看 UPDATE_TYPES 的白名单，模型多给的字段进不了库。余额、市值、未还本金要走校准 / 估值 / 还款
import dayjs from 'dayjs'
import prisma from './prisma.js'
import { logAudit } from './audit.js'
import { assertOwnRefs } from './ledger.js'
import { recalcAccountBalance } from './balance.js'
import { invalidateClassifier } from './classify.js'
import { round2 } from './money.js'
import { toDate } from './period.js'
import { resolveUid } from './tenant.js'

export const ACCOUNT_KINDS = ['BANK', 'WECHAT', 'ALIPAY', 'CASH', 'CREDIT']
export const ASSET_KINDS = ['PROPERTY', 'VEHICLE', 'OTHER']
export const LOAN_KINDS = ['PERSONAL', 'COMPANY', 'MORTGAGE', 'CAR', 'CONSUMER', 'OTHER']

const text = (col, max) => ({ col, t: 'text', max })
const num = (col) => ({ col, t: 'number' })
const date = (col) => ({ col, t: 'date' })
const day = (col) => ({ col, t: 'day' })
const oneOf = (col, of) => ({ col, t: 'enum', of })

// 键是草稿字段。ctx 是 aiEntry.buildContext 里的列表，keys 是按名字找记录时比对的字段
export const UPDATE_TYPES = {
  update_account: {
    label: '账户', model: 'account', pin: 'account', nameKey: 'account', idKey: 'accountId', ctx: 'accounts', keys: ['name', 'lastNo'], title: (r) => r.name,
    fields: {
      newName: text('name', 80), institution: text('institution', 80), lastNo: text('lastNo', 20), creditLimit: num('creditLimit'),
      billDay: day('billDay'), repayDay: day('repayDay'), aliases: text('aliases', 500), status: oneOf('status', ['ACTIVE', 'CLOSED']), remark: text('remark', 500)
    }
  },
  update_holding: {
    label: '持仓', model: 'holding', pin: 'holding', nameKey: 'holding', idKey: 'holdingId', ctx: 'holdings', keys: ['name', 'code'], title: (r) => r.name,
    fields: {
      newName: text('name', 80), code: text('code', 30), platform: text('platform', 50), maturityDate: date('maturityDate'),
      annualRate: num('annualRate'), remark: text('remark', 500)
    }
  },
  update_asset: {
    label: '资产', entity: '固定资产', model: 'fixedAsset', pin: 'asset', nameKey: 'asset', idKey: 'assetId', ctx: 'assets', keys: ['name'], title: (r) => r.name,
    fields: {
      newName: text('name', 80), address: text('address', 200), purchaseDate: date('purchaseDate'), purchasePrice: num('purchasePrice'),
      status: oneOf('status', ['HOLDING', 'SOLD']), remark: text('remark', 500)
    }
  },
  update_loan: {
    label: '借贷', model: 'loan', pin: 'loan', nameKey: 'loan', idKey: 'loanId', ctx: 'loans', keys: ['counterparty'], title: (r) => r.counterparty,
    fields: {
      counterparty: text('counterparty', 80), kind: oneOf('kind', LOAN_KINDS), monthlyPayment: num('monthlyPayment'), annualRate: num('annualRate'),
      dueDate: date('dueDate'), contractNo: text('contractNo', 50), remark: text('remark', 500)
    }
  }
}

export const MASTER_TYPES = { new_asset: '新增资产', new_account: '新增账户', set_budget: '设预算', ...Object.fromEntries(Object.entries(UPDATE_TYPES).map(([k, c]) => [k, `修改${c.label}`])) }
export const isUpdateType = (t) => t === 'update_transaction' || !!UPDATE_TYPES[t]

const has = (v) => v !== undefined && v !== null && v !== ''

function convert(key, spec, v) {
  const bad = () => { throw new Error(`${key} 不合法：${v}`) }
  switch (spec.t) {
    case 'text': { const s = String(v).trim(); return s.length > spec.max ? bad() : s }
    case 'number': { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : bad() }
    case 'day': { const x = Number(v); return Number.isInteger(x) && x >= 1 && x <= 31 ? x : bad() }
    case 'date': return toDate(v) || bad()
    case 'enum': return spec.of.includes(v) ? v : bad()
  }
}

/** 这张修改草稿实际要改的字段，键是数据库列 */
export function changesOf(it) {
  const data = {}
  for (const [key, spec] of Object.entries(UPDATE_TYPES[it.type].fields)) {
    if (has(it[key])) data[spec.col] = convert(key, spec, it[key])
  }
  return data
}

async function commitUpdate(it) {
  const cfg = UPDATE_TYPES[it.type]
  const db = prisma[cfg.model]
  const id = /^\d+$/.test(String(it.targetId ?? '')) ? BigInt(it.targetId) : null
  const before = id && await db.findFirst({ where: { id, userId: resolveUid(), deletedAt: null } })
  if (!before) throw new Error(`${cfg.label}不存在或无权访问`)
  const data = changesOf(it)
  if (!Object.keys(data).length) throw new Error('没有要改的内容')
  const row = await db.update({ where: { id }, data })
  await logAudit({ action: 'UPDATE', entity: cfg.entity || cfg.label, entityId: id, summary: `AI 修改${cfg.label} ${cfg.title(before)}`, before, after: row })
  if (cfg.model === 'account') invalidateClassifier()
  return { id: row.id, ref: `${cfg.label} ${cfg.title(row)}` }
}

async function commitNewAsset(it) {
  if (!ASSET_KINDS.includes(it.assetType)) throw new Error('资产类型不对')
  const value = has(it.amount) ? convert('amount', num(), it.amount) : convert('purchasePrice', num(), it.purchasePrice)
  const row = await prisma.fixedAsset.create({
    data: {
      userId: resolveUid(), type: it.assetType, name: convert('assetName', text('', 80), it.assetName), currentValue: round2(value),
      valuedAt: toDate(new Date()), purchaseDate: has(it.date) ? toDate(it.date) : null,
      purchasePrice: has(it.purchasePrice) ? round2(convert('purchasePrice', num(), it.purchasePrice)) : null,
      address: has(it.address) ? convert('address', text('', 200), it.address) : null,
      remark: has(it.description) ? convert('description', text('', 500), it.description) : null
    }
  })
  await logAudit({ action: 'CREATE', entity: '固定资产', entityId: row.id, summary: `AI 新增固定资产 ${row.name}`, after: row })
  return { id: row.id, ref: `资产 ${row.name}` }
}

async function commitNewAccount(it) {
  if (!ACCOUNT_KINDS.includes(it.accountType)) throw new Error('账户类型不对')
  const balance = has(it.amount) ? Number(it.amount) : 0
  if (!Number.isFinite(balance)) throw new Error('余额不合法')
  const row = await prisma.account.create({
    data: {
      userId: resolveUid(), type: it.accountType, name: convert('accountName', text('', 80), it.accountName),
      institution: has(it.institution) ? convert('institution', text('', 80), it.institution) : null,
      lastNo: has(it.lastNo) ? convert('lastNo', text('', 20), it.lastNo) : null,
      creditLimit: has(it.creditLimit) ? convert('creditLimit', num(), it.creditLimit) : null,
      billDay: has(it.billDay) ? convert('billDay', day(), it.billDay) : null,
      repayDay: has(it.repayDay) ? convert('repayDay', day(), it.repayDay) : null,
      initialBalance: round2(balance), initialDate: toDate(it.date || new Date()), balance: round2(balance)
    }
  })
  await logAudit({ action: 'CREATE', entity: '账户', entityId: row.id, summary: `AI 新增账户 ${row.name}`, after: row })
  invalidateClassifier()
  await recalcAccountBalance(row.id)
  return { id: row.id, ref: `账户 ${row.name}` }
}

async function commitBudget(it) {
  const userId = resolveUid()
  const category = await prisma.category.findFirst({ where: { id: BigInt(it.categoryId), userId, deletedAt: null } })
  if (!category || category.kind !== 'EXPENSE') throw new Error('预算只能设在支出科目上')
  await assertOwnRefs({ categoryId: it.categoryId }, userId)
  const year = Number(it.year) || dayjs().year()
  if (year < 2000 || year > 2100) throw new Error('年份不对')
  const annual = round2(has(it.annual) ? convert('annual', num(), it.annual) : convert('monthly', num(), it.monthly) * 12)
  const key = { userId_year_categoryId: { userId, year, categoryId: category.id } }
  const before = await prisma.budget.findUnique({ where: key })
  const row = await prisma.budget.upsert({
    where: key,
    update: { monthlyAmount: annual / 12, annualAmount: annual },
    create: { userId, year, categoryId: category.id, monthlyAmount: annual / 12, annualAmount: annual }
  })
  await logAudit({ action: before ? 'UPDATE' : 'CREATE', entity: '预算', entityId: row.id, summary: `AI 设预算 ${year} ${category.code} ${category.name} 年 ${annual}`, before, after: row })
  return { id: row.id, ref: `预算 ${year} ${category.name}` }
}

/** 入账一条基础资料操作，返回 { id, ref } */
export function commitMaster(it) {
  if (UPDATE_TYPES[it.type]) return commitUpdate(it)
  if (it.type === 'new_asset') return commitNewAsset(it)
  if (it.type === 'new_account') return commitNewAccount(it)
  return commitBudget(it)
}
