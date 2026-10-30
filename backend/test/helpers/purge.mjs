// 按 userId 硬删除用户及名下全部数据。fixtures 的 cleanup 和 run.mjs 的兜底清理共用
// 顺序按外键：先子表（草稿、成交、估值、还款、流水）后父表（持仓、资产、借贷、账户、科目），用户最后
export const TEST_USERNAME_PREFIX = 'e2e-test-'

export const TENANT_MODELS = ['aiSubmission', 'aiDraft', 'aiEntryLog', 'holdingTrade', 'assetValuation', 'loanRepayment', 'transaction', 'categoryRule', 'budget',
  'netWorthSnapshot', 'loan', 'holding', 'fixedAsset', 'account', 'category']

// AuditLog 没有 userId，只能按「实体 + id」对回去。同一张表两种写法：crud.js 写中文名，ledger.js 写英文名
const AUDIT_ENTITIES = {
  transaction: ['流水'],
  holding: ['持仓', 'holding'],
  fixedAsset: ['固定资产', 'fixedAsset'],
  loan: ['借贷', 'loan'],
  account: ['账户', 'account'],
  category: ['科目'],
  aiDraft: ['aiDraft']
}

async function auditFilters(prisma, where) {
  const filters = []
  for (const [model, entities] of Object.entries(AUDIT_ENTITIES)) {
    const rows = await prisma[model].findMany({ where, select: { id: true } })
    if (rows.length) filters.push({ entity: { in: entities }, entityId: { in: rows.map((x) => String(x.id)) } })
  }
  // 导入批次的留痕 entityId 为空，批次号写在 summary 里
  const batches = await prisma.transaction.findMany({ where: { ...where, importBatch: { not: null } }, distinct: ['importBatch'], select: { importBatch: true } })
  for (const b of batches) filters.push({ entity: '流水', summary: { contains: b.importBatch } })
  return filters
}

/** 返回删掉的审计行的过滤条件：删完 id 就查不到了，核对残留时要用 */
export async function purgeUsers(prisma, userIds) {
  const where = { userId: { in: userIds } }
  const filters = await auditFilters(prisma, where)
  if (filters.length) await prisma.auditLog.deleteMany({ where: { OR: filters } })
  for (const m of TENANT_MODELS) await prisma[m].deleteMany({ where })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  return filters
}
