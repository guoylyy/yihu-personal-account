<template>
  <el-container class="layout">
    <!-- 桌面 200px 侧栏；平板（≤1024）收成 64px 图标栏，子菜单浮层展开；手机（≤768）改为抽屉 -->
    <el-aside v-if="!isMobile" :width="isTablet ? '64px' : '200px'" class="sidebar" :class="{ 'is-collapsed': isTablet }">
      <div class="logo">
        <div class="mark">私</div>
        <div v-if="!isTablet">
          <div class="logo-name">个人财务</div>
          <div class="logo-sub">PERSONAL</div>
        </div>
      </div>
      <NavMenu :collapse="isTablet" />
    </el-aside>

    <el-drawer v-else v-model="navOpen" direction="ltr" size="min(300px, 82vw)" :with-header="false"
               class="m-nav-drawer" append-to-body>
      <div class="logo">
        <div class="mark">私</div>
        <div class="logo-text">
          <div class="logo-name">个人财务</div>
          <div class="logo-sub">PERSONAL</div>
        </div>
        <el-button text circle class="m-nav-close" aria-label="收起导航" @click="navOpen = false">
          <el-icon :size="18"><Close /></el-icon>
        </el-button>
      </div>
      <NavMenu @select="navOpen = false" />
    </el-drawer>

    <el-container class="main-col">
      <el-header class="topbar">
        <div class="crumb">
          <el-button v-if="isMobile" text circle class="m-menu-btn" aria-label="打开导航" @click="navOpen = true">
            <el-icon :size="20"><Expand /></el-icon>
          </el-button>
          <span class="title">{{ route.meta.title }}</span>
        </div>
        <div class="right">
          <el-button v-if="route.path !== '/ai'" type="primary" class="ai-open-btn" @click="toggleDrawer"><el-icon><MagicStick /></el-icon>&nbsp;AI 记账</el-button>
          <el-dropdown :trigger="isMobile ? 'click' : 'hover'" @command="onCommand">
            <span class="user">
              <el-avatar v-if="isMobile" :size="32" style="background: var(--text)">{{ user?.name?.[0] || '我' }}</el-avatar>
              <template v-else>
                <el-avatar :size="26" style="background: var(--text)">{{ user?.name?.[0] || '我' }}</el-avatar>
                <span>{{ user?.name }}</span>
                <el-icon><ArrowDown /></el-icon>
              </template>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <template v-if="isMobile">
                  <el-dropdown-item disabled class="m-user-line">{{ user?.name }}</el-dropdown-item>
                </template>
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

    <AiDrawer />
  </el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getUser, clearAuth } from '@/api'
import { getPlatformHome } from '@/api/base'
import { loadMeta } from '@/composables/useMeta'
import AiDrawer from '@/components/AiDrawer.vue'
import NavMenu from './NavMenu.vue'
import { useViewport } from '@/composables/useViewport'
import { toggleDrawer, resetAi } from '@/composables/useAiAssistant'

const route = useRoute()
const router = useRouter()
const user = ref(getUser())
const navOpen = ref(false)
const { isMobile, isTablet } = useViewport()

onMounted(() => loadMeta().catch(() => {}))

function onCommand(cmd) {
  if (cmd === 'settings') return router.push('/settings')
  clearAuth()
  resetAi() // 草稿和引用在内存里，不清掉下一个登录的人会看到
  // 从以虎 One 进来的：回到平台工作台（留在这里会被自动再登录一次）
  const home = getPlatformHome()
  if (home) location.href = home
  else router.replace('/login')
}
</script>

<style scoped>
.layout { height: 100vh; }
.main-col { min-width: 0; }
.sidebar { background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
.logo { display: flex; align-items: center; gap: 10px; padding: 18px 18px 14px; border-bottom: 1px solid var(--border); }
.mark { width: 30px; height: 30px; border-radius: 8px; background: var(--text); color: #faf9f7; display: grid; place-items: center; font-size: 14px; font-weight: 600; }
.logo-name { font-size: 15px; font-weight: 600; line-height: 1.2; }
.logo-sub { font-family: var(--font-num); font-size: 10px; letter-spacing: 0.18em; color: var(--accent); font-weight: 700; }
.topbar { height: 56px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
.crumb { display: flex; align-items: center; gap: 10px; }
.title { font-size: 15px; font-weight: 600; }
.right { display: flex; align-items: center; gap: 16px; }
.user { display: flex; align-items: center; gap: 8px; cursor: pointer; outline: none; font-size: 14px; }
.main { background: var(--bg); padding: 18px 20px; overflow-y: auto; }

/* 平板：图标栏 */
.sidebar.is-collapsed .logo { justify-content: center; padding: 18px 0 14px; }

/* 手机 */
@media (max-width: 768px) {
  .layout { height: 100dvh; }
  .topbar { height: 52px; padding: 0 6px 0 4px; padding-left: max(4px, env(safe-area-inset-left)); padding-right: max(6px, env(safe-area-inset-right)); }
  .crumb { min-width: 0; flex: 1; gap: 4px; }
  .title { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .m-menu-btn { flex-shrink: 0; }
  .right { gap: 6px; flex-shrink: 0; }
  .ai-open-btn { min-height: 44px; padding: 0 12px; font-size: 14px; }
  .user { min-width: 44px; min-height: 44px; justify-content: center; }
  .main { padding: 12px 12px calc(16px + env(safe-area-inset-bottom)); }
}
</style>

<!-- 导航抽屉 append 到 body，scoped 样式够不到 -->
<style>
.m-nav-drawer .el-drawer__body { padding: 0; display: flex; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }
.m-nav-drawer .logo {
  display: flex; align-items: center; gap: 10px;
  padding: calc(14px + env(safe-area-inset-top)) 8px 12px 18px; border-bottom: 1px solid var(--border);
}
.m-nav-drawer .mark {
  width: 30px; height: 30px; border-radius: 8px; background: var(--text); color: #faf9f7;
  display: grid; place-items: center; font-size: 14px; font-weight: 600;
}
.m-nav-drawer .logo-text { flex: 1; }
.m-nav-drawer .logo-name { font-size: 15px; font-weight: 600; line-height: 1.2; }
.m-nav-drawer .logo-sub { font-family: var(--font-num); font-size: 10px; letter-spacing: 0.18em; color: var(--accent); font-weight: 700; }
.m-user-line { font-size: 14px !important; color: var(--text-muted) !important; cursor: default; }
.el-dropdown-menu__item .el-icon { margin-right: 6px; }
</style>
