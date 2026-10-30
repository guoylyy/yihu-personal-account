import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { ok, badRequest, notFound, wrap } from '../lib/response.js'
import { createTransaction, updateTransaction } from '../lib/ledger.js'
import { recalcAccountBalance } from '../lib/balance.js'
import { classify, learnRule, matchAccount } from '../lib/classify.js'
import { parseBill } from '../lib/billParser.js'
import { aiClassifyRows } from '../lib/aiEntry.js'
import { codeAllocator } from '../lib/code.js'
import { toDate, periodRange } from '../lib/period.js'
import { logAudit } from '../lib/audit.js'
import { round2 } from '../lib/money.js'
import { currentUserId } from '../lib/tenant.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
const include = { account: { select: { id: true, name: true, type: true } }, category: { select: { id: true, code: true, name: true, kind: true, groupName: true } } }

function buildWhere(q) {
  const where = { deletedAt: null, userId: currentUserId() }
  if (q.account_id) where.accountId = BigInt(q.account_id)
  if (q.category_id) where.categoryId = q.category_id === 'none' ? null : BigInt(q.category_id)
  if (q.direction) where.direction = q.direction
  if (q.source) where.source = q.source
  if (q.biz_status) where.bizStatus = q.biz_status
  if (q.scope === 'business') where.isBusiness = true
  if (q.scope === 'personal') { where.isBusiness = false; where.OR = [{ categoryId: null }, { category: { kind: { not: 'TRANSFER' } } }] }
  if (q.scope === 'transfer') where.category = { kind: 'TRANSFER' }
  if (q.period) { const { start, end } = periodRange(q.period); where.txnDate = { gte: start, lte: end } }
  if (q.date_from || q.date_to) {
    where.txnDate = {}
    if (q.date_from) where.txnDate.gte = toDate(q.date_from)
    if (q.date_to) where.txnDate.lte = toDate(q.date_to)
  }
  if (q.keyword) {
    const kw = { OR: [{ counterparty: { contains: q.keyword } }, { description: { contains: q.keyword } }, { code: { contains: q.keyword } }, { remark: { contains: q.keyword } }] }
    where.AND = [...(where.AND || []), kw]
  }
  return where
}

router.get('/', wrap(async (req, res) => {
  const { page = 1, page_size = 50 } = req.query
  const take = Math.min(Number(page_size) || 50, 1000)
  const where = buildWhere(req.query)
  const [list, total, sums] = await Promise.all([
    prisma.transaction.findMany({ where, include, orderBy: [{ txnDate: 'desc' }, { txnTime: 'desc' }, { id: 'desc' }], skip: (Number(page) - 1) * take, take }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({ by: ['direction'], where, _sum: { amount: true } })
  ])
  const s = (d) => Number(sums.find((x) => x.direction === d)?._sum.amount || 0)
  return ok(res, { list, total, summary: { in: s('IN'), out: s('OUT'), net: round2(s('IN') - s('OUT')) } })
}))

router.post('/', wrap(async (req, res) => {
  const row = await createTransaction(req.body, { source: 'MANUAL' })
  if (req.body.learn && row.counterparty && row.categoryId) await learnRule(row.counterparty, row.categoryId, row.isBusiness)
  await logAudit({ action: 'CREATE', entity: '流水', entityId: row.id, summary: `${row.direction} ${row.amount} ${row.counterparty || ''}`, after: row })
  return ok(res, row)
}))

router.put('/:id', wrap(async (req, res) => {
  const row = await updateTransaction(req.params.id, req.body, { include })
  if (!row) return notFound(res)
  return ok(res, row)
}))

router.delete('/:id', wrap(async (req, res) => {
  const id = BigInt(req.params.id)
  const before = await prisma.transaction.findFirst({ where: { id, userId: currentUserId(), deletedAt: null } })
  if (!before) return notFound(res)
  // 互转的两条一起作废，否则一边余额会悬空
  const targets = before.transferGroup
    ? await prisma.transaction.findMany({ where: { userId: currentUserId(), transferGroup: before.transferGroup, deletedAt: null } })
    : [before]
  await prisma.transaction.updateMany({ where: { userId: currentUserId(), id: { in: targets.map((t) => t.id) } }, data: { deletedAt: new Date() } })
  for (const a of new Set(targets.map((t) => t.accountId).filter(Boolean).map(String))) await recalcAccountBalance(a)
  await logAudit({ action: 'DELETE', entity: '流水', entityId: id, summary: `作废 ${targets.map((t) => t.code).join('、')}`, before })
  return ok(res, { count: targets.length })
}))

/** 批量改科目 / 公私标记 / 剥离状态；learn=true 时按对方名记住规则 */
router.post('/batch', wrap(async (req, res) => {
  const { ids = [], categoryId, isBusiness, businessOrg, bizStatus, accountId, learn } = req.body
  if (!ids.length) return badRequest(res, '请先勾选流水')
  const data = {}
  if (categoryId !== undefined) data.categoryId = categoryId ? BigInt(categoryId) : null
  if (isBusiness !== undefined) { data.isBusiness = !!isBusiness; data.bizStatus = isBusiness ? bizStatus || 'PENDING' : null; if (!isBusiness) data.businessOrg = null }
  if (businessOrg !== undefined) data.businessOrg = businessOrg || null
  if (bizStatus !== undefined && isBusiness === undefined) data.bizStatus = bizStatus
  if (accountId !== undefined) data.accountId = accountId ? BigInt(accountId) : null
  const bigIds = ids.map((i) => BigInt(i))
  const userId = currentUserId()
  const before = await prisma.transaction.findMany({ where: { userId, id: { in: bigIds } } })
  await prisma.transaction.updateMany({ where: { userId, id: { in: bigIds } }, data })
  if (accountId !== undefined) {
    for (const a of new Set([...before.map((t) => t.accountId), accountId].filter(Boolean).map(String))) await recalcAccountBalance(a)
  }
  if (learn) {
    const after = await prisma.transaction.findMany({ where: { userId, id: { in: bigIds } } })
    for (const cp of new Set(after.map((t) => t.counterparty).filter(Boolean))) {
      const t = after.find((x) => x.counterparty === cp)
      if (t.categoryId) await learnRule(cp, t.categoryId, t.isBusiness)
    }
  }
  await logAudit({ action: 'BATCH', entity: '流水', summary: `批量修改 ${ids.length} 笔：${JSON.stringify(req.body).slice(0, 300)}` })
  return ok(res, { count: ids.length })
}))

// ─────────── 账单导入（微信 / 支付宝 / 银行）───────────

router.post('/import/preview', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return badRequest(res, '请上传账单文件')
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
  const { channel, rows } = parseBill(req.file.buffer, filename)
  const cats = await prisma.category.findMany({ where: { userId: currentUserId(), deletedAt: null } })
  const out = []
  for (const r of rows) {
    const dup = await prisma.transaction.findFirst({
      where: {
        userId: currentUserId(),
        deletedAt: null,
        OR: [
          { externalId: r.externalId },
          // 同一笔从不同渠道导出（如微信原始账单 vs 已归类 CSV）：日期+时刻+金额 一致视为重复
          ...(r.txnTime ? [{ txnDate: toDate(r.txnDate), txnTime: r.txnTime, amount: r.amount || 0, direction: r.direction || 'OUT' }] : [])
        ]
      },
      select: { code: true }
    })
    const cls = r.presetCategory
      ? { ...(await classify(r)), preset: r.presetCategory }
      : await classify(r)
    const acc = await matchAccount(r.payMethod || r.channel)
    out.push({
      ...r,
      duplicate: dup?.code || null,
      categoryId: cls.categoryId ? String(cls.categoryId) : null,
      categoryCode: cls.categoryCode,
      classifiedBy: cls.by,
      isBusiness: cls.isBusiness,
      accountId: acc ? String(acc.id) : null
    })
  }
  const stat = {
    total: out.length,
    skip: out.filter((r) => r.skip).length,
    duplicate: out.filter((r) => r.duplicate).length,
    uncategorized: out.filter((r) => !r.skip && !r.duplicate && !r.categoryId).length
  }
  return ok(res, { channel, filename, stat, rows: out, categories: cats.length })
}))

