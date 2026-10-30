# yihu-personal-account · 个人记账

> 面向个人与家庭的轻量私人账本：**净资产 · 收支流水 · 预算 · 投资持仓 · 借贷往来 · AI 记账**
> Vue 3 + Element Plus ｜ Node 20 + Express 4 + Prisma 6 ｜ MySQL 8 ｜ 可作为 [以虎 One](#部署到以虎-one) 平台的应用一键安装
>
> Yihu Work Tools 套件组件之一 —— 以虎开源工具集，服务个人家庭财务。

它回答三个问题：**我有多少（净资产）？钱去哪了（收支）？按计划走没有（预算）？**

> 🌱 本仓库中的所有公司、人员、银行账号与金额均为**虚构演示数据**（见 `backend/data/personal-seed.example.json`），可放心运行与二次开发。

---

## 功能特性

### 📊 财务总览
净资产、可动用资金、应急金覆盖月数、本月收支/储蓄率、资产结构、近 12 个月收支趋势、预算执行、账户余额、待办提醒。

### ✍️ AI 记账
一句话 / 多行文字 / ⌘V 粘贴截图 → 拆成草稿（收支、转账、投资买卖、持仓估值、资产估值、余额校准、还款、新增借贷/持仓）→ 逐条核对后入账；你改过的分类会按对方名记住；导入的未分类流水也能 AI 批量归类。

### 💰 资金
| 模块 | 能力 |
|---|---|
| 收支流水 | 个人 / 公司款 / 转移三种口径筛选、批量改科目、标公司款与报销状态 |
| 导入账单 | 微信 xlsx/csv、支付宝 csv（GBK）、银行 xlsx/csv 自动识别；按交易号+时间查重；规则 → AI 两级归类；批次可撤销 |
| 账户 | 银行卡 / 微信 / 支付宝 / 现金 / 信用卡；余额 = 校准日真实余额 + 之后流水；互转、还信用卡自动生成两条转移流水 |

### 📈 投资与资产
| 模块 | 能力 |
|---|---|
| 投资持仓 | 股票 / 基金 / 理财 / 定存 / 储蓄险 / 股权；买入 / 卖出（按比例结转成本、算已实现收益）/ 分红 / 估值；选资金账户自动记转移流水 |
| 固定资产 | 房产 / 车辆 / 大件，估值历史 |

### 🤝 借贷、预算与月结
- **借贷往来**：我借出（应收）/ 我借入（负债，含房贷）；登记还款自动拆本金（转移）和利息（收支）；「待核实」不计入净资产
- **预算**：按年按科目编制；月度与年累计执行率
- **月结与净资产**：月结检查清单、净资产快照、生成 Markdown 月结摘要（可归档到 Obsidian 等笔记）
- **问问 AI**：基于资产负债表和近 6 个月收支的只读问答

---

## 口径（统计规则）

- **个人支出 = 支出类科目 − 公司款 − 转移类**。转移类（T1 互转、T2 还信用卡、T3 投资买卖、T4 家庭内部划转、T5 借贷本金）只影响账户余额，不算收支。
- **公司款**（`isBusiness`）：从个人账户付出去的公司的钱，状态「待剥离 → 已报销 / 不追回」，不计入个人支出。
- 科目代码：A 必要 / B 弹性 / C 经营 / I 收入 / T 转移；内置标准科目见 `backend/prisma/categories.js`，可自行增删。
- 演示预算按「本人承担」口径编制（家庭开销 × 2/3 已折算进预算数），可按自家口径调整。

## AI 录入怎么工作

`backend/.env` 的 `AI_PROVIDER`：

| 值 | 说明 |
|---|---|
| `claude-cli`（默认） | 调本机已登录的 `claude` 命令行，无需 API Key。文字约 5~20 秒，截图约 10 秒。`AI_CLI_MODEL=haiku` 更快，`sonnet` 更准 |
| `anthropic` | 用 `ANTHROPIC_API_KEY` 直连 Messages API（`AI_MODEL` 默认 `claude-opus-5`），部署到服务器用这个 |
| `off` | 不调模型，只用规则解析简单句子和「把这笔改成餐饮」 |
| `stub` | 不发任何外部请求，按 `lib/llmStub.js` 的规则返回确定结果；`npm test` 和本地联调用 |

解析优先级：**你学过的规则 > 模型判断 > 科目关键字**。AI 只产出草稿，入账永远要点确认。每次解析都记在 `AiEntryLog`，方便回看。

**随身抽屉**：顶栏「AI 记账」在任何页面打开，切换页面不关、草稿保留（`/ai` 是完整模式，多了只读问答）。列表上的 `@` 把记录放进引用，可以直接说「把这笔改成餐饮」「这笔还信用卡」「还了 2000」。

**「这笔」指什么**：用户明确说的 > `@` 引用的 > 当前页筛选 > 不确定就问。`@` 到的记录由服务端按当前用户重新查库，越权或不存在时整句拒绝，不会丢掉引用继续出草稿。

**提交幂等**：草稿落库（`AiDraft`），入账走 `POST /api/pf/ai/drafts/:id/submit`。同一草稿重复提交返回第一次的结果；内容相同的另一张草稿 60 秒内也按重复处理，靠 `AiSubmission.fingerprint` 唯一索引挡并发。同一批解析里两笔一样的账不算重复。细节见 `docs/接口说明.md`。

---

## 快速启动

```bash
# 1. 数据库（本地 MySQL，默认 root/root）
mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS personal_finance DEFAULT CHARACTER SET utf8mb4"

# 2. 后端
cd backend && npm install
cp .env.example .env        # 按需改 DATABASE_URL / JWT_SECRET / AI_PROVIDER
npx prisma db push          # 建表

# 3. 演示数据（可选）
# 真实个人数据 backend/data/personal-seed.json 不进 git；想直接体验完整账本，
# 复制仓库自带的虚构演示种子即可（相当于在仓库根目录执行
# cp backend/data/personal-seed.example.json backend/data/personal-seed.json）：
cp data/personal-seed.example.json data/personal-seed.json
npm run seed                # 写入标准科目 + 演示数据（不 cp 则只建 admin/admin123 和科目）

# 4. 启动
npm run dev                 # http://localhost:3020
cd ../frontend && npm install && npm run dev   # http://localhost:5193
```

或一键启动：`./start.sh`（首次会自动建库、建表、初始化）。

默认账号 `admin / admin123`（**仅本地演示用，部署到公网前务必修改密码或改用统一登录**）。`frontend` 执行 `npm run build` 后，后端会直接托管页面，只开 `http://localhost:3020` 也能用。

---

## 多租户与数据隔离

- **本地单机**：单用户（`admin`），登录后在「系统设置」改密码；个人数据只放 `backend/data/`（已 gitignore），`personal-seed.json`、原始账单 CSV 都不进仓库。
- **接到以虎 One 后**：每个平台用户一本独立账本、互相隔离。平台用户首次进入自动开户（`platform_<id>`，只走 SSO、无本地密码）并初始化一套标准科目；兼容旧单主人数据——还没人绑定时，第一个进来的平台用户接管最早的账号及其历史数据。
- **二次开发铁律**：业务读写一律带租户过滤（`backend/src/lib/tenant.js` 的 `tenantWhere()` / `resolveUid()`），写数据一律带 `userId`，新增表先加 `userId` 列——漏过滤就是串账。

---

## 部署到以虎 One

本系统可以作为应用插到 [以虎 One](https://github.com/guoylyy/yihu-one) 平台（自托管的小团队工作台，统一登录 + 应用市场 + AI 助手）上：用平台的统一登录，挂在 `<平台地址>/apps/personal-account/` 下，AI 助手可以直接查询净资产、预算和月结。本地开发不受影响——不配平台注入的 `YH_*` 环境变量时，一切照旧（账号密码登录、根路径访问）。

**版本**：当前 `1.2.0`（`VERSION` 文件与 `yh-app.json` 的 `version` 字段保持一致，遵循语义化版本；每次发版同步更新，平台据此展示与升级比对）。

**安装**：平台控制台「管理 → 应用 → 从 Git 安装应用」填本仓库地址 `https://github.com/guoylyy/yihu-personal-account` 和 code `personal-account`；或在平台服务器上：

```bash
./yh add personal-account --git https://github.com/guoylyy/yihu-personal-account     # 本机目录用 --path
./yh up personal-account
```

**发布**：在 `main` 上开发，要上线时 `./release.sh`（检查 → 构建 → 推到 `release` 分支），平台两分钟内自动发布，失败自动回滚。

**迁移已有数据**：容器启动只会建表、补科目/分类，不会写入真实数据。把本机库导进平台：

```bash
mysqldump -uroot -proot --single-transaction --routines personal_finance | gzip > /tmp/personal_finance.sql.gz
# 拷到平台服务器后，在平台目录：
./yh restore personal-account /tmp/personal_finance.sql.gz && ./yh restart personal-account
```

**从旧版（单主人）数据升级到多租户**：旧库没有 `userId` 列，而新版 schema 给各表加了带 `userId` 的唯一约束——应用启动时的 `db push`（不带 `--accept-data-loss`）会拒绝这种改动，导致发布失败回滚。要先手动放行一次并回填历史数据，再上线（在平台服务器上执行）：

```bash
git -C apps/personal-account/src fetch origin release && git -C apps/personal-account/src checkout -f --detach FETCH_HEAD
docker compose -f apps/personal-account/compose.yml build
docker run --rm --network yh-app-personal-account --env-file apps/personal-account/.env \
  yh-app-personal-account:latest \
  sh -c "npx prisma db push --accept-data-loss --skip-generate && node prisma/migrate-tenant.js"
./yh up personal-account
```

`migrate-tenant.js` 幂等：把所有 `userId` 为空的历史数据归属到账本主人。以后 schema 再新增唯一约束，同样要在上线前手动 `db push --accept-data-loss` 一次。

| 接入点 | 说明 |
| --- | --- |
| 清单 | `yh-app.json`（端口 3020、健康检查 `/api/health`、需要数据库、MCP `/mcp`） |
| 镜像 | `Dockerfile`：构建前端，后端托管页面；启动时 `prisma db push`（会丢数据的改动直接失败，平台回滚），`seed.js` 可重复执行，只补科目（`backend/data/` 不进镜像） |
| 统一登录 | `backend/src/lib/platform.js` + `platform-users.js` + `tenant.js`：多租户。平台用户首次进入自动开户（`platform_<id>`，只走 SSO，无本地密码）并初始化一套标准科目，数据按 `userId` 隔离；兼容旧单主人数据：还没人绑定时第一个进来的平台用户接管最早的账号及其历史数据。清单可见范围已放开（全部登录用户可见） |
| 本地密码登录 | 在平台上默认关闭（种子里的默认密码不能暴露在公网上），确需时 `apps/personal-account/.env` 里设 `ALLOW_LOCAL_LOGIN=true` |
| 页面路径 | 后端给 `index.html` 注入 `<base href="/apps/personal-account/">`，前端接口、路由都从 `frontend/src/api/base.js` 的 `BASE` 拼 |
| AI 工具（只读） | `get_financial_overview` 财务总览、`get_budget_execution` 预算执行、`get_month_summary` 月结摘要 |
| JWT 密钥 | 没配 `JWT_SECRET` 时从平台注入的应用密钥派生 |
| AI 记账 | 容器里没有 `claude` 命令行：在 `apps/personal-account/.env` 里填 `ANTHROPIC_API_KEY`（自动用 anthropic），不填则只用规则解析 |

---

## 仓库结构

```
backend/
  prisma/schema.prisma      账户/科目/规则/流水/持仓/交易/固定资产/估值/借贷/还款/预算/净资产快照/AI 记录
  prisma/categories.js      标准科目代码（seed 与平台开户共用）
  prisma/seed.js            科目（代码内）+ 个人数据（data/personal-seed.json，不进仓库）
  prisma/migrate-tenant.js  一次性迁移：历史数据回填 userId（单主人 → 多租户）
  data/personal-seed.example.json  虚构演示种子（cp 为 personal-seed.json 后 npm run seed）
  scripts/import-2026-bills.js
  src/lib/tenant.js         请求级租户上下文（AsyncLocalStorage），查询统一带 userId
  src/lib/ledger.js         记账动作（流水、互转、持仓交易、估值、还款、校准）
  src/lib/networth.js       资产负债表、月度收支统计
  src/lib/aiEntry.js        AI 录入：上下文 → 解析 → 对 id → 入账；规则兜底
  src/lib/aiContext.js      页面上下文与 @ 引用：重新查库、解析优先级
  src/lib/aiDrafts.js       草稿落库与提交幂等（草稿锁 + 指纹唯一索引）
  src/lib/llm.js            模型调用（claude-cli / anthropic / off / stub）
  test/                     node --test，进程内起 app + stub 模型，自建数据、跑完硬删除
  src/lib/billParser.js     微信/支付宝/银行账单解析
  src/lib/classify.js       规则分类与学习
frontend/src/
  components/AiEntry.vue    AI 录入组件（/ai 页和抽屉共用，状态在 composables/useAiAssistant.js）
  components/AiDrawer.vue   全局抽屉，挂在 Layout 上，不随路由销毁
  views/                    12 个页面
```

---

## 测试

```bash
cd backend && npm test        # 不需要模型，也不需要后端在跑，只需要 .env 里的数据库；自建数据，跑完硬删除
cd frontend && npm run build && APP_URL=http://127.0.0.1:3020 node scripts/mobile-audit.mjs audit   # 移动端验收，含抽屉打开态
```

---

## 几条硬约定（二次开发前必读）

1. 金额 `Decimal(18,2)`；日期 `@db.Date` 按 UTC 零点（用 `lib/period.js` 的 `toDate()`）。
2. 写流水只走 `lib/ledger.js`，写完重算余额（`recalcAccountBalance`）。
3. 删除一律软删。
4. 个人数据（`backend/data/`）不进 git：`personal-seed.json`、原始账单 CSV。
5. 多租户：业务读写一律带租户过滤（`lib/tenant.js` 的 `tenantWhere()` / `resolveUid()`），写数据必须带 `userId`，新增表先加 `userId` 列——漏过滤就是串账。
6. schema 新增唯一约束会被平台启动的 `db push` 拦截（安全默认），上线前手动放行一次，见「部署到以虎 One → 从旧版升级」。

---

## License

[Apache-2.0](LICENSE)
