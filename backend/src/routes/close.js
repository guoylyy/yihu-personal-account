// 月结：生成净资产快照 + Markdown 摘要（可直接贴回 Obsidian 的 06.家庭个人）
import express from 'express'
import dayjs from 'dayjs'
import prisma from '../lib/prisma.js'
import { ok, wrap } from '../lib/response.js'
import { balanceSheet, periodStats } from '../lib/networth.js'
import { fmtMoney as m } from '../lib/money.js'

const router = express.Router()

router.get('/snapshots', wrap(async (req, res) => {
  const list = await prisma.netWorthSnapshot.findMany({ orderBy: { period: 'desc' } })
  return ok(res, { list, total: list.length })
}))

async function checklist(period) {
  const start = new Date(`${period}-01T00:00:00Z`)
  const end = new Date(`${dayjs(start).endOf('month').format('YYYY-MM-DD')}T23:59:59Z`)
  const [accounts, uncategorized, pendingBiz, txnCount, holdings] = await Promise.all([
    prisma.account.findMany({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.transaction.count({ where: { deletedAt: null, categoryId: null, txnDate: { gte: start, lte: end } } }),
    prisma.transaction.count({ where: { deletedAt: null, isBusiness: true, bizStatus: 'PENDING', txnDate: { gte: start, lte: end } } }),
    prisma.transaction.count({ where: { deletedAt: null, txnDate: { gte: start, lte: end } } }),
    prisma.holding.findMany({ where: { deletedAt: null, status: 'HOLDING' } })
  ])
  const monthStart = dayjs(start).startOf('month')
  const staleAcc = accounts.filter((a) => !a.initialDate || dayjs(a.initialDate).isBefore(monthStart.add(20, 'day')))
  const staleHold = holdings.filter((h) => !h.valuedAt || dayjs(h.valuedAt).isBefore(monthStart))
  return [
    { key: 'txn', title: '本月流水已导入/录入', ok: txnCount > 0, detail: `${txnCount} 笔`, link: '/import' },
    { key: 'cat', title: '流水全部归类', ok: uncategorized === 0, detail: uncategorized ? `${uncategorized} 笔未归类` : '已完成', link: '/transactions?category_id=none' },
    { key: 'biz', title: '公司款已剥离（报销或确认不追回）', ok: pendingBiz === 0, detail: pendingBiz ? `${pendingBiz} 笔待剥离` : '已完成', link: '/transactions?scope=business&biz_status=PENDING' },
    { key: 'bal', title: '账户余额已按月末真实数校准', ok: staleAcc.length === 0, detail: staleAcc.length ? staleAcc.map((a) => a.name).join('、') : '已完成', link: '/accounts' },
    { key: 'val', title: '投资持仓市值已更新', ok: staleHold.length === 0, detail: staleHold.length ? staleHold.map((h) => h.name).join('、') : '已完成', link: '/holdings' }
  ]
}

router.get('/checklist', wrap(async (req, res) => ok(res, await checklist(req.query.period || dayjs().format('YYYY-MM')))))

router.post('/snapshot', wrap(async (req, res) => {
  const period = req.body.period || dayjs().format('YYYY-MM')
  const [sheet, stats] = await Promise.all([balanceSheet(), periodStats(period)])
  const data = {
    cash: sheet.cash, investments: sheet.investments, equity: sheet.equity, receivables: sheet.receivables,
    fixedAssets: sheet.fixedAssets, totalAssets: sheet.totalAssets, liabilities: sheet.liabilities, netWorth: sheet.netWorth,
    income: stats.income, expense: stats.expense, detail: { sheet, stats }, remark: req.body.remark || null
  }
  const row = await prisma.netWorthSnapshot.upsert({ where: { period }, update: data, create: { period, ...data } })
  return ok(res, row)
}))

router.get('/summary', wrap(async (req, res) => {
  const period = req.query.period || dayjs().format('YYYY-MM')
  const [sheet, s, prev, checks] = await Promise.all([
    balanceSheet(), periodStats(period),
    prisma.netWorthSnapshot.findFirst({ where: { period: { lt: period } }, orderBy: { period: 'desc' } }),
    checklist(period)
  ])
  const delta = prev ? sheet.netWorth - Number(prev.netWorth) : null
  const lines = [
    `# ${period} 个人财务月结`, '',
    `> 由个人财务系统生成 · ${dayjs().format('YYYY-MM-DD HH:mm')}`, '',
    '## 一、净资产', '',
    '| 项目 | 金额 |', '|---|---:|',
    `| 现金类 | ${m(sheet.cash)} |`, `| 金融投资 | ${m(sheet.investments)} |`, `| 股权 | ${m(sheet.equity)} |`,
    `| 应收借款 | ${m(sheet.receivables)} |`, `| 固定资产 | ${m(sheet.fixedAssets)} |`,
    `| **总资产** | **${m(sheet.totalAssets)}** |`, `| 负债 | ${m(sheet.liabilities)} |`,
    `| **净资产** | **${m(sheet.netWorth)}** |`,
    delta != null ? `| 较 ${prev.period} | ${delta >= 0 ? '+' : ''}${m(delta)} |` : '', '',
    '## 二、本月收支（个人口径）', '',
    '| 项目 | 金额 |', '|---|---:|',
    `| 收入 | ${m(s.income)} |`, `| 个人支出 | ${m(s.expense)} |`, `| 结余 | ${m(s.net)} |`,
    `| 储蓄率 | ${s.savingRate == null ? '—' : s.savingRate + '%'} |`,
    `| 公司款（已剔除） | ${m(s.business)} |`, `| 转移类（已剔除） | ${m(s.transfer)} |`, '',
    '## 三、支出结构', '',
    '| 科目 | 金额 | 笔数 |', '|---|---:|---:|',
    ...s.byCategory.filter((c) => c.kind !== 'INCOME').map((c) => `| ${c.code} ${c.name} | ${m(c.amount)} | ${c.count} |`), '',
    '## 四、月结检查', '',
    ...checks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.title}：${c.detail}`), ''
  ]
  if (sheet.pendingItems.length) {
    lines.push('## 五、待核实（未计入净资产）', '', ...sheet.pendingItems.map((p) => `- ${p.counterparty} ¥${m(p.balance)}：${p.remark || ''}`), '')
  }
  return ok(res, { markdown: lines.filter((l) => l !== null).join('\n') })
}))

export default router
