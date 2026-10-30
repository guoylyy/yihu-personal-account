<!-- 总览上的自由天数卡，替换原来的「应急金覆盖」。点开是详情抽屉 -->
<template>
  <div class="stat-card freedom-card" role="button" tabindex="0" @click="$emit('open')" @keydown.enter="$emit('open')">
    <div class="label">自由天数</div>
    <template v-if="!f"><div class="value">—</div></template>
    <template v-else-if="f.state === 'INSUFFICIENT'">
      <div class="value">—</div>
      <div class="foot">再记 {{ f.need }} 个月就能算出来</div>
    </template>
    <template v-else-if="f.state === 'COVERED'">
      <div class="value">已覆盖</div>
      <div class="foot">被动收入已覆盖开销</div>
    </template>
    <template v-else>
      <div class="value">{{ durationText(f.days.living) }}</div>
      <div class="foot">
        <template v-if="f.state === 'DEPLETED'">缺口 ¥{{ moneyShort(-f.available) }}</template>
        <template v-else>
          <span v-if="f.days.living >= 365">{{ f.days.living }} 天 · </span>约 {{ f.depleteDate.living.slice(0, 7) }} 见底
        </template>
      </div>
      <div class="foot">
        只保必要 {{ f.days.survival == null ? '已覆盖' : durationText(f.days.survival) }}
        <span v-if="f.warnings.length" class="warn"> · 数字可能不准</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { moneyShort } from '@/utils/format'
import { durationText } from '@/composables/useFreedom'

const props = defineProps({ freedom: Object })
defineEmits(['open'])
const f = computed(() => props.freedom)
</script>

<style scoped>
.freedom-card { cursor: pointer; }
.freedom-card:hover { border-color: var(--border-strong); }
.warn { color: var(--warning); }
</style>
