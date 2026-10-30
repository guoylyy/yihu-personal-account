import express from 'express'
import multer from 'multer'
import dayjs from 'dayjs'
import prisma from '../lib/prisma.js'
import { ok, badRequest, notFound, fail, wrap } from '../lib/response.js'
import { aiStatus, llmJSON } from '../lib/llm.js'
import { parseEntry, commitItems, resolveItems, ITEM_TYPES } from '../lib/aiEntry.js'
import { balanceSheet, periodStats } from '../lib/networth.js'
import { currentUserId } from '../lib/tenant.js'
import { loadContext, applyRefs, ContextError } from '../lib/aiContext.js'
import { saveDrafts, getDraft, draftView, submitDraft } from '../lib/aiDrafts.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 6 } })
const MAX_DRAFT_ITEMS = 100

// 页面上下文：@ 越权或不存在时直接回错误（返回 null），不进模型、不出草稿
async function contextOf(res, raw) {
  try {
    return await loadContext(raw)
  } catch (e) {
    if (!(e instanceof ContextError)) throw e
    e.code === 9004 ? notFound(res, e.message) : badRequest(res, e.message)
    return null
  }
}

router.get('/status', (req, res) => ok(res, { ...aiStatus(), types: ITEM_TYPES }))

/** 解析：text + 可选截图（multipart 字段 images）+ 可选页面上下文（字段 context，JSON 串）；每条草稿落库带 draftId */
router.post('/parse', upload.array('images', 6), wrap(async (req, res) => {
  const text = String(req.body.text || '')
  const images = (req.files || [])
    .filter((f) => /^image\//.test(f.mimetype))
    .map((f) => ({ data: f.buffer, mediaType: f.mimetype }))
  if (!text.trim() && !images.length) return badRequest(res, '说点什么，或贴一张截图')
  const refs = await contextOf(res, req.body.context)
  if (!refs) return
  const r = await parseEntry({ text, images, refs })
  return ok(res, { ...r, items: await saveDrafts(r.items, { logId: r.logId }) })
}))

/** 草稿落库：items 走和 /resolve 一样的解析，再按上下文定修改目标；定不下来的不出草稿，返回 question */
router.post('/drafts', wrap(async (req, res) => {
  const items = req.body.items || (req.body.item ? [req.body.item] : [])
  if (!Array.isArray(items) || !items.length) return badRequest(res, '没有要保存的草稿')
  if (items.length > MAX_DRAFT_ITEMS) return badRequest(res, `一次最多 ${MAX_DRAFT_ITEMS} 条`)
  const refs = await contextOf(res, req.body.context)
  if (!refs) return
  const applied = await applyRefs(items, refs, '')
  const saved = await saveDrafts(await resolveItems(applied.items))
  return ok(res, { draftId: saved.length === 1 ? saved[0].draftId : undefined, items: saved, question: applied.question })
}))

router.get('/drafts/:id', wrap(async (req, res) => {
  const d = await getDraft(req.params.id)
  if (!d) return notFound(res, '草稿不存在或已过期')
  return ok(res, { ...draftView(d), payload: d.payload })
}))

/** 确认入账。body 可带用户改过的 item；不带用落库时的内容。重复提交返回第一次的结果和 duplicate: true */
router.post('/drafts/:id/submit', wrap(async (req, res) => {
  const r = await submitDraft(req.params.id, req.body?.item)
  if (r.code) return fail(res, r.code, r.message)
  return ok(res, r.data)
}))

/** 改了某条的账户/持仓名后，重新对一次 id */
router.post('/resolve', wrap(async (req, res) => ok(res, await resolveItems(req.body.items || []))))

router.post('/commit', wrap(async (req, res) => {
  const items = req.body.items || []
  if (!items.length) return badRequest(res, '没有要入账的条目')
  return ok(res, await commitItems(items, { logId: req.body.logId }))
}))

router.get('/logs', wrap(async (req, res) => {
  const list = await prisma.aiEntryLog.findMany({ where: { userId: currentUserId() }, orderBy: { id: 'desc' }, take: 50 })
  return ok(res, { list, total: list.length })
}))

/** 只读问答：把资产负债表和近 6 个月收支给模型，回答你的问题 */
router.post('/ask', wrap(async (req, res) => {
  const q = String(req.body.question || '').trim()
  if (!q) return badRequest(res, '请输入问题')
  const periods = Array.from({ length: 6 }, (_, i) => dayjs().subtract(5 - i, 'month').format('YYYY-MM'))
  const [sheet, stats, budgets] = await Promise.all([
    balanceSheet(),
    Promise.all(periods.map((p) => periodStats(p))),
    prisma.budget.findMany({ where: { year: dayjs().year(), userId: currentUserId() }, include: { category: true } })
  ])
  const context = {
    资产负债表: sheet,
    近6个月收支: stats.map((s) => ({ 月份: s.period, 收入: s.income, 个人支出: s.expense, 公司款: s.business, 科目: s.byCategory.slice(0, 12).map((c) => `${c.code}${c.name}:${c.amount}`) })),
    今年预算: budgets.map((b) => `${b.category.code}${b.category.name}: 月 ${b.monthlyAmount}`)
  }
  const r = await llmJSON({
    system: '你是用户的私人财务顾问，只根据给出的数据回答，数字要准确，不确定就说不确定。不提供具体证券买卖建议。用中文，简洁，重点加粗。输出 JSON：{"answer":"markdown 文本"}',
    prompt: `数据：${JSON.stringify(context)}\n\n问题：${q}`
  })
  return ok(res, { answer: r.data.answer || '', ms: r.ms })
}))

export default router
