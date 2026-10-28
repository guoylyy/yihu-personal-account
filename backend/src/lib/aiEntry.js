// AI 辅助录入：一句话 / 多行文字 / 截图 → 结构化草稿 → 你确认后入账
// 流程：parse（AI 或规则）→ resolve（名字对到账户/科目/持仓 id，套用学到的规则）→ 前端可改 → commit
import dayjs from 'dayjs'
import prisma from './prisma.js'
import { llmJSON, aiStatus } from './llm.js'
import { classify, matchAccount, learnRule } from './classify.js'
import { createTransaction, createTransfer, holdingTrade, assetValuation, loanRepay, calibrateBalance } from './ledger.js'
import { round2 } from './money.js'
import { toDate } from './period.js'
import { resolveUid } from './tenant.js'

export const ITEM_TYPES = {
  transaction: '收支',
  transfer: '账户互转',
  trade: '投资交易',
  holding_valuation: '持仓估值',
  asset_valuation: '资产估值',
  balance: '余额校准',
  loan_repay: '借贷还款',
  new_loan: '新增借贷',
  new_holding: '新增持仓'
}

// ─────────── 上下文：告诉模型你有哪些账户、科目、持仓 ───────────
async function buildContext() {
  const userId = resolveUid()
  const [accounts, categories, holdings, assets, loans] = await Promise.all([
    prisma.account.findMany({ where: { userId, deletedAt: null, status: 'ACTIVE' }, orderBy: { sort: 'asc' } }),
    prisma.category.findMany({ where: { userId, deletedAt: null }, orderBy: { sort: 'asc' } }),
    prisma.holding.findMany({ where: { userId, deletedAt: null, status: 'HOLDING' } }),
    prisma.fixedAsset.findMany({ where: { userId, deletedAt: null } }),
    prisma.loan.findMany({ where: { userId, deletedAt: null, status: { not: 'SETTLED' } } })
  ])
  return { accounts, categories, holdings, assets, loans }
}

function systemPrompt(ctx) {
  const today = dayjs().format('YYYY-MM-DD dddd')
  return `你是一个个人记账助手，把用户输入的自然语言或账单截图，解析成可入账的结构化条目。今天是 ${today}（Asia/Shanghai）。

## 用户的账户（account / toAccount 字段填这里的「名称」）
${ctx.accounts.map((a) => `- ${a.name}（${a.type}${a.lastNo ? ' 尾号' + a.lastNo : ''}${a.aliases ? '，别名：' + a.aliases : ''}）`).join('\n')}

## 收支科目（categoryCode 填代码）
${ctx.categories.map((c) => `- ${c.code} ${c.name} [${c.kind}${c.groupName ? '/' + c.groupName : ''}]${c.remark ? '：' + c.remark : ''}`).join('\n')}

## 投资持仓（holding 字段填名称）
${ctx.holdings.map((h) => `- ${h.name}${h.code ? '(' + h.code + ')' : ''} [${h.type}]`).join('\n') || '（暂无）'}

## 固定资产（asset 字段填名称）
${ctx.assets.map((a) => `- ${a.name} [${a.type}]`).join('\n') || '（暂无）'}

## 借贷（loan 字段填对方名称）
${ctx.loans.map((l) => `- ${l.counterparty}（${l.direction === 'LEND' ? '我借出' : '我借入'}，${l.kind}）`).join('\n') || '（暂无）'}

## 记账口径
- 只记实际发生的钱。夫妻/家庭内部划转用 T4。还信用卡、转余额宝等自己账户之间的钱用 transfer 类型。
- 公司的钱（替公司付的云服务、员工报销、合伙人款、办公室房租等）isBusiness=true，categoryCode 用最贴近的科目或 C，businessOrg 写公司名（示例科技/示例教育/示例云/示例联合/示例贸易 等）。
- 日期：「今天/昨天/前天/上周五/9月3号」换算成 YYYY-MM-DD；没说日期就用今天。
- 金额：「3千」=3000，「1.2万」=12000，「128块5」=128.5。
- 一段话里有几笔就拆成几条；截图里每一笔交易都是一条。看不清/不确定的字段留 null，并在 note 里说明。

## 输出
只输出一个 JSON 对象，不要任何解释：
{"items":[{ "type": "...", ... , "confidence": 0~1, "note": "不确定之处（可空）" }]}

各 type 的字段：
- transaction：date, direction("IN"|"OUT"), amount, account, categoryCode, counterparty, description, isBusiness, businessOrg
- transfer：date, amount, account(转出), toAccount(转入), description
- trade：date, holding, action("BUY"|"SELL"|"DIVIDEND"), quantity, price, amount, fee, account(资金账户，可空)
- holding_valuation：date, holding, price 或 amount(新市值)
- asset_valuation：date, asset, amount(新估值), description
- balance：date, account, amount(该账户当前真实余额)
- loan_repay：date, loan, principal, interest, account
- new_loan：date, direction("LEND"|"BORROW"), counterparty, amount, kind("PERSONAL"|"COMPANY"|"MORTGAGE"|"OTHER"), description
- new_holding：date, holding(名称), holdingType("STOCK"|"FUND"|"WEALTH"|"DEPOSIT"|"INSURANCE"|"EQUITY"|"OTHER"), code, platform, quantity, price, amount, account`
}

