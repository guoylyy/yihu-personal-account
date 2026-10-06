// 规则分类：学到的规则（你改过的）> 科目关键字。都命中不了再交给 AI
// 多租户：规则/关键字缓存与查询都按当前用户隔离
import prisma from './prisma.js'
import { resolveUid } from './tenant.js'

const caches = new Map() // userId -> { at, rules, keywords, categories }

export function invalidateClassifier() { caches.clear() }

async function load(uid) {
  const key = String(uid)
  const hit = caches.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit
  const [rules, categories] = await Promise.all([
    prisma.categoryRule.findMany({ where: { userId: uid }, include: { category: true } }),
    prisma.category.findMany({ where: { userId: uid, deletedAt: null } })
  ])
  const cache = {
    rules: rules.sort((a, b) => b.pattern.length - a.pattern.length),
    keywords: categories.flatMap((c) =>
      (c.keywords || '').split(/[,，]/).map((k) => k.trim()).filter(Boolean).map((k) => ({ k, c }))
    ).sort((a, b) => b.k.length - a.k.length),
    categories
  }
  caches.set(key, { at: Date.now(), ...cache })
  return cache
}

/**
 * @returns {{ categoryId, categoryCode, isBusiness, by: 'rule'|'keyword'|null, pattern? }}
 */
export async function classify({ counterparty = '', description = '', direction = 'OUT' }, uid) {
  const userId = resolveUid(uid)
  const { rules, keywords } = await load(userId)
  const cp = String(counterparty || '')
  const text = `${cp} ${description || ''}`
  const rule = rules.find((r) => cp && (cp === r.pattern || cp.includes(r.pattern))) ||
               rules.find((r) => r.pattern.length >= 3 && text.includes(r.pattern))
  if (rule) {
    return { categoryId: rule.categoryId, categoryCode: rule.category.code, isBusiness: rule.isBusiness, by: 'rule', pattern: rule.pattern }
  }
  const wantKind = direction === 'IN' ? 'INCOME' : 'EXPENSE'
  const kw = keywords.find(({ k, c }) => text.includes(k) && (c.kind === wantKind || c.kind === 'TRANSFER'))
  if (kw) return { categoryId: kw.c.id, categoryCode: kw.c.code, isBusiness: kw.c.code === 'C', by: 'keyword', pattern: kw.k }
  return { categoryId: null, categoryCode: null, isBusiness: false, by: null }
}

/** 记住一条分类规则（用户纠正/确认时调用） */
export async function learnRule(pattern, categoryId, isBusiness = false, uid) {
  const p = String(pattern || '').trim().slice(0, 100)
  if (p.length < 2 || !categoryId) return
  const userId = resolveUid(uid)
  await prisma.categoryRule.upsert({
    where: { userId_pattern: { userId, pattern: p } },
    update: { categoryId: BigInt(categoryId), isBusiness: !!isBusiness, hits: { increment: 1 } },
    create: { userId, pattern: p, categoryId: BigInt(categoryId), isBusiness: !!isBusiness }
  })
  invalidateClassifier()
}

export async function categoryByCode(code, uid) {
  const { categories } = await load(resolveUid(uid))
  return categories.find((c) => c.code === code) || null
}

/** 按账户名 / 别名 / 尾号找账户 */
export async function matchAccount(text, uid) {
  if (!text) return null
  const s = String(text)
  const accounts = await prisma.account.findMany({ where: { userId: resolveUid(uid), deletedAt: null, status: 'ACTIVE' } })
  let best = null
  let bestLen = 0
  for (const a of accounts) {
    const keys = [a.name, a.lastNo, ...(a.aliases || '').split(/[,，]/)].map((x) => (x || '').trim()).filter((x) => x.length >= 2)
    for (const k of keys) {
      if ((s.includes(k) || k.includes(s)) && k.length > bestLen) { best = a; bestLen = k.length }
    }
  }
  return best
}
