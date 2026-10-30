// 后端 API 封装：统一带 token、统一解包 { code, message, data }（沿用集团系统写法）
import { BASE } from './base.js'
const TOKEN_KEY = 'pf_token'
const USER_KEY = 'pf_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const getUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null } }
export const setUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u))
export const clearAuth = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY) }

function qs(params = {}) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.append(k, v)
  const str = s.toString()
  return str ? `?${str}` : ''
}

async function request(url, options = {}) {
  const isForm = options.body instanceof FormData
  const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout || 30000)
  let res
  try {
    res = await fetch(url, { ...options, headers, signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    throw new Error(e.name === 'AbortError' ? '请求超时，请稍后重试' : '网络异常，请检查后端服务是否已启动')
  }
  clearTimeout(timer)
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) {
    if (res.status === 401) { clearAuth(); if (!location.pathname.endsWith('/login')) location.href = `${BASE}/login` }
    throw new Error(data.message || `请求失败（HTTP ${res.status}）`)
  }
  return data.data
}

const get = (url, params) => request(url + qs(params))
const post = (url, body, opt = {}) => request(url, { method: 'POST', body: JSON.stringify(body || {}), ...opt })
const put = (url, body) => request(url, { method: 'PUT', body: JSON.stringify(body || {}) })
const del = (url) => request(url, { method: 'DELETE' })
const upload = (url, formData, timeout = 120000) => request(url, { method: 'POST', body: formData, timeout })

const crud = (base) => ({
  list: (p) => get(base, p),
  get: (id) => get(`${base}/${id}`),
  create: (b) => post(base, b),
  update: (id, b) => put(`${base}/${id}`, b),
  remove: (id) => del(`${base}/${id}`)
})

const B = `${BASE}/api/pf`
const AI_TIMEOUT = 180000

export const api = {
  health: () => get(`${BASE}/api/health`),
  auth: {
    login: (b) => post(`${BASE}/api/auth/login`, b),
    mode: () => get(`${BASE}/api/auth/mode`),
    me: () => get(`${BASE}/api/auth/me`),
    changePassword: (b) => post(`${BASE}/api/auth/change-password`, b)
  },
  accounts: {
    ...crud(`${B}/accounts`),
    calibrate: (id, b) => post(`${B}/accounts/${id}/calibrate`, b),
    transfer: (b) => post(`${B}/accounts/transfer`, b)
  },
  categories: {
    ...crud(`${B}/categories`),
    rules: () => get(`${B}/categories/rules`),
    addRule: (b) => post(`${B}/categories/rules`, b),
    removeRule: (id) => del(`${B}/categories/rules/${id}`)
  },
  transactions: {
    ...crud(`${B}/transactions`),
    batch: (b) => post(`${B}/transactions/batch`, b),
    importPreview: (fd) => upload(`${B}/transactions/import/preview`, fd),
    aiClassify: (rows) => post(`${B}/transactions/import/ai-classify`, { rows }, { timeout: AI_TIMEOUT }),
    importCommit: (b) => post(`${B}/transactions/import/commit`, b, { timeout: 120000 }),
    batches: () => get(`${B}/transactions/import/batches`),
    undoBatch: (batch) => del(`${B}/transactions/import/${batch}`)
  },
  holdings: {
    ...crud(`${B}/holdings`),
    overview: (p) => get(`${B}/holdings/overview`, p),
    trades: (id) => get(`${B}/holdings/${id}/trades`),
    trade: (id, b) => post(`${B}/holdings/${id}/trade`, b)
  },
  assets: {
    ...crud(`${B}/assets`),
    valuations: (id) => get(`${B}/assets/${id}/valuations`),
    valuate: (id, b) => post(`${B}/assets/${id}/valuation`, b)
  },
  loans: {
    ...crud(`${B}/loans`),
    repayments: (id) => get(`${B}/loans/${id}/repayments`),
    repay: (id, b) => post(`${B}/loans/${id}/repay`, b)
  },
  budgets: {
    list: (p) => get(`${B}/budgets`, p),
    save: (year, items) => put(`${B}/budgets/${year}`, { items }),
    execution: (p) => get(`${B}/budgets/execution`, p)
  },
  dashboard: { get: (p) => get(`${B}/dashboard`, p) },
  freedom: {
    get: () => get(`${B}/freedom`),
    simulate: (p) => get(`${B}/freedom/simulate`, p)
  },
  close: {
    checklist: (p) => get(`${B}/close/checklist`, p),
    summary: (p) => get(`${B}/close/summary`, p),
    snapshot: (b) => post(`${B}/close/snapshot`, b),
    snapshots: () => get(`${B}/close/snapshots`)
  },
  ai: {
    status: () => get(`${B}/ai/status`),
    parse: (fd) => upload(`${B}/ai/parse`, fd, AI_TIMEOUT),
    resolve: (items) => post(`${B}/ai/resolve`, { items }),
    commit: (b) => post(`${B}/ai/commit`, b, { timeout: 60000 }),
    submitDraft: (id, item) => post(`${B}/ai/drafts/${id}/submit`, { item }, { timeout: 60000 }),
    logs: () => get(`${B}/ai/logs`),
    ask: (question) => post(`${B}/ai/ask`, { question }, { timeout: AI_TIMEOUT })
  }
}
export default api