// ─────────── 规则解析（AI 不可用时兜底，只识别收支）───────────
const CN_NUM = { 两: 2, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function parseDate(s) {
  const today = dayjs()
  if (/前天/.test(s)) return today.subtract(2, 'day').format('YYYY-MM-DD')
  if (/昨天|昨晚|昨日/.test(s)) return today.subtract(1, 'day').format('YYYY-MM-DD')
  let m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s)
  if (m) return dayjs(`${m[1]}-${m[2]}-${m[3]}`).format('YYYY-MM-DD')
  m = /(?<![\d.])(\d{1,2})(?:[-/](\d{1,2})(?![\d.])|月(\d{1,2})[日号]?)/.exec(s)
  if (m) {
    let d = dayjs(`${today.year()}-${m[1]}-${m[2] || m[3]}`)
    if (d.isAfter(today.add(1, 'day'))) d = d.subtract(1, 'year')
    return d.format('YYYY-MM-DD')
  }
  return today.format('YYYY-MM-DD')
}

function parseMoney(s) {
  const clean = s.replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}[日号]?/g, ' ').replace(/(?<![\d.])\d{1,2}(?:[-/]\d{1,2}(?![\d.])|月\d{1,2}[日号]?)/g, ' ').replace(/尾号\d+|\(\d{4}\)|（\d{4}）/g, ' ')
  let m = /(\d+(?:\.\d+)?)\s*(万|w|W|千|k|K)?/.exec(clean.replace(/,/g, ''))
  if (m) {
    const unit = { 万: 1e4, w: 1e4, W: 1e4, 千: 1e3, k: 1e3, K: 1e3 }[m[2]] || 1
    let v = Number(m[1]) * unit
    const tail = /块(\d)/.exec(clean.slice(m.index))
    if (tail && unit === 1) v += Number(tail[1]) / 10
    return round2(v)
  }
  m = /([一二两三四五六七八九十])\s*(万|千|百)/.exec(clean)
  if (m) return CN_NUM[m[1]] * { 万: 1e4, 千: 1e3, 百: 100 }[m[2]]
  return null
}

export async function ruleParse(text) {
  const lines = String(text).split(/[\n；;]+/).map((x) => x.trim()).filter(Boolean)
  const items = []
  for (const line of lines) {
    const amount = parseMoney(line)
    if (!amount) continue
    const direction = /收到|到账|入账|工资|收入|退款|报销款|回款|分红|利息收入|转给我|还我/.test(line) ? 'IN' : 'OUT'
    const acc = await matchAccount(line)
    const desc = line.replace(/\d{1,4}[-/年月]\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]?/g, ' ').replace(/\d+(\.\d+)?\s*(万|w|千|k|块|元)?/gi, ' ').replace(/今天|昨天|昨晚|前天|用|通过|付的|付款|支付/g, ' ').replace(/\s+/g, ' ').trim()
    items.push({
      type: 'transaction', date: parseDate(line), direction, amount,
      account: acc?.name || null, categoryCode: null, counterparty: null, description: desc || line,
      isBusiness: /公司|报销|垫付|代付/.test(line), confidence: 0.5, note: '规则解析，请核对'
    })
  }
  return items
}

// ─────────── 把名字对上 id，并套用学到的规则 ───────────
const norm = (s) => String(s || '').toLowerCase().replace(/\s/g, '')
function fuzzyFind(list, name, keys) {
  if (!name) return null
  const n = norm(name)
  return list.find((x) => keys.some((k) => norm(x[k]) === n)) ||
         list.find((x) => keys.some((k) => x[k] && (norm(x[k]).includes(n) || n.includes(norm(x[k])))))
}

