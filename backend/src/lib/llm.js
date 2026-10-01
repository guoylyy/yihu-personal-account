// 大模型调用封装：AI 录入 / 分类 / 问答都走这里
// 三种模式（.env 的 AI_PROVIDER）：
//   claude-cli  默认。复用本机已登录的 `claude` 命令行，不需要 API Key；图片会落临时文件让它用 Read 工具看
//   anthropic   用 ANTHROPIC_API_KEY 直连 Messages API（更快，适合部署到服务器）
//   off         不调模型，只用规则解析（lib/ruleParser.js）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'

// 没配 AI_PROVIDER 时：有 API Key 用 anthropic；部署在以虎 One 的容器里没有 claude 命令行，关掉；本机默认 claude-cli
export const provider = () => (process.env.AI_PROVIDER ||
  (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'anthropic' : process.env.YH_CLIENT_ID ? 'off' : 'claude-cli')).toLowerCase()

export function aiStatus() {
  const p = provider()
  if (p === 'off') return { enabled: false, provider: p, hint: 'AI 已关闭，只用规则解析' }
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
export async function llmJSON({ system, prompt, images = [], timeoutMs = 120000 }) {
  const p = provider()
  const t0 = Date.now()
  if (p === 'off') throw new Error('AI 未开启（AI_PROVIDER=off）')
  const text = p === 'anthropic'
    ? await viaApi({ system, prompt, images })
    : await viaCli({ system, prompt, images, timeoutMs })
  return { data: extractJSON(text), provider: p, ms: Date.now() - t0 }
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

function viaCli({ system, prompt, images, timeoutMs }) {
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
