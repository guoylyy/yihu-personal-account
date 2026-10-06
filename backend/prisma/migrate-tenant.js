// 一次性迁移：把单主人时代的历史数据全部归属到当前账本主人
// 幂等：只更新 userId 为空的行，可重复执行
// 用法：cd backend && node prisma/migrate-tenant.js
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 需要回填的租户模型（parent / child 都带上 userId，便于直接按人查询）
const MODELS = [
  'account', 'category', 'categoryRule', 'transaction',
  'holding', 'holdingTrade', 'fixedAsset', 'assetValuation',
  'loan', 'loanRepayment', 'budget', 'netWorthSnapshot', 'aiEntryLog'
]

async function pickOwner() {
  // 约定：当前账本主人是平台用户 3
  const byPlatform = await prisma.user.findFirst({ where: { platformUserId: 3 } })
  if (byPlatform) return byPlatform
  // 兜底：第一个绑定平台的用户，再否则系统里最早的用户
  return (await prisma.user.findFirst({ where: { platformUserId: { not: null } }, orderBy: { platformUserId: 'asc' } })) ||
         (await prisma.user.findFirst({ orderBy: { id: 'asc' } }))
}

async function main() {
  const owner = await pickOwner()
  if (!owner) throw new Error('系统里还没有任何用户，无法确定账本主人')
  console.log(`账本主人：${owner.name}（userId=${owner.id}，platformUserId=${owner.platformUserId}）`)

  let total = 0
  for (const m of MODELS) {
    const res = await prisma[m].updateMany({ where: { userId: null }, data: { userId: owner.id } })
    if (res.count) console.log(`✔ ${m} 回填 ${res.count} 行`)
    total += res.count
  }
  console.log(`完成，共回填 ${total} 行`)
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1) })