export async function resolveItems(items, ctx) {
  ctx ||= await buildContext()
  const out = []
  for (const raw of items || []) {
    const it = { ...raw, type: ITEM_TYPES[raw.type] ? raw.type : 'transaction' }
    it.date = it.date && dayjs(it.date).isValid() ? dayjs(it.date).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD')
    if (it.amount != null) it.amount = round2(Math.abs(Number(it.amount)))

    if (it.account) {
      const a = fuzzyFind(ctx.accounts, it.account, ['name', 'lastNo']) || (await matchAccount(it.account))
      it.accountId = a ? String(a.id) : null
    }
    if (it.toAccount) {
      const a = fuzzyFind(ctx.accounts, it.toAccount, ['name', 'lastNo']) || (await matchAccount(it.toAccount))
      it.toAccountId = a ? String(a.id) : null
    }
    if (it.type === 'transaction') {
      it.direction = it.direction === 'IN' ? 'IN' : 'OUT'
      const rule = await classify({ counterparty: it.counterparty, description: it.description, direction: it.direction })
      if (rule.by === 'rule') {
        // 你纠正过的规则优先于模型判断
        it.categoryCode = rule.categoryCode
        it.isBusiness = rule.isBusiness
        it.matchedRule = rule.pattern
      } else if (!it.categoryCode && rule.categoryCode) {
        it.categoryCode = rule.categoryCode
        it.isBusiness = it.isBusiness || rule.isBusiness
      }
      const c = ctx.categories.find((x) => x.code === it.categoryCode)
      it.categoryId = c ? String(c.id) : null
      it.aiCategoryCode = it.categoryCode || null
    }
    if (it.holding) {
      const h = fuzzyFind(ctx.holdings, it.holding, ['name', 'code'])
      it.holdingId = h ? String(h.id) : null
    }
    if (it.asset) {
      const a = fuzzyFind(ctx.assets, it.asset, ['name'])
      it.assetId = a ? String(a.id) : null
    }
    if (it.loan) {
      const l = fuzzyFind(ctx.loans, it.loan, ['counterparty'])
      it.loanId = l ? String(l.id) : null
    }
    it.warnings = warningsOf(it)
    out.push(it)
  }
  return out
}

function warningsOf(it) {
  const w = []
  if (['transaction', 'transfer', 'trade', 'balance', 'asset_valuation', 'new_loan', 'new_holding'].includes(it.type) && !it.amount && it.type !== 'trade') w.push('缺金额')
  if (it.type === 'transaction' && !it.categoryId) w.push('未识别科目')
  if (it.type === 'transaction' && !it.accountId) w.push('未指定账户（入账后不影响任何余额）')
  if (it.type === 'transfer' && (!it.accountId || !it.toAccountId)) w.push('转账需要两个账户')
  if (it.type === 'trade' && !it.holdingId) w.push('没找到这个持仓，可改成「新增持仓」')
  if (it.type === 'holding_valuation' && !it.holdingId) w.push('没找到持仓')
  if (it.type === 'asset_valuation' && !it.assetId) w.push('没找到资产')
  if (it.type === 'balance' && !it.accountId) w.push('没找到账户')
  if (it.type === 'loan_repay' && !it.loanId) w.push('没找到借贷记录')
  return w
}

// ─────────── 对外：解析 ───────────
export async function parseEntry({ text = '', images = [] }) {
  const ctx = await buildContext()
  const status = aiStatus()
  const t0 = Date.now()
  let items = []
  let provider = 'rule'
  let error = null
  if (status.enabled && (text.trim() || images.length)) {
    try {
      const r = await llmJSON({
        system: systemPrompt(ctx),
        prompt: text.trim() ? `请解析：\n${text}` : '请解析截图里的所有交易。',
        images
      })
      items = Array.isArray(r.data) ? r.data : r.data.items || []
      provider = r.provider
    } catch (e) {
      error = e.message
    }
  }
  if (!items.length && text.trim()) {
    items = await ruleParse(text)
    provider = error ? `rule（AI 失败：${error}）` : 'rule'
  }
  const resolved = await resolveItems(items, ctx)
  const log = await prisma.aiEntryLog.create({
    data: { userId: resolveUid(), input: text.slice(0, 60000), hasImage: images.length > 0, provider, output: resolved, error, ms: Date.now() - t0 }
  })
  return { logId: String(log.id), provider, error, ms: Date.now() - t0, items: resolved }
}

