// AI 草稿的落库与「确认提交」，这里挡住重复入账：
//   1. 同一张草稿：提交成功后记下 submittedAt + 业务 id，之后再提交一律返回第一次的结果；并发两次由草稿锁排队
//   2. 不同草稿、内容相同：按指纹认领，唯一索引挡并发；60 秒内同指纹再提交返回第一次的结果，超过 60 秒视为新的一笔
//   3. 失败（越权、账户不存在、缺字段）不标记已提交，改好可以再提交
// 一次多笔里两笔一样的账不算重复：指纹里带 batchSeq（同批第几条相同内容），同一批重新解析时仍能和上一次一一对上
import crypto from 'node:crypto'
import dayjs from 'dayjs'
import prisma from './prisma.js'
import { resolveUid } from './tenant.js'
import { logAudit } from './audit.js'
import { round2 } from './money.js'
import { commitOne, missingOf, ITEM_TYPES, MISSING_LABELS, SIGNED_AMOUNT } from './aiEntry.js'
import { UPDATE_TYPES, isUpdateType } from './aiMaster.js'

export const DUP_WINDOW_MS = 60_000
const WAIT_MS = 15_000
const POLL_MS = 100
const ID_RE = /^[1-9]\d{0,18}$/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

// 只有写进账本的字段算内容：把握度、备注、警告这些每次解析都可能不同，不能影响判重
const CONTENT_FIELDS = {
  transaction: ['date', 'direction', 'amount', 'accountId', 'categoryId', 'counterparty', 'description', 'isBusiness', 'businessOrg'],
  transfer: ['date', 'amount', 'accountId', 'toAccountId', 'description'],
  trade: ['date', 'holdingId', 'action', 'quantity', 'price', 'amount', 'fee', 'accountId'],
  holding_valuation: ['date', 'holdingId', 'price', 'amount'],
  asset_valuation: ['date', 'assetId', 'amount', 'description'],
  balance: ['date', 'accountId', 'amount'],
  loan_repay: ['date', 'loanId', 'principal', 'interest', 'accountId'],
  new_loan: ['date', 'direction', 'counterparty', 'amount', 'kind', 'monthlyPayment', 'annualRate', 'dueDate', 'description'],
  new_holding: ['date', 'holding', 'holdingType', 'code', 'platform', 'quantity', 'price', 'amount', 'accountId'],
  update_transaction: ['date', 'direction', 'amount', 'accountId', 'categoryId', 'counterparty', 'description', 'isBusiness', 'businessOrg'],
  new_asset: ['date', 'assetName', 'assetType', 'amount', 'purchasePrice', 'address', 'description'],
  new_account: ['date', 'accountName', 'accountType', 'institution', 'lastNo', 'amount', 'creditLimit', 'billDay', 'repayDay'],
  set_budget: ['categoryId', 'year', 'monthly', 'annual'],
  ...Object.fromEntries(Object.entries(UPDATE_TYPES).map(([type, cfg]) => [type, Object.keys(cfg.fields)]))
}
const NUMERIC = new Set(['amount', 'quantity', 'price', 'fee', 'principal', 'interest', 'purchasePrice', 'creditLimit', 'billDay', 'repayDay', 'monthly', 'annual', 'year', 'monthlyPayment', 'annualRate'])

/** 规范化：键排序；空值、false 不影响写入结果，一律去掉；字符串去首尾空格 */
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical)
  if (isPlainObject(v)) {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      const x = canonical(v[k])
      if (x === undefined || x === null || x === '' || x === false) continue
      out[k] = x
    }
    return out
  }
  if (typeof v === 'string') return v.trim()
  return v
}

/** 草稿里真正入账的内容：'45.00'、45、45.0 是同一个金额，id 一律字符串 */
export function contentOf(item) {
  const out = {}
  for (const k of CONTENT_FIELDS[item.type] || []) {
    const v = item[k]
    if (v === undefined || v === null || v === '') continue
    out[k] = NUMERIC.has(k) ? Number(v) : k.endsWith('Id') ? String(v) : v
  }
  return out
}

export function fingerprint({ type, userId, targetId, item, batchSeq = 0 }) {
  const content = canonical({ ...contentOf({ ...item, type }), targetId: targetId != null ? String(targetId) : null, batchSeq: batchSeq || null })
  return crypto.createHash('sha256').update([type, String(userId), JSON.stringify(content)].join('|')).digest('hex')
}

