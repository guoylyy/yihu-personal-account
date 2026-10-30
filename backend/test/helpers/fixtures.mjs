// 测试数据：每个文件建自己的用户（前缀 E2E-TEST-<时间戳>），一人一本账；跑完按用户硬删除并核对残留为 0
// 只删这里建出来的用户名下的数据，碰不到演示账本。不依赖 3020 上跑的后端：进程内起一份 app，监听随机端口
import './env.mjs'
import crypto from 'node:crypto'
import prisma from '../../src/lib/prisma.js'
import app from '../../src/app.js'
import { signToken } from '../../src/lib/auth.js'
import { CATEGORIES } from '../../prisma/categories.js'
import { purgeUsers, TENANT_MODELS } from './purge.mjs'

export async function boot() {
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const userIds = []
  const auditFilters = []
  const prefix = `E2E-TEST-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`

  const call = async (method, url, token, body, raw) => {
    const r = await fetch(`${base}/api/pf${url}`, {
      method,
      headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: raw || (body === undefined ? undefined : JSON.stringify(body))
    })
    return { status: r.status, ...(await r.json()) }
  }
  /** 成功时直接取 data，否则抛错（断言成功路径用） */
  const data = async (method, url, token, body) => {
    const r = await call(method, url, token, body)
    if (r.code !== 0) throw new Error(`${method} ${url}: ${r.code} ${r.message}`)
    return r.data
  }
  const parse = (token, text, context, images = []) => {
    const fd = new FormData()
    fd.append('text', text)
    if (context !== undefined) fd.append('context', typeof context === 'string' ? context : JSON.stringify(context))
    for (const i of images) fd.append('images', i)
    return call('POST', '/ai/parse', token, undefined, fd)
  }

  async function createUser(key) {
    const u = await prisma.user.create({ data: { username: `${prefix}-${key}`.toLowerCase().slice(0, 50), passwordHash: 'x', name: key } })
    userIds.push(u.id)
    const uid = u.id
    await prisma.category.createMany({ data: CATEGORIES.map((c, i) => ({ ...c, userId: uid, sort: i + 1 })) })
    const cats = await prisma.category.findMany({ where: { userId: uid } })
    const acc = (name, type, extra = {}) => prisma.account.create({ data: { userId: uid, name, type, ...extra } })
    return {
      id: uid, token: signToken({ id: String(uid), username: u.username, name: key }),
      cat: Object.fromEntries(cats.map((c) => [c.code, c])),
      bank: await acc('招商银行', 'BANK', { initialBalance: 10000, balance: 10000 }),
      wx: await acc('微信零钱', 'WECHAT'),
      card: await acc('光大信用卡', 'CREDIT', { initialBalance: -3000, balance: -3000 }),
      holding: await prisma.holding.create({ data: { userId: uid, type: 'FUND', name: '沪深300基金', quantity: 100, price: 4, marketValue: 400, costAmount: 300 } }),
      asset: await prisma.fixedAsset.create({ data: { userId: uid, type: 'PROPERTY', name: '滨江一号', currentValue: 3000000 } }),
      loan: await prisma.loan.create({ data: { userId: uid, direction: 'LEND', kind: 'PERSONAL', counterparty: '李新民', principal: 50000, balance: 50000 } })
    }
  }

  async function cleanup() {
    auditFilters.push(...await purgeUsers(prisma, userIds))
  }

  async function residual() {
    const where = { userId: { in: userIds } }
    let n = await prisma.user.count({ where: { id: { in: userIds } } })
    for (const m of TENANT_MODELS) n += await prisma[m].count({ where })
    if (auditFilters.length) n += await prisma.auditLog.count({ where: { OR: auditFilters } })
    return n
  }

  async function close() {
    await new Promise((ok) => server.close(ok))
    await prisma.$disconnect()
  }

  return { base, prefix, call, data, parse, createUser, cleanup, residual, close }
}

export { prisma }
