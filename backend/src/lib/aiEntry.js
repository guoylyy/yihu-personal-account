// AI 辅助录入：一句话 / 多行文字 / 截图 → 结构化草稿 → 你确认后入账
// 流程：parse（AI 或规则）→ resolve（名字对到账户/科目/持仓 id，套用学到的规则）→ 前端可改 → commit
import dayjs from 'dayjs'
import prisma from './prisma.js'
import { llmJSON, aiStatus } from './llm.js'
import { classify, matchAccount, learnRule } from './classify.js'
import { createTransaction, createTransfer, updateTransaction, holdingTrade, assetValuation, loanRepay, calibrateBalance, assertOwnRefs } from './ledger.js'
import { round2 } from './money.js'
import { toDate } from './period.js'
import { resolveUid } from './tenant.js'
import { parseDate, parseMoney, isEditLine, parseEditLine, textLines } from './aiIntent.js'
import { applyRefs, contextPrompt } from './aiContext.js'
import { UPDATE_TYPES, MASTER_TYPES, ASSET_KINDS, ACCOUNT_KINDS, commitMaster } from './aiMaster.js'

export const ITEM_TYPES = {
  transaction: '收支',
  transfer: '账户互转',
  trade: '投资交易',
  holding_valuation: '持仓估值',
  asset_valuation: '资产估值',
  balance: '余额校准',
  loan_repay: '借贷还款',
  new_loan: '新增借贷',
  new_holding: '新增持仓',
  update_transaction: '修改流水',
  ...MASTER_TYPES
}

// 这两种的金额是余额，可以为负（信用卡欠款）
export const SIGNED_AMOUNT = new Set(['balance', 'new_account'])
// 没说日期就是没有，不用今天顶替
const NO_DEFAULT_DATE = new Set(['update_transaction', 'new_asset', 'set_budget', ...Object.keys(UPDATE_TYPES)])

// ─────────── 上下文：告诉模型你有哪些账户、科目、持仓 ───────────
async function buildContext() {
  const userId = resolveUid()
  const [accounts, categories, holdings, assets, loans, budgets] = await Promise.all([
    prisma.account.findMany({ where: { userId, deletedAt: null, status: 'ACTIVE' }, orderBy: { sort: 'asc' } }),
    prisma.category.findMany({ where: { userId, deletedAt: null }, orderBy: { sort: 'asc' } }),
    prisma.holding.findMany({ where: { userId, deletedAt: null, status: 'HOLDING' } }),
    prisma.fixedAsset.findMany({ where: { userId, deletedAt: null } }),
    prisma.loan.findMany({ where: { userId, deletedAt: null, status: { not: 'SETTLED' } } }),
    prisma.budget.findMany({ where: { userId, year: dayjs().year() } })
  ])
  return { accounts, categories, holdings, assets, loans, budgets }
}

