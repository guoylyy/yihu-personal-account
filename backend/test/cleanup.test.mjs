// 清理本身：走真实接口留下的各种审计行（中文/英文实体名、导入批次）都要删干净
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, prisma } from './helpers/fixtures.mjs'

let t, me
before(async () => { t = await boot(); me = await t.createUser('clean') })
after(async () => { await t.cleanup(); await t.close() })

test('cleanup 删掉名下全部业务数据和审计行，不碰别人的数据', async () => {
  const pairs = []
  const post = async (entity, url, body) => {
    const row = await t.data('POST', url, me.token, body)
    pairs.push({ entity, entityId: String(row.id) })
  }
  await post('账户', '/accounts', { name: '清理测试卡', type: 'BANK' })
  await post('科目', '/categories', { code: 'ZZ1', name: '清理测试科目', kind: 'EXPENSE' })
  await post('持仓', '/holdings', { type: 'FUND', name: '清理测试基金' })
  await post('固定资产', '/assets', { type: 'OTHER', name: '清理测试资产' })
  await post('借贷', '/loans', { direction: 'LEND', counterparty: '清理测试', principal: 100, balance: 100 })

  const batch = `${t.prefix}-batch`
  await prisma.transaction.create({ data: { userId: me.id, code: `${t.prefix}-1`.slice(0, 30), txnDate: new Date('2026-10-01'), direction: 'OUT', amount: 1, importBatch: batch } })
  await prisma.auditLog.create({ data: { action: 'IMPORT', entity: '流水', summary: `导入 1 笔（${batch}）` } })
  const others = await prisma.auditLog.create({ data: { action: 'IMPORT', entity: '流水', summary: `导入 1 笔（${t.prefix}-别人的批次）` } })

  const where = { OR: [...pairs, { summary: { contains: batch } }] }
  assert.equal(await prisma.auditLog.count({ where }), pairs.length + 1)

  await t.cleanup()

  assert.equal(await prisma.auditLog.count({ where }), 0)
  assert.equal(await t.residual(), 0)
  assert.equal(await prisma.auditLog.count({ where: { id: others.id } }), 1)
  await prisma.auditLog.delete({ where: { id: others.id } })
})
