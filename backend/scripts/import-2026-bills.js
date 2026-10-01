// 一次性导入：2026 年 1-9 月微信+支付宝已归类账单（data/2026-wechat-alipay.csv，来自 06.家庭个人/账单分析）
// 优先级：你确认过的规则（卢佳怡=家庭划转、韩飞/房东=公司…）> 账单分析时的科目 > 关键字；「其他」留空，交给 AI 归类
import 'dotenv/config'
import fs from 'node:fs'
import prisma from '../src/lib/prisma.js'
import { parseBill } from '../src/lib/billParser.js'
import { classify, matchAccount } from '../src/lib/classify.js'
import { createTransaction } from '../src/lib/ledger.js'
import { codeAllocator } from '../src/lib/code.js'
import { recalcAll } from '../src/lib/balance.js'
import { toDate } from '../src/lib/period.js'

const MAP = {
  交通出行: 'A7', 餐饮日常: 'B1', 转账与红包: 'B3', 网购平台: 'B1', 通讯与订阅: 'A12', 物业: 'A6',
  AI算力与云服务: 'A10', 水电燃气: 'A4', 同济与社会工作: 'B3', 健康保健: 'A11', 旅行住宿: 'B1',
  小孩相关: 'A1', 学习提升: 'B2', 保险: 'A8', 税费: 'A13'
}

const file = new URL('../data/2026-wechat-alipay.csv', import.meta.url)
const { rows } = parseBill(fs.readFileSync(file), '2026账单-已归类明细.csv')
const cats = Object.fromEntries((await prisma.category.findMany()).map((c) => [c.code, c]))
const alloc = await codeAllocator()
const batch = 'IMP-2026-HISTORY'
let n = 0, skipped = 0, dup = 0
const stat = {}

for (const r of rows) {
  if (r.skip) { skipped++; continue }
  if (await prisma.transaction.findFirst({ where: { externalId: r.externalId, deletedAt: null }, select: { id: true } })) { dup++; continue }
  const cls = await classify(r)
  let code = cls.by === 'rule' ? cls.categoryCode : MAP[r.presetCategory] || (cls.by === 'keyword' ? cls.categoryCode : null)
  const isBusiness = cls.by === 'rule' ? cls.isBusiness : false
  const acc = await matchAccount(r.payMethod)
  await createTransaction({
    code: await alloc(toDate(r.txnDate)), txnDate: r.txnDate, txnTime: r.txnTime, direction: r.direction, amount: r.amount,
    accountId: acc?.id, categoryId: code ? cats[code].id : null, counterparty: r.counterparty, description: r.description,
    channel: r.channel, payMethod: r.payMethod, isBusiness, importBatch: batch, externalId: r.externalId,
    remark: r.presetCategory === '其他' ? null : `账单分析科目：${r.presetCategory}`
  }, { source: 'IMPORT', recalc: false })
  stat[code || '未分类'] = (stat[code || '未分类'] || 0) + 1
  n++
}
await recalcAll()
console.log(`✔ 导入 ${n} 笔，跳过（退款等）${skipped}，重复 ${dup}`)
console.log(stat)
await prisma.$disconnect()
