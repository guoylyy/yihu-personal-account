// JWT 鉴权。个人系统只有一个使用者，不做角色矩阵（集团系统的 PERMISSIONS 在这里不需要）
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

// 部署在以虎 One 上没配 JWT_SECRET 时，从平台注入的应用密钥派生（重置应用密钥 = 重新登录）
const SECRET = process.env.JWT_SECRET ||
  (process.env.YH_CLIENT_SECRET && crypto.createHash('sha256').update(`personal-account-jwt:${process.env.YH_CLIENT_SECRET}`).digest('hex')) ||
  'dev-secret'
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d'

export const signToken = (payload, expiresIn) => jwt.sign(payload, SECRET, { expiresIn: expiresIn || EXPIRES_IN })

export function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ code: 1001, message: '未登录', data: null })
  try {
    req.user = jwt.verify(header.slice(7), SECRET)
    next()
  } catch {
    return res.status(401).json({ code: 1002, message: '登录已过期，请重新登录', data: null })
  }
}
