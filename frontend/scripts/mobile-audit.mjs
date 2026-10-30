// 移动端验收脚本（playwright）。参照 yihu-finance/frontend/scripts/mobile-audit.mjs，路由和交互态换成本系统
//   node scripts/mobile-audit.mjs seed                      往 E2E 库灌演示数据（账本里有非 E2E 数据时拒绝执行）
//   node scripts/mobile-audit.mjs audit                     375/768/1440 逐路由断言 + 抽屉打开态 + 交互态 + 触控/字号 + 1024 图标栏
//   node scripts/mobile-audit.mjs shots [--out screenshots/mobile] [--only ai|version]   --only ai 只截 AI 助手四态，--only version 只截版本号
//   node scripts/mobile-audit.mjs desktop --out <dir>       1440 全路由 + 桌面弹窗整页截图（回归基线/改后各跑一次）
//   node scripts/mobile-audit.mjs compare <基线目录> <改后目录>   逐像素对比
// 环境变量：APP_URL（默认 http://localhost:5193）、PF_USER / PF_PASS（默认 admin / admin123）
// AI 解析和问答都走拦截的固定响应，不调真实模型；错误态/空态/加载态同样靠拦截构造
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const APP = (process.env.APP_URL || 'http://localhost:5193').replace(/\/$/, '')
const USER = process.env.PF_USER || 'admin'
const PASS = process.env.PF_PASS || 'admin123'
const args = process.argv.slice(2)
const mode = args[0] || 'audit'
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : def }
const HEIGHT = { 375: 667, 768: 1024, 1024: 768, 1440: 900 }
// 日期冻结：跨天跑基线和改后对比时，页面上的「今天」不变
const FROZEN = new Date('2026-10-29T12:00:00+08:00')

const AUTHED = ['dashboard', 'ai', 'accounts', 'transactions', 'import', 'holdings', 'assets', 'loans', 'budget', 'close', 'categories', 'settings']
const PUBLIC = ['login', 'sso-done']
const ROUTES = [...AUTHED, ...PUBLIC]
// 这些页面有数据表：手机端必须是卡片、桌面必须是 el-table，防止「没数据所以没溢出」的假通过
const TABLE_ROUTES = ['dashboard', 'accounts', 'transactions', 'import', 'holdings', 'assets', 'loans', 'budget', 'close', 'categories']
// 版本号断言的基准：读清单，发版改号不用动脚本
const MANIFEST_VERSION = JSON.parse(fs.readFileSync(new URL('../../yh-app.json', import.meta.url), 'utf8')).version

