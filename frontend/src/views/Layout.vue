<template>
  <el-container class="layout">
    <el-aside width="200px" class="sidebar">
      <div class="logo">
        <div class="mark">私</div>
        <div>
          <div class="logo-name">个人财务</div>
          <div class="logo-sub">PERSONAL</div>
        </div>
      </div>
      <el-menu :default-active="route.path" router class="menu">
        <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><span>财务总览</span></el-menu-item>
        <el-menu-item index="/ai"><el-icon><MagicStick /></el-icon><span>AI 记账</span></el-menu-item>
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
    </el-aside>

    <el-container>
      <el-header class="topbar">
        <span class="title">{{ route.meta.title }}</span>
        <div class="right">
          <el-button type="primary" @click="quick = true"><el-icon><MagicStick /></el-icon>&nbsp;AI 记一笔</el-button>
          <el-dropdown @command="onCommand">
            <span class="user">
              <el-avatar :size="26" style="background: var(--text)">{{ user?.name?.[0] || '我' }}</el-avatar>
              <span>{{ user?.name }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">系统设置</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view v-slot="{ Component }">
          <keep-alive :max="6"><component :is="Component" :key="route.path" /></keep-alive>
        </router-view>
      </el-main>
    </el-container>

    <el-drawer v-model="quick" title="AI 记一笔" size="720px" destroy-on-close>
      <AiEntry compact @committed="onCommitted" />
    </el-drawer>
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getUser, clearAuth } from '@/api'
import { getPlatformHome } from '@/api/base'
import { loadMeta } from '@/composables/useMeta'
import AiEntry from '@/components/AiEntry.vue'

const route = useRoute()
const router = useRouter()
const user = ref(getUser())
const quick = ref(false)

onMounted(() => loadMeta().catch(() => {}))

function onCommitted() { quick.value = false }
function onCommand(cmd) {
  if (cmd === 'settings') return router.push('/settings')
  clearAuth()
  // 从以虎 One 进来的：回到平台工作台（留在这里会被自动再登录一次）
  const home = getPlatformHome()
  if (home) location.href = home
  else router.replace('/login')
}
</script>

<style scoped>
.layout { height: 100vh; }
.sidebar { background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
.logo { display: flex; align-items: center; gap: 10px; padding: 18px 18px 14px; border-bottom: 1px solid var(--border); }
.mark { width: 30px; height: 30px; border-radius: 8px; background: var(--text); color: #faf9f7; display: grid; place-items: center; font-size: 14px; font-weight: 600; }
.logo-name { font-size: 15px; font-weight: 600; line-height: 1.2; }
.logo-sub { font-family: var(--font-num); font-size: 10px; letter-spacing: 0.18em; color: var(--accent); font-weight: 700; }
.menu { border-right: none; flex: 1; overflow-y: auto; padding-bottom: 20px; }
.menu :deep(.el-menu-item.is-active) { color: var(--accent); background: #eef5f1; font-weight: 600; }
.menu :deep(.el-menu-item), .menu :deep(.el-sub-menu__title) { height: 42px; line-height: 42px; font-size: 14px; }
.topbar { height: 56px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
.title { font-size: 15px; font-weight: 600; }
.right { display: flex; align-items: center; gap: 16px; }
.user { display: flex; align-items: center; gap: 8px; cursor: pointer; outline: none; font-size: 14px; }
.main { background: var(--bg); padding: 18px 20px; overflow-y: auto; }
</style>
