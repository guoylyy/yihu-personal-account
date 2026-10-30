<!-- 自由天数详情：怎么算出来的、哪些没算、数字准不准、模拟决策 -->
<template>
  <el-drawer :model-value="modelValue" title="自由天数" size="min(560px, 100vw)" append-to-body @update:model-value="$emit('update:modelValue', $event)">
    <template v-if="f">
      <div class="question muted">如果今天起不再有工作收入，按现在的生活方式，手上的钱能撑多久</div>

      <div v-if="f.state === 'INSUFFICIENT'" class="block big-line">再记 {{ f.need }} 个月就能算出来</div>
      <div v-else class="lines">
        <div class="line">
          <div class="muted">维持现在的生活</div>
          <div class="big money">{{ daysText(f.days.living) }}</div>
          <div class="muted sub">{{ subText('living') }}</div>
        </div>
        <div class="line">
          <div class="muted">只保必要开销</div>
          <div class="big money">{{ daysText(f.days.survival) }}</div>
          <div class="muted sub">{{ subText('survival') }}</div>
        </div>
      </div>

      <template v-if="f.state === 'OK'">
        <div class="section-title">自由网格</div>
        <FreedomGrid :freedom="f" />
      </template>

      <div v-if="f.warnings.length" class="block">
        <div class="section-title">数字可能不准</div>
        <div v-for="w in f.warnings" :key="w.key" class="warning" role="link" tabindex="0" @click="go(w.link)" @keydown.enter="go(w.link)">
          <span>{{ w.text }}</span><el-icon><ArrowRight /></el-icon>
        </div>
      </div>

      <div class="section-title">可动用资金 ¥{{ money(f.available) }}</div>
      <div class="rows">
        <div><span>现金</span><span class="money">{{ money(f.breakdown.cash) }}</span></div>
        <div><span>金融投资（不含储蓄险）</span><span class="money">{{ money(f.breakdown.investments) }}</span></div>
        <div v-if="f.breakdown.creditDebt"><span>信用卡欠款</span><span class="money">−{{ money(f.breakdown.creditDebt) }}</span></div>
        <div v-if="f.breakdown.unsecuredDebt"><span>没有月供的借款</span><span class="money">−{{ money(f.breakdown.unsecuredDebt) }}</span></div>
      </div>
      <div v-if="excludedRows.length" class="muted note">
        没算进去：{{ excludedRows.join('、') }}。这些变现不确定，或者不能花
      </div>

      <template v-if="f.daily">
        <div class="section-title">每日净消耗 ¥{{ money(f.daily.living) }}</div>
        <div class="rows">
          <div><span>支出（近 {{ f.window.months }} 个完整月）</span><span class="money">{{ money(f.totals.living) }}</span></div>
          <div v-if="f.totals.principal"><span>必还本金</span><span class="money">{{ money(f.totals.principal) }}</span></div>
          <div v-if="f.totals.passive"><span>投资收益到账</span><span class="money">−{{ money(f.totals.passive) }}</span></div>
          <div><span>统计天数（{{ f.window.from }} 至 {{ f.window.to }}）</span><span class="money">{{ f.window.days }} 天</span></div>
        </div>
        <div v-if="f.passiveCoverage != null" class="muted note">被动收入覆盖了开销的 {{ f.passiveCoverage }}%</div>

        <div class="section-title">模拟决策</div>
        <div class="muted note top">只是算一下，不写入账本</div>
        <el-form label-position="top" class="sim" @submit.prevent="simulate">
          <el-form-item label="一次性花">
            <el-input-number v-model="form.oneOff" inputmode="decimal" :min="0" :precision="2" :controls="false" placeholder="金额" />
          </el-form-item>
          <el-form-item label="每月多花（减少填负数）">
            <el-input-number v-model="form.monthly" inputmode="decimal" :precision="2" :controls="false" placeholder="金额" />
          </el-form-item>
          <template v-if="f.loans.length">
            <el-form-item label="提前还哪笔">
              <el-select v-model="form.loanId" clearable placeholder="不还" @clear="form.prepay = undefined">
                <el-option v-for="l in f.loans" :key="l.id" :value="l.id" :label="`${l.counterparty}（余 ${moneyShort(l.balance)}）`" />
              </el-select>
            </el-form-item>
            <el-form-item label="提前还多少">
              <el-input-number v-model="form.prepay" inputmode="decimal" :min="0" :precision="2" :controls="false" :disabled="!form.loanId" placeholder="金额" />
            </el-form-item>
          </template>
          <el-button type="primary" native-type="submit" :loading="busy" class="sim-go">算一下</el-button>
        </el-form>

        <div v-if="sim?.after" class="block">
          <div class="rows">
            <div v-for="l in SIM_LINES" :key="l.key">
              <span>{{ l.label }}</span>
              <span class="money">
                {{ daysText(sim.before.days[l.key]) }} → {{ daysText(sim.after.days[l.key]) }}
                <b v-if="sim.delta[l.key]" :class="sim.delta[l.key] < 0 ? 'money-out' : 'money-in'">{{ sim.delta[l.key] > 0 ? '多' : '少' }} {{ Math.abs(sim.delta[l.key]) }} 天</b>
              </span>
            </div>
          </div>
          <div class="muted note">{{ sim.note }}</div>
        </div>
      </template>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '@/api'
