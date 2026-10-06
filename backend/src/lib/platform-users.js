// 平台用户 → 本系统用户。多租户：每个平台用户一本独立账本
// 1. 已绑定（platformUserId）→ 直接用
// 2. 还没人绑定过时，第一个进来的平台用户接管系统里最早的账号和历史数据（兼容旧的单主人账本）
// 3. 其他新平台用户 → 自动开户：建系统用户 + 复制一套标准科目，互相隔离
import prisma from './prisma.js'
import { signToken } from './auth.js'
import { CATEGORIES } from '../../prisma/categories.js'

/** 给新平台用户开户：建系统用户 + 复制一套标准科目（幂等） */
export async function provisionUser(pu) {
  const pid = Number(pu.id)
  const username = `platform_${pid}`
  let user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    user = await prisma.user.create({
      // passwordHash 用非 bcrypt 的 '!'，本地账号密码登录不可能成功；进入只走平台 SSO
      data: { username, platformUserId: pid, name: String(pu.name || username).slice(0, 50), passwordHash: '!' }
    })
    console.log(`[platform] 新开户 ${user.name}（platformUserId=${pid}）`)
  }
  const have = await prisma.category.count({ where: { userId: user.id } })
  if (!have) {
    for (const [i, c] of CATEGORIES.entries()) {
      await prisma.category.create({ data: { ...c, userId: user.id, sort: i + 1 } })
    }
    console.log(`[platform] 已为 ${user.name} 初始化 ${CATEGORIES.length} 个标准科目`)
  }
  return user
}

export async function resolveUser(pu) {
  if (!pu?.id) throw new Error('没有拿到平台身份，请从工作台重新打开')
  const pid = Number(pu.id)
  const bound = await prisma.user.findFirst({ where: { platformUserId: pid } })
  if (bound) return bound

  // 兼容旧的单主人账本：还没人绑定过时，第一个进来的平台用户接管最早的账号及其历史数据
  const anyBound = await prisma.user.count({ where: { platformUserId: { not: null } } })
  const legacy = await prisma.user.findFirst({ where: { platformUserId: null }, orderBy: { id: 'asc' } })
  if (!anyBound && legacy) {
    const user = await prisma.user.update({
      where: { id: legacy.id },
      data: { platformUserId: pid, name: pu.name ? String(pu.name).slice(0, 50) : legacy.name }
    })
    await prisma.category.updateMany({ where: { userId: null }, data: { userId: user.id } })
    console.log(`[platform] 旧账本由 ${user.name}（platformUserId=${pid}）接管`)
    return user
  }

  return provisionUser(pu)
}

/** 与账号密码登录签发的 token 一致 */
export const signFor = (user, expiresIn) => signToken({ id: String(user.id), username: user.username, name: user.name }, expiresIn)
