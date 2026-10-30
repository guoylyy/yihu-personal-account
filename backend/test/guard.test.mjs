// 库名护栏：判断逻辑本身，不连库
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTestDatabase, databaseName } from './helpers/guard.mjs'

const url = (db) => `mysql://root:p@127.0.0.1:3318/${db}`

test('库名含 test / e2e 放行，大小写不敏感，且不带警告', () => {
  for (const db of ['personal_finance_e2e', 'personal_finance_test', 'TEST_pf', 'E2E']) {
    assert.deepEqual(checkTestDatabase({ url: url(db), allow: '' }), { ok: true, db })
  }
})

test('其他库名拒绝，提示带库名和放行开关', () => {
  const r = checkTestDatabase({ url: url('personal_finance'), allow: '' })
  assert.equal(r.ok, false)
  assert.match(r.message, /personal_finance 看起来不是测试库/)
  assert.match(r.message, /ALLOW_TEST_ON_REAL_DB=1/)
})

test('只认库名：host、用户名、查询串里的 test 不算', () => {
  assert.equal(checkTestDatabase({ url: 'mysql://test:test@test-host:3306/personal_finance?x=test', allow: '' }).ok, false)
})

test('ALLOW_TEST_ON_REAL_DB 只有等于 1 才放行，放行时带警告', () => {
  assert.equal(checkTestDatabase({ url: url('personal_finance'), allow: 'true' }).ok, false)
  const r = checkTestDatabase({ url: url('personal_finance'), allow: '1' })
  assert.equal(r.ok, true)
  assert.match(r.warning, /在非测试库 personal_finance 上跑测试/)
})

test('DATABASE_URL 缺失、解析不了或没写库名都拒绝', () => {
  for (const u of [null, '', 'not a url', 'mysql://root@127.0.0.1:3318/']) {
    assert.equal(checkTestDatabase({ url: u, allow: '' }).ok, false)
  }
  assert.equal(databaseName(url('a%2Db')), 'a-b')
})
