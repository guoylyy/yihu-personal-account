// AI_PROVIDER=stub：不发任何外部请求。输入输出和真实模型一样（system + prompt 进，JSON 出），
// 账户、科目、@ 引用都从提示词里读，所以提示词漏了什么，stub 也看不到；之后的 applyRefs / resolveItems 走真实路径
import dayjs from 'dayjs'
import { parseDate, parseMoney, isEditLine, parseEditLine, textLines } from './aiIntent.js'

// 测试用：模拟模型不听话（编 id、不反问）。传 null 恢复
let override = null
export const setStubReply = (fn) => { override = fn }

function section(system, title) {
  const m = new RegExp(`## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`).exec(system)
  return m ? m[1].split('\n').map((x) => x.trim()).filter((x) => x.startsWith('- ')) : []
}

function readPrompt(system) {
  const accounts = section(system, '用户的账户').map((l) => /^- (.+?)（(\w+)/.exec(l)).filter(Boolean).map((m) => ({ name: m[1], type: m[2] }))
  const categories = section(system, '收支科目').map((l) => /^- (\S+) (.+?) \[.*?(?:（如 (.+)）)?$/.exec(l)).filter(Boolean).map((m) => ({ code: m[1], name: m[2], keywords: m[3] || '' }))
  const names = (t) => section(system, t).map((l) => /^- (.+?)(?:\(|（| \[|$)/.exec(l)?.[1]).filter(Boolean)
  const pins = [...system.matchAll(/^- \[(\w+)#(\d+)\] (.*)$/gm)].map((m) => ({ type: m[1], id: m[2], summary: m[3] }))
  return { accounts, categories, holdings: names('投资持仓'), assets: names('固定资产'), loans: names('借贷'), pins }
}

const named = (line, list) => list.filter((n) => line.includes(n)).sort((a, b) => b.length - a.length)[0] || null

// 基础资料：只认测试和联调用的说法，真实模型靠提示词。没命中返回 null，走记账那条路
function masterLine(line, p, { base, amount, account }) {
  const newAsset = /(?:新增|新建|添加|登记)(?:一[套辆台个])?(固定资产|资产|房产|车辆)\s*(\S+)/.exec(line)
  if (newAsset) return { ...base, type: 'new_asset', assetName: newAsset[2], assetType: newAsset[1] === '房产' ? 'PROPERTY' : newAsset[1] === '车辆' ? 'VEHICLE' : 'OTHER', amount, date: null }
  const newAccount = /(?:新增|新建|开)(?:一个)?账户\s*(\S+)/.exec(line)
  if (newAccount) return { ...base, type: 'new_account', accountName: newAccount[1], accountType: /信用卡/.test(line) ? 'CREDIT' : 'BANK', amount }
  if (/预算/.test(line)) {
    const c = p.categories.find((x) => line.includes(x.name))
    return { ...base, type: 'set_budget', categoryCode: c?.code || null, date: null, year: null, [/年度|全年/.test(line) ? 'annual' : 'monthly']: amount }
  }
  const loanPins = p.pins.filter((x) => x.type === 'loan')
  if (/月供|年?利率/.test(line) && (named(line, p.loans) || loanPins.length)) {
    const rate = /年?利率\s*(\d+(?:\.\d+)?)/.exec(line)
    const pay = /月供\s*(\d+(?:\.\d+)?)/.exec(line)
    return { ...base, type: 'update_loan', loan: named(line, p.loans), date: null, monthlyPayment: pay ? Number(pay[1]) : null, annualRate: rate ? Number(rate[1]) : null }
  }
  const bill = /账单日\s*(\d+)/.exec(line)
  const repay = /还款日\s*(\d+)/.exec(line)
  if (bill || repay) return { ...base, type: 'update_account', account, date: null, billDay: bill ? Number(bill[1]) : null, repayDay: repay ? Number(repay[1]) : null }
  if (/停用/.test(line)) return { ...base, type: 'update_account', account, date: null, status: 'CLOSED' }
  if (/已?卖掉|已卖出/.test(line)) return { ...base, type: 'update_asset', asset: named(line, p.assets), date: null, status: 'SOLD' }
  const rename = /改名(?:成|为)?\s*(\S+)/.exec(line)
  if (rename) {
    const holding = named(line, p.holdings)
    if (holding || p.pins.some((x) => x.type === 'holding')) return { ...base, type: 'update_holding', holding, date: null, newName: rename[1] }
    return { ...base, type: 'update_account', account, date: null, newName: rename[1] }
  }
  return null
}

function parseLine(line, p) {
  const date = parseDate(line)
  const amount = parseMoney(line)
  const account = p.accounts.find((a) => line.includes(a.name))?.name || null
  const accountsSaid = p.accounts.filter((a) => line.includes(a.name)).map((a) => a.name)
  const base = { date, confidence: 0.9 }
  const master = masterLine(line, p, { base, amount, account })
  if (master) return master
  const editPin = p.pins.filter((x) => x.type === 'transaction')

  if (isEditLine(line)) {
    const it = { ...parseEditLine(line, p.categories), ...base, date: null }
    if (it.targetCode) return it
    if (editPin.length === 1) return { ...it, targetId: editPin[0].id }
    return { ask: editPin.length ? `你 @ 了 ${editPin.length} 笔流水，这句说的是哪一笔？` : '你说的是哪一笔？' }
  }
  const holding = named(line, p.holdings)
  const trade = /买入|卖出|赎回|分红/.exec(line)?.[0]
  if (trade) {
    const qty = /(\d+(?:\.\d+)?)\s*[股份]/.exec(line)
    const price = /(?:价格|单价|@)\s*(\d+(?:\.\d+)?)/.exec(line)
    return { ...base, type: 'trade', holding: holding || line.replace(/.*(?:买入|卖出|赎回|分红)\s*/, '').split(/\s/)[0], action: { 买入: 'BUY', 卖出: 'SELL', 赎回: 'SELL', 分红: 'DIVIDEND' }[trade],
      quantity: qty ? Number(qty[1]) : null, price: price ? Number(price[1]) : null, amount: qty && price ? null : amount, fee: Number(/手续费\s*(\d+(?:\.\d+)?)/.exec(line)?.[1] || 0), account }
  }
  if (/估值|市值/.test(line)) {
    const asset = named(line, p.assets)
    if (asset) return { ...base, type: 'asset_valuation', asset, amount, description: null }
    if (holding) return { ...base, type: 'holding_valuation', holding, amount }
    if (p.pins.some((x) => x.type === 'asset')) return { ...base, type: 'asset_valuation', amount, description: null }
    if (p.pins.some((x) => x.type === 'holding')) return { ...base, type: 'holding_valuation', amount }
  }
  if (/余额/.test(line)) return { ...base, type: 'balance', account, amount }
  const loan = named(line, p.loans)
  if (loan && /还|回款/.test(line)) return { ...base, type: 'loan_repay', loan, principal: amount, interest: null, account }
  if (/还了|还款|回款/.test(line) && p.pins.some((x) => x.type === 'loan')) return { ...base, type: 'loan_repay', principal: amount, interest: null, account }
  if (/还.*(信用卡|花呗)|转账|转到|转入|转给自己/.test(line)) {
    const card = p.accounts.find((a) => a.type === 'CREDIT' && line.includes(a.name))?.name
    const from = /从(.+?)(?:扣|转|付|$)/.exec(line)?.[1]
    return { ...base, type: 'transfer', amount, account: from ? p.accounts.find((a) => from.includes(a.name))?.name || null : accountsSaid.find((n) => n !== card) || null, toAccount: card || null, description: null }
  }
  const direction = /收到|到账|工资|收入|退款|回款/.test(line) ? 'IN' : 'OUT'
  return { ...base, type: 'transaction', direction, amount, account, categoryCode: null, counterparty: null, description: line, isBusiness: /公司|报销|垫付/.test(line) ? true : null }
}

export async function stubLLM({ system = '', prompt = '', images = [] }) {
  if (override) return override({ system, prompt, images })
  // 只读问答：不进草稿流程
  if (!/个人记账助手/.test(system)) return { answer: '（stub 模式没有接模型）', items: [] }
  const p = readPrompt(system)
  if (images.length) {
    return { items: images.flatMap((_, i) => [{ type: 'transaction', date: dayjs().format('YYYY-MM-DD'), direction: 'OUT', amount: 12 + i, counterparty: `截图商户${i + 1}`, description: '截图识别', confidence: 0.8 }]) }
  }
  const text = prompt.replace(/^请解析：\n/, '')
  const items = []
  const asks = []
  for (const line of textLines(text)) {
    const r = parseLine(line, p)
    if (r.ask) asks.push(r.ask)
    else items.push(r)
  }
  return { items, question: asks[0] || null }
}
