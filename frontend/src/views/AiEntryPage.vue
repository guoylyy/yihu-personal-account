<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">AI 记账</div>
        <div class="page-sub">像发微信一样记账：收支、转账、买卖基金股票、资产估值、还款、余额校准都可以直接说，或粘贴截图</div>
      </div>
    </div>
    <el-row :gutter="16">
      <el-col :xs="24" :lg="16"><AiEntry @committed="loadLogs" /></el-col>
      <el-col :xs="24" :lg="8">
        <div class="section-title" style="margin-top: 0">问问 AI（只读）</div>
        <div class="table-card ask">
          <el-input v-model="question" type="textarea" :rows="3" placeholder="例如：这个月钱主要花哪了？和预算比哪项超了？我的应急金够几个月？"
                    @keydown.meta.enter="ask" />
          <div style="text-align: right; margin-top: 8px">
            <el-button type="primary" plain :loading="asking" @click="ask">提问</el-button>
          </div>
          <div v-if="answer" class="answer" v-html="answer" />
        </div>

        <div class="section-title">最近 AI 录入</div>
        <div class="table-card">
          <div v-for="l in logs" :key="l.id" class="log">
            <div class="muted" style="font-size: 12px">{{ datetime(l.createdAt) }} · {{ l.provider }} · {{ (l.ms / 1000).toFixed(1) }}s
              <el-tag v-if="l.hasImage" size="small" effect="plain">截图</el-tag>
              <el-tag v-if="l.committed" size="small" type="success" effect="plain">已入账 {{ l.committed.filter((c) => c.ok).length }}</el-tag>
            </div>
            <div class="log-text">{{ l.input || '（截图）' }}</div>
          </div>
          <div v-if="!logs.length" class="muted" style="padding: 12px 0">还没有记录</div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import api from '@/api'
import AiEntry from '@/components/AiEntry.vue'
import { datetime } from '@/utils/format'

const logs = ref([])
const question = ref('')
const answer = ref('')
const asking = ref(false)

async function loadLogs() { logs.value = (await api.ai.logs()).list.slice(0, 12) }
async function ask() {
  if (!question.value.trim()) return
  asking.value = true
  try {
    const r = await api.ai.ask(question.value)
    answer.value = marked.parse(r.answer)
  } catch (e) { ElMessage.error(e.message) } finally { asking.value = false }
}
onMounted(loadLogs)
</script>

<style scoped>
.ask { padding: 12px 14px; }
.answer { margin-top: 12px; font-size: 13px; line-height: 1.8; border-top: 1px solid var(--border); padding-top: 10px; }
.answer :deep(table) { border-collapse: collapse; margin: 6px 0; }
.answer :deep(td), .answer :deep(th) { border: 1px solid var(--border); padding: 2px 8px; }
.log { padding: 10px 0; border-bottom: 1px solid var(--border); }
.log:last-child { border-bottom: none; }
.log-text { font-size: 13px; white-space: pre-wrap; max-height: 64px; overflow: hidden; }
.answer { overflow-x: auto; }
@media (max-width: 768px) {
  .answer, .log-text { font-size: 14px; }
  .log-text { max-height: 72px; }
}
</style>