// ---------- 演示数据 ----------
async function api(token, method, url, body) {
  const res = await fetch(`${APP}/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const j = await res.json()
  if (j.code !== 0) throw new Error(`${method} ${url}: ${j.message}`)
  return j.data
}

async function seed() {
  const { token } = await api(null, 'POST', '/auth/login', { username: USER, password: PASS })
  const pf = (m, u, b) => api(token, m, `/pf${u}`, b)
  const existing = (await pf('GET', '/accounts?page_size=200')).list
  if (existing.some((a) => !a.name.startsWith('E2E'))) throw new Error('账本里有非 E2E 账户，拒绝灌数据（这不是测试库？）')
  if (existing.length) return console.log('已有 E2E 数据，跳过')

  const acc = {}
  for (const a of [
    { key: 'bank', name: 'E2E 招商银行一卡通储蓄账户（工资卡）', type: 'BANK', institution: '招商银行', lastNo: '0595', owner: 'ME', initialBalance: 186420.5, initialDate: '2026-08-01', aliases: '招商银行储蓄卡(0595),0595,招行,工资卡,招商银行一卡通,一卡通', remark: '工资卡，房贷自动扣款都从这张走，余额不要低于月供' },
    { key: 'wx', name: 'E2E 微信零钱', type: 'WECHAT', owner: 'ME', initialBalance: 3280, initialDate: '2026-08-01', aliases: '微信,零钱' },
    { key: 'ali', name: 'E2E 支付宝余额', type: 'ALIPAY', owner: 'SPOUSE', initialBalance: 12860.32, initialDate: '2026-06-01', aliases: '支付宝' },
    { key: 'cc', name: 'E2E 光大信用卡', type: 'CREDIT', institution: '光大银行', lastNo: '8821', owner: 'ME', initialBalance: -8650.75, initialDate: '2026-08-01', creditLimit: 80000, repayDay: 8 }
  ]) { const { key, ...body } = a; acc[key] = (await pf('POST', '/accounts', { status: 'ACTIVE', ...body })).id }

  const cats = (await pf('GET', '/categories?page_size=200')).list
  const expense = cats.filter((c) => c.kind === 'EXPENSE')
  const income = cats.find((c) => c.kind === 'INCOME')
  const parties = ['上海某某某某信息技术有限公司华东第二分公司', '盒马鲜生', '滴滴出行', '肯德基', '中国石化加油站', '星巴克', '阿里云计算有限公司', '京东商城']
  const descs = ['午饭', '订单号 https://example.com/orders/2026102900001234567890123456 的尾款，分三期支付', '打车去机场', '加油', '周末买菜', '给小孩买绘本']
  const acctCycle = [acc.bank, acc.wx, acc.ali, acc.cc]
  for (let i = 0; i < 64; i++) {
    const day = 28 - (i % 28)
    const month = ['2026-10', '2026-09', '2026-08'][i % 3]
    const isIn = i % 11 === 0
    await pf('POST', '/transactions', {
      direction: isIn ? 'IN' : 'OUT', amount: isIn ? 35000 : 12.5 + i * 37.3, txnDate: `${month}-${String(day).padStart(2, '0')}`,
      accountId: String(acctCycle[i % 4]), categoryId: i % 13 === 5 ? '' : String(isIn ? income.id : expense[i % expense.length].id),
      counterparty: parties[i % parties.length], description: descs[i % descs.length],
      isBusiness: i % 9 === 4, businessOrg: i % 9 === 4 ? '示例科技' : '', bizStatus: 'PENDING', remark: ''
    })
    if (i === 30) await pf('POST', '/close/snapshot', { period: '2026-08' })
    if (i === 48) await pf('POST', '/close/snapshot', { period: '2026-09' })
  }
  await pf('POST', '/accounts/transfer', { fromAccountId: acc.bank, toAccountId: acc.cc, amount: 2000, txnDate: '2026-10-08', description: '还光大信用卡' })

  const fund = await pf('POST', '/holdings', { type: 'FUND', name: 'E2E 沪深300交易型开放式指数证券投资基金联接A', code: '510300', market: 'A', platform: '且慢', quantity: 12000.5, price: 4.1234, costAmount: 45000, marketValue: 49484.86, includeInNetWorth: true, valuedAt: '2026-10-20', valuationNote: '按当日净值' })
  await pf('POST', '/holdings', { type: 'STOCK', name: 'E2E 腾讯控股', code: '00700', market: 'HK', platform: '富途', quantity: 100, price: 385, costAmount: 42000, marketValue: 38500, includeInNetWorth: true, valuedAt: '2026-10-20' })
  await pf('POST', '/holdings', { type: 'EQUITY', name: 'E2E 示例科技有限公司', ratio: 12.5, quantity: 0, costAmount: 500000, marketValue: 1200000, includeInNetWorth: true, valuedAt: '2026-06-30', valuationNote: '按最近一轮融资估值打七折' })
  await pf('POST', `/holdings/${fund.id}/trade`, { action: 'BUY', tradeDate: '2026-10-10', quantity: 1000, price: 4.05, fee: 1.5, cashAccountId: String(acc.bank) })

  const house = await pf('POST', '/assets', { type: 'PROPERTY', name: 'E2E 滨江一号 3 幢 1201 室', owner: 'JOINT', address: '杭州市滨江区某某路 88 号 3 幢 1201 室（产证面积 118.6 平）', purchaseDate: '2021-05-20', purchasePrice: 3200000, currentValue: 3600000, valuedAt: '2026-09-30', valuationNote: '同小区 9 月成交均价 × 面积', includeInNetWorth: true, status: 'HOLDING' })
  await pf('POST', '/assets', { type: 'VEHICLE', name: 'E2E 家用车', owner: 'ME', purchasePrice: 280000, currentValue: 160000, valuedAt: '2026-09-30', includeInNetWorth: true, status: 'HOLDING' })
  await pf('POST', `/assets/${house.id}/valuation`, { value: 3580000, valDate: '2026-06-30', note: '上半年挂牌价' })

  const lend = await pf('POST', '/loans', { direction: 'LEND', counterparty: 'E2E 李新民', kind: 'PERSONAL', principal: 100000, balance: 100000, annualRate: 3.6, startDate: '2026-01-15', status: 'ACTIVE', includeInNetWorth: true, remark: '朋友周转，年底前还清' })
  await pf('POST', '/loans', { direction: 'BORROW', counterparty: 'E2E 招商银行个人住房贷款中心', kind: 'MORTGAGE', principal: 1800000, balance: 1520000, annualRate: 3.25, monthlyPayment: 8960.42, startDate: '2021-06-01', status: 'ACTIVE', includeInNetWorth: true })
  await pf('POST', `/loans/${lend.id}/repay`, { repayDate: '2026-09-15', principalPart: 20000, interestPart: 300, accountId: String(acc.bank), remark: '第一笔回款' })

  await pf('PUT', '/budgets/2026', { items: expense.slice(0, 8).map((c, i) => ({ categoryId: c.id, annualAmount: (i + 1) * 3600, remark: '' })) })
  await pf('POST', '/categories/rules', { pattern: '星巴克', categoryId: expense[1].id, isBusiness: false }).catch(() => {})
  await pf('POST', '/categories/rules', { pattern: '阿里云计算有限公司杭州分公司', categoryId: expense[2].id, isBusiness: true }).catch(() => {})
  await pf('POST', '/transactions/import/commit', { rows: [
    { txnDate: '2026-10-02', txnTime: '12:10:00', direction: 'OUT', amount: 66, counterparty: '导入样例', description: '导入批次样例', channel: '微信', accountId: acc.wx, externalId: 'E2E-IMPORT-1' }
  ] })
  await pf('POST', '/close/snapshot', { period: '2026-10' })
  console.log('演示数据已写入')
}

// AI 解析的固定响应：覆盖最宽的几种草稿
const AI_FIXTURE = {
  provider: 'claude-cli', ms: 12345, logId: null, question: null,
  items: [
    { draftId: '9001', type: 'transaction', date: '2026-10-29', direction: 'OUT', amount: 386, counterparty: '海底捞火锅（滨江宝龙城店）', description: '和朋友吃火锅', confidence: 0.55, note: '没说是哪张卡，按上次的信用卡猜的', warnings: ['未识别科目', '未指定账户（入账后不影响任何余额）'], matchedRule: '海底捞' },
    { draftId: '9002', type: 'transfer', date: '2026-10-29', amount: 2000, description: '还光大信用卡' },
    { draftId: '9003', type: 'trade', date: '2026-10-29', action: 'BUY', quantity: 100, price: 385, amount: 38500, fee: 5, confidence: 0.9 },
    { draftId: '9004', type: 'balance', date: '2026-10-29', amount: 76543.21 },
    { draftId: '9005', type: 'new_holding', date: '2026-10-29', holding: '中证红利ETF', holdingType: 'FUND', code: '515080', quantity: 1000, price: 1.5, amount: 1500 }
  ]
}

// 导入预览用的账单（只走 preview，不落库）
const BILL_CSV = ['交易时间,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号',
  '2026-10-20 12:30:00,上海某某某某餐饮管理有限公司滨江分公司,午餐套餐,支出,45.00,微信零钱,支付成功,E2E2026102001',
  '2026-10-21 09:15:00,滴滴出行,打车,支出,32.50,光大信用卡,支付成功,E2E2026102002',
  '2026-10-22 18:00:00,朋友,AA 退款,收入,120.00,微信零钱,已存入零钱,E2E2026102003'].join('\n')

// ---------- 页面内检查 ----------
// 在页面里找出右边界超出视口、且没有被可滚动/裁剪祖先兜住的元素，只报最外层
// 视口宽度由外部传入：移动端仿真下内容超宽时 innerWidth 会被撑大
// 布局里 .main 是 overflow-y: auto，x 轴会跟着变成 auto：页内超宽不撑 body 而是 .main 自己能横拖，所以单独断言
const FIND_OVERFLOW = (vw) => {
  const sel = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) s += `#${el.id}`
    const cls = [...el.classList].slice(0, 3)
    if (cls.length) s += '.' + cls.join('.')
    return s
  }
  const pathOf = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) parts.unshift(sel(e))
    return parts.join(' > ')
  }
  // 祖先里有在视口内的裁剪/滚动容器才算兜住（示例条、Markdown 表格、平板上的 el-table）；.main / overlay 这种全屏容器不算
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.classList.contains('main') || p.classList.contains('el-overlay-dialog') || p.classList.contains('el-dialog__body')) return false
      if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true
    }
    return false
  }
  const bad = []
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (r.right > vw + 1 || r.left < -1) {
      if (clipped(el)) continue
      if (cs.position === 'fixed' && r.left >= vw) continue // 收起到屏外的抽屉
      if (bad.some((b) => b.el.contains(el))) continue
      bad.push({ el, path: pathOf(el), right: Math.round(r.right) })
    }
  }
  const scrollers = [...document.querySelectorAll('.main, .el-dialog__body, .el-drawer__body, .ai-messages, .ai-ctx')]
    .filter((m) => m.offsetParent !== null && m.scrollWidth > m.clientWidth + 1)
    .map((m) => `${sel(m)} 内部可横拖 scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth}`)
  const grouped = new Map()
  for (const b of bad) {
    const g = grouped.get(b.path) || { n: 0, right: 0 }
    grouped.set(b.path, { n: g.n + 1, right: Math.max(g.right, b.right) })
  }
  const list = [...grouped].slice(0, 6).map(([p, g]) => `${p} (right=${g.right}${g.n > 1 ? ` ×${g.n}` : ''})`)
  if (grouped.size > 6) list.push(`…另 ${grouped.size - 6} 类`)
  // el-popup-parent--hidden 是 Element 弹层打开时自己加的滚动锁，不是掩盖溢出
  const hidden = [document.documentElement, document.body, document.querySelector('.main')].filter(Boolean)
    .filter((e) => !e.classList.contains('el-popup-parent--hidden'))
    .filter((e) => { const o = getComputedStyle(e).overflowX; return o === 'hidden' || o === 'clip' }).map(sel)
  return {
    scrollWidth: document.body.scrollWidth, docWidth: document.documentElement.scrollWidth, vw,
    bad: [...scrollers, ...list, ...hidden.map((h) => `${h} 用了 overflow-x: hidden`)],
    tables: document.querySelectorAll('.el-table').length,
    cards: document.querySelectorAll('.m-card').length
  }
}

// 可见的可点元素里，小于 44×44 的
const SMALL_TARGETS = () => {
  const q = 'button, a[href], [role=button], [role=menuitem], [role=tab], .el-radio-button__inner, .el-checkbox, .el-switch, .el-select__wrapper, .el-input__wrapper, .el-textarea__inner, .alert, .check, .eg, .el-tag.is-closable'
  const seen = new Map()
  for (const el of document.querySelectorAll(q)) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.disabled) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || r.bottom < 0 || r.top > document.documentElement.scrollHeight) continue
    if (r.width < 43.5 || r.height < 43.5) {
      const name = el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.') + `「${(el.textContent || '').trim().slice(0, 8)}」`
      if (!seen.has(name)) seen.set(name, `${name} ${Math.round(r.width)}×${Math.round(r.height)}`)
    }
  }
  return [...seen.values()]
}

// 可见文字里小于 14px 的
const SMALL_TEXT = () => {
  const seen = new Map()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim()
    const el = n.parentElement
    if (!t || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (cs.visibility === 'hidden' || cs.display === 'none' || !r.width || !r.height) continue
    const px = parseFloat(cs.fontSize)
    if (px < 14 && !el.classList.contains('logo-sub')) { // PERSONAL 是 logo 的装饰字
      const k = `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}`
      if (!seen.has(k)) seen.set(k, `${k}「${t.slice(0, 10)}」${px}px`)
    }
  }
  return [...seen.values()]
}

