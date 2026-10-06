// 请求级租户上下文（AsyncLocalStorage）
// 一次登录请求内的所有读写都隐式归属当前用户，lib 函数不用把 userId 层层传参；
// seed / 迁移脚本不在请求上下文里，显式传 userId
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

/** 在指定租户上下文中执行（fn 一般是 Express 的 next） */
export const withTenant = (userId, fn) => als.run(userId == null ? null : BigInt(userId), fn)

/** 是否处于登录请求上下文 */
export const hasTenant = () => als.getStore() != null

/** 当前登录用户 id；不在请求上下文里直接报错，避免漏过滤导致串账 */
export function currentUserId() {
  const id = als.getStore()
  if (id == null) throw new Error('缺少租户上下文：该操作必须在登录请求中执行')
  return id
}

/**
 * 取租户 id：请求上下文里用当前用户；否则用显式传入的 uid（seed/迁移脚本）
 * 两者都没有时抛错
 */
export function resolveUid(uid) {
  if (hasTenant()) return als.getStore()
  if (uid == null) return currentUserId()
  return BigInt(uid)
}

/** 给查询 where 补上租户过滤 */
export function tenantWhere(where = {}) {
  return { ...where, userId: currentUserId() }
}
