<!--
  随身 AI 记账：挂在 Layout 上，不随路由销毁，切页面时草稿还在
  宽屏（≥1280）贴右侧、把主内容挤窄，列表上的 @ 还点得到；平板盖在内容上；手机全屏 sheet
-->
<template>
  <transition name="ai-slide">
    <aside v-if="everOpened" v-show="drawerOpen" class="ai-drawer" :class="{ 'is-sheet': isMobile, 'is-dock': docked }"
           :style="isMobile ? {} : { width: `${width}px` }" role="complementary" aria-label="AI 记账">
      <div v-if="!isMobile" class="resizer" title="拖动调整宽度" @pointerdown="startResize" />
      <header class="ai-head">
        <div v-if="isMobile" class="handle-zone" @pointerdown="startSwipe"><span class="handle" /></div>
        <div class="ai-head-row">
          <span class="ai-title">AI 记账</span>
          <el-button link class="ai-full" @click="openFull">在完整页面打开</el-button>
          <el-button text circle class="ai-close" aria-label="关闭 AI 记账" @click="closeDrawer">
            <el-icon :size="18"><Close /></el-icon>
          </el-button>
        </div>
      </header>
      <div v-if="contextLine || pinned.length" class="ai-context">
        <div v-if="contextLine" class="ctx-line muted">{{ contextLine }}</div>
        <div v-if="pinned.length" class="pins">
          <span class="muted">已引用：</span>
          <el-tag v-for="p in pinned" :key="`${p.type}${p.id}`" class="pin-tag" closable effect="plain" size="small" @close="unpin(p)">{{ p.label }}</el-tag>
        </div>
      </div>
      <AiEntry compact class="ai-drawer-body" />
    </aside>
  </transition>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AiEntry from './AiEntry.vue'
import { useViewport } from '@/composables/useViewport'
import { accounts } from '@/composables/useMeta'
import { everOpened, drawerOpen, closeDrawer, pinned, pageFilters, unpin } from '@/composables/useAiAssistant'

const WIDTH_KEY = 'pf_ai_drawer_width'
const MIN_W = 360
const MAX_W = 720
const DOCK_MIN = 1280

const route = useRoute()
const router = useRouter()
const { isMobile } = useViewport()
const width = ref(Math.min(MAX_W, Math.max(MIN_W, Number(localStorage.getItem(WIDTH_KEY)) || 420)))

const mqDock = window.matchMedia(`(min-width: ${DOCK_MIN}px)`)
const wide = ref(mqDock.matches)
const onDock = () => { wide.value = mqDock.matches }
mqDock.addEventListener('change', onDock)
onBeforeUnmount(() => mqDock.removeEventListener('change', onDock))
const docked = computed(() => wide.value && !isMobile.value)

const SCOPE_LABEL = { personal: '个人', business: '公司款', transfer: '转移' }
const contextLine = computed(() => {
  const f = pageFilters.value
  const parts = [route.meta.title]
  if (f.period) parts.push(f.period)
  if (f.account_id) parts.push(accounts.value.find((a) => String(a.id) === String(f.account_id))?.name || '已选账户')
  if (f.scope) parts.push(SCOPE_LABEL[f.scope])
  return parts.filter(Boolean).length > 1 ? `当前：${parts.join(' · ')}` : ''
})

function openFull() {
  closeDrawer()
  router.push('/ai')
}

function startResize(e) {
  e.preventDefault()
  const onMove = (ev) => { width.value = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX)) }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    localStorage.setItem(WIDTH_KEY, String(width.value))
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// 顶部把手下拉收起
function startSwipe(e) {
  const y0 = e.clientY
  const onUp = (ev) => {
    window.removeEventListener('pointerup', onUp)
    if (ev.clientY - y0 > 60) closeDrawer()
  }
  window.addEventListener('pointerup', onUp)
}
</script>

<style scoped>
.ai-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 1500; max-width: 100vw;
  display: flex; flex-direction: column; background: var(--bg); border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, .06);
}
.ai-drawer.is-dock { position: relative; z-index: 1; flex-shrink: 0; height: 100%; box-shadow: none; }
.ai-drawer.is-sheet { left: 0; width: 100%; height: 100dvh; border-left: none; padding-bottom: env(safe-area-inset-bottom); }
.resizer { position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; cursor: col-resize; z-index: 2; touch-action: none; }
.resizer:hover { background: var(--accent); opacity: .3; }
.ai-head { background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ai-head-row { display: flex; align-items: center; gap: 8px; height: 55px; padding: 0 8px 0 16px; }
.ai-title { font-size: 15px; font-weight: 600; flex: 1; }
.ai-full { font-size: 13px; }
.ai-context { padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; font-size: 12px; }
.pins { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ctx-line + .pins { margin-top: 6px; }
.pin-tag { max-width: 100%; }
.pin-tag :deep(.el-tag__content) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-drawer-body { flex: 1; min-height: 0; }

.ai-slide-enter-active, .ai-slide-leave-active { transition: transform .22s ease; }
.ai-slide-enter-from, .ai-slide-leave-to { transform: translateX(100%); }

@media (max-width: 768px) {
  .ai-slide-enter-from, .ai-slide-leave-to { transform: translateY(100%); }
  .ai-head { padding-top: env(safe-area-inset-top); }
  .handle-zone { display: flex; justify-content: center; align-items: center; height: 18px; touch-action: none; cursor: grab; }
  .handle { width: 40px; height: 4px; border-radius: 2px; background: var(--border-strong); }
  .ai-head-row { height: 48px; padding-left: 14px; }
  .ai-title { font-size: 16px; }
  .ai-full { font-size: 14px; min-height: 44px; min-width: 44px; }
  .ai-close { width: 44px; height: 44px; }
  .ai-context { font-size: 14px; }
  .pin-tag { font-size: 14px; height: auto; min-height: 44px; }
  .pin-tag :deep(.el-tag__close) { width: 44px; height: 44px; font-size: 16px; }
}
</style>
