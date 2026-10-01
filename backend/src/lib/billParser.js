// 账单文件解析：微信支付账单（xlsx/csv）、支付宝交易明细（csv，GBK）、银行流水、以及本库已归类 CSV
// 思路同集团系统：自动找表头行 → 按同义词映射列 → 统一成标准行
import XLSX from 'xlsx'
import iconv from 'iconv-lite'
import dayjs from 'dayjs'
import { parseAmount } from './money.js'

const COLS = {
  time: ['交易时间', '交易日期', '记账日期', '时间', '日期', '交易创建时间', '付款时间'],
  counterparty: ['交易对方', '对方', '对方户名', '对方名称', '对手方', '收/付款方'],
  goods: ['商品', '商品说明', '商品名称', '摘要', '交易摘要', '用途', '备注说明'],
  io: ['收/支', '收支', '收支类型', '资金方向'],
  amount: ['金额(元)', '金额（元）', '金额', '交易金额'],
  inAmount: ['收入金额', '存入金额', '贷方金额', '收入'],
  outAmount: ['支出金额', '取出金额', '借方金额', '支出'],
  payMethod: ['支付方式', '收/付款方式', '付款方式', '账户'],
  status: ['当前状态', '交易状态', '状态'],
  txnNo: ['交易单号', '交易订单号', '交易流水号', '流水号', '订单号'],
  category: ['科目'],
  txnType: ['交易类型', '交易分类']
}

function decode(buf) {
  const utf8 = buf.toString('utf8')
  // 支付宝导出是 GBK；UTF-8 解码出现大量替换字符说明编码不对
  const bad = (utf8.match(/�/g) || []).length
  return bad > 5 ? iconv.decode(buf, 'gbk') : utf8.replace(/^﻿/, '')
}

function toRows(buf, filename = '') {
  if (/\.(xlsx|xls)$/i.test(filename)) {
    const wb = XLSX.read(buf, { type: 'buffer' })
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
  }
  const text = decode(buf)
  const wb = XLSX.read(text, { type: 'string', raw: true })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
}

function detectChannel(filename, headerText, allText) {
  if (/微信|wechat/i.test(filename) || /微信支付账单/.test(allText)) return '微信'
  if (/支付宝|alipay/i.test(filename) || /支付宝/.test(allText) || headerText.includes('收/付款方式')) return '支付宝'
  return '银行'
}

/**
 * @returns {{ channel, rows: Array<{ txnDate, txnTime, direction, amount, counterparty, description, payMethod, status, externalId, presetCategory, skip, skipReason }> }}
 */
export function parseBill(buf, filename = '') {
  const table = toRows(buf, filename)
  const cell = (v) => String(v ?? '').trim()
  const headerIdx = table.findIndex((r) => {
    const s = r.map(cell)
    return COLS.time.some((k) => s.includes(k)) && (s.some((x) => /金额/.test(x)) || s.includes('收入') || s.includes('支出'))
  })
  if (headerIdx < 0) throw new Error('没找到表头（需要包含「交易时间/日期」和「金额」列）')
  const header = table[headerIdx].map(cell)
  const col = {}
  for (const [k, names] of Object.entries(COLS)) {
    const i = header.findIndex((h) => names.includes(h))
    if (i >= 0) col[k] = i
  }
  const allText = table.slice(0, headerIdx).flat().map(cell).join(' ')
  const channel = detectChannel(filename, header.join(','), allText)

  const out = []
  for (const r of table.slice(headerIdx + 1)) {
    const g = (k) => (col[k] != null ? cell(r[col[k]]) : '')
    const rawTime = g('time')
    if (!rawTime || !/\d/.test(rawTime)) continue
    const t = dayjs(rawTime.replace(/\//g, '-'))
    if (!t.isValid()) continue

    let direction = null
    let amount = null
    const io = g('io')
    if (col.inAmount != null || col.outAmount != null) {
      const inA = parseAmount(g('inAmount'))
      const outA = parseAmount(g('outAmount'))
      if (inA) { direction = 'IN'; amount = inA } else if (outA) { direction = 'OUT'; amount = outA }
    }
    if (amount == null) {
      const a = parseAmount(g('amount'))
      if (a == null) continue
      amount = Math.abs(a)
      if (/收入/.test(io)) direction = 'IN'
      else if (/支出/.test(io)) direction = 'OUT'
      else if (!io) direction = a < 0 ? 'OUT' : 'IN'
    }

    const status = g('status')
    let skip = false
    let skipReason = ''
    if (!direction) { skip = true; skipReason = `不计收支（${io || g('txnType') || '—'}）` }
    if (/全额退款|已关闭|交易关闭|失败|对方已退还/.test(status)) { skip = true; skipReason = status }
    const refund = /已退款\(?[¥￥]?([\d.]+)\)?/.exec(status)
    if (refund && !skip) {
      amount = Math.round((amount - Number(refund[1])) * 100) / 100
      if (amount <= 0) { skip = true; skipReason = '已退款' }
    }

    if (!skip && !(amount > 0)) { skip = true; skipReason = '金额为 0' }
    const chIdx = header.indexOf('渠道')
    const rowChannel = (chIdx >= 0 && cell(r[chIdx])) || channel
    const txnNo = g('txnNo')
    out.push({
      txnDate: t.format('YYYY-MM-DD'),
      txnTime: /\d{1,2}:\d{2}/.test(rawTime) ? t.format('HH:mm:ss') : null,
      direction, amount,
      counterparty: g('counterparty') || null,
      description: g('goods') || g('txnType') || null,
      payMethod: g('payMethod') || null,
      status,
      channel: rowChannel,
      externalId: txnNo ? `${rowChannel}:${txnNo}` : `${rowChannel}:${t.format('YYYYMMDDHHmmss')}:${amount}:${(g('counterparty') || '').slice(0, 20)}`,
      presetCategory: g('category') || null,
      skip, skipReason
    })
  }
  return { channel, header, rows: out }
}