/** 规则没命中的行，交给 AI 批量归类（一次最多 120 行） */
router.post('/import/ai-classify', wrap(async (req, res) => {
  const rows = req.body.rows || []
  const result = await aiClassifyRows(rows)
  const cats = await prisma.category.findMany({ where: { userId: currentUserId(), deletedAt: null } })
  return ok(res, result.map((r) => {
    const c = cats.find((x) => x.code === r.categoryCode)
    return { i: r.i, categoryId: c ? String(c.id) : null, categoryCode: r.categoryCode, isBusiness: !!r.isBusiness, businessOrg: r.businessOrg || null }
  }))
}))

router.post('/import/commit', wrap(async (req, res) => {
  const rows = (req.body.rows || []).filter((r) => !r.skip && !r.duplicate)
  if (!rows.length) return badRequest(res, '没有可导入的行')
  const batch = `IMP-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
  const alloc = await codeAllocator()
  const touched = new Set()
  let count = 0
  for (const r of rows) {
    const date = toDate(r.txnDate)
    await createTransaction({
      code: await alloc(date), txnDate: r.txnDate, txnTime: r.txnTime, direction: r.direction, amount: r.amount,
      accountId: r.accountId, categoryId: r.categoryId, counterparty: r.counterparty, description: r.description,
      channel: r.channel, payMethod: r.payMethod, isBusiness: r.isBusiness, businessOrg: r.businessOrg,
      importBatch: batch, externalId: r.externalId
    }, { source: 'IMPORT', recalc: false })
    if (r.accountId) touched.add(String(r.accountId))
    if (r.learn && r.counterparty && r.categoryId) await learnRule(r.counterparty, r.categoryId, r.isBusiness)
    count++
  }
  for (const a of touched) await recalcAccountBalance(a)
  await logAudit({ action: 'IMPORT', entity: '流水', summary: `导入 ${count} 笔（${batch}）` })
  return ok(res, { batch, count })
}))

router.delete('/import/:batch', wrap(async (req, res) => {
  const list = await prisma.transaction.findMany({ where: { userId: currentUserId(), importBatch: req.params.batch, deletedAt: null } })
  await prisma.transaction.updateMany({ where: { userId: currentUserId(), importBatch: req.params.batch }, data: { deletedAt: new Date() } })
  for (const a of new Set(list.map((t) => t.accountId).filter(Boolean).map(String))) await recalcAccountBalance(a)
  await logAudit({ action: 'DELETE', entity: '流水', summary: `撤销导入批次 ${req.params.batch}（${list.length} 笔）` })
  return ok(res, { count: list.length })
}))

router.get('/import/batches', wrap(async (req, res) => {
  const rows = await prisma.transaction.groupBy({
    by: ['importBatch'], where: { userId: currentUserId(), importBatch: { not: null }, deletedAt: null },
    _count: true, _min: { txnDate: true }, _max: { txnDate: true, createdAt: true }
  })
  return ok(res, rows.sort((a, b) => (b._max.createdAt > a._max.createdAt ? 1 : -1)))
}))

export default router