function systemPrompt(ctx, refs) {
  const today = dayjs().format('YYYY-MM-DD dddd')
  return `你是一个个人记账助手，把用户输入的自然语言或账单截图，解析成可入账的结构化条目，也负责新增和修改账户、持仓、资产、借贷、预算这些资料。今天是 ${today}（Asia/Shanghai）。

## 用户的账户（account / toAccount 字段填这里的「名称」）
${ctx.accounts.map((a) => `- ${a.name}（${a.type}${a.lastNo ? ' 尾号' + a.lastNo : ''}${a.aliases ? '，别名：' + a.aliases : ''}）`).join('\n')}

## 收支科目（categoryCode 填代码）
${ctx.categories.map((c) => `- ${c.code} ${c.name} [${c.kind}${c.groupName ? '/' + c.groupName : ''}]${c.remark ? '：' + c.remark : ''}${c.keywords ? `（如 ${c.keywords.slice(0, 40)}）` : ''}`).join('\n')}

## 投资持仓（holding 字段填名称）
${ctx.holdings.map((h) => `- ${h.name}${h.code ? '(' + h.code + ')' : ''} [${h.type}]`).join('\n') || '（暂无）'}

## 固定资产（asset 字段填名称）
${ctx.assets.map((a) => `- ${a.name} [${a.type}] 估值 ${a.currentValue}`).join('\n') || '（暂无）'}

## 借贷（loan 字段填对方名称）
${ctx.loans.map((l) => `- ${l.counterparty}（${l.direction === 'LEND' ? '我借出' : '我借入'}，${l.kind}，未还 ${l.balance}${l.monthlyPayment != null ? `，月供 ${l.monthlyPayment}` : ''}${l.annualRate != null ? `，年利率 ${l.annualRate}%` : ''}）`).join('\n') || '（暂无）'}

## 记账口径
- 只记实际发生的钱。夫妻/家庭内部划转用 T4。还信用卡、转余额宝等自己账户之间的钱用 transfer 类型。
- 公司的钱（替公司付的云服务、员工报销、合伙人款、办公室房租等）isBusiness=true，categoryCode 用最贴近的科目或 C，businessOrg 写公司名（示例科技/示例教育/示例云/示例联合/示例贸易 等）。
- 日期：「今天/昨天/前天/上周五/9月3号」换算成 YYYY-MM-DD；没说日期就用今天。
- 金额：「3千」=3000，「1.2万」=12000，「128块5」=128.5。
- 一段话里有几笔就拆成几条；截图里每一笔交易都是一条。看不清/不确定的字段留 null，并在 note 里说明。
- 用户没说的字段不要编：isBusiness 没提就留 null；金额没说就留 null。
- 「把这笔改成餐饮」是改已有流水，用 update_transaction，不要新建收支。「这笔还信用卡」指把这笔流水改成信用卡还款（categoryCode 用 T2）。
- 登记房产、车辆、大件用 new_asset，不要记成支出。它只登记资产，不动账户余额；用户说了从哪个账户付的，在 note 里写「账户余额没有扣，需要的话再记一笔」。
- 「这套房现在值 300 万」是已有资产的估值，用 asset_valuation，不是 update_asset。账户余额不对用 balance，持仓市值用 holding_valuation，还款用 loan_repay；update_* 不能改余额、市值和未还本金。
- 年利率一律填百分数：3.85% 填 3.85，不要填 0.0385。
- 借贷的月供、利率这些资料，已有记录用 update_loan，新的用 new_loan。new_loan 同样不动账户余额，用户说了账户时在 note 里提醒。

## 你能做什么、怎么说话
你能记收支、转账、买卖、还款、资产估值、余额校准，能新增账户、持仓、资产、借贷，能修改已有的流水、账户、持仓、资产、借贷，能设预算。在哪个页面都能做，当前页面只是上下文。一段话说了几件事就出几条。不确定就问，不要猜。
删除或作废记录你做不了：items 留空，在 question 里说请到对应页面操作。
- 金额能确定的先出草稿，缺的字段留 null，用户可以在草稿上补。
- question 只写一句，只问最关键的一个字段，比如「这笔从哪个账户出的？」；不要一次列多个待填项，不要复述草稿内容。
- note 一句话以内，只写不确定之处，没有就留空。
- 用户是在提问而不是记账（如「这个月花了多少」「预算超了吗」）：items 留空，question 留 null，不要编草稿，系统会转去问答。
- 句末的「（补充：xxx）」是用户对你上一句反问的回答，并进同一笔，不要另起一条；补充的内容明显是另一笔新账时才拆成两条。

## 判断「这笔/这个/它」指什么，优先级从高到低
1. 用户明确说的（账户名、流水编号、对方名）
2. 用户 @ 引用的记录
3. 当前页面的筛选条件
4. 都不确定就问：不要猜，items 留空，在 question 里问一句
没有 @ 引用、用户也没写流水编号时，「这笔」指哪一条是不确定的，必须问。@ 了多条又分不清指哪条时也要问。
update_account / update_holding / update_asset / update_loan 用名称字段点名要改哪一条，指的是 @ 的那条时名称字段留空。
${contextPrompt(refs)}
## 输出
只输出一个 JSON 对象，不要任何解释：
{"items":[{ "type": "...", ... , "confidence": 0~1, "note": "不确定之处（可空）" }],"question":"需要反问用户时写在这里，否则 null"}

各 type 的字段：
- transaction：date, direction("IN"|"OUT"), amount, account, categoryCode, counterparty, description, isBusiness, businessOrg
- transfer：date, amount, account(转出), toAccount(转入), description
- trade：date, holding, action("BUY"|"SELL"|"DIVIDEND"), quantity, price, amount, fee, account(资金账户，可空)
- holding_valuation：date, holding, price 或 amount(新市值)
- asset_valuation：date, asset, amount(新估值), description
- balance：date, account, amount(该账户当前真实余额)
- loan_repay：date, loan, principal, interest, account
- new_loan：date, direction("LEND"|"BORROW"), counterparty, amount, kind("PERSONAL"|"COMPANY"|"MORTGAGE"|"CAR"|"CONSUMER"|"OTHER"), monthlyPayment, annualRate, dueDate, description
- new_holding：date, holding(名称), holdingType("STOCK"|"FUND"|"WEALTH"|"DEPOSIT"|"INSURANCE"|"EQUITY"|"OTHER"), code, platform, quantity, price, amount, account
- update_transaction：targetId(@ 引用里的流水 id) 或 targetCode(用户写的流水编号，如 T-202610-00012)，再加要改的字段，没改的不要填：date, direction, amount, account, categoryCode, counterparty, description, isBusiness, businessOrg
- new_asset：assetName, assetType("PROPERTY"|"VEHICLE"|"OTHER"), amount(现在的估值), purchasePrice, date(买入日期，没说留 null), address, description
- new_account：accountName, accountType("BANK"|"WECHAT"|"ALIPAY"|"CASH"|"CREDIT"), institution, lastNo(尾号), amount(当前余额，信用卡欠款填负数), date, creditLimit, billDay, repayDay
- set_budget：categoryCode, year(没说留 null), monthly(月度额) 或 annual(年度额)。一个科目一条
以下只填要改的字段，没改的不要填：
- update_account：account(要改哪个，现在的名称), newName, institution, lastNo, creditLimit, billDay, repayDay, aliases, status("ACTIVE"|"CLOSED"), remark
- update_holding：holding(要改哪个), newName, code, platform, maturityDate, annualRate, remark
- update_asset：asset(要改哪个), newName, address, purchaseDate, purchasePrice, status("HOLDING"|"SOLD"), remark
- update_loan：loan(要改哪笔，对方名称), counterparty(新的对方名), kind, monthlyPayment, annualRate, dueDate, contractNo, remark`
}

