// npm test 入口：查库名 → 记全部表行数 → 跑测试 → 再数一遍，有漂移就非 0 退出
// 单个测试文件核对不了全库（并发跑、彼此看得见对方的数据），所以放在所有测试进程外面比
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkTestDatabase } from './helpers/guard.mjs'

const guard = checkTestDatabase()
if (!guard.ok) {
  console.error(`\n✖ ${guard.message}\n`)
  process.exit(2)
}
if (guard.warning) console.warn(guard.warning)

const { Prisma } = await import('@prisma/client')
const { default: prisma } = await import('../src/lib/prisma.js')
const { purgeUsers, TEST_USERNAME_PREFIX } = await import('./helpers/purge.mjs')

// 表清单取自 schema：以后新增的表自动纳入
async function countAll() {
  const counts = {}
  for (const { name } of Prisma.dmmf.datamodel.models) counts[name] = await prisma[name[0].toLowerCase() + name.slice(1)].count()
  return counts
}

function report(before, after) {
  const drift = Object.keys(before).filter((t) => before[t] !== after[t])
  console.log(`\n库 ${guard.db} 各表行数（跑前 → 跑后）`)
  for (const t of Object.keys(before)) {
    const d = after[t] - before[t]
    console.log(`  ${t.padEnd(18)} ${String(before[t]).padStart(5)} → ${String(after[t]).padStart(5)}${d ? `   漂移 ${d > 0 ? '+' : ''}${d}` : ''}`)
  }
  return drift
}

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const before = await countAll()
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=4', 'test/*.test.mjs'], { cwd: backend, stdio: 'inherit' })
const drift = report(before, await countAll())

// 测试进程崩溃时 after 钩子不会跑：把留下的测试用户清掉，否则下一轮把残留算进基线，就查不出来了
const leftovers = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } })
if (leftovers.length) await purgeUsers(prisma, leftovers.map((u) => u.id))
await prisma.$disconnect()

if (drift.length) {
  console.error(`\n✖ 测试污染：${drift.join('、')} 行数漂移${leftovers.length ? `（已硬删除残留的 ${leftovers.length} 个测试用户）` : ''}\n`)
  process.exit(1)
}
console.log('\n✔ 行数无漂移\n')
process.exit(run.status ?? 1)
