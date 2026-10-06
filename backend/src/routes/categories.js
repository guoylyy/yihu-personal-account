import express from 'express'
import prisma from '../lib/prisma.js'
import { crudRouter } from '../lib/crud.js'
import { ok, wrap } from '../lib/response.js'
import { invalidateClassifier, learnRule } from '../lib/classify.js'
import { currentUserId } from '../lib/tenant.js'

const router = express.Router()

// 学到的分类规则
router.get('/rules', wrap(async (req, res) => {
  const list = await prisma.categoryRule.findMany({ where: { userId: currentUserId() }, include: { category: true }, orderBy: [{ hits: 'desc' }, { id: 'desc' }] })
  return ok(res, { list, total: list.length })
}))
router.post('/rules', wrap(async (req, res) => {
  await learnRule(req.body.pattern, req.body.categoryId, req.body.isBusiness)
  return ok(res, true)
}))
router.delete('/rules/:id', wrap(async (req, res) => {
  const row = await prisma.categoryRule.findFirst({ where: { id: BigInt(req.params.id), userId: currentUserId() } })
  if (!row) return res.status(404).json({ code: 9004, message: '规则不存在', data: null })
  await prisma.categoryRule.delete({ where: { id: row.id } })
  invalidateClassifier()
  return ok(res, true)
}))

router.use('/', crudRouter({
  model: 'category', entity: '科目',
  fields: ['code', 'name', 'kind', 'groupName', 'keywords', 'sort', 'remark'],
  searchFields: ['code', 'name', 'keywords'],
  filters: { kind: 'kind' },
  orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  required: ['code', 'name', 'kind'],
  hooks: { afterWrite: async () => invalidateClassifier() }
}))

export default router
