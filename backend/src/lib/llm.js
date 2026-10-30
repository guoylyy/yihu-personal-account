// 大模型调用封装：AI 录入 / 分类 / 问答都走这里
// 几种模式（.env 的 AI_PROVIDER，不配时见 provider()）：
//   platform    以虎 One 的标准模型接口，用应用凭证（YH_CLIENT_ID / YH_CLIENT_SECRET）调，部署到平台时默认走这个
//   claude-cli  本机默认。复用本机已登录的 `claude` 命令行，不需要 API Key；图片会落临时文件让它用 Read 工具看
//   anthropic   用 ANTHROPIC_API_KEY 直连 Messages API（更快，适合部署到服务器）
//   off         不调模型，只用规则解析（lib/aiEntry.js 的 ruleParse）
//   stub        不发任何外部请求，按 lib/llmStub.js 的规则返回确定结果（测试和本地联调用）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { stubLLM } from './llmStub.js'

/** 模型调不通时抛这个：message 是给人看的话，不带原始异常和响应内容。status 是平台的 HTTP 状态，连不上时为 0 */
export class LlmError extends Error {
  constructor(message, { status = 0, noVision = false } = {}) {
    super(message)
    this.status = status
    this.noVision = noVision
  }
}

export const NO_VISION_MESSAGE = '当前平台模型不支持看图，请改用文字描述'
const PLATFORM_TIMEOUT_MS = 60000
const platformConfigured = () => !!(process.env.YH_CLIENT_ID && process.env.YH_CLIENT_SECRET)

function claudeOnPath() {
  if (process.env.CLAUDE_BIN) return true
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, 'claude'), fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

// 显式 AI_PROVIDER > 平台应用凭证 > API Key > 本机 claude 命令行 > 关闭
export function provider() {
  if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER.toLowerCase()
  if (platformConfigured()) return 'platform'
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'anthropic'
  return claudeOnPath() ? 'claude-cli' : 'off'
}

// 平台默认模型是平台定的，调通一次才知道名字
let platformModel = null

export function aiStatus() {
  const p = provider()
  if (p === 'off') return { enabled: false, provider: p, hint: 'AI 已关闭，只用规则解析' }
  if (p === 'stub') return { enabled: true, provider: p, model: 'stub' }
  if (p === 'platform') {
    const has = platformConfigured()
    return { enabled: has, provider: p, model: platformModel || process.env.AI_MODEL || '平台默认模型', hint: has ? '' : '缺少 YH_CLIENT_ID / YH_CLIENT_SECRET' }
  }
  if (p === 'anthropic') {
    const has = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
    return { enabled: has, provider: p, model: process.env.AI_MODEL || 'claude-opus-5', hint: has ? '' : '缺少 ANTHROPIC_API_KEY' }
  }
  return { enabled: true, provider: 'claude-cli', model: process.env.AI_CLI_MODEL || 'sonnet' }
}

/** 从模型输出里抠出 JSON（容忍 ```json 包裹和前后说明文字） */
export function extractJSON(text) {
  if (!text) throw new Error('模型没有返回内容')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('模型返回里没有 JSON')
  const open = body[start]
  const close = open === '{' ? '}' : ']'
  const end = body.lastIndexOf(close)
  return JSON.parse(body.slice(start, end + 1))
}

/**
 * @param {object} o
 *  system  系统提示
 *  prompt  用户内容
 *  images  [{ data: Buffer, mediaType: 'image/png' }]
 * @returns {Promise<{ data: any, provider: string, ms: number }>}
 */
export async function llmJSON({ system, prompt, images = [], timeoutMs }) {
  const p = provider()
  const t0 = Date.now()
  if (p === 'off') throw new Error('AI 未开启（AI_PROVIDER=off）')
  if (p === 'stub') return { data: await stubLLM({ system, prompt, images }), provider: p, ms: Date.now() - t0 }
  if (p === 'platform') return { data: await viaPlatform({ system, prompt, images, timeoutMs }), provider: p, ms: Date.now() - t0 }
  const text = p === 'anthropic'
    ? await viaApi({ system, prompt, images })
    : await viaCli({ system, prompt, images, timeoutMs })
  return { data: extractJSON(text), provider: p, ms: Date.now() - t0 }
}

// 日志里只留状态和打码后的响应片段：平台报错时可能把请求头回显出来
function logPlatformFailure(what, detail = '') {
  const { YH_CLIENT_ID: id, YH_CLIENT_SECRET: secret } = process.env
  const basic = Buffer.from(`${id}:${secret}`).toString('base64')
  console.error(`[platform-llm] ${what}`, String(detail).slice(0, 200).replaceAll(secret, '***').replaceAll(basic, '***'))
}

