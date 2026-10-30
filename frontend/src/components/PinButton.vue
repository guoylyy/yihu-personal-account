<!-- 列表行/卡片上的 @：把这条记录作为引用放进 AI 记账抽屉 -->
<template>
  <el-button link class="pin-btn" :class="{ 'is-pinned': isPinned(type, id) }" :aria-label="`引用：${label}`" title="@ 引用到 AI 记账"
             @click.stop="pin(type, id, label)">@</el-button>
</template>

<script setup>
import { isPinned, pin } from '@/composables/useAiAssistant'

defineProps({ type: { type: String, required: true }, id: { type: [String, Number], required: true }, label: { type: String, required: true } })
</script>

<style scoped>
.pin-btn { font-weight: 700; }
.pin-btn.is-pinned { color: var(--accent); }
</style>
