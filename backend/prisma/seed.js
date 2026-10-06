// 初始化：科目（通用，写在代码里）+ 个人数据（data/personal-seed.json，不进仓库）
// 可重复执行：已存在的按 code / name 跳过，不会覆盖你在系统里改过的数据
// 多租户：seed 只初始化「种子用户」的一本，科目/数据都带该用户 userId
import 'dotenv/config'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { CATEGORIES } from './categories.js'
import { recalcAll } from '../src/lib/balance.js'

export { CATEGORIES }

const prisma = new PrismaClient()
const d = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null)

async function main() {
  const file = new URL('../data/personal-seed.json', import.meta.url)
  const hasFile = fs.existsSync(file)
  const p = hasFile ? JSON.parse(fs.readFileSync(file, 'utf8')) : null

  const seedUser = await ensureUser(p?.user || { username: 'admin', password: 'admin123', name: '我' })
  const uid = seedUser.id

  const cats = {}
  for (const [i, c] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { userId_code: { userId: uid, code: c.code } },
      update: {},
      create: { ...c, userId: uid, sort: i + 1 }
    })
    cats[c.code] = row
  }
  console.log(`✔ 科目 ${CATEGORIES.length} 个`)

  if (!hasFile) {
    console.log('ℹ 没有 data/personal-seed.json，只初始化了 admin/admin123 和标准科目')
    return
  }

  for (const a of p.accounts || []) {
    if (await prisma.account.findFirst({ where: { userId: uid, name: a.name, deletedAt: null } })) continue
    await prisma.account.create({ data: { ...a, userId: uid, initialDate: d(a.initialDate) } })
  }
  await recalcAll(uid)
  console.log(`✔ 账户 ${p.accounts?.length || 0} 个`)

  for (const h of p.holdings || []) {
    if (await prisma.holding.findFirst({ where: { userId: uid, name: h.name, deletedAt: null } })) continue
    await prisma.holding.create({ data: { ...h, userId: uid, valuedAt: d(h.valuedAt) } })
  }
  console.log(`✔ 持仓 ${p.holdings?.length || 0} 个`)

  for (const a of p.assets || []) {
    if (await prisma.fixedAsset.findFirst({ where: { userId: uid, name: a.name, deletedAt: null } })) continue
    const row = await prisma.fixedAsset.create({ data: { ...a, userId: uid, valuedAt: d(a.valuedAt) } })
    await prisma.assetValuation.create({ data: { userId: uid, assetId: row.id, valDate: d(a.valuedAt) || new Date(), value: a.currentValue, note: '初始快照' } })
  }
  console.log(`✔ 固定资产 ${p.assets?.length || 0} 项`)

  for (const l of p.loans || []) {
    if (await prisma.loan.findFirst({ where: { userId: uid, counterparty: l.counterparty, deletedAt: null } })) continue
    const { asset, ...rest } = l
    const assetRow = asset ? await prisma.fixedAsset.findFirst({ where: { userId: uid, name: asset } }) : null
    await prisma.loan.create({ data: { ...rest, userId: uid, balance: l.balance ?? l.principal, startDate: d(l.startDate), assetId: assetRow?.id || null } })
  }
  console.log(`✔ 借贷 ${p.loans?.length || 0} 笔`)

  for (const r of p.rules || []) {
    await prisma.categoryRule.upsert({
      where: { userId_pattern: { userId: uid, pattern: r.pattern } }, update: {},
      create: { userId: uid, pattern: r.pattern, categoryId: cats[r.code].id, isBusiness: !!r.isBusiness, source: 'SEED' }
    })
  }
  console.log(`✔ 分类规则 ${p.rules?.length || 0} 条`)

  for (const year of p.budgets?.years || []) {
    for (const b of p.budgets.items) {
      const annual = b.annual ?? b.monthly * 12
      const categoryId = cats[b.code].id
      await prisma.budget.upsert({
        where: { userId_year_categoryId: { userId: uid, year, categoryId } }, update: {},
        create: { userId: uid, year, categoryId, monthlyAmount: annual / 12, annualAmount: annual, remark: b.remark || null }
      })
    }
  }
  console.log(`✔ 预算 ${p.budgets?.years?.join('/')}`)
}

async function ensureUser(u) {
  const existing = await prisma.user.findUnique({ where: { username: u.username } })
  if (existing) return existing
  return prisma.user.create({ data: { username: u.username, name: u.name, passwordHash: await bcrypt.hash(u.password, 10) } })
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1) })
