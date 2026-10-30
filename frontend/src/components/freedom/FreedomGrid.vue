<!-- 自由网格：把天数画出来。不足 1 年 1 格 1 天，1 到 10 年 1 格 1 月，10 年以上 1 格 1 年 -->
<template>
  <div>
    <div class="grid" :class="`unit-${g.key}`" role="img" :aria-label="`${g.count} ${g.unit}，现金 ${g.cash} 格，投资 ${g.count - g.cash} 格`">
      <i v-for="i in g.count" :key="i" :class="i <= g.cash ? 'cash' : 'invest'" />
      <i v-for="i in g.idle" :key="`idle-${i}`" class="idle" />
    </div>
    <div class="legend muted">
      <span><i class="cash" />现金</span>
      <span><i class="invest" />投资</span>
      <span v-if="g.idle"><i class="idle" />有，但不算能花的钱</span>
      <span>1 格 = 1 {{ g.unit }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ freedom: { type: Object, required: true } })
const MAX_YEARS = 100
const MAX_IDLE = 60 // 房产按格子能铺满一屏，灰格只示意

const g = computed(() => {
  const { days, breakdown, excluded, available } = props.freedom
  const d = days.living
  const [key, unit, per, cap] = d < 365 ? ['day', '天', 1, 365] : d < 3650 ? ['month', '月', 365 / 12, 120] : ['year', '年', 365, MAX_YEARS]
  const count = Math.min(cap, Math.floor(d / per))
  const cash = Math.max(0, breakdown.cash)
  const invest = Math.max(0, breakdown.investments)
  const cashCells = cash + invest > 0 ? Math.round((count * cash) / (cash + invest)) : count
  const other = excluded.insurance + excluded.equity + excluded.fixedAssets
  const idle = other > 0 && count ? Math.min(MAX_IDLE, Math.ceil(other / (available / count))) : 0
  return { key, unit, count, cash: cashCells, idle }
})
</script>

<style scoped>
.grid { display: grid; gap: 2px; }
.unit-day { grid-template-columns: repeat(auto-fill, 9px); }
.unit-month { grid-template-columns: repeat(12, minmax(0, 18px)); gap: 3px; }
.unit-year { grid-template-columns: repeat(10, minmax(0, 24px)); gap: 3px; }
.grid i { display: block; aspect-ratio: 1; border-radius: 2px; }
.cash { background: var(--accent); }
.invest { background: var(--text-secondary); }
.idle { background: var(--border-strong); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; font-size: 12px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; }
@media (max-width: 768px) {
  .legend { font-size: 14px; }
}
</style>
