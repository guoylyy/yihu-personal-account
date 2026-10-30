// 随身 AI 记账的全局状态：抽屉开合、输入内容、对话（草稿挂在消息上）、@ 引用、页面筛选
// 放在模块级而不是组件里：切换页面、抽屉和 /ai 完整页来回切时对话都还在；退出登录必须 resetAi，否则下一个人会看到上一个人的草稿
import { ref, computed, watch, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'

export const drawerOpen = ref(false)
export const everOpened = ref(false) // 第一次打开才挂载，之后只显隐
export const text = ref('')
export const images = ref([])
export const messages = ref([]) // [{ id, role, content, html?, images?, drafts?, warn? }]
export const sending = ref('') // 请求中的占位文案，空串表示空闲；抽屉和完整页共用，防止两边同时发
export const clarify = ref(null) // 等用户回答的反问：{ text, images, msg }，下一句话会和原话合并重新识别
export const session = ref(0) // 每次清空 +1：退出登录时还在路上的响应，回来后不能写进下一个人的对话
export const pinned = ref([]) // [{ type, id, label }]
export const pageFilters = ref({})
export const committedTick = ref(0) // 每次入账 +1，列表页据此刷新

const MAX_PINS = 10
let seq = 0
export const nextId = () => ++seq

export const pendingDrafts = computed(() => messages.value.flatMap((m) => m.drafts || []).filter((d) => !d._done))

/** 加一条消息，返回响应式的那一份（之后改它的 drafts 才能触发更新） */
export function addMessage(m) {
  messages.value.push({ id: nextId(), ...m })
  return messages.value[messages.value.length - 1]
}

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

export function clearConversation() {
  messages.value.forEach((m) => m.images?.forEach((img) => URL.revokeObjectURL(img.url)))
  messages.value = []
  clarify.value = null
  sending.value = ''
  session.value++
}

export function resetAi() {
  clearConversation()
  images.value.forEach((img) => URL.revokeObjectURL(img.url))
  text.value = ''
  images.value = []
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
