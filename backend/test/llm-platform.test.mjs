// 平台大模型通道：用本地起的极简 HTTP 服务当平台，测 provider 判定、请求形状、错误映射和降级
// 不碰真实模型；业务接口走真实 app，只把 AI_PROVIDER 临时切到 platform
import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { boot } from './helpers/fixtures.mjs'
import { provider, aiStatus, llmJSON } from '../src/lib/llm.js'

const ENV_KEYS = ['AI_PROVIDER', 'AI_MODEL', 'YH_CLIENT_ID', 'YH_CLIENT_SECRET', 'YH_API_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_BIN', 'PATH']
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
const SECRET = 'mock-secret-do-not-log'

let t, me, mock, mockUrl
let requests = []
let reply = null // (req) => { status, body } | 'hang'

const chat = (content, model = 'mock-model') => ({ status: 200, body: { model, choices: [{ message: { role: 'assistant', content } }] } })
const reject = (status) => () => ({ status, body: { message: '拒绝' } })

before(async () => {
  t = await boot()
  me = await t.createUser('llm')
  mock = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      const seen = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(raw) }
      requests.push(seen)
      const r = reply(seen)
      if (r === 'hang') return
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
    })
  })
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok))
  mockUrl = `http://127.0.0.1:${mock.address().port}`
})

after(async () => {
  mock.closeAllConnections()
  await new Promise((ok) => mock.close(ok))
  await t.cleanup()
  await t.close()
})

afterEach(() => {
  for (const k of ENV_KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])
  requests = []
  reply = null
})

function usePlatform() {
  process.env.AI_PROVIDER = 'platform'
  process.env.YH_API_URL = `${mockUrl}/`
  process.env.YH_CLIENT_ID = 'mock-id'
  process.env.YH_CLIENT_SECRET = SECRET
  delete process.env.AI_MODEL
}

function clearProviderEnv() {
  for (const k of ['AI_PROVIDER', 'YH_CLIENT_ID', 'YH_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_BIN']) delete process.env[k]
  process.env.PATH = '/nonexistent'
}

const png = () => new File([Buffer.from('fake-png')], 'a.png', { type: 'image/png' })
const ask = () => llmJSON({ system: '系统提示', prompt: '用户的话' })

// ─────────── provider 判定 ───────────
test('provider：有 YH_CLIENT_ID + SECRET 选 platform，不是 off', () => {
  clearProviderEnv()
  process.env.YH_CLIENT_ID = 'id'
  process.env.YH_CLIENT_SECRET = 's'
  assert.equal(provider(), 'platform')
  process.env.ANTHROPIC_API_KEY = 'k'
  assert.equal(provider(), 'platform', '平台凭证优先于 API Key')
})

test('provider：只有 YH_CLIENT_ID 没有 SECRET 不算平台', () => {
  clearProviderEnv()
  process.env.YH_CLIENT_ID = 'id'
  assert.equal(provider(), 'off')
})

test('provider：显式 AI_PROVIDER 优先级最高', () => {
  clearProviderEnv()
  process.env.YH_CLIENT_ID = 'id'
  process.env.YH_CLIENT_SECRET = 's'
  process.env.AI_PROVIDER = 'stub'
  assert.equal(provider(), 'stub')
})

test('provider：其后依次是 API Key、本机 claude、off', () => {
  clearProviderEnv()
  assert.equal(provider(), 'off', 'PATH 里没有 claude')
  process.env.CLAUDE_BIN = '/opt/claude'
  assert.equal(provider(), 'claude-cli')
  process.env.ANTHROPIC_API_KEY = 'k'
  assert.equal(provider(), 'anthropic')
})

// ─────────── 请求形状与状态 ───────────
test('platform 请求：URL、Basic 认证、messages、temperature；不配 AI_MODEL 就不传 model', async () => {
  usePlatform()
  reply = () => chat('```json\n{"ok":true}\n```')
  const r = await ask()
  assert.deepEqual(r.data, { ok: true })
  assert.equal(r.provider, 'platform')
  const [q] = requests
  assert.equal(q.method, 'POST')
  assert.equal(q.url, '/api/open/llm/chat/completions')
  assert.equal(q.headers.authorization, `Basic ${Buffer.from(`mock-id:${SECRET}`).toString('base64')}`)
  assert.deepEqual(q.body.messages, [{ role: 'system', content: '系统提示' }, { role: 'user', content: '用户的话' }])
  assert.equal(q.body.temperature, 0.1)
  assert.equal('model' in q.body, false)
})

test('platform 请求：配了 AI_MODEL 就带上', async () => {
  usePlatform()
  process.env.AI_MODEL = 'deepseek-pro'
  reply = () => chat('{"ok":true}')
  await ask()
  assert.equal(requests[0].body.model, 'deepseek-pro')
})

test('platform 响应：兼容 { code, data } 再包一层', async () => {
  usePlatform()
  reply = () => ({ status: 200, body: { code: 0, data: chat('{"ok":1}').body } })
  assert.deepEqual((await ask()).data, { ok: 1 })
})

test('aiStatus：platform 可用，model 取平台返回的；缺凭证时 enabled=false', async () => {
  usePlatform()
  reply = () => chat('{"ok":true}', 'deepseek-flash')
  await ask()
  const s = aiStatus()
  assert.equal(s.enabled, true)
  assert.equal(s.provider, 'platform')
  assert.equal(s.model, 'deepseek-flash')
  delete process.env.YH_CLIENT_SECRET
  assert.equal(aiStatus().enabled, false)
})

