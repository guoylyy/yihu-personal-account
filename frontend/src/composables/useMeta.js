// 账户 / 科目缓存：下拉框到处要用，统一取一次
import { ref } from 'vue'
import api from '@/api'

export const accounts = ref([])
export const categories = ref([])
let loaded = false

export async function loadMeta(force = false) {
  if (loaded && !force) return
  const [a, c] = await Promise.all([api.accounts.list({ page_size: 200 }), api.categories.list({ page_size: 200 })])
  accounts.value = a.list
  categories.value = c.list
  loaded = true
}

export const accountOptions = () => accounts.value.filter((a) => a.status === 'ACTIVE').map((a) => ({ value: String(a.id), label: a.name }))
export const categoryOptions = (kind) =>
  categories.value.filter((c) => !kind || c.kind === kind).map((c) => ({ value: String(c.id), label: `${c.code} ${c.name}` }))
export const categoryGroups = () => {
  const groups = {}
  for (const c of categories.value) (groups[c.groupName || '其他'] ||= []).push({ value: String(c.id), label: `${c.code} ${c.name}`, code: c.code })
  return Object.entries(groups).map(([label, options]) => ({ label, options }))
}
