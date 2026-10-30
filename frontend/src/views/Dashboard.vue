<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <div>
        <div class="page-title">财务总览</div>
        <div class="page-sub">只含个人与家庭，不含集团公司资产 · 数据截至 {{ today }}</div>
      </div>
      <el-select v-model="period" style="width: 130px" @change="load">
        <el-option v-for="p in periods" :key="p" :label="p" :value="p" />
      </el-select>
    </div>

    <div class="stat-grid">
      <div class="stat-card is-accent">
        <div class="label">净资产</div>
        <div class="value">¥{{ moneyShort(s.netWorth) }}</div>
        <div class="foot">总资产 {{ moneyShort(s.totalAssets) }} − 负债 {{ moneyShort(s.liabilities) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">可动用资金</div>
        <div class="value">¥{{ moneyShort(s.liquid) }}</div>
        <div class="foot">现金 {{ moneyShort(s.cash) }} + 金融投资 {{ moneyShort(s.investments) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">应急金覆盖</div>
        <div class="value">{{ emergencyMonths }} <small>个月</small></div>
        <div class="foot">按月预算支出 ¥{{ money(monthlyBudget) }}</div>
      </div>
      <div class="stat-card is-success">
        <div class="label">{{ period }} 收入</div>
        <div class="value">¥{{ money(m.income) }}</div>
        <div class="foot">储蓄率 {{ m.savingRate == null ? '—' : m.savingRate + '%' }}</div>
      </div>
      <div class="stat-card is-danger">
        <div class="label">{{ period }} 个人支出</div>
        <div class="value">¥{{ money(m.expense) }}</div>
        <div class="foot">预算 ¥{{ money(monthlyBudget) }} · 已剔除公司款 {{ moneyShort(m.business) }}</div>
      </div>
    </div>

    <div v-if="data.alerts?.length" class="alerts">
      <div v-for="(a, i) in data.alerts" :key="i" class="alert" :class="a.level" @click="router.push(a.link)">
        <el-icon><WarningFilled v-if="a.level !== 'info'" /><InfoFilled v-else /></el-icon>{{ a.text }}
        <el-icon class="go"><ArrowRight /></el-icon>
      </div>
    </div>

    <el-row :gutter="14">
      <el-col :xs="24" :lg="9">
        <div class="section-title">资产结构</div>
        <div class="chart-card"><div ref="pieRef" class="chart" /></div>
      </el-col>
      <el-col :xs="24" :lg="15">
        <div class="section-title">近 12 个月收支（个人口径）</div>
        <div class="chart-card"><div ref="trendRef" class="chart" /></div>
      </el-col>
    </el-row>

    <el-row :gutter="14">
      <el-col :xs="24" :lg="12">
        <div class="section-title">
          本月预算执行
          <el-button link type="primary" style="margin-left: auto" @click="router.push('/budget')">全部</el-button>
        </div>
        <div class="table-card">
          <div v-for="r in budgetRows" :key="r.code" class="brow">
            <div class="bname">{{ r.code === r.name ? r.name : `${r.code} ${r.name}` }}</div>
            <el-progress :percentage="Math.min(r.rate ?? 100, 100)" :stroke-width="8" :show-text="false"
                         :color="r.rate == null ? '#8f8a82' : r.rate > 110 ? '#c2362b' : r.rate > 90 ? '#b3450f' : '#2f6b55'" style="flex: 1" />
            <div class="bnum money">{{ money(r.actual) }} <span class="muted">/ {{ money(r.monthlyBudget) }}</span></div>
          </div>
          <div v-if="!budgetRows.length" class="muted" style="padding: 14px 0">本月还没有支出</div>
        </div>
      </el-col>
      <el-col :xs="24" :lg="12">
        <div class="section-title">
          账户余额
          <el-button link type="primary" style="margin-left: auto" @click="router.push('/accounts')">管理</el-button>
        </div>
        <div class="table-card">
          <ResponsiveTable :data="data.accounts || []" size="small">
            <el-table-column prop="name" label="账户" mobile="title" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">{{ labelOf(ACCOUNT_TYPES, row.type) }}</template>
            </el-table-column>
            <el-table-column label="余额" align="right" mobile="amount">
              <template #default="{ row }"><span class="money" :class="{ 'money-out': Number(row.balance) < 0 }">{{ money(row.balance) }}</span></template>
            </el-table-column>
            <el-table-column label="校准于" width="100">
              <template #default="{ row }"><span class="muted">{{ date(row.initialDate) }}</span></template>
            </el-table-column>
          </ResponsiveTable>
        </div>
      </el-col>
    </el-row>

    <div class="section-title">净资产走势 <span class="muted" style="font-size: 12px; font-weight: 400">（每月月结时生成快照）</span></div>
    <div class="chart-card">
      <div v-if="(data.snapshots || []).length < 2" class="muted empty">
        已有 {{ (data.snapshots || []).length }} 个快照，到「月结与净资产」每月生成一次，就能看到走势
      </div>
      <div v-else ref="nwRef" class="chart" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { useAiPageContext, onAiCommitted } from '@/composables/useAiAssistant'
import { money, moneyShort, date, currentPeriod, periodOptions } from '@/utils/format'
import { ACCOUNT_TYPES, labelOf } from '@/constants'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'
import { useCharts } from '@/composables/useCharts'

const router = useRouter()
const loading = ref(false)
const period = ref(currentPeriod())
useAiPageContext(() => ({ period: period.value }))
const periods = periodOptions(18)
const data = ref({})
const exec = ref({ rows: [], total: {} })
const pieRef = ref(), trendRef = ref(), nwRef = ref()
const { render } = useCharts()
const today = new Date().toLocaleDateString('zh-CN')

const s = computed(() => data.value.sheet || {})
const m = computed(() => data.value.month || {})
const monthlyBudget = computed(() => exec.value.total?.monthlyBudget || 0)
const emergencyMonths = computed(() => (monthlyBudget.value ? (s.value.liquid / monthlyBudget.value).toFixed(1) : '—'))
// 有预算的按执行率从高到低（超支的先看），没预算的放后面按金额排
const budgetRows = computed(() => exec.value.rows.filter((r) => r.actual || r.monthlyBudget)
  .sort((a, b) => (a.rate == null) - (b.rate == null) || (b.rate ?? 0) - (a.rate ?? 0) || b.actual - a.actual).slice(0, 8))

const INK = ['#2f6b55', '#1c1917', '#b08d57', '#5b8fb9', '#8f8a82', '#c2362b']
const axis = { axisLine: { lineStyle: { color: '#ddd9d2' } }, axisLabel: { color: '#8f8a82' }, splitLine: { lineStyle: { color: '#f2f0eb' } } }

async function load() {
  loading.value = true
  try {
    const [d, e] = await Promise.all([api.dashboard.get({ period: period.value }), api.budgets.execution({ period: period.value })])
    data.value = d
    exec.value = e
    await nextTick()
    draw()
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    loading.value = false
  }
}

function draw() {
  const sh = s.value
  render(pieRef.value, {
    color: INK,
    tooltip: { trigger: 'item', valueFormatter: (v) => '¥' + money(v) },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, textStyle: { color: '#5c574f' } },
    series: [{
      type: 'pie', radius: ['48%', '72%'], center: ['50%', '44%'], label: { formatter: '{d}%', color: '#5c574f' },
      data: [
        { name: '现金', value: sh.cash }, { name: '金融投资', value: sh.investments }, { name: '股权', value: sh.equity },
        { name: '应收借款', value: sh.receivables }, { name: '固定资产', value: sh.fixedAssets }
      ].filter((x) => x.value > 0)
    }]
  })
  const t = data.value.trend || []
  render(trendRef.value, {
    color: ['#2f6b55', '#1c1917', '#d6d2ca'],
    tooltip: { trigger: 'axis', valueFormatter: (v) => '¥' + money(v) },
    legend: { top: 0, right: 0, textStyle: { color: '#5c574f' } },
    grid: { left: 50, right: 10, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: t.map((x) => x.period.slice(2)), ...axis },
    yAxis: { type: 'value', ...axis, axisLabel: { color: '#8f8a82', formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
    series: [
      { name: '收入', type: 'bar', barMaxWidth: 16, data: t.map((x) => x.income) },
      { name: '个人支出', type: 'bar', barMaxWidth: 16, data: t.map((x) => x.expense) },
      { name: '公司款', type: 'bar', barMaxWidth: 16, data: t.map((x) => x.business) }
    ]
  })
  const snaps = data.value.snapshots || []
  if (snaps.length >= 2) {
    render(nwRef.value, {
      color: ['#2f6b55'],
      tooltip: { trigger: 'axis', valueFormatter: (v) => '¥' + money(v) },
      grid: { left: 60, right: 10, top: 16, bottom: 24 },
      xAxis: { type: 'category', data: snaps.map((x) => x.period), ...axis },
      yAxis: { type: 'value', scale: true, ...axis, axisLabel: { color: '#8f8a82', formatter: (v) => v / 10000 + '万' } },
      series: [{ name: '净资产', type: 'line', smooth: true, symbolSize: 6, areaStyle: { opacity: 0.08 }, data: snaps.map((x) => Number(x.netWorth)) }]
    })
  }
}

onMounted(load)
onActivated(load)
onAiCommitted(load)
</script>

<style scoped>
.stat-card .value small { font-size: 13px; color: var(--text-muted); font-weight: 400; }
.alerts { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.alert { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px 12px; border-radius: 8px; cursor: pointer; background: var(--surface); border: 1px solid var(--border); }
.alert.warn { color: var(--warning); background: #fbf4ef; border-color: #f0dccd; }
.alert.danger { color: var(--danger); background: #fbefee; border-color: #f0cdca; }
.alert.info { color: var(--text-secondary); }
.alert .go { margin-left: auto; }
.chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--card-radius); padding: 12px; }
.chart { height: 280px; }
.empty { height: 80px; display: grid; place-items: center; font-size: 13px; }
.brow { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-bottom: 1px solid #f2f0eb; }
.brow:last-child { border-bottom: none; }
.bname { width: 108px; font-size: 13px; flex-shrink: 0; }
.bnum { width: 170px; text-align: right; font-size: 13px; flex-shrink: 0; }
.section-title { display: flex; }
@media (max-width: 768px) {
  .chart { height: 240px; }
  .alert { min-height: 44px; font-size: 14px; }
  /* 预算行：名称 + 金额一行，进度条占满下一行 */
  .brow { flex-wrap: wrap; gap: 4px 12px; padding: 10px 0; }
  .bname { width: auto; flex: 1; min-width: 0; font-size: 14px; }
  .bnum { width: auto; font-size: 14px; }
  .brow :deep(.el-progress) { order: 3; flex-basis: 100% !important; }
  .empty { font-size: 14px; height: auto; min-height: 80px; text-align: center; }
}
</style>
