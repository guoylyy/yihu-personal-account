// AI 助手的两个前端判断：这句话是提问还是记账、这张草稿还缺什么
const has = (v) => v !== undefined && v !== null && v !== ''
const pos = (v) => has(v) && Number(v) > 0
const set = (k) => (it) => has(it[k])
const amount = (it) => pos(it.amount)

// 卡片上要随用户修改实时变，所以在前端判；后端 aiEntry.missingOf 只管硬性缺项，这里多了账户、科目两个「不挡提交但该问」的
const NEED = {
  transaction: [[amount, '金额'], [set('accountId'), '账户'], [set('categoryId'), '科目']],
  transfer: [[amount, '金额'], [set('accountId'), '转出账户'], [set('toAccountId'), '转入账户']],
  trade: [[set('holdingId'), '持仓'], [set('action'), '买卖方向'], [(it) => amount(it) || (pos(it.quantity) && pos(it.price)), '金额']],
  holding_valuation: [[set('holdingId'), '持仓'], [(it) => has(it.amount) || has(it.price), '金额']],
  asset_valuation: [[set('assetId'), '资产'], [set('amount'), '金额']],
  balance: [[set('accountId'), '账户'], [set('amount'), '金额']],
  loan_repay: [[set('loanId'), '借贷'], [(it) => pos(it.principal) || pos(it.interest), '本金或利息']],
  new_loan: [[set('counterparty'), '对方'], [amount, '金额']],
  new_holding: [[set('holding'), '持仓名称']]
}

/** 还缺的字段（中文），按该问的先后排 */
export const lackOf = (it) => (NEED[it.type] || []).filter(([ok]) => !ok(it)).map(([, label]) => label)

// 一次只问一个
export const LACK_ASK = {
  金额: '金额是多少？', 账户: '这笔从哪个账户出的？', 科目: '这笔算什么科目？', 转出账户: '从哪个账户转出？', 转入账户: '转到哪个账户？',
  持仓: '是哪个持仓？', 买卖方向: '是买入还是卖出？', 资产: '是哪项资产？', 借贷: '是哪笔借贷？', 本金或利息: '本金和利息各多少？', 对方: '对方是谁？', 持仓名称: '持仓叫什么？'
}

const DATE_NUM = /\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}[日号]?)?|\d{1,2}月(?:\d{1,2}[日号]?)?|\d+\s*(?:个月|年|季度|周|天)/g
const EDIT_VERB = /改成|改为|换成|调成|记成|算成|归到|归为|改到/
const ASK_WORD = /多少|几个?月|几笔|几次|哪些|哪项|哪个|哪里|花哪|什么|怎么|如何|够不够|够用|占比|对比|趋势|分析|总结|汇总|有没有/

/**
 * 明显是提问的直接走问答，省掉一次解析（10~20 秒）。判错也不丢东西：
 * 提问漏判走解析，解析不出草稿会再转问答；记账误判成提问顶多多答一句，不产生草稿
 */
export function looksLikeQuestion(s) {
  const t = s.trim()
  if (!t || t.includes('\n') || EDIT_VERB.test(t)) return false // 多行是一次多笔
  if (/[?？吗呢]$/.test(t)) return true
  if (/\d/.test(t.replace(DATE_NUM, ''))) return false // 带金额的是记账
  return ASK_WORD.test(t)
}
