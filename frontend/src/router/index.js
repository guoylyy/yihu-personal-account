import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '@/api'
import { BASE } from '@/api/base'

const v = (name) => () => import(`@/views/${name}.vue`)
const routes = [
  { path: '/login', component: v('Login'), meta: { public: true } },
  // 以虎 One 统一登录回来的落地页
  { path: '/sso-done', component: v('SsoDone'), meta: { public: true } },
  {
    path: '/',
    component: v('Layout'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: v('Dashboard'), meta: { title: '财务总览' } },
      { path: 'ai', component: v('AiEntryPage'), meta: { title: 'AI 记账' } },
      { path: 'accounts', component: v('Accounts'), meta: { title: '账户' } },
      { path: 'transactions', component: v('Transactions'), meta: { title: '收支流水' } },
      { path: 'import', component: v('Import'), meta: { title: '导入账单' } },
      { path: 'holdings', component: v('Holdings'), meta: { title: '投资持仓' } },
      { path: 'assets', component: v('Assets'), meta: { title: '固定资产' } },
      { path: 'loans', component: v('Loans'), meta: { title: '借贷往来' } },
      { path: 'budget', component: v('Budget'), meta: { title: '预算' } },
      { path: 'close', component: v('Close'), meta: { title: '月结与净资产' } },
      { path: 'categories', component: v('Categories'), meta: { title: '科目与规则' } },
      { path: 'settings', component: v('Settings'), meta: { title: '设置' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
]

const router = createRouter({ history: createWebHistory(BASE + '/'), routes })
router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!getToken()) return { path: '/login', query: { redirect: to.fullPath } }
  return true
})
export default router
