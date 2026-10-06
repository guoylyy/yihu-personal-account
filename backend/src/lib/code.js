// 流水编号：T-YYYYMM-00001（编号只在同一租户内连续）
import prisma from './prisma.js'
import dayjs from 'dayjs'
import { resolveUid } from './tenant.js'

export async function nextTxnCode(date = new Date(), uid) {
  const userId = resolveUid(uid)
  const head = `T-${dayjs(date).format('YYYYMM')}-`
  const last = await prisma.transaction.findFirst({
    where: { userId, code: { startsWith: head } }, orderBy: { code: 'desc' }, select: { code: true }
  })
  const seq = last ? Number(last.code.slice(head.length)) + 1 : 1
  return head + String(seq).padStart(5, '0')
}

/** 批量取号：一次性导入几百笔时避免逐条查库 */
export async function codeAllocator(uid) {
  const userId = resolveUid(uid)
  const cache = new Map()
  return async (date) => {
    const head = `T-${dayjs(date).format('YYYYMM')}-`
    if (!cache.has(head)) {
      const last = await prisma.transaction.findFirst({
        where: { userId, code: { startsWith: head } }, orderBy: { code: 'desc' }, select: { code: true }
      })
      cache.set(head, last ? Number(last.code.slice(head.length)) : 0)
    }
    const seq = cache.get(head) + 1
    cache.set(head, seq)
    return head + String(seq).padStart(5, '0')
  }
}