const TITLE_ONCE = () => {
  const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
  const top = document.querySelector('.topbar .title')
  const title = top?.textContent.trim()
  if (!title) return { title: null, count: 0 }
  const count = [...document.querySelectorAll('.topbar .title, .page-title')].filter((el) => visible(el) && el.textContent.trim() === title).length
  return { title, count }
}

// 内容在 .main 里滚动，整页截图前临时放开
async function unlockScroll(page) {
  await page.addStyleTag({ content: '.layout,.layout>.el-container{height:auto!important}.main{overflow:visible!important}' })
  await page.waitForTimeout(150)
}

async function settle(page, ms = 500) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

async function open(page, route, ms) {
  await page.goto(`${APP}/${route}`)
  await settle(page, ms)
}

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.clock.setFixedTime(FROZEN)
  const page = await ctx.newPage()
  await page.goto(`${APP}/login`)
  await page.getByPlaceholder('用户名').fill(USER)
  await page.getByPlaceholder('密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/dashboard/)
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

const device = (w) => {
  const mobile = w <= 768
  return { viewport: { width: w, height: HEIGHT[w] || 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 }
}

let draftSeq = 9100

async function newPage(browser, w, state) {
  const ctx = await browser.newContext({ ...device(w), ...(state ? { storageState: state } : {}) })
  await ctx.clock.setFixedTime(FROZEN)
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' || /\[Vue warn\]/.test(m.text())) page.errors.push(m.text().slice(0, 160)) })
  page.parseBodies = []
  page.askBodies = []
  page.parseReply = null // 单个用例改解析结果：(默认响应) => 响应
  await page.route('**/api/pf/ai/parse', (r) => {
    page.parseBodies.push(r.request().postData() || '')
    const data = { ...AI_FIXTURE, items: AI_FIXTURE.items.map((x) => ({ ...x, draftId: String(++draftSeq) })) }
    return r.fulfill({ json: { code: 0, message: 'ok', data: page.parseReply ? page.parseReply(data) : data } })
  })
  await page.route('**/api/pf/ai/ask', (r) => {
    page.askBodies.push(r.request().postDataJSON().question)
    return r.fulfill({ json: { code: 0, message: 'ok', data: { answer: '这个月花了 **12,860.32**，比上月少 8%。', ms: 1 } } })
  })
  // 入账不落库：演示账本要留给桌面回归；幂等本身由 backend/test 对真实库断言。第二次提交同一草稿回 duplicate，和服务端约定一致
  const seen = new Set()
  await page.route('**/api/pf/ai/drafts/*/submit', (r) => {
    const id = r.request().url().match(/drafts\/(\d+)/)[1]
    const duplicate = seen.has(id)
    seen.add(id)
    return r.fulfill({ json: { code: 0, message: 'ok', data: { draftId: id, id: '1', code: 'T-202610-00099', duplicate, submitted: true } } })
  })
  return { ctx, page }
}

const clickAdd = async (page) => {
  await page.locator('.page-head .el-button--primary').first().click()
  await page.waitForTimeout(450)
}
const openAi = async (page) => { await page.locator('.ai-open-btn').click(); await page.locator('.ai-drawer').waitFor({ timeout: 3000 }); await page.waitForTimeout(350) }
const closeOverlay = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(350) }

const sendAi = async (page, words, root = '.ai-drawer') => {
  await page.locator(`${root} textarea`).fill(words)
  await page.locator(`${root} .send-btn`).click()
}
const ONE_DRAFT = (d) => ({ ...d, items: d.items.slice(0, 1) })
const NO_DRAFT = (d) => ({ ...d, items: [] })

async function openDrafts(page) {
  await open(page, 'ai')
  await sendAi(page, '昨天和朋友吃火锅 386', '.ai-page')
  await page.locator('.draft').first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(250)
}

// 助手里不该再出现的东西：技术元数据、示例标签行、解析按钮；主按钮只能有一个「发送」
const CHAT_CLEAN = (root) => {
  const box = document.querySelector(root)
  const text = box.innerText
  const bad = []
  if (/(claude-cli|anthropic|provider|stub|e2e-fixture)\s*(·|\/)|\d+(\.\d+)?\s*s\b/i.test(text)) bad.push('出现 provider / 耗时文案')
  if (/试试[:：]/.test(text)) bad.push('出现「试试：」')
  if (/问问 AI/.test(text)) bad.push('出现「问问 AI」')
  if ([...box.querySelectorAll('button')].some((b) => b.textContent.includes('解析'))) bad.push('出现「解析」按钮')
  const main = [...box.querySelectorAll('.composer .el-button--primary')]
  if (main.length !== 1 || main[0].textContent.trim() !== '发送') bad.push(`输入区主按钮：${main.map((b) => b.textContent.trim()).join('/') || '无'}`)
  const eg = box.querySelectorAll('.ai-empty .eg').length
  return { bad, eg, empty: !!box.querySelector('.ai-empty') }
}

async function openImportPreview(page) {
  await open(page, 'import')
  await page.locator('.el-upload__input').first().setInputFiles({ name: 'e2e-微信账单.csv', mimeType: 'text/csv', buffer: Buffer.from(BILL_CSV) })
  await page.locator('.stat-grid').first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
}

// ---------- 验收 ----------
async function audit() {
  const browser = await chromium.launch()
  const state = await login(browser)
  const A = [] // 14 路由 × 3 档
  const B = [] // 交互态
  const D = [] // 抽屉打开态：路由 × 宽度
  const quality = [] // 触控/字号
  const logErrors = new Set()

  for (const w of [375, 768, 1440]) {
    const { ctx, page } = await newPage(browser, w, state)
    const { ctx: anonCtx, page: anon } = await newPage(browser, w)
    for (const route of ROUTES) {
      const p = PUBLIC.includes(route) ? anon : page
      await open(p, route)
      const r = await p.evaluate(FIND_OVERFLOW, w)
      const bad = [...r.bad]
      const hasData = TABLE_ROUTES.includes(route)
      if (w <= 768 && r.tables) bad.push(`仍渲染 el-table ×${r.tables}`)
      if (w <= 768 && hasData && !r.cards) bad.push('没有渲染出卡片（数据没灌上？）')
      if (w === 1440 && hasData && !r.tables) bad.push('桌面没有 el-table')
      if (w === 1440 && r.cards) bad.push('桌面渲染了卡片')
      if (w <= 768 && AUTHED.includes(route)) {
        const t = await p.evaluate(TITLE_ONCE)
        if (t.count !== 1) bad.push(`标题出现 ${t.count} 次`)
      }
      const pass = r.scrollWidth <= w + 1 && r.docWidth <= w + 1 && !bad.length
      A.push({ route, w, pass, scrollWidth: r.scrollWidth, tables: r.tables, cards: r.cards, bad })
      if (w <= 768) {
        const small = await p.evaluate(SMALL_TARGETS)
        const text = await p.evaluate(SMALL_TEXT)
        if (small.length || text.length) quality.push({ name: `${w} ${route}`, small, text })
      }
    }
    page.errors.concat(anon.errors).forEach((e) => logErrors.add(`${w}: ${e}`))
    await ctx.close(); await anonCtx.close()
  }

  // 交互态：手机 + 平板竖屏
  for (const w of [375, 768]) {
    const { ctx, page } = await newPage(browser, w, state)
    const add = async (name, extra = []) => {
      const r = await page.evaluate(FIND_OVERFLOW, w)
      const bad = [...r.bad, ...extra]
      if (r.tables) bad.push(`el-table ×${r.tables}`)
      const small = await page.evaluate(SMALL_TARGETS)
      const text = await page.evaluate(SMALL_TEXT)
      if (small.length || text.length) quality.push({ name: `${w} ${name}`, small, text })
      B.push({ name: `${w} ${name}`, pass: r.scrollWidth <= w + 1 && !bad.length, bad })
    }
    const must = async (sel) => ((await page.locator(sel).first().isVisible().catch(() => false)) ? [] : [`未打开：${sel}`])
    // 弹窗：全屏 + 标签在上 + 主按钮在视口内
    const dialogChecks = async () => page.evaluate((vw) => {
      const d = [...document.querySelectorAll('.el-dialog')].find((x) => x.offsetParent !== null || x.getBoundingClientRect().width)
      if (!d) return ['没有弹窗']
      const out = []
      const r = d.getBoundingClientRect()
      if (Math.round(r.width) < vw) out.push(`弹窗宽 ${r.width} 不是全屏`)
      const btn = d.querySelector('.el-dialog__footer .el-button--primary')?.getBoundingClientRect()
      if (!btn || btn.bottom > window.innerHeight + 1) out.push('主按钮不在视口内')
      for (const it of d.querySelectorAll('.el-form-item')) {
        const l = it.querySelector('.el-form-item__label'), c = it.querySelector('.el-form-item__content')
        if (l && l.textContent.trim() && c && l.getBoundingClientRect().bottom > c.getBoundingClientRect().top + 1) { out.push(`标签没在上方：${l.textContent}`); break }
      }
      const small = [...d.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')].filter((i) => i.offsetParent && parseFloat(getComputedStyle(i).fontSize) < 16)
      if (small.length) out.push(`输入框字号 <16px ×${small.length}`)
      return out
    }, w)

    // 导航抽屉：打开、高亮、点菜单后收起
    await open(page, 'transactions')
    await page.locator('.m-menu-btn').click(); await page.waitForTimeout(400)
    const active = (await page.locator('.m-nav-drawer .el-menu-item.is-active').first().textContent().catch(() => '')).trim()
    await add('[抽屉] 导航', [...(await must('.m-nav-drawer')), ...(active === '收支流水' ? [] : [`当前页高亮不对：「${active}」`])])
    await page.locator('.m-nav-drawer .el-menu-item', { hasText: '账户' }).click()
    await page.waitForURL(/accounts/); await page.waitForTimeout(500)
    const drawerGone = !(await page.locator('.m-nav-drawer').isVisible().catch(() => false))
    B.push({ name: `${w} [抽屉] 点菜单后收起`, pass: drawerGone, bad: drawerGone ? [] : ['抽屉没收起'] })

    // 顶栏入口：手机在头像旁，点开是全屏 sheet
    const label = (await page.locator('.ai-open-btn').textContent()).trim()
    await openAi(page)
    const sheet = await page.locator('.ai-drawer').evaluate((d) => { const r = d.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(d).paddingBottom !== undefined] })
    await add('[AI 抽屉] 全屏 sheet', [...(await must('.ai-drawer.is-sheet .ai-entry')), ...(await must('.ai-drawer .handle')), ...(await must('.ai-drawer .ai-close')), ...(await must('.ai-drawer .ai-clear')), ...(label === 'AI 记账' ? [] : [`按钮文案「${label}」`]), ...(sheet[0] === w && sheet[1] === HEIGHT[w] ? [] : [`sheet ${sheet[0]}×${sheet[1]}`])])
    const hint = (await page.locator('.ai-drawer .ai-hint').innerText()).trim()
    B.push({ name: `${w} [AI 抽屉] 一行说明`, pass: hint === '说一句话就能记，草稿确认后才入账', bad: [hint] })
    const ctxLine = (await page.locator('.ai-drawer .ai-ctx').innerText()).trim()
    const noTag = (await page.locator('.ai-drawer .ai-ctx .el-tag').count()) === 0
    B.push({ name: `${w} [AI 抽屉] 没引用时只有一句提示、没有空标签`, pass: ctxLine === '在列表里点 @ 引用记录' && noTag, bad: [ctxLine] })
    // 输入区贴底
    const docked = await page.evaluate(() => { const r = document.querySelector('.ai-drawer .composer').getBoundingClientRect(); return Math.abs(r.bottom - document.querySelector('.ai-drawer').getBoundingClientRect().bottom) <= 1 })
    B.push({ name: `${w} [AI 抽屉] 输入区贴底`, pass: docked, bad: docked ? [] : ['输入区没贴底'] })

    // 草稿卡：单列、入账按钮 ≥44、确认入账在视口内
    await sendAi(page, '昨天和朋友吃火锅 386')
    await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(300)
    await add('[AI 抽屉] 草稿卡', await must('.ai-drawer .draft'))
    const card = await page.evaluate(() => {
      const r = document.querySelector('.ai-drawer .card-submit').getBoundingClientRect()
      const c = document.querySelector('.ai-drawer .commit-bar .el-button').getBoundingClientRect()
      const box = document.querySelector('.ai-drawer .ai-messages')
      const cs = getComputedStyle(document.querySelector('.ai-drawer .draft'))
      const amount = getComputedStyle(document.querySelector('.ai-drawer .d-amount'))
      return { h: r.height, cols: getComputedStyle(document.querySelector('.ai-drawer .d-rows')).gridTemplateColumns.split(' ').length, confirm: c.bottom <= window.innerHeight + 1 && c.top >= 0, confirmH: c.height,
        scrollX: box.scrollWidth - box.clientWidth, radius: cs.borderRadius, padding: cs.paddingLeft, amountPx: amount.fontSize, amountW: Number(amount.fontWeight) }
    })
    const cardBad = [...(card.h >= 44 ? [] : [`入账按钮高 ${card.h}`]), ...(card.cols === 2 ? [] : [`${card.cols} 列`]), ...(card.confirm ? [] : ['确认入账不在视口内']), ...(card.confirmH >= 44 ? [] : [`确认入账高 ${card.confirmH}`]), ...(card.scrollX <= 1 ? [] : [`对话区可横拖 ${card.scrollX}`]), ...(card.radius === '10px' && card.padding === '12px' ? [] : [`圆角 ${card.radius} 内边距 ${card.padding}`]), ...(card.amountPx === '18px' && card.amountW >= 600 ? [] : [`金额 ${card.amountPx}/${card.amountW}`])]
    B.push({ name: `${w} [AI 抽屉] 两列字段/入账≥44/确认固定底部/卡片规格`, pass: !cardBad.length, bad: cardBad })
    const drafts = await page.locator('.ai-drawer .draft').count()
    B.push({ name: `${w} [AI 抽屉] 一次多笔`, pass: drafts === AI_FIXTURE.items.length, bad: [`草稿 ${drafts}`] })
    const lack = (await page.locator('.ai-drawer .draft').first().locator('.d-lack').innerText()).trim()
    B.push({ name: `${w} [AI 抽屉] 缺字段红色一行`, pass: lack === '还缺：账户、科目', bad: [lack] })
    await page.locator('.ai-drawer .d-edit').first().click(); await page.waitForTimeout(200)
    await add('[AI 抽屉] 草稿展开修改', await must('.ai-drawer .fields'))
    const fieldCols = await page.evaluate(() => getComputedStyle(document.querySelector('.ai-drawer .fields')).gridTemplateColumns.split(' ').length)
    B.push({ name: `${w} [AI 抽屉] 修改表单单列`, pass: fieldCols === 1, bad: [`${fieldCols} 列`] })
    await page.locator('.ai-drawer .d-edit').first().click(); await page.waitForTimeout(150)

    // 切换页面：关掉 sheet 去别的页，再打开草稿还在
    const n0 = await page.locator('.ai-drawer .draft').count()
    await page.locator('.ai-close').click(); await page.waitForTimeout(350)
    await page.locator('.m-menu-btn').click(); await page.waitForTimeout(400)
    await page.locator('.m-nav-drawer .el-menu-item', { hasText: '收支流水' }).click()
    await page.waitForURL(/transactions/); await page.waitForTimeout(500)
    await openAi(page)
    const n1 = await page.locator('.ai-drawer .draft').count()
    B.push({ name: `${w} [AI 抽屉] 切页草稿保留`, pass: n0 > 0 && n1 === n0, bad: n1 === n0 ? [] : [`${n0} → ${n1}`] })
    await page.locator('.ai-close').click(); await page.waitForTimeout(350)

    // 卡片上的 @：放进引用、打开抽屉，解析时带给后端
    await page.locator('.m-card .pin-btn').first().click(); await page.waitForTimeout(400)
    await add('[AI 抽屉] @ 引用', await must('.ai-drawer .pin-tag'))
    await sendAi(page, '把这笔改成餐饮'); await page.waitForTimeout(400)
    const body = page.parseBodies.at(-1) || ''
    const sent = /"route":"\/transactions"/.test(body) && /"pinned":\[\{"type":"transaction","id":"\d+"\}\]/.test(body)
    B.push({ name: `${w} [AI 抽屉] 上下文和 @ 传给后端`, pass: sent, bad: sent ? [] : [body.slice(0, 200)] })

    // 连点入账：第二次走重复提示，不是报错
    const firstCard = page.locator('.ai-drawer .draft').first()
    const did = await firstCard.locator('.card-submit').click().then(() => true).catch(() => false)
    await page.waitForTimeout(350)
    const toast = await page.locator('.el-message').count()
    B.push({ name: `${w} [AI 抽屉] 单张入账：卡片收成一行，不弹提示`, pass: did && (await firstCard.locator('.d-done', { hasText: '已入账' }).count()) > 0 && toast === 0, bad: [`提示 ${toast}`] })
    // 忽略：这张没了，确认入账的数字跟着少一
    const n2 = await page.locator('.ai-drawer .d-ignore').count()
    await page.locator('.ai-drawer .d-ignore').first().click(); await page.waitForTimeout(200)
    const bar = (await page.locator('.ai-drawer .commit-bar').innerText()).trim()
    B.push({ name: `${w} [AI 抽屉] 忽略一张`, pass: bar === `确认入账（${n2 - 1}）`, bad: [bar] })
    await page.locator('.ai-drawer .commit-bar .el-button').click(); await page.waitForTimeout(500)
    const said = (await page.locator('.ai-drawer .msg.assistant .bubble').last().innerText()).trim()
    const toast2 = await page.locator('.el-message').count()
    B.push({ name: `${w} [AI 抽屉] 确认入账：只有一条「已入账 N 条」`, pass: said === `已入账 ${n2 - 1} 条` && toast2 === 0, bad: [said, `提示 ${toast2}`] })
    await page.locator('.ai-drawer .ai-clear').first().click(); await page.waitForTimeout(250)
    B.push({ name: `${w} [AI 抽屉] 清空对话`, pass: (await page.locator('.ai-drawer .msg').count()) === 0, bad: [] })
    await page.locator('.ai-drawer .el-tag__close').first().click(); await page.waitForTimeout(200)
    await page.locator('.ai-close').click(); await page.waitForTimeout(300)

    // 各页新增弹窗
    for (const [route, label] of [['accounts', '新增账户'], ['transactions', '手工记一笔'], ['holdings', '新增持仓'], ['assets', '新增资产'], ['loans', '新增借贷'], ['categories', '新增科目']]) {
      await open(page, route)
      await clickAdd(page)
      await add(`[弹窗] ${label}`, [...(await must('.el-dialog')), ...(await dialogChecks())])
      if (route === 'transactions') {
        await page.locator('.el-dialog .el-date-editor').first().click(); await page.waitForTimeout(350)
        await add('[弹窗] 日期选择面板', await must('.el-picker-panel'))
        await page.keyboard.press('Escape'); await page.waitForTimeout(200)
        const im = await page.locator('.el-dialog .el-input-number input').first().getAttribute('inputmode')
        B.push({ name: `${w} [弹窗] 金额键盘`, pass: im === 'decimal', bad: im === 'decimal' ? [] : [`inputmode=${im}`] })
      }
      await closeOverlay(page)
    }
    // 业务弹窗/抽屉
    const rowAction = async (route, text, sel, name, isDialog, card = '') => {
      await open(page, route)
      await page.locator('.m-card', { hasText: card }).locator('.m-card-actions .el-button', { hasText: text }).first().click()
      await page.waitForTimeout(500)
      await add(name, [...(await must(sel)), ...(isDialog ? await dialogChecks() : [])])
      await closeOverlay(page)
    }
    await rowAction('accounts', '校准', '.el-dialog', '[弹窗] 校准余额', true)
    await rowAction('assets', '更新估值', '.el-dialog', '[弹窗] 更新估值', true)
    await rowAction('assets', '历史', '.el-drawer .m-card', '[抽屉] 估值历史')
    await rowAction('loans', /登记/, '.el-dialog', '[弹窗] 登记回款', true)
    await rowAction('loans', '记录', '.el-drawer .m-card', '[抽屉] 还款记录')
    await rowAction('holdings', '交易/估值', '.el-dialog', '[弹窗] 交易估值', true)
    await rowAction('holdings', '记录', '.el-drawer .m-card', '[抽屉] 交易记录', false, '沪深300')
    await open(page, 'accounts')
    await page.locator('.page-head .el-button', { hasText: '转账' }).click(); await page.waitForTimeout(400)
    await add('[弹窗] 账户互转', [...(await must('.el-dialog')), ...(await dialogChecks())])
    await closeOverlay(page)

    // 筛选 sheet
    for (const route of ['transactions', 'loans', 'categories']) {
      await open(page, route)
      await page.locator('.m-filter-btn').first().click(); await page.waitForTimeout(450)
      await add(`[sheet] ${route} 筛选`, await must('.m-sheet'))
      await closeOverlay(page)
    }
    // 流水：翻页、勾选批量条
    await open(page, 'transactions')
    const pagerNext = page.locator('.m-pager .el-button').last()
    await pagerNext.click(); await settle(page, 300)
    const pageInfo = (await page.locator('.m-pager-info').textContent()).trim()
    await add('[流水] 第 2 页', pageInfo.startsWith('2') ? [] : [`翻页没生效：${pageInfo}`])
    await page.locator('.m-pager .el-button').first().click(); await settle(page, 300)
    await page.locator('.m-card .m-check .el-checkbox').first().click(); await page.waitForTimeout(300)
    await add('[流水] 批量操作条', await must('.batch-bar'))

    // 预算编制、导入预览、AI 草稿
    await open(page, 'budget')
    await page.locator('.el-radio-button', { hasText: '编制预算' }).click(); await page.waitForTimeout(500)
    await add('[预算] 编制 tab')
    await openImportPreview(page)
    await add('[导入] 预览', await must('.m-desktop-tip'))
    await openDrafts(page)
    await page.evaluate(() => { document.querySelector('.ai-messages').scrollTop = 1e6 }); await page.waitForTimeout(250)
    const sendBtn = await page.evaluate(() => {
      const r = document.querySelector('.ai-page .send-btn').getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })
    await add('[AI] 草稿卡（滚到底）', [...(await must('.ai-page .draft')), ...(sendBtn ? [] : ['发送按钮不在视口内'])])
    const pageBars = await page.evaluate(() => {
      const c = document.querySelector('.ai-page .commit-bar .el-button').getBoundingClientRect()
      const a = document.querySelector('.ai-page .composer').getBoundingClientRect()
      return c.bottom <= a.top + 1 && c.top >= 0
    })
    B.push({ name: `${w} [AI] 完整页确认入账固定在输入条上方`, pass: pageBars, bad: pageBars ? [] : ['位置不对'] })
    const noMainScroll = await page.evaluate(() => { const m = document.querySelector('.main'); return m.scrollHeight <= m.clientHeight + 1 })
    B.push({ name: `${w} [AI] 完整页只有对话区滚动`, pass: noMainScroll, bad: noMainScroll ? [] : ['.main 也能滚'] })
    await page.locator('.ai-entry .card-submit').first().scrollIntoViewIfNeeded()
    await page.locator('.ai-entry .card-submit').first().click(); await page.waitForTimeout(200)
    page.errors.forEach((e) => logErrors.add(`${w}: ${e}`))
    await ctx.close()
  }

  // 抽屉打开时逐路由 0 溢出（含草稿卡）：375/768 全屏 sheet，1440 贴右侧挤窄主内容，1024 盖在内容上
  for (const w of [375, 768, 1024, 1440]) {
    const { ctx, page } = await newPage(browser, w, state)
    for (const route of AUTHED) {
      await open(page, route, 300)
      if (route === 'ai') { // 完整页就是这条对话，抽屉不开
        const off = (await page.locator('.ai-open-btn').count()) === 0
        D.push({ route, w, pass: off, scrollWidth: 0, bad: off ? [] : ['完整页上还有 AI 记账按钮'] })
        continue
      }
      await openAi(page)
      if (route === 'transactions') {
        await sendAi(page, '昨天和朋友吃火锅 386')
        await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(250)
      }
      const r = await page.evaluate(FIND_OVERFLOW, w)
      const bad = [...r.bad]
      if (w <= 768) {
        const small = await page.evaluate(SMALL_TARGETS)
        const text = await page.evaluate(SMALL_TEXT)
        if (small.length || text.length) quality.push({ name: `${w} 抽屉打开 ${route}`, small, text })
      }
      D.push({ route, w, pass: r.scrollWidth <= w + 1 && r.docWidth <= w + 1 && !bad.length, scrollWidth: r.scrollWidth, bad })
    }
    page.errors.forEach((e) => logErrors.add(`${w}: ${e}`))
    await ctx.close()
  }

  // 桌面抽屉：贴右侧 ~420、主内容让位、切页不销毁、可拖宽、完整页入口、@ 不关抽屉、退出登录清掉草稿
  {
    const { ctx, page } = await newPage(browser, 1440, state)
    const rows = []
    const row = (name, pass, bad = []) => rows.push({ name: `1440 [AI 抽屉] ${name}`, pass, bad: pass ? [] : bad })
    await open(page, 'transactions')
    const mainW = await page.locator('.main').evaluate((e) => e.clientWidth)
    row('关闭时不占位（没挂载）', (await page.locator('.ai-drawer').count()) === 0)
    await openAi(page)
    const dw = await page.locator('.ai-drawer').evaluate((e) => e.getBoundingClientRect().width)
    const mainOpen = await page.locator('.main').evaluate((e) => e.clientWidth)
    row('宽 420、主内容让位', dw === 420 && mainOpen <= mainW - 400, [`抽屉 ${dw} 主内容 ${mainW} → ${mainOpen}`])
    await page.locator('.ai-drawer textarea').fill('昨天和朋友吃火锅 386')
    await page.keyboard.press('Enter')
    await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(250)
    row('Enter 发送', (await page.locator('.ai-drawer .msg.user').count()) === 1)
    await page.locator('.pin-btn').first().click(); await page.waitForTimeout(250)
    row('@ 后抽屉仍开着，出现已引用', (await page.locator('.ai-drawer .pin-tag').count()) === 1)
    await page.locator('.sidebar .el-menu-item', { hasText: '账户' }).first().click()
    await page.waitForURL(/accounts/); await page.waitForTimeout(500)
    const kept = await page.locator('.ai-drawer .draft').count()
    row('切页抽屉不关、草稿保留', (await page.locator('.ai-drawer').isVisible()) && kept === AI_FIXTURE.items.length, [`草稿 ${kept}`])
    const box = await page.locator('.resizer').boundingBox()
    await page.mouse.move(box.x + 2, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x - 120, box.y + 200, { steps: 4 }); await page.mouse.up()
    await page.waitForTimeout(200)
    const dragged = await page.locator('.ai-drawer').evaluate((e) => e.getBoundingClientRect().width)
    row('可拖宽', dragged > 500, [`宽 ${dragged}`])
    const r = await page.evaluate(FIND_OVERFLOW, 1440)
    row('拖宽后 0 溢出', r.scrollWidth <= 1441 && !r.bad.length, r.bad)
    await page.locator('.sidebar .el-menu-item', { hasText: 'AI 记账' }).first().click()
    await page.waitForURL(/\/ai$/); await page.waitForTimeout(400)
    row('进完整页：同一条对话，抽屉让位', (await page.locator('.ai-page .draft').count()) === kept && !(await page.locator('.ai-drawer').isVisible()))
    await page.locator('.topbar .user').hover(); await page.waitForTimeout(300)
    await page.getByRole('menuitem', { name: '退出登录' }).click(); await page.waitForURL(/login/)
    await page.getByPlaceholder('用户名').fill(USER); await page.getByPlaceholder('密码').fill(PASS)
    await page.getByRole('button', { name: '登录' }).click(); await page.waitForURL(/dashboard/)
    await page.goto(`${APP}/dashboard`).catch(() => {})
    await page.locator('.ai-open-btn').click(); await page.waitForTimeout(350)
    row('退出登录后草稿和引用清空', (await page.locator('.ai-drawer .draft').count()) === 0 && (await page.locator('.ai-drawer .pin-tag').count()) === 0)
    B.push(...rows)
    page.errors.forEach((e) => logErrors.add(`1440 抽屉: ${e}`))
    await ctx.close()
  }

  // 助手 DOM 断言：抽屉和完整页 × 三档；同一个输入框记账、提问自然切换；反问补一句后取代旧草稿
  for (const w of [375, 768, 1440]) {
    const { ctx, page } = await newPage(browser, w, state)
    const row = (name, pass, bad = []) => B.push({ name: `${w} [助手] ${name}`, pass, bad: pass ? [] : bad })
    const clean = async (name, root) => {
      const r = await page.evaluate(CHAT_CLEAN, root)
      row(`${name} 无元数据/试试/解析，主按钮只有「发送」`, !r.bad.length, r.bad)
      return r
    }
    await open(page, 'transactions')
    await openAi(page)
    const empty = await clean('抽屉空态', '.ai-drawer')
    row('抽屉空态可点示例恰好 1 个', empty.eg === 1, [`${empty.eg} 个`])
    await page.locator('.ai-drawer .ai-empty .eg').click()
    row('点示例填进输入框', (await page.locator('.ai-drawer textarea').inputValue()) === '今天午饭 45 微信')
    await page.locator('.ai-drawer textarea').fill('')

    // 纯问题：直接答，不进解析、不出草稿
    await sendAi(page, '这个月花了多少')
    await page.locator('.ai-drawer .msg.assistant .bubble').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(200)
    row('纯问题不调解析、不出草稿', page.askBodies.length === 1 && !page.parseBodies.length && (await page.locator('.ai-drawer .draft').count()) === 0, [`ask ${page.askBodies.length} parse ${page.parseBodies.length}`])
    row('回答里的加粗渲染了', (await page.locator('.ai-drawer .bubble.md strong').count()) === 1)
    // 追问要带前文
    await sendAi(page, '那上个月呢')
    await page.waitForTimeout(400)
    row('追问带上前文', /这个月花了多少/.test(page.askBodies[1] || '') && /现在的问题：那上个月呢/.test(page.askBodies[1] || ''), [page.askBodies[1] || ''])
    // 判不出是提问的：解析空手回来，转问答，不弹「换个说法」
    page.parseReply = NO_DRAFT
    await sendAi(page, '超过1000的支出有哪些')
    await page.waitForTimeout(500)
    row('解析空手转问答', page.parseBodies.length === 1 && page.askBodies.length === 3, [`ask ${page.askBodies.length} parse ${page.parseBodies.length}`])

    // 记账：单笔缺账户，一句话问；补一句后合并重发，新草稿取代旧草稿
    page.parseReply = ONE_DRAFT
    await sendAi(page, '昨天和朋友吃火锅 386')
    await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(250)
    const ask = (await page.locator('.ai-drawer .msg.assistant').last().locator('.bubble').innerText()).trim()
    row('缺字段只问一句', ask === '这笔从哪个账户出的？', [ask])
    await sendAi(page, '光大信用卡')
    await page.waitForTimeout(500)
    const merged = page.parseBodies.at(-1) || ''
    row('反问的回答并进原话', merged.includes('昨天和朋友吃火锅 386（补充：光大信用卡）'), [merged.slice(0, 200)])
    row('新草稿取代旧草稿', (await page.locator('.ai-drawer .draft').count()) === 1, [`${await page.locator('.ai-drawer .draft').count()} 张`])
    await clean('抽屉有草稿', '.ai-drawer')
    page.parseReply = null

    // 375 下抽屉：不横向溢出，切页后还在，对话也在
    const sw = await page.evaluate(() => [document.body.scrollWidth, window.innerWidth])
    row('抽屉 body.scrollWidth <= innerWidth', sw[0] <= sw[1], [sw.join(' / ')])
    const msgs = await page.locator('.ai-drawer .msg').count()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/accounts'))
    await page.waitForURL(/accounts/); await page.waitForTimeout(400)
    row('切页后抽屉仍在、对话不丢', (await page.locator('.ai-drawer').isVisible()) && (await page.locator('.ai-drawer .msg').count()) === msgs)

    // 完整页是同一条对话
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/ai'))
    await page.waitForURL(/\/ai$/); await page.waitForTimeout(500)
    row('完整页同一条对话', (await page.locator('.ai-page .msg').count()) === msgs, [`${await page.locator('.ai-page .msg').count()} / ${msgs}`])
    await clean('完整页', '.ai-page')
    const pageText = await page.locator('.main').innerText()
    row('完整页无独立问答区、无耗时', !/问问 AI|提问/.test(pageText) && !/\d\.\d+s\b/.test(pageText), [pageText.slice(0, 120)])
    page.errors.forEach((e) => logErrors.add(`${w} 助手: ${e}`))
    await ctx.close()
  }

  // 列表三态：两种形态都要有
  for (const w of [375, 1440]) {
    const { ctx, page } = await newPage(browser, w, state)
    const list = '**/api/pf/accounts?*'
    const rows = [
      ['错误态', (r) => r.fulfill({ status: 500, json: { code: 500, message: 'E2E 模拟失败' } }), w < 769 ? '.m-state-error' : '.el-table__empty-text .money-out'],
      ['空态', (r) => r.fulfill({ json: { code: 0, message: 'ok', data: { list: [], total: 0 } } }), w < 769 ? '.m-state' : '.el-table__empty-text'],
      ['加载态', async (r) => { await new Promise((ok) => setTimeout(ok, 2500)); await r.continue() }, '.el-loading-mask']
    ]
    for (const [name, handler, sel] of rows) {
      await page.route(list, handler)
      await page.goto(`${APP}/accounts`)
      await page.waitForTimeout(name === '加载态' ? 800 : 1000)
      const ok = await page.locator(sel).first().isVisible().catch(() => false)
      const text = ok ? (await page.locator(sel).first().textContent()).trim().slice(0, 24) : ''
      B.push({ name: `${w} [列表] ${name}`, pass: ok, bad: ok ? [`（文案：${text || '—'}）`] : [`未出现：${sel}`], note: true })
      await page.unroute(list)
      await page.waitForTimeout(name === '加载态' ? 2000 : 0)
    }
    await ctx.close()
  }

  // 版本号：桌面在顶栏，手机收进头像下拉；接口没给版本时什么都不显示
  {
    const version = `v${MANIFEST_VERSION}`
    const row = (name, pass, bad = []) => B.push({ name: `[版本号] ${name}`, pass, bad: pass ? [] : bad })
    const topbar = (page) => page.locator('.topbar').innerText()
    const { ctx: dCtx, page: desk } = await newPage(browser, 1440, state)
    await open(desk, 'dashboard')
    const dText = await topbar(desk)
    row(`1440 顶栏含 ${version}`, /\bv\d/.test(dText) && dText.includes(version), [dText])
    const px = await desk.locator('.app-version').evaluate((e) => getComputedStyle(e).fontSize)
    row('1440 字号 12px', px === '12px', [px])
    const order = await desk.evaluate(() => document.querySelector('.app-version').getBoundingClientRect().right <= document.querySelector('.topbar .user').getBoundingClientRect().left)
    row('1440 在头像左侧', order)
    await dCtx.close()

    for (const w of [375, 768]) {
      const { ctx, page } = await newPage(browser, w, state)
      await open(page, 'dashboard')
      const text = await topbar(page)
      row(`${w} 顶栏不含版本`, !/\bv\d/.test(text) && (await page.locator('.topbar .app-version').count()) === 0, [text])
      await page.locator('.topbar .user').click(); await page.waitForTimeout(350)
      const items = (await page.locator('.el-dropdown-menu:visible .el-dropdown-menu__item').allInnerTexts()).map((t) => t.trim())
      row(`${w} 头像下拉第一行是「版本 ${version}」`, items[0] === `版本 ${version}`, [items.join(' / ')])
      const r = await page.evaluate(FIND_OVERFLOW, w)
      row(`${w} 下拉打开 0 溢出`, r.scrollWidth <= w + 1 && !r.bad.length, r.bad)
      await ctx.close()
    }

    for (const [name, reply] of [['没有 version 字段', { json: { code: 0, message: 'ok', data: { ts: 1 } } }], ['接口报错', { status: 500, json: { code: 500, message: 'E2E 模拟失败' } }]]) {
      for (const w of [375, 1440]) {
        const { ctx, page } = await newPage(browser, w, state)
        await page.route('**/api/health', (r) => r.fulfill(reply))
        await open(page, 'dashboard')
        const text = await topbar(page)
        await page.locator('.topbar .user').click(); await page.waitForTimeout(350)
        const menu = await page.locator('.el-dropdown-menu:visible').innerText()
        const leaked = (await page.locator('.app-version, .m-version-line').count()) || /\bv(undefined|null)?(\s|$)|版本/.test(`${text}\n${menu}`)
        row(`${w} ${name}：不渲染占位`, !leaked, [text, menu])
        await ctx.close()
      }
    }
  }

  // 平板图标栏（1024）：只测导航形态，表格保持桌面
  {
    const { ctx, page } = await newPage(browser, 1024, state)
    for (const route of AUTHED) {
      await open(page, route)
      const r = await page.evaluate(FIND_OVERFLOW, 1024)
      const rail = await page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().width)
      const bad = [...r.bad, ...(rail === 64 ? [] : [`侧栏宽 ${rail}`])]
      B.push({ name: `1024 ${route}`, pass: r.scrollWidth <= 1025 && !bad.length, bad })
    }
    await ctx.close()
  }

  // 跨断点：桌面 → 手机 → 桌面，表格/卡片要来回切换
  {
    const { ctx, page } = await newPage(browser, 1440, state)
    await open(page, 'transactions')
    const before = await page.locator('.el-table').count()
    await page.setViewportSize({ width: 375, height: 667 }); await page.waitForTimeout(500)
    const mid = await page.evaluate(() => [document.querySelectorAll('.el-table').length, document.querySelectorAll('.m-card').length])
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(500)
    const after = await page.locator('.el-table').count()
    const pass = before > 0 && mid[0] === 0 && mid[1] > 0 && after > 0
    B.push({ name: '跨断点 1440→375→1440', pass, bad: pass ? [] : [`table ${before} → ${mid[0]}（卡片 ${mid[1]}）→ ${after}`] })
    await ctx.close()
  }
  await browser.close()

  console.log('\n## A. 14 路由 × 3 档\n')
  console.log('| 路由 | 375 | 375 scrollWidth | 375 el-table | 375 卡片 | 768 | 768 scrollWidth | 768 el-table | 768 卡片 | 1440 | 1440 scrollWidth | 1440 el-table |')
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const route of ROUTES) {
    const [a, b, c] = [375, 768, 1440].map((w) => A.find((x) => x.route === route && x.w === w))
    const m = (x) => (x.pass ? 'PASS' : 'FAIL')
    console.log(`| ${route} | ${m(a)} | ${a.scrollWidth} | ${a.tables} | ${a.cards} | ${m(b)} | ${b.scrollWidth} | ${b.tables} | ${b.cards} | ${m(c)} | ${c.scrollWidth} | ${c.tables} |`)
  }
  for (const r of A.filter((x) => x.bad.length)) console.log(`  ✗ ${r.w} ${r.route}: ${r.bad.join(' ; ')}`)

  console.log('\n## 抽屉打开态 × 路由\n')
  console.log('| 路由 | 375 | 768 | 1024 | 1440 |')
  console.log('|---|---|---|---|---|')
  for (const route of AUTHED) {
    console.log(`| ${route} | ${[375, 768, 1024, 1440].map((w) => { const x = D.find((d) => d.route === route && d.w === w); return `${x.pass ? 'PASS' : 'FAIL'} ${x.scrollWidth}` }).join(' | ')} |`)
  }
  for (const r of D.filter((x) => x.bad.length)) console.log(`  ✗ ${r.w} ${r.route}: ${r.bad.join(' ; ')}`)

  console.log('\n## 交互态\n')
  for (const r of B) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.bad.length ? '  ' + r.bad.join(' ; ') : ''}`)

  console.log('\n## 触控 <44 / 字号 <14\n')
  if (!quality.length) console.log('无')
  for (const q of quality) {
    console.log(`- ${q.name}`)
    if (q.small.length) console.log(`    触控: ${q.small.slice(0, 8).join(' | ')}`)
    if (q.text.length) console.log(`    字号: ${q.text.slice(0, 8).join(' | ')}`)
  }
  console.log('\n## 控制台错误\n')
  console.log(logErrors.size ? [...logErrors].join('\n') : '无')

  const failA = A.filter((r) => !r.pass).length
  const failB = B.filter((r) => !r.pass).length
  const failD = D.filter((r) => !r.pass).length
  console.log(`\n合计 A ${A.length} 项失败 ${failA}；抽屉打开 ${D.length} 项失败 ${failD}；交互 ${B.length} 项失败 ${failB}；触控/字号待修 ${quality.length} 处；控制台错误 ${logErrors.size}`)
  process.exit(failA || failB || failD || quality.length ? 1 : 0)
}

// AI 助手四态：抽屉空态、一张草稿、多笔草稿、完整页
async function aiShots(browser, state, w, dir) {
  const { ctx, page } = await newPage(browser, w, state)
  await open(page, 'transactions', 800)
  await openAi(page)
  await page.screenshot({ path: path.join(dir, 'ai-drawer-empty.png') })
  page.parseReply = ONE_DRAFT
  await sendAi(page, '昨天和朋友吃火锅 386')
  await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(dir, 'ai-drawer-draft.png') })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/transactions'))
  await page.locator('.ai-drawer .ai-clear').first().click(); await page.waitForTimeout(250)
  await page.locator('.el-message-box .el-button--primary').click(); await page.waitForTimeout(350)
  page.parseReply = null
  await sendAi(page, '昨天和朋友吃火锅 386\n还光大信用卡 2000\n买入腾讯 100 股\n招行余额 76543.21\n新买中证红利 1500')
  await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(dir, 'ai-drawer-multi.png') })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/ai'))
  await page.waitForURL(/\/ai$/); await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(dir, 'ai-page.png') })
  await ctx.close()
}

async function shots() {
  const out = opt('out', 'screenshots/mobile')
  const browser = await chromium.launch()
  const state = await login(browser)
  if (opt('only') === 'version') {
    fs.mkdirSync(out, { recursive: true })
    const { ctx: dCtx, page: desk } = await newPage(browser, 1440, state)
    await open(desk, 'dashboard')
    await desk.screenshot({ path: path.join(out, 'version-1440-topbar.png'), clip: { x: 0, y: 0, width: 1440, height: 120 } })
    await dCtx.close()
    const { ctx, page } = await newPage(browser, 375, state)
    await open(page, 'dashboard')
    await page.screenshot({ path: path.join(out, 'version-375-topbar.png'), clip: { x: 0, y: 0, width: 375, height: 120 } })
    await page.locator('.topbar .user').click(); await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(out, 'version-375-dropdown.png'), clip: { x: 0, y: 0, width: 375, height: 260 } })
    await ctx.close()
    await browser.close()
    return console.log(path.join(out, 'version-*.png'))
  }
  const onlyAi = opt('only') === 'ai'
  for (const w of opt('widths', '375,768,1440').split(',').map(Number)) {
    const dir = path.join(out, String(w))
    fs.mkdirSync(dir, { recursive: true })
    await aiShots(browser, state, w, dir)
    if (onlyAi) { console.log(`${w}: ${['ai-drawer-empty', 'ai-drawer-draft', 'ai-drawer-multi', 'ai-page'].map((f) => path.join(dir, `${f}.png`)).join('\n     ')}`); continue }
    const { ctx: anonCtx, page: anon } = await newPage(browser, w)
    await open(anon, 'login')
    await anon.screenshot({ path: path.join(dir, 'login.png') })
    await anonCtx.close()

    const { ctx, page } = await newPage(browser, w, state)
    for (const route of ['dashboard', 'transactions', 'accounts', 'import', 'holdings', 'budget', 'close']) {
      await open(page, route, 1300)
      await unlockScroll(page)
      await page.screenshot({ path: path.join(dir, `${route}.png`), fullPage: true })
    }
    await open(page, 'transactions')
    await clickAdd(page)
    await page.screenshot({ path: path.join(dir, 'transactions-add-dialog.png') })
    await closeOverlay(page)
    await open(page, 'accounts')
    await clickAdd(page)
    await page.screenshot({ path: path.join(dir, 'accounts-add-dialog.png') })
    await closeOverlay(page)
    await openDrafts(page)
    await page.screenshot({ path: path.join(dir, 'ai.png') })
    await unlockScroll(page)
    await page.screenshot({ path: path.join(dir, 'ai-drafts-full.png'), fullPage: true })
    await openImportPreview(page)
    await unlockScroll(page)
    await page.screenshot({ path: path.join(dir, 'import-preview.png'), fullPage: true })
    if (w <= 768) {
      await open(page, 'transactions')
      await page.locator('.m-menu-btn').click(); await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(dir, 'nav-drawer.png') })
      await closeOverlay(page)
      await page.locator('.m-filter-btn').first().click(); await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(dir, 'filter-sheet.png') })
      await closeOverlay(page)
    }
    await ctx.close()
    console.log(`${w}: ${fs.readdirSync(dir).sort().map((f) => path.join(dir, f)).join('\n     ')}`)
  }
  await browser.close()
}

// 桌面回归：同一份脚本在改动前后各跑一次，compare 逐像素比
async function desktop() {
  const out = opt('out', 'screenshots/desktop')
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const state = await login(browser)
  const { ctx: anonCtx, page: anon } = await newPage(browser, 1440)
  for (const route of PUBLIC) {
    await open(anon, route)
    await anon.screenshot({ path: path.join(out, `${route}.png`), fullPage: true })
  }
  await anonCtx.close()
  const { ctx, page } = await newPage(browser, 1440, state)
  for (const route of AUTHED) {
    await open(page, route, 1500)
    await page.screenshot({ path: path.join(out, `${route}.png`) }) // 视口内原样
    await unlockScroll(page)
    await page.screenshot({ path: path.join(out, `${route}-full.png`), fullPage: true })
  }
  for (const route of ['accounts', 'transactions', 'holdings', 'loans', 'assets', 'categories']) {
    await open(page, route)
    await clickAdd(page)
    await page.screenshot({ path: path.join(out, `dialog-${route}.png`) })
  }
  await open(page, 'budget')
  await page.locator('.el-radio-button', { hasText: '编制预算' }).click(); await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(out, 'budget-edit.png') })
  await openImportPreview(page)
  await page.screenshot({ path: path.join(out, 'import-preview.png') })
  await openDrafts(page)
  await page.screenshot({ path: path.join(out, 'ai-drafts.png') })
  // 改动前的版本没有这个入口时跳过，基线和改后都能跑
  if (await page.locator('.ai-open-btn').count()) {
    await open(page, 'transactions', 1000)
    await openAi(page)
    await sendAi(page, '昨天和朋友吃火锅 386')
    await page.locator('.ai-drawer .draft').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(out, 'ai-drawer-open.png') })
  }
  await browser.close()
  console.log(`已截 ${fs.readdirSync(out).length} 张 → ${out}`)
}

async function compare() {
  const [a, b] = args.slice(1)
  const browser = await chromium.launch()
  const page = await browser.newPage()
  let same = 0
  const rows = []
  for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
    if (!fs.existsSync(path.join(b, f))) { rows.push(`${f}: 改后缺失`); continue }
    const url = (d) => `data:image/png;base64,${fs.readFileSync(path.join(d, f)).toString('base64')}`
    const r = await page.evaluate(async ([ua, ub]) => {
      const load = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u })
      const [ia, ib] = await Promise.all([load(ua), load(ub)])
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}×${ia.height} → ${ib.width}×${ib.height}` }
      const data = (img) => { const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data }
      const [da, db] = [data(ia), data(ib)]
      let n = 0, top = 1e9, bottom = -1, left = 1e9, right = -1
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 8) {
          n++
          const px = i / 4, y = Math.floor(px / ia.width), x = px - y * ia.width
          top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x)
        }
      }
      return { n, box: n ? `x${left}-${right} y${top}-${bottom}` : '', total: ia.width * ia.height }
    }, [url(a), url(b)])
    if (r.size) rows.push(`${f}: 尺寸变化 ${r.size}`)
    else if (r.n) rows.push(`${f}: ${r.n} 像素不同（${(r.n / r.total * 100).toFixed(3)}%）${r.box}`)
    else same++
  }
  await browser.close()
  console.log(`完全一致 ${same} 张；有差异 ${rows.length} 张`)
  rows.forEach((r) => console.log('  ' + r))
}

if (mode === 'seed') await seed()
else if (mode === 'audit') await audit()
else if (mode === 'shots') await shots()
else if (mode === 'desktop') await desktop()
else if (mode === 'compare') await compare()
else { console.error('用法：node scripts/mobile-audit.mjs seed|audit|shots|desktop|compare'); process.exit(2) }
