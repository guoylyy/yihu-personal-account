// Express 应用本体：测试直接引入这里、自己监听端口；启动入口是 index.js
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
import freedomRouter from './routes/freedom.js'
import aiRouter from './routes/ai.js'
import { auth } from './lib/auth.js'
import { withTenant } from './lib/tenant.js'
import { mountPlatform, serveFrontend, callSelf } from './lib/platform.js'
import { resolveUser, signFor } from './lib/platform-users.js'
import { VERSION } from './lib/version.js'

BigInt.prototype.toJSON = function () { return this.toString() }

const app = express()

app.use(cors())
app.use(express.json({ limit: '20mb' }))

app.get('/api/health', (req, res) => res.json({ code: 0, message: 'ok', data: { ts: Date.now(), version: VERSION } }))
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
app.use('/api/pf/freedom', freedomRouter)
app.use('/api/pf/ai', aiRouter)

// ---------- 以虎 One 接入：统一登录 + AI 工具（只读） ----------
const period = { type: 'string', description: '月份 YYYY-MM，默认本月' }
mountPlatform(app, {
  appName: 'personal-account',
  resolveUser,
  signFor,
  tools: [
    {
      name: 'get_financial_overview', title: '个人财务总览',
      description: '净资产、自由天数、本月收支与储蓄率、资产结构、账户余额、待办提醒。问「我现在有多少钱」「这个月花了多少」时用。',
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
    },
    {
      name: 'get_freedom_overview', title: '自由天数',
      description: '不再有工作收入时手上的钱能撑多少天：生活线和只保必要的天数、见底日期、可动用资金和每日净消耗的拆解、数据可信度提示。问「我能撑多久」「还有多少自由天数」时用。只复述返回的数字，不要自己算；state 不是 OK 时按 state 说明，不要给天数。',
      inputSchema: { type: 'object', properties: {} },
      run: ({ token }) => callSelf(token, '/api/pf/freedom')
    },
    {
      name: 'simulate_decision', title: '模拟决策',
      description: '算一个花钱决定对自由天数的影响，只读，不落账也不产生草稿。问「买这台车会怎样」「每月多 500 的订阅影响多大」「提前还 10 万房贷划算吗」时用。只复述返回的 before / after / delta，不要自己算；回答要说明一次性支出和长期支出的区别，并说明这是估算。提前还贷先用 get_freedom_overview 的 loans 取 loanId。',
      inputSchema: {
        type: 'object',
        properties: {
          oneOff: { type: 'number', description: '一次性支出金额' },
          monthly: { type: 'number', description: '每月增加的支出，减少时填负数' },
          loanId: { type: 'string', description: '提前还贷的借款 id' },
          prepay: { type: 'number', description: '提前还款金额，要同时给 loanId' }
        }
      },
      run: ({ token, args }) => callSelf(token, '/api/pf/freedom/simulate', args)
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

export default app
