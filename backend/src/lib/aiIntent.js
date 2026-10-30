// 自然语言里的日期、金额和「改已有记录」的意图：规则解析和 stub 共用，不碰数据库
import dayjs from 'dayjs'
import { round2 } from './money.js'

const CN_NUM = { 两: 2, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

export function parseDate(s) {
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

export function parseMoney(s) {
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

export const TXN_CODE = /T-\d{6}-\d{5}/
const DEICTIC = /这笔|这条|这个(?![月季周年])|那笔|那条|它|上一笔|刚才那笔/
const EDIT_VERB = /改成|改为|换成|调成|记成|算成|归到|归为|改到|还信用卡/

/** 这一行说的是「改某条已有记录」，而不是记一笔新的 */
export const isEditLine = (s) => (DEICTIC.test(s) || TXN_CODE.test(s)) && EDIT_VERB.test(s)

export const textLines = (text) => String(text).split(/[\n；;]+/).map((x) => x.trim()).filter(Boolean)

/** 把一个词对到科目：代码 > 名称 > 关键字。「餐饮」不是科目名，是 B1 的关键字 */
export function categoryByWord(word, categories) {
  if (!word) return null
  const w = word.toLowerCase()
  const keys = (c) => (c.keywords || '').split(/[,，]/).map((k) => k.trim().toLowerCase()).filter(Boolean)
  return categories.find((c) => c.code.toLowerCase() === w) ||
    categories.find((c) => c.name === word) ||
    categories.find((c) => c.name.includes(word)) ||
    categories.find((c) => keys(c).includes(w)) ||
    categories.find((c) => keys(c).some((k) => k.includes(w))) || null
}

/** 「把这笔改成餐饮」「金额改成 50」「这笔还信用卡」→ update_transaction 草稿；改哪一笔由 aiContext.applyRefs 决定 */
export function parseEditLine(line, categories) {
  const it = { type: 'update_transaction', targetCode: TXN_CODE.exec(line)?.[0] }
  if (/还信用卡|信用卡还款/.test(line)) return { ...it, categoryCode: categories.find((c) => c.code === 'T2')?.code || 'T2' }
  const word = /(?:改成|改为|换成|调成|记成|算成|归到|归为|改到)\s*([^\s，。,；;]+)/.exec(line)?.[1].replace(/(科目|类别|分类|类)$/, '')
  if (word && /^[\d.]/.test(word)) return { ...it, amount: parseMoney(word) }
  const c = categoryByWord(word, categories)
  return c ? { ...it, categoryCode: c.code } : { ...it, categoryWord: word || null }
}
