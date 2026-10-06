import express from 'express'
import prisma from '../lib/prisma.js'
import { crudRouter } from '../lib/crud.js'
import { ok, badRequest, wrap } from '../lib/response.js'
import { assetValuation } from '../lib/ledger.js'
import { currentUserId } from '../lib/tenant.js'

const router = express.Router()

router.get('/:id/valuations', wrap(async (req, res) => {
  const list = await prisma.assetValuation.findMany({ where: { userId: currentUserId(), assetId: BigInt(req.params.id) }, orderBy: { valDate: 'desc' } })
  return ok(res, { list, total: list.length })
}))

router.post('/:id/valuation', wrap(async (req, res) => {
  if (!(Number(req.body.value) > 0)) return badRequest(res, '请填写估值')
  return ok(res, await assetValuation({ ...req.body, assetId: req.params.id }))
}))

router.use('/', crudRouter({
  model: 'fixedAsset', entity: '固定资产',
  fields: ['type', 'name', 'owner', 'address', 'purchaseDate', 'purchasePrice', 'currentValue', 'valuedAt', 'valuationNote', 'includeInNetWorth', 'status', 'remark'],
  dateFields: ['purchaseDate', 'valuedAt'],
  searchFields: ['name', 'address'],
  filters: { type: 'type', status: 'status' },
  orderBy: [{ type: 'asc' }, { id: 'asc' }],
  required: ['type', 'name']
}))

export default router