import { money, moneyShort } from '@/utils/format'
import FreedomGrid from './FreedomGrid.vue'

const props = defineProps({ modelValue: Boolean, freedom: Object })
const emit = defineEmits(['update:modelValue'])
const SIM_LINES = [{ key: 'living', label: '维持现在的生活' }, { key: 'survival', label: '只保必要开销' }]

const router = useRouter()
const f = computed(() => props.freedom)
const form = reactive({ oneOff: undefined, monthly: undefined, loanId: '', prepay: undefined })
const sim = ref(null)
const busy = ref(false)

const excludedRows = computed(() => {
  const e = f.value.excluded
  return [['储蓄险', e.insurance], ['股权', e.equity], ['固定资产', e.fixedAssets], ['应收借款', e.receivables]]
    .filter(([, v]) => v > 0).map(([k, v]) => `${k} ¥${moneyShort(v)}`)
})

const daysText = (d) => (d == null ? '已覆盖' : `${d} 天`)
function subText(k) {
  const d = f.value.days[k]
  if (d == null) return '被动收入已覆盖'
  if (f.value.state === 'DEPLETED') return `缺口 ¥${moneyShort(-f.value.available)}`
  return `约 ${f.value.depleteDate[k]} 见底`
}

function go(link) {
  emit('update:modelValue', false)
  router.push(link)
}

async function simulate() {
  busy.value = true
  try {
    sim.value = await api.freedom.simulate({
      oneOff: form.oneOff, monthly: form.monthly,
      ...(form.loanId && form.prepay ? { loanId: form.loanId, prepay: form.prepay } : {})
    })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = false
  }
}

watch(() => props.freedom, () => { sim.value = null })
</script>

<style scoped>
.question { font-size: 13px; margin-bottom: 14px; }
.lines { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.line { font-size: 13px; }
.big { font-size: 26px; font-weight: 600; line-height: 1.3; color: var(--accent); }
.big-line { font-size: 16px; font-weight: 600; }
.sub { font-size: 12px; }
.block { margin-top: 12px; }
.rows > div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
.rows > div > .money { text-align: right; white-space: nowrap; }
.rows b { margin-left: 6px; font-weight: 600; }
.note { font-size: 12px; margin-top: 6px; }
.note.top { margin: -4px 0 8px; }
.warning { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; font-size: 13px; color: var(--warning); cursor: pointer; }
.sim { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.sim :deep(.el-form-item) { margin-bottom: 10px; }
.sim :deep(.el-input-number), .sim :deep(.el-select) { width: 100%; }
.sim :deep(.el-input__inner) { text-align: left; }
.sim-go { grid-column: 1 / -1; }
@media (max-width: 768px) {
  .question, .line, .rows > div, .warning { font-size: 14px; }
  .sub, .note { font-size: 14px; }
  .rows > div { flex-wrap: wrap; }
  .sim { grid-template-columns: 1fr; }
}
</style>