// ─────────── 规则解析（AI 不可用时兜底，只识别收支和「改这笔」）───────────
export async function ruleParse(text, ctx) {
  const items = []
  for (const line of textLines(text)) {
    if (isEditLine(line)) {
      items.push({ ...parseEditLine(line, ctx?.categories || []), confidence: 0.5, note: '规则解析，请核对' })
      continue
    }
    const amount = parseMoney(line)
    if (!amount) continue
    const direction = /收到|到账|入账|工资|收入|退款|报销款|回款|分红|利息收入|转给我|还我/.test(line) ? 'IN' : 'OUT'
    const acc = await matchAccount(line)
    const desc = line.replace(/\d{1,4}[-/年月]\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]?/g, ' ').replace(/\d+(\.\d+)?\s*(万|w|千|k|块|元)?/gi, ' ').replace(/今天|昨天|昨晚|前天|用|通过|付的|付款|支付/g, ' ').replace(/\s+/g, ' ').trim()
    items.push({
      type: 'transaction', date: parseDate(line), direction, amount,
      account: acc?.name || null, categoryCode: null, counterparty: null, description: desc || line,
      isBusiness: /公司|报销|垫付|代付/.test(line) ? true : null, confidence: 0.5, note: '规则解析，请核对'
    })
  }
  return items
}

