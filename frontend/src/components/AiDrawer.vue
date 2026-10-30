<!--
  随身 AI 记账：挂在 Layout 上，不随路由销毁，切页面时对话和草稿都还在
  宽屏（≥1280）贴右侧、把主内容挤窄，列表上的 @ 还点得到；平板盖在内容上；手机全屏 sheet
  /ai 完整页就是同一条对话，在那个页面上抽屉让位
-->
<template>
  <transition name="ai-slide">
    <aside v-if="everOpened" v-show="drawerOpen && route.path !== '/ai'" class="ai-drawer" :class="{ 'is-sheet': isMobile, 'is-dock': docked }"
           :style="isMobile ? {} : { width: `${width}px` }" role="complementary" aria-label="AI 记账">
      <div v-if="!isMobile" class="resizer" title="拖动调整宽度" @pointerdown="startResize" />
      <AiEntry compact class="ai-drawer-body" @close="closeDrawer">
        <template #handle>
          <div v-if="isMobile" class="handle-zone" @pointerdown="startSwipe"><span class="handle" /></div>
        </template>
      </AiEntry>
    </aside>
  </transition>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import AiEntry from './AiEntry.vue'
import { useViewport } from '@/composables/useViewport'
import { everOpened, drawerOpen, closeDrawer } from '@/composables/useAiAssistant'

const WIDTH_KEY = 'pf_ai_drawer_width'
const MIN_W = 360
const MAX_W = 720
const DOCK_MIN = 1280

const route = useRoute()
const { isMobile } = useViewport()
const width = ref(Math.min(MAX_W, Math.max(MIN_W, Number(localStorage.getItem(WIDTH_KEY)) || 420)))

const mqDock = window.matchMedia(`(min-width: ${DOCK_MIN}px)`)
const wide = ref(mqDock.matches)
const onDock = () => { wide.value = mqDock.matches }
mqDock.addEventListener('change', onDock)
onBeforeUnmount(() => mqDock.removeEventListener('change', onDock))
const docked = computed(() => wide.value && !isMobile.value)

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
  display: flex; flex-direction: column; background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, .06);
}
.ai-drawer.is-dock { position: relative; z-index: 1; flex-shrink: 0; height: 100%; box-shadow: none; }
.ai-drawer.is-sheet { left: 0; width: 100%; height: 100dvh; border-left: none; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); box-sizing: border-box; }
.resizer { position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; cursor: col-resize; z-index: 2; touch-action: none; }
.resizer:hover { background: var(--accent); opacity: .3; }
.ai-drawer-body { flex: 1; min-height: 0; }

.ai-slide-enter-active, .ai-slide-leave-active { transition: transform .22s ease; }
.ai-slide-enter-from, .ai-slide-leave-to { transform: translateX(100%); }

@media (max-width: 768px) {
  .ai-slide-enter-from, .ai-slide-leave-to { transform: translateY(100%); }
  .handle-zone { display: flex; justify-content: center; align-items: center; height: 18px; touch-action: none; cursor: grab; }
  .handle { width: 40px; height: 4px; border-radius: 2px; background: var(--border-strong); }
}
</style>
