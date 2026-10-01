// 通用台账 CRUD 工厂（从集团系统精简：去掉公司数据范围与权限点）
import express from 'express'
import prisma from './prisma.js'
import { ok, badRequest, notFound, wrap } from './response.js'
import { logAudit } from './audit.js'
import { toDate } from './period.js'

export function crudRouter(cfg) {
  const {
    model, entity = model, fields = [], dateFields = [], searchFields = [], filters = {},
    include, orderBy = { createdAt: 'desc' }, dateRangeField, required = [], hooks = {}, softDelete = true
  } = cfg
  const router = express.Router()
  const db = () => prisma[model]
  const isBigint = (k) => /Id$/.test(k) && k !== 'id'

  function pickData(body) {
    const data = {}
    for (const k of fields) {
      if (body[k] === undefined) continue
      let v = body[k]
      if (v === '') v = null
      if (v !== null) {
        if (dateFields.includes(k)) v = toDate(v)
        else if (isBigint(k)) v = BigInt(v)
      }
      data[k] = v
    }
    return data
  }

  router.get('/', wrap(async (req, res) => {
    const { page = 1, page_size = 50, keyword = '', date_from = '', date_to = '' } = req.query
    const take = Math.min(Number(page_size) || 50, 1000)
    const skip = (Number(page) - 1) * take
    const where = softDelete ? { deletedAt: null } : {}
    for (const [q, field] of Object.entries(filters)) {
      const v = req.query[q]
      if (v !== undefined && v !== '') where[field] = isBigint(field) ? BigInt(v) : v === 'true' ? true : v === 'false' ? false : v
    }
    if (keyword && searchFields.length) where.OR = searchFields.map((f) => ({ [f]: { contains: keyword } }))
    if (dateRangeField && (date_from || date_to)) {
      where[dateRangeField] = {}
      if (date_from) where[dateRangeField].gte = toDate(date_from)
      if (date_to) where[dateRangeField].lte = toDate(date_to)
    }
    const [list, total] = await Promise.all([
      db().findMany({ where, include, orderBy, skip, take }),
      db().count({ where })
    ])
    return ok(res, { list, total, page: Number(page), pageSize: take })
  }))

  router.get('/:id', wrap(async (req, res) => {
    const row = await db().findFirst({ where: { id: BigInt(req.params.id), ...(softDelete ? { deletedAt: null } : {}) }, include })
    return row ? ok(res, row) : notFound(res)
  }))

  router.post('/', wrap(async (req, res) => {
    const missing = required.filter((k) => req.body[k] === undefined || req.body[k] === '' || req.body[k] === null)
    if (missing.length) return badRequest(res, `缺少必填字段：${missing.join('、')}`)
    let data = pickData(req.body)
    if (hooks.beforeCreate) {
      const r = await hooks.beforeCreate(data, req)
      if (r?.error) return badRequest(res, r.error)
      data = r?.data || data
    }
    const row = await db().create({ data, include })
    await logAudit({ action: 'CREATE', entity, entityId: row.id, summary: `新增${entity}`, after: row })
    if (hooks.afterWrite) await hooks.afterWrite(row, 'CREATE')
    return ok(res, row)
  }))

  router.put('/:id', wrap(async (req, res) => {
    const id = BigInt(req.params.id)
    const before = await db().findFirst({ where: { id } })
    if (!before) return notFound(res)
    let data = pickData(req.body)
    if (hooks.beforeUpdate) {
      const r = await hooks.beforeUpdate(data, req, before)
      if (r?.error) return badRequest(res, r.error)
      data = r?.data || data
    }
    const row = await db().update({ where: { id }, data, include })
    await logAudit({ action: 'UPDATE', entity, entityId: id, summary: `修改${entity}`, before, after: row })
    if (hooks.afterWrite) await hooks.afterWrite(row, 'UPDATE', before)
    return ok(res, row)
  }))

  router.delete('/:id', wrap(async (req, res) => {
    const id = BigInt(req.params.id)
    const before = await db().findFirst({ where: { id } })
    if (!before) return notFound(res)
    const row = softDelete
      ? await db().update({ where: { id }, data: { deletedAt: new Date() } })
      : await db().delete({ where: { id } })
    await logAudit({ action: 'DELETE', entity, entityId: id, summary: `作废${entity}`, before })
    if (hooks.afterWrite) await hooks.afterWrite(row, 'DELETE', before)
    return ok(res, { id: String(id) })
  }))

  return router
}
