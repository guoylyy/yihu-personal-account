import express from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma.js'
import { signToken, auth } from '../lib/auth.js'
import { ok, badRequest, wrap } from '../lib/response.js'
import { localLoginAllowed } from '../lib/platform.js'

const router = express.Router()

router.post('/login', wrap(async (req, res) => {
  if (!localLoginAllowed()) return badRequest(res, '请从以虎 One 工作台进入（统一登录）')
  const { username, password } = req.body
  const user = await prisma.user.findUnique({ where: { username: String(username || '') } })
  if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) return badRequest(res, '用户名或密码错误')
  const payload = { id: String(user.id), username: user.username, name: user.name }
  return ok(res, { token: signToken(payload), user: payload })
}))

router.get('/me', auth, (req, res) => ok(res, { user: req.user }))

router.post('/change-password', auth, wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body
  if (!newPassword || newPassword.length < 6) return badRequest(res, '新密码至少 6 位')
  const user = await prisma.user.findUnique({ where: { id: BigInt(req.user.id) } })
  if (!(await bcrypt.compare(String(oldPassword || ''), user.passwordHash))) return badRequest(res, '原密码不对')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } })
  return ok(res, true)
}))

export default router