// ─────────── 把名字对上 id，并套用学到的规则 ───────────
const norm = (s) => String(s || '').toLowerCase().replace(/\s/g, '')
// 要改已有记录时不能猜：同名命中多条算没找到，让用户说清楚
function uniqueFind(list, name, keys) {
  const n = norm(name)
  const exact = list.filter((x) => keys.some((k) => norm(x[k]) === n))
  if (exact.length) return exact.length === 1 ? exact[0] : null
  const near = list.filter((x) => keys.some((k) => x[k] && (norm(x[k]).includes(n) || n.includes(norm(x[k])))))
  return near.length === 1 ? near[0] : null
}

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
    const edit = it.type === 'update_transaction'
    if (it.date && dayjs(it.date).isValid()) it.date = dayjs(it.date).format('YYYY-MM-DD')
    else it.date = NO_DEFAULT_DATE.has(it.type) ? null : dayjs().format('YYYY-MM-DD') // 改流水没提日期 = 不改日期
    if (it.amount != null) it.amount = round2(SIGNED_AMOUNT.has(it.type) ? Number(it.amount) : Math.abs(Number(it.amount)))

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
      it.categoryId = c ? String(c.id) : it.categoryId || null // 只带 id 没带代码时保留（归属在入账时校验）
      it.aiCategoryCode = it.categoryCode || null
    }
    if ((edit || it.type === 'set_budget') && it.categoryCode) {
      const c = ctx.categories.find((x) => x.code === it.categoryCode)
      it.categoryId = c ? String(c.id) : null
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
    const master = UPDATE_TYPES[it.type]
    if (master) {
      const hit = it[master.nameKey] ? uniqueFind(ctx[master.ctx], it[master.nameKey], master.keys) : null
      if (hit) { it.targetId = String(hit.id); it.targetSummary = master.title(hit) }
      it[master.idKey] = it.targetId || null
    }
    it.warnings = [...warningsOf(it), ...masterWarnings(it, ctx)]
    it.missing = missingOf(it)
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
  if (it.type === 'update_transaction' && it.categoryWord && !it.categoryId) w.push(`没有叫「${it.categoryWord}」的科目`)
  if (it.type === 'update_transaction' && it.targetLinked) w.push('这是互转或持仓/借贷带出的流水，这里只改这一条，另一边不动')
  return w
}

const CHANGE_FIELDS = ['date', 'direction', 'amount', 'accountId', 'categoryId', 'counterparty', 'description', 'isBusiness', 'businessOrg']
function masterWarnings(it, ctx) {
  const w = []
  const named = (list, name) => list.some((x) => norm(x.name) === norm(name))
  if (it.type === 'new_account' && named(ctx.accounts, it.accountName)) w.push(`已经有账户「${it.accountName}」，确认要再建一个`)
  if (it.type === 'new_asset' && named(ctx.assets, it.assetName)) w.push(`已经有资产「${it.assetName}」，要更新估值请用资产估值`)
  if (it.type === 'update_account' && it.status === 'CLOSED') {
    const a = ctx.accounts.find((x) => String(x.id) === String(it.targetId))
    if (a && Number(a.balance)) w.push(`这个账户还有余额 ${a.balance}，停用后不再计入资产`)
  }
  if (it.annualRate != null && Number(it.annualRate) > 0 && Number(it.annualRate) < 0.5) w.push('年利率按百分数填，3.85% 写 3.85')
  if (it.type === 'set_budget' && it.categoryId) {
    const c = ctx.categories.find((x) => String(x.id) === String(it.categoryId))
    if (c && c.kind !== 'EXPENSE') w.push('预算只能设在支出科目上')
    const b = ctx.budgets.find((x) => String(x.categoryId) === String(it.categoryId) && x.year === (Number(it.year) || dayjs().year()))
    if (b) w.push(`现在的月预算是 ${b.monthlyAmount}，确认后覆盖`)
  }
  return w
}

const has = (v) => v !== undefined && v !== null && v !== ''
const positive = (v) => has(v) && Number(v) > 0

