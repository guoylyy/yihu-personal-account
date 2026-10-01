<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">导入账单</div>
        <div class="page-sub">支持微信支付账单（xlsx/csv）、支付宝交易明细（csv）、银行流水（xlsx/csv）。自动识别表头与编码、按交易号和时间查重</div>
      </div>
    </div>

    <div v-if="!preview" class="table-card upload-card">
      <el-upload drag :auto-upload="false" :show-file-list="false" accept=".csv,.xls,.xlsx" :on-change="onFile">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">把账单文件拖到这里，或 <em>点击选择</em></div>
      </el-upload>
      <div class="how muted">
        <p><b>微信</b>：我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单 → 用于个人对账（发到邮箱，解压密码在微信支付通知里）</p>
        <p><b>支付宝</b>：我的 → 账单 → 右上角 ··· → 开具交易流水证明 → 用于个人对账</p>
        <p><b>银行</b>：网银导出交易明细 xlsx 即可</p>
      </div>
    </div>

    <template v-else>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">{{ preview.channel }} · {{ preview.filename }}</div><div class="value">{{ preview.stat.total }} <small>笔</small></div></div>
        <div class="stat-card is-accent"><div class="label">待导入</div><div class="value">{{ importable.length }}</div></div>
        <div class="stat-card is-danger"><div class="label">未分类</div><div class="value">{{ uncategorized.length }}</div></div>
        <div class="stat-card"><div class="label">重复 / 跳过</div><div class="value">{{ preview.stat.duplicate }} / {{ preview.stat.skip }}</div></div>
      </div>

      <div class="filter-bar">
        <el-radio-group v-model="tab">
          <el-radio-button value="todo">待导入</el-radio-button>
          <el-radio-button value="uncat">未分类</el-radio-button>
          <el-radio-button value="dup">重复/跳过</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-select v-model="bulkAccount" placeholder="统一设置账户" clearable style="width: 150px" @change="setAllAccount">
          <el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" />
        </el-select>
        <el-button type="primary" plain :loading="aiLoading" :disabled="!uncategorized.length" @click="aiClassify">
          <el-icon><MagicStick /></el-icon>&nbsp;AI 归类未分类（{{ uncategorized.length }}）
        </el-button>
        <span style="flex: 1" />
        <el-button @click="preview = null">重新选择</el-button>
        <el-button type="primary" :loading="committing" :disabled="!importable.length" @click="commit">导入 {{ importable.length }} 笔</el-button>
      </div>

      <div class="table-card">
        <el-table :data="shown" size="small" max-height="600">
          <el-table-column label="时间" width="140"><template #default="{ row }">{{ row.txnDate }} {{ row.txnTime?.slice(0, 5) }}</template></el-table-column>
          <el-table-column label="金额" align="right" width="100">
            <template #default="{ row }"><span class="money" :class="row.direction === 'IN' ? 'money-in' : 'money-out'">{{ row.direction === 'IN' ? '+' : '−' }}{{ money(row.amount) }}</span></template>
          </el-table-column>
          <el-table-column prop="counterparty" label="对方" min-width="140" show-overflow-tooltip />
          <el-table-column prop="description" label="说明" min-width="150" show-overflow-tooltip />
          <el-table-column label="科目" width="170">
            <template #default="{ row }">
              <el-select v-if="!row.skip && !row.duplicate" v-model="row.categoryId" size="small" filterable clearable placeholder="未分类" @change="row.learn = true">
                <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label"><el-option v-for="o in g.options" :key="o.value" v-bind="o" /></el-option-group>
              </el-select>
              <span v-if="row.classifiedBy === 'ai'" class="ai-mark">AI</span>
            </template>
          </el-table-column>
          <el-table-column label="账户" width="130">
            <template #default="{ row }">
              <el-select v-if="!row.skip && !row.duplicate" v-model="row.accountId" size="small" clearable placeholder="—">
                <el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="公司款" width="70" align="center">
            <template #default="{ row }"><el-checkbox v-if="!row.skip && !row.duplicate" v-model="row.isBusiness" /></template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.duplicate" size="small" type="info">重复 {{ row.duplicate }}</el-tag>
              <el-tag v-else-if="row.skip" size="small" type="info">{{ row.skipReason }}</el-tag>
              <el-tag v-else size="small" type="success" effect="plain">待导入</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <div class="section-title">导入记录</div>
    <div class="table-card">
      <el-table :data="batches" size="small">
        <el-table-column prop="importBatch" label="批次" />
        <el-table-column label="笔数" width="80"><template #default="{ row }">{{ row._count }}</template></el-table-column>
        <el-table-column label="交易日期范围"><template #default="{ row }">{{ date(row._min.txnDate) }} ~ {{ date(row._max.txnDate) }}</template></el-table-column>
        <el-table-column label="导入时间" width="150"><template #default="{ row }">{{ datetime(row._max.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link type="danger" @click="undo(row)">撤销</el-button></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'
