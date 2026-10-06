import express from 'express'
import prisma from '../lib/prisma.js'
import { crudRouter } from '../lib/crud.js'
import { ok, badRequest, wrap } from '../lib/response.js'
import { holdingTrade, holdingMarketValue } from '../lib/ledger.js'
import { round2 } from '../lib/money.js'
import { currentUserId } from '../lib/tenant.js'

const router = express.Router()

// 持仓列表附带计算字段：市值、浮盈、收益率
router.get('/overview', wrap(async (req, res) => {
  const where = { userId: currentUserId(), deletedAt: null }
  if (req.query.status) where.status = req.query.status
  const list = await prisma.holding.findMany({ where, orderBy: [{ type: 'asc' }, { id: 'asc' }] })
  const rows = list.map((h) => {
    const mv = holdingMarketValue(h)
    const cost = Number(h.costAmount)
    const pnl = cost ? round2(mv - cost) : null
    return { ...h, mv, pnl, pnlRate: cost ? round2((pnl / cost) * 100) : null }
  })
  const byType = {}
  for (const r of rows.filter((x) => x.status === 'HOLDING')) {
    const o = (byType[r.type] ||= { type: r.type, mv: 0, cost: 0, count: 0 })
    o.mv = round2(o.mv + r.mv); o.cost = round2(o.cost + Number(r.costAmount)); o.count++
  }
  return ok(res, { list: rows, byType: Object.values(byType) })
}))

router.get('/:id/trades', wrap(async (req, res) => {
  const list = await prisma.holdingTrade.findMany({ where: { userId: currentUserId(), holdingId: BigInt(req.params.id), deletedAt: null }, orderBy: [{ tradeDate: 'desc' }, { id: 'desc' }] })
  return ok(res, { list, total: list.length })
}))

router.post('/:id/trade', wrap(async (req, res) => {
  if (!req.body.action) return badRequest(res, '请选择操作类型')
  return ok(res, await holdingTrade({ ...req.body, holdingId: req.params.id }))
}))

router.use('/', crudRouter({
  model: 'holding', entity: '持仓',
  fields: ['type', 'code', 'name', 'market', 'platform', 'quantity', 'costAmount', 'price', 'marketValue', 'ratio', 'valuationNote', 'valuedAt', 'maturityDate', 'annualRate', 'includeInNetWorth', 'status', 'remark'],
  dateFields: ['valuedAt', 'maturityDate'],
  searchFields: ['name', 'code', 'platform'],
  filters: { type: 'type', status: 'status' },
  orderBy: [{ type: 'asc' }, { id: 'asc' }],
  required: ['type', 'name']
}))

export default router
