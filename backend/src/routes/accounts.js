import express from 'express'
import prisma from '../lib/prisma.js'
import { crudRouter } from '../lib/crud.js'
import { ok, badRequest, wrap } from '../lib/response.js'
import { recalcAccountBalance } from '../lib/balance.js'
import { calibrateBalance, createTransfer } from '../lib/ledger.js'
import { invalidateClassifier } from '../lib/classify.js'
import { currentUserId } from '../lib/tenant.js'

const router = express.Router()

router.post('/:id/calibrate', wrap(async (req, res) => {
  const { balance, date } = req.body
  if (balance === undefined || balance === '') return badRequest(res, '请填写真实余额')
  return ok(res, await calibrateBalance(req.params.id, Number(balance), date))
}))

router.post('/transfer', wrap(async (req, res) => {
  const { fromAccountId, toAccountId, amount, txnDate, description } = req.body
  if (!(Number(amount) > 0)) return badRequest(res, '金额必须大于 0')
  return ok(res, await createTransfer({ fromAccountId, toAccountId, amount: Number(amount), txnDate, description }))
}))

router.post('/recalc', wrap(async (req, res) => {
  const list = await prisma.account.findMany({ where: { userId: currentUserId(), deletedAt: null } })
  for (const a of list) await recalcAccountBalance(a.id)
  return ok(res, true)
}))

router.use('/', crudRouter({
  model: 'account', entity: '账户',
  fields: ['name', 'type', 'institution', 'lastNo', 'owner', 'initialBalance', 'initialDate', 'creditLimit', 'billDay', 'repayDay', 'aliases', 'status', 'sort', 'remark'],
  dateFields: ['initialDate'],
  searchFields: ['name', 'institution', 'aliases'],
  filters: { type: 'type', status: 'status' },
  orderBy: [{ sort: 'asc' }, { id: 'asc' }],
  required: ['name', 'type'],
  hooks: {
    afterWrite: async (row) => { invalidateClassifier(); if (!row.deletedAt) await recalcAccountBalance(row.id) }
  }
}))

export default router
