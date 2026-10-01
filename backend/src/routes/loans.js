import express from 'express'
import prisma from '../lib/prisma.js'
import { crudRouter } from '../lib/crud.js'
import { ok, wrap } from '../lib/response.js'
import { loanRepay } from '../lib/ledger.js'

const router = express.Router()

router.get('/:id/repayments', wrap(async (req, res) => {
  const list = await prisma.loanRepayment.findMany({ where: { loanId: BigInt(req.params.id), deletedAt: null }, orderBy: { repayDate: 'desc' } })
  return ok(res, { list, total: list.length })
}))

router.post('/:id/repay', wrap(async (req, res) => ok(res, await loanRepay({ ...req.body, loanId: req.params.id }))))

router.use('/', crudRouter({
  model: 'loan', entity: '借贷',
  fields: ['direction', 'kind', 'counterparty', 'principal', 'balance', 'annualRate', 'startDate', 'dueDate', 'monthlyPayment', 'assetId', 'contractNo', 'includeInNetWorth', 'status', 'remark'],
  dateFields: ['startDate', 'dueDate'],
  searchFields: ['counterparty', 'remark', 'contractNo'],
  filters: { direction: 'direction', status: 'status', kind: 'kind' },
  orderBy: [{ direction: 'desc' }, { id: 'asc' }],
  required: ['direction', 'counterparty', 'principal'],
  hooks: {
    beforeCreate: (data) => ({ data: { ...data, balance: data.balance ?? data.principal } })
  }
}))

export default router