function platformHttpError(status, hasImages) {
  if (status === 401 || status === 403) return new LlmError('平台拒绝了模型调用（应用凭证无效）', { status })
  if (status === 429) return new LlmError('模型调用太频繁，稍后再试', { status })
  // 凭证和频率都没问题，只有带图时才出的 4xx：这个模型不收图片
  if (hasImages && status >= 400 && status < 500) return new LlmError(NO_VISION_MESSAGE, { status, noVision: true })
  return new LlmError(`平台大模型出错（HTTP ${status}）`, { status })
}

function platformContent({ prompt, images }) {
  if (!images.length) return prompt
  return [
    { type: 'text', text: prompt },
    ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data.toString('base64')}` } }))
  ]
}

async function viaPlatform({ system, prompt, images, timeoutMs = PLATFORM_TIMEOUT_MS }) {
  if (!platformConfigured()) throw new LlmError('缺少 YH_CLIENT_ID / YH_CLIENT_SECRET')
  const base = (process.env.YH_API_URL || 'http://localhost:3105').replace(/\/$/, '')
  const basic = Buffer.from(`${process.env.YH_CLIENT_ID}:${process.env.YH_CLIENT_SECRET}`).toString('base64')
  const body = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: platformContent({ prompt, images }) }],
    temperature: 0.1
  }
  if (process.env.AI_MODEL) body.model = process.env.AI_MODEL
  const hasImages = images.length > 0

  let res, raw
  try {
    res = await fetch(`${base}/api/open/llm/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    raw = await res.text()
  } catch (e) {
    logPlatformFailure(e.name, e.message)
    throw new LlmError(e.name === 'TimeoutError' ? '模型响应超时' : '连不上平台大模型')
  }
  if (!res.ok) {
    logPlatformFailure(`HTTP ${res.status}`, raw)
    throw platformHttpError(res.status, hasImages)
  }
  try {
    const j = JSON.parse(raw)
    // 兼容平台用 { code, data } 再包一层的情况
    const payload = j.choices ? j : j.data
    const data = extractJSON(payload.choices[0].message.content)
    if (payload.model) platformModel = payload.model
    return data
  } catch (e) {
    logPlatformFailure(`返回内容解析失败（${e.message}）`, raw)
    // 带图时模型不认图片的表现就是答非所问，这里不能当普通的格式错误吞掉
    throw hasImages ? new LlmError(NO_VISION_MESSAGE, { status: res.status, noVision: true }) : new LlmError('模型返回的内容看不懂', { status: res.status })
  }
}

async function viaApi({ system, prompt, images }) {
  const client = new Anthropic()
  const content = [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data.toString('base64') }
    })),
    { type: 'text', text: prompt }
  ]
  const response = await client.messages.create({
    model: process.env.AI_MODEL || 'claude-opus-5',
    max_tokens: 16000,
    system,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content }]
  })
  if (response.stop_reason === 'refusal') throw new Error('模型拒绝了这次请求')
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

function viaCli({ system, prompt, images, timeoutMs = 120000 }) {
  // 在独立临时目录里跑，避免读到任何项目的 CLAUDE.md；只开放 Read 工具看图片
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ai-'))
  const files = images.map((img, i) => {
    const ext = (img.mediaType.split('/')[1] || 'png').replace('jpeg', 'jpg')
    const f = path.join(dir, `img-${i + 1}-${crypto.randomBytes(3).toString('hex')}.${ext}`)
    fs.writeFileSync(f, img.data)
    return f
  })
  const fullPrompt = files.length
    ? `${prompt}\n\n请先用 Read 工具查看以下图片（账单/截图），再按要求输出：\n${files.join('\n')}`
    : prompt

  const args = [
    '-p', '--model', process.env.AI_CLI_MODEL || 'sonnet',
    '--output-format', 'json',
    '--system-prompt', system,
    '--tools', files.length ? 'Read' : '',
    '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'
  ]
  if (files.length) args.push('--add-dir', dir, '--allowedTools', 'Read')

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: dir, env: process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('AI 解析超时')) }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`无法启动 claude 命令行：${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.rmSync(dir, { recursive: true, force: true })
      try {
        const wrapper = JSON.parse(out)
        if (wrapper.is_error) return reject(new Error(`AI 调用失败：${wrapper.result || wrapper.subtype}`))
        resolve(wrapper.result || '')
      } catch {
        reject(new Error(`AI 调用失败（exit ${code}）：${(err || out).slice(0, 300)}`))
      }
    })
    child.stdin.end(fullPrompt)
  })
}
