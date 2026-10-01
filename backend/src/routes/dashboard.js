import express from 'express'
import dayjs from 'dayjs'
import prisma from '../lib/prisma.js'
import { ok, wrap } from '../lib/response.js'
import { balanceSheet, periodStats } from '../lib/networth.js'
import { lastPeriods } from '../lib/period.js'

const router = express.Router()

router.get('/', wrap(async (req, res) => {
  const period = req.query.period || dayjs().format('YYYY-MM')
  const [sheet, month, snapshots, accounts, pendingBiz, uncategorized] = await Promise.all([
    balanceSheet(),
    periodStats(period),
    prisma.netWorthSnapshot.findMany({ orderBy: { period: 'asc' }, take: 24 }),
    prisma.account.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
    prisma.transaction.aggregate({ where: { deletedAt: null, isBusiness: true, bizStatus: 'PENDING' }, _sum: { amount: true }, _count: true }),
    prisma.transaction.count({ where: { deletedAt: null, categoryId: null } })
  ])
  const trend = []
  for (const p of lastPeriods(12, dayjs(`${period}-01`))) {
    const s = await periodStats(p)
    trend.push({ period: p, income: s.income, expense: s.expense, business: s.business })
  }
  const alerts = []
  if (uncategorized) alerts.push({ level: 'warn', text: `${uncategorized} 笔流水还没归类`, link: '/transactions?category_id=none' })
  if (pendingBiz._count) alerts.push({ level: 'warn', text: `${pendingBiz._count} 笔公司款待剥离，合计 ¥${Number(pendingBiz._sum.amount || 0).toLocaleString()}`, link: '/transactions?scope=business&biz_status=PENDING' })
  for (const a of sheet.staleAccounts) alerts.push({ level: 'info', text: `「${a.name}」余额超过 35 天没校准`, link: '/accounts' })
  for (const p of sheet.pendingItems) alerts.push({ level: 'danger', text: `待核实：${p.counterparty} ¥${p.balance.toLocaleString()}（${p.direction === 'LEND' ? '应收' : '负债'}，暂不计入净资产）`, link: '/loans' })
  return ok(res, { period, sheet, month, trend, snapshots, accounts, alerts })
}))

export default router
