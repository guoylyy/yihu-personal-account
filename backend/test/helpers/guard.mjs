// 库名护栏：库名不含 test / e2e 一律拒绝，防止 DATABASE_URL 指到真实库时往账本里写测试数据
// npm test 入口（run.mjs）和 env.mjs 都查一遍：绕过入口直接 node --test 也拦得住
import dotenv from 'dotenv'

dotenv.config({ quiet: true })

export function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || null
  } catch {
    return null
  }
}

export function checkTestDatabase({ url = process.env.DATABASE_URL, allow = process.env.ALLOW_TEST_ON_REAL_DB } = {}) {
  const db = databaseName(url)
  if (db && /test|e2e/i.test(db)) return { ok: true, db }
  if (allow === '1') {
    const bar = '!'.repeat(64)
    return { ok: true, db, warning: `\n${bar}\n! ALLOW_TEST_ON_REAL_DB=1：在非测试库 ${db ?? '（无法解析库名）'} 上跑测试\n! 测试会往这个库写数据，跑完再硬删除；中途崩溃可能有残留\n${bar}\n` }
  }
  return { ok: false, db, message: `当前数据库 ${db ?? '（无法解析库名）'} 看起来不是测试库，如确认要跑加 ALLOW_TEST_ON_REAL_DB=1` }
}