export function draftView(d) {
  return {
    draftId: String(d.id),
    type: d.type,
    targetId: d.targetId != null ? String(d.targetId) : null,
    status: d.submittedAt ? 'SUBMITTED' : 'PENDING',
    submitted: !!d.submittedAt,
    submittedAt: d.submittedAt,
    id: d.resultId,
    code: d.resultCode,
    duplicateOf: d.duplicateOf != null ? String(d.duplicateOf) : null
  }
}

/** 解析结果落库，draftId 挂到每一条上给前端 */
export async function saveDrafts(items, { logId } = {}) {
  const userId = resolveUid()
  const seen = new Map()
  const out = []
  for (const it of items) {
    const key = JSON.stringify(canonical({ type: it.type, targetId: it.targetId, ...contentOf(it) }))
    const batchSeq = seen.get(key) || 0
    seen.set(key, batchSeq + 1)
    const row = await prisma.aiDraft.create({
      data: { userId, type: it.type, targetId: it.targetId ? BigInt(it.targetId) : null, payload: it, batchSeq, logId: logId ? BigInt(logId) : null }
    })
    out.push({ ...it, draftId: String(row.id) })
  }
  return out
}

export async function getDraft(id) {
  if (!ID_RE.test(String(id))) return null
  return prisma.aiDraft.findFirst({ where: { id: BigInt(id), userId: resolveUid() } }) // 只能碰自己的草稿
}

/** 草稿锁：拿到返回 true；拿不到说明同一张草稿正在被另一个请求提交 */
async function lockDraft(id) {
  const now = new Date()
  const r = await prisma.aiDraft.updateMany({
    where: { id, submittedAt: null, OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - DUP_WINDOW_MS) } }] },
    data: { lockedAt: now }
  })
  return r.count === 1
}

/**
 * 认领指纹：直接插入，唯一索引保证同一时刻只有一个请求能拿到；冲突再回查已有那行
 * 返回 { own: row } 自己负责入账；{ duplicate: row } 60 秒内已成功提交过；{ error } 前一个还在处理中
 */
async function claimFingerprint(fp, draft, userId) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const now = new Date()
    try {
      const row = await prisma.aiSubmission.create({ data: { fingerprint: fp, userId, draftId: draft.id, type: draft.type, status: 'PENDING', claimedAt: now } })
      return { own: row }
    } catch (e) {
      if (e?.code !== 'P2002') throw e
    }
    const ex = await prisma.aiSubmission.findUnique({ where: { fingerprint: fp } })
    if (!ex) continue
    const fresh = Date.now() - ex.claimedAt.getTime() < DUP_WINDOW_MS
    if (ex.status === 'DONE' && fresh) return { duplicate: ex }
    if (ex.status === 'PENDING' && fresh) {
      if (Date.now() > deadline) return { error: '同样内容的上一次提交仍在处理中，请稍后再试' }
      await sleep(POLL_MS)
      continue
    }
    // 上次失败了，或已过 60 秒窗口：接管这一行。条件更新保证并发接管时只有一个成功
    const r = await prisma.aiSubmission.updateMany({
      where: { id: ex.id, status: ex.status, claimedAt: ex.claimedAt },
      data: { status: 'PENDING', userId, draftId: draft.id, type: draft.type, resultId: null, resultCode: null, claimedAt: now }
    })
    if (r.count === 1) return { own: { ...ex, status: 'PENDING', draftId: draft.id, claimedAt: now } }
  }
}

// 请求体可带用户改过的内容；类型可在收支类之间切换，但修改目标只认落库的
function itemOf(draft, body) {
  const edited = isPlainObject(body) ? body : draft.payload
  const type = isUpdateType(draft.type) ? draft.type : edited.type || draft.type
  if (!ITEM_TYPES[type]) return { error: `不支持的类型：${type}` }
  if (isUpdateType(type) && draft.type !== type) return { error: '不能把这张草稿改成修改操作，请重新解析' }
  const item = { ...edited, type, targetId: draft.targetId != null ? String(draft.targetId) : undefined }
  if (item.date && dayjs(item.date).isValid()) item.date = dayjs(item.date).format('YYYY-MM-DD')
  if (item.amount != null && item.amount !== '' && !SIGNED_AMOUNT.has(type)) item.amount = round2(Math.abs(Number(item.amount)))
  return { item }
}