import { money, date, datetime } from '@/utils/format'
import { accountOptions, categoryGroups, loadMeta } from '@/composables/useMeta'

const preview = ref(null)
const tab = ref('todo')
const bulkAccount = ref('')
const aiLoading = ref(false)
const committing = ref(false)
const batches = ref([])

const rows = computed(() => preview.value?.rows || [])
const importable = computed(() => rows.value.filter((r) => !r.skip && !r.duplicate))
const uncategorized = computed(() => importable.value.filter((r) => !r.categoryId))
const shown = computed(() => ({
  todo: importable.value, uncat: uncategorized.value, all: rows.value,
  dup: rows.value.filter((r) => r.skip || r.duplicate)
}[tab.value]))

async function onFile(f) {
  const fd = new FormData()
  fd.append('file', f.raw)
  try {
    preview.value = await api.transactions.importPreview(fd)
    tab.value = 'todo'
  } catch (e) { ElMessage.error(e.message) }
}
function setAllAccount(v) { for (const r of importable.value) if (!r.accountId || v) r.accountId = v }

async function aiClassify() {
  aiLoading.value = true
  try {
    const todo = uncategorized.value.slice(0, 120)
    const res = await api.transactions.aiClassify(todo.map((r) => ({ direction: r.direction, amount: r.amount, counterparty: r.counterparty, description: r.description })))
    let n = 0
    for (const s of res) {
      const r = todo[s.i]
      if (r && s.categoryId) { r.categoryId = s.categoryId; r.isBusiness = s.isBusiness; r.businessOrg = s.businessOrg; r.classifiedBy = 'ai'; n++ }
    }
    ElMessage.success(`AI 归类了 ${n} 笔，标了「AI」的可以再核对${uncategorized.value.length ? `；还剩 ${uncategorized.value.length} 笔，可再点一次` : ''}`)
  } catch (e) { ElMessage.error(e.message) } finally { aiLoading.value = false }
}

async function commit() {
  if (uncategorized.value.length) {
    try { await ElMessageBox.confirm(`还有 ${uncategorized.value.length} 笔未分类，导入后可在流水里再归类。继续？`, '提示') } catch { return }
  }
  committing.value = true
  try {
    const r = await api.transactions.importCommit({ rows: importable.value })
    ElMessage.success(`已导入 ${r.count} 笔`)
    preview.value = null
    loadBatches()
  } catch (e) { ElMessage.error(e.message) } finally { committing.value = false }
}

async function loadBatches() { batches.value = await api.transactions.batches() }
async function undo(row) {
  await ElMessageBox.confirm(`撤销批次 ${row.importBatch}（${row._count} 笔）？`, '确认', { type: 'warning' })
  await api.transactions.undoBatch(row.importBatch)
  ElMessage.success('已撤销')
  loadBatches()
}
onMounted(() => { loadMeta(); loadBatches() })
</script>

<style scoped>
.upload-card { padding: 20px; }
.how { font-size: 12px; line-height: 2; margin-top: 12px; }
.stat-card .value small { font-size: 13px; color: var(--text-muted); }
.ai-mark { font-size: 10px; color: var(--accent); margin-left: 4px; font-weight: 700; }
</style>
