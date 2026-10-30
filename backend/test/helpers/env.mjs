// 必须最先引入：库名不对直接抛错，app 启动时不能走真实模型
import { checkTestDatabase } from './guard.mjs'

const guard = checkTestDatabase()
if (!guard.ok) throw new Error(guard.message)
if (guard.warning) console.warn(guard.warning)

process.env.AI_PROVIDER = 'stub'
