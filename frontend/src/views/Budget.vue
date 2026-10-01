<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">预算</div>
        <div class="page-sub">以「我承担的部分」为口径；实际数只算个人支出（已剔除公司款和转移类）</div>
      </div>
      <el-radio-group v-model="tab">
        <el-radio-button value="exec">执行情况</el-radio-button>
        <el-radio-button value="edit">编制预算</el-radio-button>
      </el-radio-group>
    </div>

    <template v-if="tab === 'exec'">
      <div class="filter-bar">
        <el-select v-model="period" style="width: 120px" @change="loadExec"><el-option v-for="p in periodOptions(24)" :key="p" :label="p" :value="p" /></el-select>
        <span class="muted" style="font-size: 13px">超 90% 标黄，超 110% 标红</span>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">本月预算</div><div class="value">¥{{ money(exec.total.monthlyBudget) }}</div></div>
        <div class="stat-card" :class="exec.total.actual > exec.total.monthlyBudget ? 'is-danger' : 'is-success'"><div class="label">本月实际</div><div class="value">¥{{ money(exec.total.actual) }}</div>
          <div class="foot">{{ pct(exec.total.actual, exec.total.monthlyBudget) }}</div></div>
        <div class="stat-card"><div class="label">年累计 实际 / 预算</div><div class="value">{{ moneyShort(exec.total.ytdActual) }}</div><div class="foot">预算 {{ moneyShort(exec.total.ytdBudget) }} · {{ pct(exec.total.ytdActual, exec.total.ytdBudget) }}</div></div>
        <div class="stat-card"><div class="label">全年预算</div><div class="value">{{ moneyShort(exec.total.annualBudget) }}</div></div>
      </div>
      <div class="table-card">
        <el-table :data="exec.rows" size="small" v-loading="loading">
          <el-table-column label="科目" width="150"><template #default="{ row }">{{ row.code === row.name ? row.name : `${row.code} ${row.name}` }} <span class="muted" style="font-size: 12px">{{ row.group }}</span></template></el-table-column>
          <el-table-column label="月预算" align="right" width="110"><template #default="{ row }"><span class="money">{{ money(row.monthlyBudget) }}</span></template></el-table-column>
          <el-table-column label="本月实际" align="right" width="110"><template #default="{ row }"><span class="money">{{ money(row.actual) }}</span></template></el-table-column>
          <el-table-column label="本月执行" min-width="180">
            <template #default="{ row }">
              <div class="prog"><el-progress :percentage="Math.min(row.rate ?? 100, 100)" :show-text="false" :stroke-width="8" :color="color(row.rate)" style="flex: 1" />
                <span class="rate" :style="{ color: color(row.rate) }">{{ row.rate == null ? '无预算' : row.rate + '%' }}</span></div>
            </template>
          </el-table-column>
          <el-table-column label="年累计实际 / 预算" align="right" width="190"><template #default="{ row }"><span class="money">{{ money(row.ytdActual) }}</span> <span class="muted">/ {{ money(row.ytdBudget) }}</span></template></el-table-column>
          <el-table-column label="年执行" width="80" align="right"><template #default="{ row }"><span :style="{ color: color(row.ytdRate) }">{{ row.ytdRate == null ? '—' : row.ytdRate + '%' }}</span></template></el-table-column>
        </el-table>
      </div>
    </template>

    <template v-else>
      <div class="filter-bar">
        <el-select v-model="year" style="width: 100px" @change="loadEdit"><el-option v-for="y in years" :key="y" :label="y" :value="y" /></el-select>
        <span class="muted" style="font-size: 13px">月度和年度填一个即可（年度 = 月度 × 12）；合计：月 ¥{{ money(editTotal / 12) }} · 年 ¥{{ money(editTotal) }}</span>
        <span style="flex: 1" />
        <el-button @click="copyFrom">从 {{ year - 1 }} 年复制</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </div>
      <div class="table-card">
        <el-table :data="editRows" size="small">
          <el-table-column label="科目" width="170"><template #default="{ row }">{{ row.code }} {{ row.name }} <span class="muted" style="font-size: 12px">{{ row.groupName }}</span></template></el-table-column>
          <el-table-column label="月度" width="170"><template #default="{ row }"><el-input-number v-model="row.monthly" :precision="0" :step="500" :min="0" size="small" controls-position="right" @change="row.annual = Math.round((row.monthly || 0) * 12)" /></template></el-table-column>
          <el-table-column label="年度" width="170"><template #default="{ row }"><el-input-number v-model="row.annual" :precision="0" :step="1000" :min="0" size="small" controls-position="right" @change="row.monthly = Math.round((row.annual || 0) / 12)" /></template></el-table-column>
          <el-table-column label="说明"><template #default="{ row }"><el-input v-model="row.remark" size="small" /></template></el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import api from '@/api'
import { money, moneyShort, currentPeriod, periodOptions } from '@/utils/format'
import { categories, loadMeta } from '@/composables/useMeta'

const tab = ref('exec')
const loading = ref(false)
const period = ref(currentPeriod())
const exec = ref({ rows: [], total: {} })
const year = ref(dayjs().year())
const years = [dayjs().year() - 1, dayjs().year(), dayjs().year() + 1]
const editRows = ref([])
const editTotal = computed(() => editRows.value.reduce((s, r) => s + (r.annual || 0), 0))

const color = (r) => (r == null ? '#8f8a82' : r > 110 ? '#c2362b' : r > 90 ? '#b3450f' : '#2f6b55')
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')

async function loadExec() {
  loading.value = true
  try { exec.value = await api.budgets.execution({ period: period.value }) } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
async function loadEdit(y = year.value, keepYear) {
  await loadMeta()
  const { list } = await api.budgets.list({ year: y })
  editRows.value = categories.value.filter((c) => c.kind === 'EXPENSE').map((c) => {
    const b = list.find((x) => String(x.categoryId) === String(c.id))
    const annual = Math.round(Number(b?.annualAmount || 0))
    return { categoryId: c.id, code: c.code, name: c.name, groupName: c.groupName, annual, monthly: Math.round(annual / 12), remark: b?.remark || '' }
  })
}
async function copyFrom() { await loadEdit(year.value - 1); ElMessage.info(`已载入 ${year.value - 1} 年数据，确认后保存到 ${year.value} 年`) }
async function saveEdit() {
  try {
    await api.budgets.save(year.value, editRows.value.map((r) => ({ categoryId: r.categoryId, annualAmount: r.annual, remark: r.remark })))
    ElMessage.success('已保存')
    loadExec()
  } catch (e) { ElMessage.error(e.message) }
}
onMounted(() => { loadExec(); loadEdit() })
onActivated(loadExec)
</script>

<style scoped>
.prog { display: flex; align-items: center; gap: 10px; }
.rate { width: 60px; text-align: right; font-size: 12px; font-family: var(--font-num); }
</style>
