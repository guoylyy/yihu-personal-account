// 操作留痕：改动金额类数据时记一笔，方便回看「这个数是什么时候被谁改的」
import prisma from './prisma.js'

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
const plain = (o) => (o ? JSON.parse(JSON.stringify(o, replacer)) : null)

export async function logAudit({ action, entity, entityId, summary, before, after }) {
  try {
    await prisma.auditLog.create({
      data: {
        action, entity,
        entityId: entityId != null ? String(entityId) : null,
        summary: summary?.slice(0, 500) || null,
        before: plain(before), after: plain(after)
      }
    })
  } catch (e) {
    console.error('[audit] 写入失败:', e.message)
  }
}
