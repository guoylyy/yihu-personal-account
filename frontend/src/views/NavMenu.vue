<!-- 左侧导航菜单：桌面侧栏、平板图标栏（collapse，子菜单浮层展开）、手机抽屉共用 -->
<template>
  <el-menu :default-active="route.path" router class="menu" :collapse="collapse" :collapse-transition="false"
           @select="emit('select', $event)">
    <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><template #title><span>财务总览</span></template></el-menu-item>
    <el-menu-item index="/ai"><el-icon><MagicStick /></el-icon><template #title><span>AI 记账</span></template></el-menu-item>
    <el-sub-menu index="cash">
      <template #title><el-icon><Wallet /></el-icon><span>收支</span></template>
      <el-menu-item index="/transactions">收支流水</el-menu-item>
      <el-menu-item index="/accounts">账户</el-menu-item>
      <el-menu-item index="/import">导入账单</el-menu-item>
    </el-sub-menu>
    <el-sub-menu index="wealth">
      <template #title><el-icon><TrendCharts /></el-icon><span>资产</span></template>
      <el-menu-item index="/holdings">投资持仓</el-menu-item>
      <el-menu-item index="/assets">固定资产</el-menu-item>
      <el-menu-item index="/loans">借贷往来</el-menu-item>
    </el-sub-menu>
    <el-sub-menu index="plan">
      <template #title><el-icon><Calendar /></el-icon><span>计划与复盘</span></template>
      <el-menu-item index="/budget">预算</el-menu-item>
      <el-menu-item index="/close">月结与净资产</el-menu-item>
    </el-sub-menu>
    <el-sub-menu index="base">
      <template #title><el-icon><Setting /></el-icon><span>设置</span></template>
      <el-menu-item index="/categories">科目与规则</el-menu-item>
      <el-menu-item index="/settings">系统设置</el-menu-item>
    </el-sub-menu>
  </el-menu>
</template>

<script setup>
import { useRoute } from 'vue-router'

defineProps({ collapse: Boolean })
const emit = defineEmits(['select'])
const route = useRoute()
</script>

<style scoped>
.menu { border-right: none; flex: 1; overflow-y: auto; padding-bottom: 20px; }
.menu :deep(.el-menu-item.is-active) { color: var(--accent); background: #eef5f1; font-weight: 600; }
.menu :deep(.el-menu-item), .menu :deep(.el-sub-menu__title) { height: 42px; line-height: 42px; font-size: 14px; }
.menu.el-menu--collapse { width: 64px; }
/* 抽屉里的菜单（手机）：行高 48，便于手指点 */
@media (max-width: 768px) {
  .menu :deep(.el-menu-item), .menu :deep(.el-sub-menu__title) { height: 48px; line-height: 48px; font-size: 15px; }
}
</style>
<!-- 平板图标栏的子菜单浮层：当前路由高亮与侧栏一致（popper 挂在 body 上，scoped 样式够不到） -->
<style>
.el-menu--popup .el-menu-item.is-active { color: var(--accent); background: #eef5f1; font-weight: 600; }
</style>