/** 没有就入不了账的字段（warnings 里其余的提示不挡提交）。值是字段名，MISSING_LABELS 是中文 */
export function missingOf(it) {
  const m = []
  const need = (ok, key) => { if (!ok) m.push(key) }
  switch (it.type) {
    case 'transaction': need(positive(it.amount), 'amount'); break
    case 'transfer': need(positive(it.amount), 'amount'); need(it.accountId, 'accountId'); need(it.toAccountId, 'toAccountId'); break
    case 'trade':
      need(it.holdingId, 'holdingId'); need(['BUY', 'SELL', 'DIVIDEND'].includes(it.action), 'action')
      need(positive(it.amount) || (it.action !== 'DIVIDEND' && positive(it.quantity) && positive(it.price)), 'amount')
      break
    case 'holding_valuation': need(it.holdingId, 'holdingId'); need(has(it.amount) || has(it.price), 'amount'); break
    case 'asset_valuation': need(it.assetId, 'assetId'); need(has(it.amount), 'amount'); break
    case 'balance': need(it.accountId, 'accountId'); need(has(it.amount), 'amount'); break
    case 'loan_repay': need(it.loanId, 'loanId'); need(positive(it.principal) || positive(it.interest), 'principal'); break
    case 'new_loan': need(has(it.counterparty), 'counterparty'); need(positive(it.amount), 'amount'); break
    case 'new_holding': need(has(it.holding), 'holding'); break
    case 'update_transaction': need(it.targetId, 'targetId'); need(CHANGE_FIELDS.some((k) => has(it[k])), 'changes'); break
    case 'new_asset': need(has(it.assetName), 'assetName'); need(ASSET_KINDS.includes(it.assetType), 'assetType'); need(has(it.amount) || has(it.purchasePrice), 'amount'); break
    case 'new_account': need(has(it.accountName), 'accountName'); need(ACCOUNT_KINDS.includes(it.accountType), 'accountType'); break
    case 'set_budget': need(it.categoryId, 'categoryId'); need(has(it.monthly) || has(it.annual), 'budgetAmount'); break
  }
  if (UPDATE_TYPES[it.type]) {
    need(it.targetId, 'targetId')
    need(Object.keys(UPDATE_TYPES[it.type].fields).some((k) => has(it[k])), 'changes')
  }
  return m
}

export const MISSING_LABELS = {
  amount: '金额', accountId: '账户', toAccountId: '转入账户', holdingId: '持仓', action: '买卖方向', assetId: '资产', loanId: '借贷记录',
  principal: '本金或利息', counterparty: '对方', holding: '持仓名称', targetId: '要改的记录', changes: '要改的内容',
  assetName: '资产名称', assetType: '资产类型', accountName: '账户名称', accountType: '账户类型', categoryId: '科目', budgetAmount: '预算金额'
}

// ─────────── 对外：解析 ───────────
export async function parseEntry({ text = '', images = [], refs = null }) {
  const ctx = await buildContext()
  const status = aiStatus()
  const t0 = Date.now()
  let items = []
  let question = null
  let provider = 'rule'
  let error = null
  let notice = null
  if (status.enabled && (text.trim() || images.length)) {
    try {
      const r = await llmJSON({
        system: systemPrompt(ctx, refs),
        prompt: text.trim() ? `请解析：\n${text}` : '请解析截图里的所有交易。',
        images
      })
      items = Array.isArray(r.data) ? r.data : r.data.items || []
      question = r.data.question || null
      provider = r.provider
    } catch (e) {
      error = e.message
      notice = e.noVision ? e.message : text.trim() ? 'AI 暂时不可用，已用规则解析' : `AI 暂时不可用（${e.message}），截图没有识别`
    }
  } else if (images.length) {
    notice = 'AI 没开，看不了截图，请改用文字描述'
  }
  if (!items.length && !question && text.trim()) {
    items = await ruleParse(text, ctx)
    provider = error ? `rule（AI 失败：${error}）` : 'rule'
  }
  const applied = await applyRefs(items, refs, text)
  question = question || applied.question
  const all = await resolveItems(applied.items, ctx)
  // 改资料对不上是哪条：不出草稿，免得用户在卡上补不了目标
  const lost = all.filter((it) => UPDATE_TYPES[it.type] && !it.targetId)
  const resolved = all.filter((it) => !lost.includes(it))
  if (lost.length && !question) {
    const it = lost[0]
    const cfg = UPDATE_TYPES[it.type]
    question = `「${it[cfg.nameKey]}」对不上${cfg.label}，可能重名或不存在。写全名，或在列表上点 @ 引用它。`
  }
  const log = await prisma.aiEntryLog.create({
    data: { userId: resolveUid(), input: text.slice(0, 60000), hasImage: images.length > 0, provider: provider.slice(0, 30), output: resolved, error, ms: Date.now() - t0 }
  })
  return { logId: String(log.id), provider, error, notice, ms: Date.now() - t0, items: resolved, question }
}

