// 规则分类：学到的规则（你改过的）> 科目关键字。都命中不了再交给 AI
import prisma from './prisma.js'

let cache = null
let cacheAt = 0

export function invalidateClassifier() { cache = null }

async function load() {
  if (cache && Date.now() - cacheAt < 60_000) return cache
  const [rules, categories] = await Promise.all([
    prisma.categoryRule.findMany({ include: { category: true } }),
    prisma.category.findMany({ where: { deletedAt: null } })
  ])
  cache = {
    rules: rules.sort((a, b) => b.pattern.length - a.pattern.length),
    keywords: categories.flatMap((c) =>
      (c.keywords || '').split(/[,，]/).map((k) => k.trim()).filter(Boolean).map((k) => ({ k, c }))
    ).sort((a, b) => b.k.length - a.k.length),
    categories
  }
  cacheAt = Date.now()
  return cache
}

/**
 * @returns {{ categoryId, categoryCode, isBusiness, by: 'rule'|'keyword'|null, pattern? }}
 */
export async function classify({ counterparty = '', description = '', direction = 'OUT' }) {
  const { rules, keywords } = await load()
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
export async function learnRule(pattern, categoryId, isBusiness = false) {
  const p = String(pattern || '').trim().slice(0, 100)
  if (p.length < 2 || !categoryId) return
  await prisma.categoryRule.upsert({
    where: { pattern: p },
    update: { categoryId: BigInt(categoryId), isBusiness: !!isBusiness, hits: { increment: 1 } },
    create: { pattern: p, categoryId: BigInt(categoryId), isBusiness: !!isBusiness }
  })
  invalidateClassifier()
}

export async function categoryByCode(code) {
  const { categories } = await load()
  return categories.find((c) => c.code === code) || null
}

/** 按账户名 / 别名 / 尾号找账户 */
export async function matchAccount(text) {
  if (!text) return null
  const s = String(text)
  const accounts = await prisma.account.findMany({ where: { deletedAt: null, status: 'ACTIVE' } })
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
