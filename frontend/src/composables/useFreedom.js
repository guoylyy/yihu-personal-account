// 自由天数的全局缓存：流水、预算、草稿卡的「≈ N 天」都用这一份。口径在后端 lib/freedom.js，这里不重算
import { ref } from 'vue'
import api from '@/api'

const SHOW_KEY = 'pf_show_cost_days'

export const freedom = ref(null)
export const showCost = ref(localStorage.getItem(SHOW_KEY) !== '0')

export function setShowCost(v) {
  showCost.value = v
  localStorage.setItem(SHOW_KEY, v ? '1' : '0')
}

export const setFreedom = (f) => { freedom.value = f || null }

// 先清空：换账号登录时不能留着上一本账的数字
export async function loadFreedom() {
  freedom.value = null
  freedom.value = await api.freedom.get()
}

/** 这笔相当于几天：只给弹性支出，不到 1 天或状态不正常时返回 0 */
export function costDays(amount, group) {
  const f = freedom.value
  if (!showCost.value || group !== '弹性' || f?.state !== 'OK') return 0
  return Math.floor(Number(amount) / f.daily.living)
}

/** 不足 365 天显示天，否则显示年；向下取整，和后端一致 */
export const durationText = (d) => (d < 365 ? `${d} 天` : `${Math.floor(d / 36.5) / 10} 年`)