test('图片按 OpenAI 多模态格式发，媒体类型取文件自己的', async () => {
  usePlatform()
  reply = () => chat('{"items":[]}')
  await llmJSON({ system: 's', prompt: '看图', images: [{ data: Buffer.from('abc'), mediaType: 'image/png' }] })
  assert.deepEqual(requests[0].body.messages[1].content, [
    { type: 'text', text: '看图' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('abc').toString('base64')}` } }
  ])
})

// ─────────── 错误映射 ───────────
const failure = (fn) => assert.rejects(fn, (e) => { failure.last = e; return true }).then(() => failure.last)

test('错误映射：401/403 → 凭证无效', async () => {
  usePlatform()
  for (const code of [401, 403]) {
    reply = reject(code)
    assert.equal((await failure(ask)).message, '平台拒绝了模型调用（应用凭证无效）')
  }
})

test('错误映射：429 → 太频繁', async () => {
  usePlatform()
  reply = reject(429)
  assert.equal((await failure(ask)).message, '模型调用太频繁，稍后再试')
})

test('错误映射：超时', async () => {
  usePlatform()
  reply = () => 'hang'
  const e = await failure(() => llmJSON({ system: 's', prompt: 'p', timeoutMs: 100 }))
  assert.equal(e.message, '模型响应超时')
})

test('错误映射：连不上', async () => {
  usePlatform()
  process.env.YH_API_URL = 'http://127.0.0.1:1'
  assert.equal((await failure(ask)).message, '连不上平台大模型')
})

test('错误映射：500 和乱码都不把响应原文给用户', async () => {
  usePlatform()
  reply = () => ({ status: 500, body: '<html>stack trace</html>' })
  assert.equal((await failure(ask)).message, '平台大模型出错（HTTP 500）')
  reply = () => chat('我不知道')
  assert.equal((await failure(ask)).message, '模型返回的内容看不懂')
})

test('日志里 secret 和 Basic 串都打码', async () => {
  usePlatform()
  const basic = Buffer.from(`mock-id:${SECRET}`).toString('base64')
  reply = () => ({ status: 401, body: `bad secret ${SECRET} / Basic ${basic}` })
  const logs = []
  const origin = console.error
  console.error = (...a) => logs.push(a.join(' '))
  try {
    await failure(ask)
  } finally {
    console.error = origin
  }
  assert.equal(logs.length, 1)
  assert.equal(logs[0].includes(SECRET), false)
  assert.equal(logs[0].includes(basic), false)
})

// ─────────── 降级：接口层 ───────────
test('AI 不可用：/ai/parse 不报错，走规则解析并带提示', async () => {
  usePlatform()
  reply = reject(401)
  const r = await t.parse(me.token, '午饭 45 微信零钱')
  assert.equal(r.status, 200)
  assert.equal(r.code, 0)
  assert.match(r.data.provider, /^rule/)
  assert.equal(r.data.items.length, 1)
  assert.equal(r.data.items[0].amount, 45)
  assert.equal(r.data.notice, 'AI 暂时不可用，已用规则解析')
  assert.equal(r.data.error, '平台拒绝了模型调用（应用凭证无效）')
})

test('AI 不可用：/ai/resolve 不调模型，照常返回', async () => {
  usePlatform()
  reply = reject(401)
  const r = await t.call('POST', '/ai/resolve', me.token, { items: [{ type: 'transaction', amount: 45, direction: 'OUT', account: '微信零钱' }] })
  assert.equal(r.status, 200)
  assert.equal(r.code, 0)
  assert.equal(r.data[0].accountId, String(me.wx.id))
  assert.equal(requests.length, 0)
})

test('AI 不可用：/ai/ask 不报错，回答里说明原因', async () => {
  usePlatform()
  reply = reject(429)
  const r = await t.call('POST', '/ai/ask', me.token, { question: '这个月花了多少' })
  assert.equal(r.status, 200)
  assert.equal(r.code, 0)
  assert.match(r.data.answer, /AI 暂时不可用（模型调用太频繁，稍后再试）/)
})

// ─────────── 图片不支持 ───────────
test('平台对图片回 4xx：明确提示不支持看图，不静默', async () => {
  usePlatform()
  reply = reject(400)
  const r = await t.parse(me.token, '', undefined, [png()])
  assert.equal(r.code, 0)
  assert.deepEqual(r.data.items, [])
  assert.equal(r.data.notice, '当前平台模型不支持看图，请改用文字描述')
})

test('模型对图片答非所问：同样提示不支持看图', async () => {
  usePlatform()
  reply = () => chat('抱歉，我看不到图片')
  const r = await t.parse(me.token, '', undefined, [png()])
  assert.equal(r.data.notice, '当前平台模型不支持看图，请改用文字描述')
})

test('图片 + 文字且模型不收图：文字走规则，提示看图不支持', async () => {
  usePlatform()
  reply = reject(415)
  const r = await t.parse(me.token, '午饭 45 微信零钱', undefined, [png()])
  assert.equal(r.code, 0, r.message) // provider 列只有 30 字符，长错误曾把这里打成 9001
  assert.equal(r.data.items.length, 1)
  assert.equal(r.data.notice, '当前平台模型不支持看图，请改用文字描述')
})

test('带图时 401 仍是凭证问题，不误报成不支持看图', async () => {
  usePlatform()
  reply = reject(401)
  const r = await t.parse(me.token, '', undefined, [png()])
  assert.equal(r.data.notice, 'AI 暂时不可用（平台拒绝了模型调用（应用凭证无效）），截图没有识别')
})

test('AI 关着时传图：提示看不了，不当作没看出内容', async () => {
  process.env.AI_PROVIDER = 'off'
  const r = await t.parse(me.token, '', undefined, [png()])
  assert.equal(r.data.notice, 'AI 没开，看不了截图，请改用文字描述')
})

test('清理后残留 0', async () => {
  await t.cleanup()
  assert.equal(await t.residual(), 0)
})
