<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">月结与净资产</div>
        <div class="page-sub">每月最后一天：过一遍检查清单 → 生成净资产快照 → 复制月结摘要贴回 Obsidian「06.家庭个人」</div>
      </div>
      <el-select v-model="period" style="width: 120px" @change="load"><el-option v-for="p in periodOptions(18)" :key="p" :label="p" :value="p" /></el-select>
    </div>

    <el-row :gutter="14">
      <el-col :xs="24" :lg="10">
        <div class="section-title" style="margin-top: 0">月结检查</div>
        <div class="table-card checks">
          <div v-for="c in checks" :key="c.key" class="check" @click="router.push(c.link)">
            <el-icon :class="c.ok ? 'money-in' : 'accent-warn'" :size="18"><CircleCheckFilled v-if="c.ok" /><WarningFilled v-else /></el-icon>
            <div style="flex: 1">
              <div>{{ c.title }}</div>
              <div class="muted" style="font-size: 12px">{{ c.detail }}</div>
            </div>
            <el-icon class="muted"><ArrowRight /></el-icon>
          </div>
          <el-button type="primary" style="width: 100%; margin-top: 12px" :loading="saving" @click="snapshot">生成 {{ period }} 净资产快照</el-button>
          <div class="muted" style="font-size: 12px; margin-top: 6px">快照取「当前」的余额与估值，建议在月末当天生成；重复生成会覆盖当月</div>
        </div>
      </el-col>
      <el-col :xs="24" :lg="14">
        <div class="section-title" style="margin-top: 0">
          月结摘要（Markdown）
          <el-button link type="primary" style="margin-left: auto" @click="copy">复制</el-button>
        </div>
        <div class="table-card md" v-html="html" />
      </el-col>
    </el-row>

    <div class="section-title">历史快照</div>
    <div class="table-card">
      <ResponsiveTable :data="snaps" size="small">
        <el-table-column prop="period" label="月份" width="90" />
        <el-table-column v-for="c in cols" :key="c.k" :label="c.l" align="right" :mobile="c.k === 'netWorth' ? 'amount' : undefined">
          <template #default="{ row }"><span class="money" :class="{ accent: c.k === 'netWorth' }">{{ moneyShort(row[c.k]) }}</span></template>
        </el-table-column>
        <el-table-column label="环比" align="right" width="110">
          <template #default="{ row, $index }">
            <span v-if="snaps[$index + 1]" class="money" :class="delta(row, $index) >= 0 ? 'money-in' : 'money-out'">{{ money(delta(row, $index), true) }}</span>
          </template>
        </el-table-column>
      </ResponsiveTable>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { useAiPageContext, onAiCommitted } from '@/composables/useAiAssistant'
import { money, moneyShort, currentPeriod, periodOptions } from '@/utils/format'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'

const router = useRouter()
const period = ref(currentPeriod())
useAiPageContext(() => ({ period: period.value }))
const checks = ref([])
const md = ref('')
const html = ref('')
const snaps = ref([])
const saving = ref(false)
const cols = [
  { k: 'cash', l: '现金' }, { k: 'investments', l: '金融投资' }, { k: 'equity', l: '股权' }, { k: 'receivables', l: '应收' },
  { k: 'fixedAssets', l: '固定资产' }, { k: 'liabilities', l: '负债' }, { k: 'netWorth', l: '净资产' }, { k: 'income', l: '当月收入' }, { k: 'expense', l: '当月支出' }
]
const delta = (row, i) => Number(row.netWorth) - Number(snaps.value[i + 1].netWorth)

async function load() {
  const [c, s, list] = await Promise.all([api.close.checklist({ period: period.value }), api.close.summary({ period: period.value }), api.close.snapshots()])
  checks.value = c
  md.value = s.markdown
  html.value = marked.parse(s.markdown)
  snaps.value = list.list
}
async function snapshot() {
  saving.value = true
  try { await api.close.snapshot({ period: period.value }); ElMessage.success('快照已生成'); load() } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
async function copy() { await navigator.clipboard.writeText(md.value); ElMessage.success('已复制，可以贴到 Obsidian') }
onMounted(load)
onActivated(load)
onAiCommitted(load)
</script>

<style scoped>
.checks { padding: 8px 14px 14px; }
.check { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f2f0eb; cursor: pointer; font-size: 14px; }
.accent-warn { color: var(--warning); }
.md { padding: 8px 18px 14px; font-size: 13px; max-height: 520px; overflow: auto; }
.md :deep(h1) { font-size: 17px; margin: 8px 0; }
.md :deep(h2) { font-size: 14px; margin: 14px 0 6px; }
.md :deep(table) { border-collapse: collapse; margin: 4px 0; }
.md :deep(td), .md :deep(th) { border: 1px solid var(--border); padding: 3px 10px; font-size: 12px; }
.md :deep(blockquote) { color: var(--text-muted); font-size: 12px; }
.md :deep(ul) { padding-left: 18px; }
.section-title { display: flex; }
@media (max-width: 768px) {
  .md { padding: 8px 12px 12px; font-size: 14px; max-height: none; }
  .md :deep(h2) { font-size: 15px; }
  .md :deep(td), .md :deep(th) { font-size: 14px; }
  .md :deep(blockquote) { font-size: 14px; }
}
</style>
