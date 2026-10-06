import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import authRouter from './routes/auth.js'
import accountsRouter from './routes/accounts.js'
import categoriesRouter from './routes/categories.js'
import transactionsRouter from './routes/transactions.js'
import holdingsRouter from './routes/holdings.js'
import assetsRouter from './routes/assets.js'
import loansRouter from './routes/loans.js'
import budgetsRouter from './routes/budgets.js'
import dashboardRouter from './routes/dashboard.js'
import closeRouter from './routes/close.js'
import aiRouter from './routes/ai.js'
import { auth } from './lib/auth.js'
import { withTenant } from './lib/tenant.js'
import { mountPlatform, serveFrontend, callSelf } from './lib/platform.js'
import { resolveUser, signFor } from './lib/platform-users.js'

BigInt.prototype.toJSON = function () { return this.toString() }

const app = express()
const PORT = process.env.PORT || 3020

app.use(cors())
app.use(express.json({ limit: '20mb' }))

app.get('/api/health', (req, res) => res.json({ code: 0, message: 'ok', data: { ts: Date.now() } }))
app.use('/api/auth', authRouter)

// 鉴权通过后进入该用户的租户上下文，下游所有读写隐式归属 req.user.id
const enterTenant = (req, res, next) => withTenant(req.user.id, next)
app.use('/api/pf', auth, enterTenant)
app.use('/api/pf/accounts', accountsRouter)
app.use('/api/pf/categories', categoriesRouter)
app.use('/api/pf/transactions', transactionsRouter)
app.use('/api/pf/holdings', holdingsRouter)
app.use('/api/pf/assets', assetsRouter)
app.use('/api/pf/loans', loansRouter)
app.use('/api/pf/budgets', budgetsRouter)
app.use('/api/pf/dashboard', dashboardRouter)
app.use('/api/pf/close', closeRouter)
app.use('/api/pf/ai', aiRouter)

// ---------- 以虎 One 接入：统一登录 + AI 工具（只读） ----------
const period = { type: 'string', description: '月份 YYYY-MM，默认本月' }
mountPlatform(app, {
  appName: 'personal-finance',
  resolveUser,
  signFor,
  tools: [
    {
      name: 'get_financial_overview', title: '个人财务总览',
      description: '净资产、可动用资金、应急金覆盖月数、本月收支与储蓄率、资产结构、账户余额、待办提醒。问「我现在有多少钱」「这个月花了多少」时用。',
      inputSchema: { type: 'object', properties: { period } },
      run: ({ token, args }) => callSelf(token, '/api/pf/dashboard', { period: args.period })
    },
    {
      name: 'get_budget_execution', title: '预算执行',
      description: '某月各科目的预算、实际支出和执行率（含年累计）。问「预算超了没有」「哪项花超了」时用。',
      inputSchema: { type: 'object', properties: { period } },
      run: ({ token, args }) => callSelf(token, '/api/pf/budgets/execution', { period: args.period })
    },
    {
      name: 'get_month_summary', title: '月结摘要',
      description: '某月的月结摘要（Markdown）：净资产变化、收支、检查清单。',
      inputSchema: { type: 'object', properties: { period } },
      run: ({ token, args }) => callSelf(token, '/api/pf/close/summary', { period: args.period })
    }
  ]
})

// 前端打包产物（frontend/dist）由后端直接托管；挂在 /apps/<code>/ 下时自动注入 <base href>
serveFrontend(app, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist'))

app.use((req, res) => res.status(404).json({ code: 9004, message: `接口不存在：${req.method} ${req.path}`, data: null }))
app.use((err, req, res, next) => {
  console.error('[unhandled]', err)
  res.status(500).json({ code: 9001, message: err.message || '服务器内部错误', data: null })
})

app.listen(PORT, () => console.log(`✅ 个人财务后端已启动：http://localhost:${PORT}`))