// ─────────── 对外：确认入账 ───────────
export async function commitItems(items, { logId } = {}) {
  const results = []
  for (const it of items) {
    try {
      results.push({ ok: true, type: it.type, ref: await commitOne(it) })
    } catch (e) {
      results.push({ ok: false, type: it.type, error: e.message, item: it })
    }
  }
  if (logId) await prisma.aiEntryLog.update({ where: { id: BigInt(logId) }, data: { committed: results } }).catch(() => {})
  return results
}

async function commitOne(it) {
  const src = { source: 'AI' }
  switch (it.type) {
    case 'transaction': {
      const row = await createTransaction({
        txnDate: it.date, direction: it.direction, amount: it.amount, accountId: it.accountId, categoryId: it.categoryId,
        counterparty: it.counterparty, description: it.description, isBusiness: it.isBusiness, businessOrg: it.businessOrg,
        channel: it.channel, remark: it.note && it.confidence < 0.7 ? `AI：${it.note}` : null
      }, src)
      // 学习：有对方名、且你改过模型给的科目（或勾了「记住」）→ 以后同一对方自动套用
      if (it.counterparty && it.categoryId && (it.learn || (it.aiCategoryCode && it.aiCategoryCode !== it.categoryCode))) {
        await learnRule(it.counterparty, it.categoryId, it.isBusiness)
      }
      return row.code
    }
    case 'transfer': {
      const [a] = await createTransfer({ fromAccountId: it.accountId, toAccountId: it.toAccountId, amount: it.amount, txnDate: it.date, description: it.description }, src)
      return a.code
    }
    case 'trade':
      await holdingTrade({ holdingId: it.holdingId, tradeDate: it.date, action: it.action, quantity: it.quantity, price: it.price, amount: it.amount, fee: it.fee, cashAccountId: it.accountId }, src)
      return `${it.action} ${it.holding}`
    case 'holding_valuation':
      await holdingTrade({ holdingId: it.holdingId, tradeDate: it.date, action: 'VALUATION', price: it.price, amount: it.amount }, src)
      return `估值 ${it.holding}`
    case 'asset_valuation':
      await assetValuation({ assetId: it.assetId, value: it.amount, valDate: it.date, note: it.description }, src)
      return `估值 ${it.asset}`
    case 'balance':
      await calibrateBalance(it.accountId, it.amount, it.date)
      return `校准 ${it.account}`
    case 'loan_repay':
      await loanRepay({ loanId: it.loanId, repayDate: it.date, principalPart: it.principal, interestPart: it.interest, accountId: it.accountId }, src)
      return `还款 ${it.loan}`
    case 'new_loan': {
      const l = await prisma.loan.create({
        data: {
          userId: resolveUid(),
          direction: it.direction === 'BORROW' ? 'BORROW' : 'LEND', kind: it.kind || 'PERSONAL', counterparty: it.counterparty || '未命名',
          principal: it.amount, balance: it.amount, startDate: toDate(it.date), remark: it.description || null
        }
      })
      return `借贷 #${l.id}`
    }
    case 'new_holding': {
      const userId = resolveUid()
      const h = await prisma.holding.create({
        data: { userId, type: it.holdingType || 'OTHER', name: it.holding, code: it.code || null, platform: it.platform || null, status: 'HOLDING' }
      })
      if (it.amount || (it.quantity && it.price)) {
        await holdingTrade({ userId, holdingId: h.id, tradeDate: it.date, action: 'BUY', quantity: it.quantity, price: it.price, amount: it.amount, cashAccountId: it.accountId }, src)
      }
      return `持仓 ${h.name}`
    }
    default:
      throw new Error(`不支持的类型：${it.type}`)
  }
}

// ─────────── 导入时批量 AI 分类（规则没命中的）───────────
export async function aiClassifyRows(rows) {
  const ctx = await buildContext()
  const list = rows.slice(0, 120).map((r, i) => ({ i, d: r.direction, a: r.amount, cp: r.counterparty, desc: r.description }))
  const r = await llmJSON({
    system: `${systemPrompt(ctx)}\n\n现在的任务不同：给一批已有流水归类。只输出 JSON：{"result":[{"i":序号,"categoryCode":"代码","isBusiness":true/false,"businessOrg":null}]}`,
    prompt: JSON.stringify(list)
  })
  return r.data.result || []
}