// ─────────── 对外：确认入账 ───────────
export async function commitItems(items, { logId } = {}) {
  const results = []
  for (const it of items) {
    try {
      results.push({ ok: true, type: it.type, ref: (await commitOne(it)).ref })
    } catch (e) {
      results.push({ ok: false, type: it.type, error: e.message, item: it })
    }
  }
  if (logId) await prisma.aiEntryLog.update({ where: { id: BigInt(logId) }, data: { committed: results } }).catch(() => {})
  return results
}

/** 入账一条，返回 { id, ref }：id 是产生/修改的业务记录，ref 是给人看的编号或摘要 */
export async function commitOne(it) {
  const src = { source: 'AI' }
  if (MASTER_TYPES[it.type]) return commitMaster(it)
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
      return { id: row.id, ref: row.code }
    }
    case 'update_transaction': {
      const row = await updateTransaction(it.targetId, {
        txnDate: it.date ?? undefined, direction: it.direction ?? undefined, amount: it.amount ?? undefined, accountId: it.accountId ?? undefined,
        categoryId: it.categoryId ?? undefined, counterparty: it.counterparty ?? undefined, description: it.description ?? undefined,
        isBusiness: it.isBusiness ?? undefined, businessOrg: it.businessOrg ?? undefined, learn: it.learn
      })
      if (!row) throw new Error('流水不存在或无权访问')
      return { id: row.id, ref: row.code }
    }
    case 'transfer': {
      const [a] = await createTransfer({ fromAccountId: it.accountId, toAccountId: it.toAccountId, amount: it.amount, txnDate: it.date, description: it.description }, src)
      return { id: a.id, ref: a.code }
    }
    case 'trade': {
      const t = await holdingTrade({ holdingId: it.holdingId, tradeDate: it.date, action: it.action, quantity: it.quantity, price: it.price, amount: it.amount, fee: it.fee, cashAccountId: it.accountId }, src)
      return { id: t.id, ref: `${it.action} ${it.holding}` }
    }
    case 'holding_valuation': {
      const t = await holdingTrade({ holdingId: it.holdingId, tradeDate: it.date, action: 'VALUATION', price: it.price, amount: it.amount }, src)
      return { id: t.id, ref: `估值 ${it.holding}` }
    }
    case 'asset_valuation': {
      const v = await assetValuation({ assetId: it.assetId, value: it.amount, valDate: it.date, note: it.description }, src)
      return { id: v.id, ref: `估值 ${it.asset}` }
    }
    case 'balance': {
      const a = await calibrateBalance(it.accountId, it.amount, it.date)
      return { id: a.id, ref: `校准 ${a.name}` }
    }
    case 'loan_repay': {
      const r = await loanRepay({ loanId: it.loanId, repayDate: it.date, principalPart: it.principal, interestPart: it.interest, accountId: it.accountId }, src)
      return { id: r.id, ref: `还款 ${it.loan}` }
    }
    case 'new_loan': {
      const l = await prisma.loan.create({
        data: {
          userId: resolveUid(),
          direction: it.direction === 'BORROW' ? 'BORROW' : 'LEND', kind: it.kind || 'PERSONAL', counterparty: it.counterparty || '未命名',
          principal: it.amount, balance: it.amount, startDate: toDate(it.date), remark: it.description || null,
          monthlyPayment: has(it.monthlyPayment) ? Number(it.monthlyPayment) : null, annualRate: has(it.annualRate) ? Number(it.annualRate) : null, dueDate: toDate(it.dueDate)
        }
      })
      return { id: l.id, ref: `借贷 #${l.id}` }
    }
    case 'new_holding': {
      const userId = resolveUid()
      await assertOwnRefs({ accountIds: [it.accountId] }, userId)
      const h = await prisma.holding.create({
        data: { userId, type: it.holdingType || 'OTHER', name: it.holding, code: it.code || null, platform: it.platform || null, status: 'HOLDING' }
      })
      if (it.amount || (it.quantity && it.price)) {
        await holdingTrade({ userId, holdingId: h.id, tradeDate: it.date, action: 'BUY', quantity: it.quantity, price: it.price, amount: it.amount, cashAccountId: it.accountId }, src)
      }
      return { id: h.id, ref: `持仓 ${h.name}` }
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
