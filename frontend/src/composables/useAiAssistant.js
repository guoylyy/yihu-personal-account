// 随身 AI 记账的全局状态：抽屉开合、输入内容、草稿、@ 引用、页面筛选
// 放在模块级而不是组件里：切换页面、抽屉和 /ai 完整页来回切时草稿都还在；退出登录必须 resetAi，否则下一个人会看到上一个人的草稿
import { ref, watch, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'

export const drawerOpen = ref(false)
export const everOpened = ref(false) // 第一次打开才挂载，之后只显隐
export const text = ref('')
export const images = ref([])
export const items = ref([])
export const meta = ref({})
export const question = ref('')
export const pinned = ref([]) // [{ type, id, label }]
export const pageFilters = ref({})
export const committedTick = ref(0) // 每次入账 +1，列表页据此刷新

const MAX_PINS = 10

export function openDrawer() { everOpened.value = true; drawerOpen.value = true }
export function closeDrawer() { drawerOpen.value = false }
export function toggleDrawer() { drawerOpen.value ? closeDrawer() : openDrawer() }

export const isPinned = (type, id) => pinned.value.some((p) => p.type === type && p.id === String(id))

/** 列表上的 @：把记录放进引用，并打开抽屉 */
export function pin(type, id, label) {
  if (!isPinned(type, id)) {
    if (pinned.value.length >= MAX_PINS) return ElMessage.warning(`一次最多引用 ${MAX_PINS} 条`)
    pinned.value.push({ type, id: String(id), label })
  }
  openDrawer()
}
export function unpin(p) { pinned.value = pinned.value.filter((x) => x !== p) }

/** 传给后端的上下文：只有 type + id，记录内容由服务端重新查 */
export const aiContext = (route) => ({
  route: route.path,
  filters: pageFilters.value,
  pinned: pinned.value.map(({ type, id }) => ({ type, id }))
})

export function resetAi() {
  images.value.forEach((img) => URL.revokeObjectURL(img.url))
  text.value = ''
  question.value = ''
  images.value = []
  items.value = []
  meta.value = {}
  pinned.value = []
  pageFilters.value = {}
  drawerOpen.value = false
  everOpened.value = false
}

/** 页面把自己的筛选报给抽屉；页面被 keep-alive 收起时撤掉，免得别的页面带上这里的筛选 */
export function useAiPageContext(getter) {
  let active = false
  const sync = () => { if (active) pageFilters.value = { ...getter() } }
  watch(getter, sync, { deep: true })
  onActivated(() => { active = true; sync() })
  const leave = () => { if (active) { active = false; pageFilters.value = {} } }
  onDeactivated(leave)
  onBeforeUnmount(leave)
}

/** 抽屉里入账后刷新当前列表（抽屉不关，页面要跟着变） */
export function onAiCommitted(fn) { watch(committedTick, () => fn()) }
