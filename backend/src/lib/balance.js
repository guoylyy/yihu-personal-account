// 账户余额 = 期初余额（initialDate 当天的实际余额）+ initialDate 之后的收入 − 支出
// 历史导入的流水（早于期初日）只用于分析，不影响当前余额；
// 余额对不上时用「校准余额」把期初日挪到今天，而不是去改流水
import prisma from './prisma.js'
import { Prisma } from '@prisma/client'
import { resolveUid } from './tenant.js'

export async function recalcAccountBalance(accountId, uid) {
  if (!accountId) return null
  const id = BigInt(accountId)
  const userId = resolveUid(uid)
  const account = await prisma.account.findFirst({ where: { id, userId } })
  if (!account) return null
  const where = { userId, accountId: id, deletedAt: null }
  if (account.initialDate) where.txnDate = { gt: account.initialDate }
  const rows = await prisma.transaction.groupBy({ by: ['direction'], where, _sum: { amount: true } })
  const sum = (d) => new Prisma.Decimal(rows.find((r) => r.direction === d)?._sum.amount || 0)
  const balance = new Prisma.Decimal(account.initialBalance).plus(sum('IN')).minus(sum('OUT'))
  return prisma.account.update({ where: { id }, data: { balance, balanceAt: new Date() } })
}

export async function recalcAll(uid) {
  const userId = resolveUid(uid)
  const list = await prisma.account.findMany({ where: { userId, deletedAt: null }, select: { id: true } })
  for (const a of list) await recalcAccountBalance(a.id, userId)
}
