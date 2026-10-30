// 当前版本号：后端 /api/health 返回，前端不写死。取不到就是空串，界面不渲染
import { ref } from 'vue'
import api from '@/api'

export const appVersion = ref('')

export async function loadAppVersion() {
  if (appVersion.value) return
  const { version } = await api.health()
  appVersion.value = version || ''
}