async function recordLog(logId, entry) {
  if (!logId) return
  const log = await prisma.aiEntryLog.findFirst({ where: { id: logId, userId: resolveUid() }, select: { committed: true } })
  if (log) await prisma.aiEntryLog.update({ where: { id: logId }, data: { committed: [...(Array.isArray(log.committed) ? log.committed : []), entry] } })
}

/**
 * @returns {{ data?: object, code?: number, message?: string }} data 是成功（含重复提交的幂等返回）；code + message 是业务错误
 */
export async function submitDraft(id, body) {
  const userId = resolveUid()
  const fail = (code, message) => ({ code, message })
  const dupView = (d) => ({ ...draftView(d), duplicate: true, originalId: d.resultId, originalDraftId: String(d.duplicateOf ?? d.id) })

  let draft = await getDraft(id)
  if (!draft) return fail(9004, '草稿不存在或已过期，请重新解析')
  if (draft.submittedAt) return { data: dupView(draft) }

  // 同一张草稿并发：后到的等前一个出结果
  if (!(await lockDraft(draft.id))) {
    const deadline = Date.now() + WAIT_MS
    for (;;) {
      await sleep(POLL_MS)
      draft = await getDraft(id)
      if (draft.submittedAt) return { data: dupView(draft) }
      if (await lockDraft(draft.id)) break
      if (Date.now() > deadline) return fail(9002, '这张草稿正在提交中，请稍后刷新查看')
    }
  }
  const unlock = () => prisma.aiDraft.update({ where: { id: draft.id }, data: { lockedAt: null } })

  let sub = null
  let done = false
  try {
    const { item, error } = itemOf(draft, body)
    if (error) { await unlock(); return fail(9002, error) }
    const missing = missingOf(item)
    if (missing.length) { await unlock(); return fail(9002, `还缺：${missing.map((k) => MISSING_LABELS[k] || k).join('、')}`) }

    const fp = fingerprint({ type: item.type, userId, targetId: draft.targetId, item, batchSeq: draft.batchSeq })
    const claim = await claimFingerprint(fp, draft, userId)
    if (claim.error) { await unlock(); return fail(9002, claim.error) }
    if (claim.duplicate) {
      // 内容相同的另一张草稿 60 秒内刚提交过：这张也标成已提交，指向第一次的结果
      const s = claim.duplicate
      const updated = await prisma.aiDraft.update({
        where: { id: draft.id },
        data: { type: item.type, payload: item, submittedAt: new Date(), resultId: s.resultId, resultCode: s.resultCode, duplicateOf: s.draftId, lockedAt: null }
      })
      return { data: dupView(updated) }
    }

    sub = claim.own
    let res
    try {
      res = await commitOne(item)
    } catch (e) {
      // 业务校验没过：放开指纹和草稿锁，改好了可以再提交
      await prisma.aiSubmission.updateMany({ where: { id: sub.id, claimedAt: sub.claimedAt }, data: { status: 'FAILED' } })
      await unlock()
      return fail(9002, e.message || '入账失败')
    }
    const resultId = res.id != null ? String(res.id) : null
    const resultCode = String(res.ref ?? '').slice(0, 120) || null
    await prisma.aiSubmission.update({ where: { id: sub.id }, data: { status: 'DONE', resultId, resultCode } })
    done = true
    const updated = await prisma.aiDraft.update({
      where: { id: draft.id },
      data: { type: item.type, payload: item, submittedAt: new Date(), resultId, resultCode, lockedAt: null }
    })
    await recordLog(draft.logId, { ok: true, type: item.type, ref: resultCode }).catch(() => {})
    await logAudit({ action: 'AI_SUBMIT', entity: 'aiDraft', entityId: draft.id, summary: `AI 入账 ${item.type}：${resultCode || resultId || '-'}` })
    return { data: { ...draftView(updated), duplicate: false, originalId: null, originalDraftId: null } }
  } catch (e) {
    // 中途异常：没写成就放开指纹，免得同样内容被「处理中」卡 60 秒
    if (sub && !done) await prisma.aiSubmission.updateMany({ where: { id: sub.id, claimedAt: sub.claimedAt }, data: { status: 'FAILED' } }).catch(() => {})
    await unlock().catch(() => {})
    throw e
  }
}
