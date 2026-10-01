// 平台用户 → 本系统用户。个人账本是私人的：只认一个人
// 1. 已绑定（platformUserId）→ 直接用
// 2. 还没有人绑定过、且来的是平台管理员 → 绑到本系统的账号上（系统里只有一个账号，取最早的那个）
// 3. 其他人一律拒绝：平台上别人即使看得到这个应用也进不来
import prisma from './prisma.js'
import { signToken } from './auth.js'

export async function resolveUser(pu) {
  if (!pu?.id) throw new Error('没有拿到平台身份，请从工作台重新打开')
  let user = await prisma.user.findFirst({ where: { platformUserId: Number(pu.id) } })
  if (!user) {
    const bound = await prisma.user.count({ where: { platformUserId: { not: null } } })
    const owner = await prisma.user.findFirst({ orderBy: { id: 'asc' } })
    if (bound || !owner || !pu.roles?.includes('ADMIN')) {
      throw new Error('个人财务是私人账本，只有账本主人能进入')
    }
    user = await prisma.user.update({ where: { id: owner.id }, data: { platformUserId: Number(pu.id) } })
    console.log(`[platform] 账本绑定到平台用户 ${pu.name}（${pu.id}）`)
  }
  return user
}

/** 与账号密码登录签发的 token 一致 */
export const signFor = (user, expiresIn) => signToken({ id: String(user.id), username: user.username, name: user.name }, expiresIn)
