# 给 Claude 的项目须知

个人财务系统（以明私人账本），与集团财务 `~/Develop/gitee/yihu-finance` 分开，但架构/风格/约定沿用它。
对应的 Obsidian 账本：`~/Downloads/百度云同步空间/02.Creation/Write Space/01.Finance/06.家庭个人/`。

## 动手前
- 读 README「三、口径」和「五、硬约定」。
- 写流水只走 `backend/src/lib/ledger.js`；新增会产生现金变动的动作，也在 ledger 里加，并补到 `aiEntry.js` 的 `commitOne` 和提示词字段说明里。
- 多租户：业务读写一律带租户过滤（`backend/src/lib/tenant.js` 的 `tenantWhere()` / `resolveUid()`），写数据一律带 `userId`，新增表先加 `userId` 列——漏过滤就是串账
- 新增科目代码时同步 `prisma/categories.js` 的 `CATEGORIES`；统计口径改动集中在 `lib/networth.js`。
- 个人数据只放 `backend/data/`（已 gitignore），不要写进代码或提示词。
- 改 schema：`cd backend && npx prisma db push && npx prisma generate`。

## 本地环境
- MySQL：`mysql://root:root@localhost:3306/personal_finance`
- 后端 3020，前端 5193（vite 代理 `/api` 到后端）

## 以虎 One 接入
- 可部署到以虎 One（见 README「部署到以虎 One」）。接入代码集中在 `backend/src/lib/platform.js`、`platform-users.js` 和 `frontend/src/api/base.js`
- 前端的接口、跳转、路由一律从 `BASE` 拼前缀，不要再写 `'/api/...'`、`location.href = '/xxx'` 这种根路径
- `backend/src/lib/yh-one.mjs` 是平台 SDK 的拷贝，不要改；要升级从平台 `/sdk/yh-one.mjs` 重新下载
- 改 schema 时新增的字段要可空或有默认值（平台上启动时 `db push` 不带 `--accept-data-loss`，会丢数据的改动直接失败）
- 新增给 AI 助手的工具：在 `backend/src/index.js` 的 `mountPlatform({ tools })` 里加，只读、用 `callSelf` 走本系统接口（权限自然一致）

