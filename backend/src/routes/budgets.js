// 预算：按年、按科目；执行情况 = 实际个人支出（不含公司款、转移类）对比预算
import express from 'express'
import prisma from '../lib/prisma.js'
import { ok, badRequest, wrap } from '../lib/response.js'
import { round2 } from '../lib/money.js'
import { periodStats } from '../lib/networth.js'
import dayjs from 'dayjs'
import { currentUserId } from '../lib/tenant.js'

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  const year = Number(req.query.year || dayjs().year())
  const list = await prisma.budget.findMany({ where: { year, userId: currentUserId() }, include: { category: true }, orderBy: { category: { sort: 'asc' } } })
  return ok(res, { year, list })
}))

// 整年批量保存：[{ categoryId, monthlyAmount, annualAmount, remark }]
router.put('/:year', wrap(async (req, res) => {
  const year = Number(req.params.year)
  const items = req.body.items || []
  if (!year) return badRequest(res, '年份不对')
  for (const it of items) {
    const userId = currentUserId()
    const categoryId = BigInt(it.categoryId)
    const monthly = round2(it.monthlyAmount || 0)
    const annual = round2(it.annualAmount || monthly * 12)
    await prisma.budget.upsert({
      where: { userId_year_categoryId: { userId, year, categoryId } },
      update: { monthlyAmount: annual / 12, annualAmount: annual, remark: it.remark || null },
      create: { userId, year, categoryId, monthlyAmount: annual / 12, annualAmount: annual, remark: it.remark || null }
    })
  }
  return ok(res, true)
}))

/** 预算执行：某月（period）或全年累计（year） */
router.get('/execution', wrap(async (req, res) => {
  const period = req.query.period || dayjs().format('YYYY-MM')
  const year = Number(period.slice(0, 4))
  const monthIdx = Number(period.slice(5, 7))
  const budgets = await prisma.budget.findMany({ where: { year, userId: currentUserId() }, include: { category: true } })
  const months = Array.from({ length: monthIdx }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const stats = await Promise.all(months.map((p) => periodStats(p)))
  const month = stats[stats.length - 1]
  const ytd = {}
  for (const s of stats) for (const c of s.byCategory) ytd[c.code] = round2((ytd[c.code] || 0) + c.amount)

  const codes = new Set([...budgets.map((b) => b.category.code), ...month.byCategory.filter((c) => c.kind === 'EXPENSE').map((c) => c.code)])
  const rows = [...codes].map((code) => {
    const b = budgets.find((x) => x.category.code === code)
    const m = month.byCategory.find((c) => c.code === code)
    const monthly = Number(b?.monthlyAmount || 0)
    const actual = m?.amount || 0
    const ytdBudget = round2(monthly * monthIdx)
    return {
      code, name: b?.category.name || m?.name, group: b?.category.groupName || m?.group, kind: b?.category.kind || m?.kind,
      monthlyBudget: round2(monthly), actual,
      rate: monthly ? round2((actual / monthly) * 100) : null,
      ytdBudget, ytdActual: ytd[code] || 0,
      ytdRate: ytdBudget ? round2(((ytd[code] || 0) / ytdBudget) * 100) : null,
      annualBudget: Number(b?.annualAmount || 0)
    }
  }).filter((r) => r.kind !== 'INCOME').sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))

  const tot = (k) => round2(rows.reduce((s, r) => s + (r[k] || 0), 0))
  return ok(res, {
    period, year, rows,
    total: { monthlyBudget: tot('monthlyBudget'), actual: tot('actual'), ytdBudget: tot('ytdBudget'), ytdActual: tot('ytdActual'), annualBudget: tot('annualBudget') },
    income: month.income, savingRate: month.savingRate
  })
}))

export default router
