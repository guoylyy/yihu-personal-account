<!-- /ai 完整页：和抽屉同一条对话；桌面右侧留一列「最近 AI 录入」 -->
<template>
  <div class="ai-page">
    <AiEntry class="ai-page-chat" />
    <aside v-if="isDesktop" class="ai-page-logs">
      <div class="section-title" style="margin-top: 0">最近 AI 录入</div>
      <div class="table-card logs">
        <div v-for="l in logs" :key="l.id" class="log">
          <div class="muted" style="font-size: 12px">{{ datetime(l.createdAt) }}
            <el-tag v-if="l.hasImage" size="small" effect="plain">截图</el-tag>
            <el-tag v-if="l.committed" size="small" type="success" effect="plain">已入账 {{ l.committed.filter((c) => c.ok).length }}</el-tag>
          </div>
          <div class="log-text">{{ l.input || '（截图）' }}</div>
        </div>
        <div v-if="!logs.length" class="muted" style="padding: 12px 0">还没有记录</div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '@/api'
import AiEntry from '@/components/AiEntry.vue'
import { datetime } from '@/utils/format'
import { useViewport } from '@/composables/useViewport'
import { onAiCommitted } from '@/composables/useAiAssistant'

const { isDesktop } = useViewport()
const logs = ref([])

async function loadLogs() { logs.value = (await api.ai.logs()).list.slice(0, 12) }
onMounted(loadLogs)
onAiCommitted(loadLogs)
</script>

<style scoped>
.ai-page { display: flex; gap: 16px; height: 100%; min-height: 0; }
.ai-page-chat { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: var(--card-radius); overflow: hidden; }
.ai-page-logs { width: 300px; flex-shrink: 0; min-height: 0; overflow-y: auto; }
.logs { padding: 0 14px; }
.log { padding: 10px 0; border-bottom: 1px solid var(--border); }
.log:last-child { border-bottom: none; }
.log-text { font-size: 13px; white-space: pre-wrap; max-height: 64px; overflow: hidden; }

/* 手机：铺满主区域，输入条贴底 */
@media (max-width: 768px) {
  .ai-page { margin: -12px -12px calc(-16px - env(safe-area-inset-bottom)); height: calc(100% + 28px + env(safe-area-inset-bottom)); }
  .ai-page-chat { border: none; border-radius: 0; }
}
</style>
