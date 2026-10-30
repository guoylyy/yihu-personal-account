// 版本号：/api/health 返回的必须是清单里的版本，读取失败不能影响健康检查
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import './helpers/env.mjs'
import app from '../src/app.js'
import prisma from '../src/lib/prisma.js'
import { readVersion } from '../src/lib/version.js'

const manifest = JSON.parse(fs.readFileSync(new URL('../../yh-app.json', import.meta.url), 'utf8'))

let server, base, tmp
before(async () => {
  server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
  base = `http://127.0.0.1:${server.address().port}`
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-version-'))
})
after(async () => {
  fs.rmSync(tmp, { recursive: true, force: true })
  await new Promise((ok) => server.close(ok))
  await prisma.$disconnect()
})

const dir = (name, files = {}) => {
  const d = path.join(tmp, name, 'backend')
  fs.mkdirSync(d, { recursive: true })
  for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(d, f), content)
  return d
}

test('GET /api/health：version 和 yh-app.json 一致，不需要登录', async () => {
  const r = await fetch(`${base}/api/health`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.code, 0)
  assert.equal(j.data.version, manifest.version)
  assert.equal(typeof j.data.ts, 'number')
})

test('VERSION 文件和 yh-app.json 一致', () => {
  assert.equal(fs.readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim(), manifest.version)
})

test('readVersion：清单在上一级（容器里 /app/yh-app.json）也能读到，优先于 package.json', () => {
  const d = dir('container', { 'package.json': '{"version":"1.0.0"}' })
  fs.writeFileSync(path.join(d, '..', 'yh-app.json'), '{"version":"9.8.7"}')
  assert.equal(readVersion([d]), '9.8.7')
})

test('readVersion：清单读不到或损坏，退回 package.json', () => {
  assert.equal(readVersion([dir('no-manifest', { 'package.json': '{"version":"1.0.0"}' })]), '1.0.0')
  assert.equal(readVersion([dir('bad-manifest', { 'yh-app.json': '{坏的', 'package.json': '{"version":"1.0.0"}' })]), '1.0.0')
})

test('readVersion：都读不到是空串，不是 undefined', () => {
  assert.equal(readVersion([dir('nothing')]), '')
  assert.equal(readVersion([dir('no-field', { 'yh-app.json': '{"code":"x"}', 'package.json': '{"name":"x"}' })]), '')
})
