<!--
  AI 辅助录入：说一句话 / 贴几行 / 粘贴账单截图 → AI 拆成草稿 → 逐条核对修改 → 确认入账
  你改过的科目会被记住（按对方名），下次同一对方自动套用
-->
<template>
  <div class="ai-entry">
    <div class="input-card" @paste="onPaste" @dragover.prevent @drop.prevent="onDrop">
      <el-input v-model="text" type="textarea" :autosize="{ minRows: compact ? 4 : 5, maxRows: 12 }" resize="none"
                :placeholder="placeholder" @keydown.meta.enter="parse" @keydown.ctrl.enter="parse" />
      <div v-if="images.length" class="thumbs">
        <div v-for="(img, i) in images" :key="img.url" class="thumb">
          <img :src="img.url" />
          <el-icon class="rm" @click="images.splice(i, 1)"><CircleCloseFilled /></el-icon>
        </div>
      </div>
      <div class="bar">
        <div class="examples">
          <span class="muted">试试：</span>
          <el-tag v-for="e in examples" :key="e" effect="plain" class="ex" @click="useExample(e)">{{ e.split('\n')[0] }}</el-tag>
        </div>
        <div class="actions">
          <el-upload :show-file-list="false" accept="image/*" multiple :auto-upload="false" :on-change="onFile">
            <el-button text><el-icon><Picture /></el-icon>&nbsp;截图</el-button>
          </el-upload>
          <el-button type="primary" :loading="parsing" @click="parse">
            <el-icon v-if="!parsing"><MagicStick /></el-icon>&nbsp;{{ parsing ? 'AI 解析中…' : '解析' }}
          </el-button>
        </div>
      </div>
      <div class="muted tip">
        支持一次多笔（换行分隔）、可直接 ⌘V 粘贴微信/支付宝/银行 App 截图 · ⌘+Enter 解析
        <span v-if="status"> · {{ status.enabled ? `AI：${status.provider} / ${status.model}` : status.hint }}</span>
      </div>
    </div>

    <div v-if="parsing" class="parsing muted"><el-icon class="is-loading"><Loading /></el-icon> 正在理解你的输入，通常 10~20 秒；截图会更久一点</div>

    <template v-if="items.length">
      <div class="drafts-head">
        <div>
          <b>{{ items.length }}</b> 条草稿
          <span class="muted" style="margin-left: 8px">{{ meta.provider }} · {{ (meta.ms / 1000).toFixed(1) }}s</span>
          <el-tag v-if="meta.error" type="warning" size="small" style="margin-left: 8px">AI 失败，已用规则兜底</el-tag>
        </div>
        <div>
          <el-button text @click="items = []">清空</el-button>
          <el-button type="primary" :loading="committing" :disabled="!selectedCount" @click="commit">
            确认入账（{{ selectedCount }}）
          </el-button>
        </div>
      </div>

      <div v-for="(it, idx) in items" :key="it._k" class="draft" :class="{ off: !it._on, done: it._done, failed: it._err }">
        <div class="d-head">
          <el-checkbox v-model="it._on" :disabled="it._done" />
          <el-select v-model="it.type" size="small" style="width: 110px" @change="refresh(it)">
            <el-option v-for="(label, v) in AI_TYPES" :key="v" :label="label" :value="v" />
          </el-select>
          <span v-if="it.type === 'transaction'" class="money big" :class="it.direction === 'IN' ? 'money-in' : 'money-out'">
            {{ it.direction === 'IN' ? '+' : '−' }}{{ money(it.amount) }}
          </span>
          <span v-else class="money big">{{ it.amount != null ? money(it.amount) : '' }}</span>
          <el-tag v-if="it.matchedRule" size="small" type="success" effect="plain">按规则「{{ it.matchedRule }}」</el-tag>
          <el-tag v-if="it.confidence != null && it.confidence < 0.7" size="small" type="warning" effect="plain">把握 {{ Math.round(it.confidence * 100) }}%</el-tag>
          <el-tag v-for="w in it.warnings" :key="w" size="small" type="danger" effect="plain">{{ w }}</el-tag>
          <span class="spacer" />
          <el-tag v-if="it._done" type="success" size="small">已入账 {{ it._ref }}</el-tag>
          <el-button v-else link type="danger" @click="items.splice(idx, 1)">移除</el-button>
        </div>
        <div v-if="it.note" class="note muted">AI：{{ it.note }}</div>
        <div v-if="it._err" class="note err">入账失败：{{ it._err }}</div>

        <div class="fields">
          <Field label="日期"><el-date-picker v-model="it.date" type="date" value-format="YYYY-MM-DD" size="small" style="width: 100%" /></Field>

          <!-- 收支 -->
          <template v-if="it.type === 'transaction'">
            <Field label="方向">
              <el-radio-group v-model="it.direction" size="small">
                <el-radio-button value="OUT">支出</el-radio-button><el-radio-button value="IN">收入</el-radio-button>
              </el-radio-group>
            </Field>
            <Field label="金额"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="账户"><AccountSelect v-model="it.accountId" /></Field>
            <Field label="科目" wide>
              <el-select v-model="it.categoryId" filterable size="small" style="width: 100%" placeholder="选科目" @change="onCategory(it)">
                <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label">
                  <el-option v-for="o in g.options" :key="o.value" :label="o.label" :value="o.value" />
                </el-option-group>
              </el-select>
            </Field>
            <Field label="对方"><el-input v-model="it.counterparty" size="small" /></Field>
            <Field label="说明" wide><el-input v-model="it.description" size="small" /></Field>
            <Field label="公司款">
              <el-switch v-model="it.isBusiness" size="small" />
              <el-select v-if="it.isBusiness" v-model="it.businessOrg" size="small" allow-create filterable placeholder="哪家" style="width: 100px; margin-left: 8px">
                <el-option v-for="o in ORGS" :key="o" :label="o" :value="o" />
              </el-select>
            </Field>
            <Field v-if="it.counterparty" label=" " wide>
              <el-checkbox v-model="it.learn" size="small">记住：以后「{{ it.counterparty }}」都这样归类</el-checkbox>
            </Field>
          </template>

          <template v-else-if="it.type === 'transfer'">
            <Field label="金额"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="转出"><AccountSelect v-model="it.accountId" /></Field>
            <Field label="转入"><AccountSelect v-model="it.toAccountId" /></Field>
            <Field label="说明" wide><el-input v-model="it.description" size="small" /></Field>
          </template>

          <template v-else-if="it.type === 'trade'">
            <Field label="持仓"><OptSelect v-model="it.holdingId" :options="holdingOpts" /></Field>
            <Field label="操作"><OptSelect v-model="it.action" :options="TRADE_ACTIONS.filter((a) => a.value !== 'VALUATION')" /></Field>
            <Field label="数量"><el-input-number v-model="it.quantity" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="价格"><el-input-number v-model="it.price" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="金额"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="费用"><el-input-number v-model="it.fee" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="资金账户"><AccountSelect v-model="it.accountId" placeholder="可不选" /></Field>
          </template>

          <template v-else-if="it.type === 'holding_valuation'">
            <Field label="持仓"><OptSelect v-model="it.holdingId" :options="holdingOpts" /></Field>
            <Field label="新价格"><el-input-number v-model="it.price" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="或新市值"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          </template>

          <template v-else-if="it.type === 'asset_valuation'">
            <Field label="资产"><OptSelect v-model="it.assetId" :options="assetOpts" /></Field>
            <Field label="新估值"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="依据" wide><el-input v-model="it.description" size="small" /></Field>
          </template>

          <template v-else-if="it.type === 'balance'">
            <Field label="账户"><AccountSelect v-model="it.accountId" /></Field>
            <Field label="真实余额"><el-input-number v-model="it.amount" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          </template>

          <template v-else-if="it.type === 'loan_repay'">
            <Field label="借贷"><OptSelect v-model="it.loanId" :options="loanOpts" /></Field>
            <Field label="本金"><el-input-number v-model="it.principal" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="利息"><el-input-number v-model="it.interest" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="账户"><AccountSelect v-model="it.accountId" placeholder="可不选" /></Field>
          </template>

          <template v-else-if="it.type === 'new_loan'">
            <Field label="方向"><OptSelect v-model="it.direction" :options="LOAN_DIRECTIONS" /></Field>
            <Field label="对方"><el-input v-model="it.counterparty" size="small" /></Field>
            <Field label="金额"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="类型"><OptSelect v-model="it.kind" :options="LOAN_KINDS" /></Field>
            <Field label="说明" wide><el-input v-model="it.description" size="small" /></Field>
          </template>

          <template v-else-if="it.type === 'new_holding'">
            <Field label="名称"><el-input v-model="it.holding" size="small" /></Field>
            <Field label="类型"><OptSelect v-model="it.holdingType" :options="HOLDING_TYPES" /></Field>
            <Field label="代码"><el-input v-model="it.code" size="small" /></Field>
            <Field label="平台"><el-input v-model="it.platform" size="small" /></Field>
            <Field label="数量"><el-input-number v-model="it.quantity" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="价格"><el-input-number v-model="it.price" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="金额"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
            <Field label="资金账户"><AccountSelect v-model="it.accountId" placeholder="可不选" /></Field>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h } from 'vue'
import { ElMessage, ElSelect, ElOption } from 'element-plus'
import api from '@/api'
import { money } from '@/utils/format'
import { categories, categoryGroups, accountOptions, loadMeta } from '@/composables/useMeta'
import { AI_TYPES, ORGS, TRADE_ACTIONS, LOAN_DIRECTIONS, LOAN_KINDS, HOLDING_TYPES } from '@/constants'

defineProps({ compact: Boolean })
const emit = defineEmits(['committed'])

// 小组件：带标签的字段、通用下拉、账户下拉
const Field = (props, { slots }) =>
  h('div', { class: ['field', props.wide !== undefined && props.wide !== false ? 'wide' : ''] }, [h('label', props.label), h('div', { class: 'ctl' }, slots.default?.())])
Field.props = ['label', 'wide']
const OptSelect = (props, { emit: e }) =>
  h(ElSelect, { modelValue: props.modelValue, size: 'small', filterable: true, clearable: true, style: 'width:100%', placeholder: props.placeholder || '请选择', 'onUpdate:modelValue': (v) => e('update:modelValue', v) },
    () => (props.options || []).map((o) => h(ElOption, { key: o.value, label: o.label, value: o.value })))
OptSelect.props = ['modelValue', 'options', 'placeholder']
OptSelect.emits = ['update:modelValue']
const AccountSelect = (props, ctx) => h(OptSelect, { ...props, options: accountOptions(), 'onUpdate:modelValue': (v) => ctx.emit('update:modelValue', v) })
AccountSelect.props = ['modelValue', 'placeholder']
AccountSelect.emits = ['update:modelValue']

const text = ref('')
const images = ref([])
const items = ref([])
const meta = ref({})
const parsing = ref(false)
const committing = ref(false)
const status = ref(null)
const holdingOpts = ref([])
const assetOpts = ref([])
const loanOpts = ref([])

const placeholder = `说人话记账，一次可以多笔，例如：
昨天和朋友吃火锅 386 光大信用卡
工资到账 3.5万 农行
给老婆转了 5000
且慢今天市值 48900
还光大信用卡 2000，从农行扣`
const examples = [
  '今天午饭 45 微信',
  '帮公司付了阿里云服务器 1280 泰隆，示例公司的',
  '买入 腾讯控股 100股 价格 385 手续费 5',
  '房产（第一套）最新估值 360 万',
  '李新民还了 2 万，打到农行',
  '泰隆银行现在余额 76543.21'
]
const selectedCount = computed(() => items.value.filter((i) => i._on && !i._done).length)
let seq = 0

onMounted(async () => {
  loadMeta().catch(() => {})
  api.ai.status().then((s) => (status.value = s)).catch(() => {})
  const [h1, a1, l1] = await Promise.all([
    api.holdings.list({ page_size: 200, status: 'HOLDING' }), api.assets.list({ page_size: 200 }), api.loans.list({ page_size: 200 })
  ])
  holdingOpts.value = h1.list.map((x) => ({ value: String(x.id), label: x.name }))
  assetOpts.value = a1.list.map((x) => ({ value: String(x.id), label: x.name }))
  loanOpts.value = l1.list.filter((x) => x.status !== 'SETTLED').map((x) => ({ value: String(x.id), label: `${x.counterparty}（${x.direction === 'LEND' ? '应收' : '负债'}）` }))
})

function useExample(e) { text.value = text.value ? `${text.value}\n${e}` : e }

function addImage(file) {
  if (!file || !/^image\//.test(file.type)) return
  if (images.value.length >= 6) return ElMessage.warning('一次最多 6 张')
  images.value.push({ file, url: URL.createObjectURL(file) })
}
function onPaste(e) {
  for (const item of e.clipboardData?.items || []) if (item.kind === 'file') addImage(item.getAsFile())
}
function onDrop(e) { for (const f of e.dataTransfer.files) addImage(f) }
function onFile(f) { addImage(f.raw) }

function onCategory(it) {
  const c = categories.value.find((x) => String(x.id) === it.categoryId)
  it.categoryCode = c?.code
  if (c?.code === 'C') it.isBusiness = true
  it.warnings = (it.warnings || []).filter((w) => w !== '未识别科目')
}

async function refresh(it) {
  const [r] = await api.ai.resolve([it])
  Object.assign(it, { warnings: r.warnings })
}

async function parse() {
  if (!text.value.trim() && !images.value.length) return ElMessage.warning('说点什么，或粘贴一张截图')
  parsing.value = true
  try {
    const fd = new FormData()
    fd.append('text', text.value)
    for (const img of images.value) fd.append('images', img.file)
    const r = await api.ai.parse(fd)
    meta.value = { provider: r.provider, ms: r.ms, error: r.error, logId: r.logId }
    items.value = r.items.map((i) => ({ ...i, _k: ++seq, _on: true, learn: false }))
    if (!r.items.length) ElMessage.warning('没识别出可以入账的内容，换个说法试试')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    parsing.value = false
  }
}

async function commit() {
  const todo = items.value.filter((i) => i._on && !i._done)
  committing.value = true
  try {
    const clean = todo.map(({ _k, _on, _done, _err, _ref, ...rest }) => rest)
    const results = await api.ai.commit({ items: clean, logId: meta.value.logId })
    results.forEach((r, i) => {
      const it = todo[i]
      if (r.ok) { it._done = true; it._ref = r.ref; it._err = null } else it._err = r.error
    })
    const okN = results.filter((r) => r.ok).length
    const bad = results.length - okN
    if (bad) ElMessage.warning(`入账 ${okN} 条，${bad} 条失败，改一下再提交`)
    else {
      ElMessage.success(`已入账 ${okN} 条`)
      text.value = ''
      images.value = []
      setTimeout(() => { items.value = items.value.filter((i) => !i._done) }, 1200)
      loadMeta(true)
      emit('committed')
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    committing.value = false
  }
}
</script>

<style scoped>
.input-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--card-radius); padding: 12px; }
.input-card :deep(.el-textarea__inner) { box-shadow: none; padding: 4px 2px; font-size: 14px; line-height: 1.7; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; flex: 1; }
.ex { cursor: pointer; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; gap: 6px; align-items: center; }
.tip { font-size: 12px; margin-top: 6px; }
.thumbs { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.thumb { position: relative; width: 72px; height: 72px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.rm { position: absolute; top: 2px; right: 2px; cursor: pointer; color: var(--danger); background: #fff; border-radius: 50%; }
.parsing { padding: 18px 4px; display: flex; gap: 8px; align-items: center; }
.drafts-head { display: flex; justify-content: space-between; align-items: center; margin: 16px 0 10px; }
.draft { background: var(--surface); border: 1px solid var(--border); border-radius: var(--card-radius); padding: 10px 14px 12px; margin-bottom: 10px; transition: opacity .2s; }
.draft.off { opacity: .5; }
.draft.done { border-color: #cfe3d8; background: #f6faf8; }
.draft.failed { border-color: #efc4c0; }
.d-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.big { font-size: 17px; font-weight: 600; }
.spacer { flex: 1; }
.note { font-size: 12px; margin: 6px 0 0 24px; }
.err { color: var(--danger); }
.fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 14px; margin-top: 10px; }
.fields :deep(.field) { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fields :deep(.field.wide) { grid-column: span 2; }
.fields :deep(.field > label) { width: 52px; flex-shrink: 0; font-size: 12px; color: var(--text-muted); text-align: right; }
.fields :deep(.field > .ctl) { flex: 1; min-width: 0; display: flex; align-items: center; }

/* 手机：解析/截图固定在屏幕底部，示例横滑，草稿卡单列；只调布局，交互不变 */
@media (max-width: 768px) {
  .ai-entry { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
  .input-card :deep(.el-textarea__inner) { font-size: 16px; }
  .examples { flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto; min-width: 0; font-size: 14px; }
  .examples > .muted { flex-shrink: 0; }
  .ex { flex-shrink: 0; min-height: 44px; max-width: none; white-space: nowrap; }
  .actions {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; gap: 8px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    background: var(--surface); border-top: 1px solid var(--border);
  }
  .actions :deep(.el-upload), .actions > div:first-child { display: block; flex: 1; }
  .actions .el-button { width: 100%; min-height: 48px; font-size: 15px; margin: 0; }
  .actions > .el-button { flex: 2; }
  .tip { font-size: 14px; line-height: 1.6; }
  .thumb { width: 88px; height: 88px; }
  .rm { top: 0; right: 0; width: 44px; height: 44px; font-size: 22px; background: transparent; }
  .parsing { font-size: 14px; }
  .drafts-head {
    position: sticky; top: -12px; z-index: 5; flex-wrap: wrap; gap: 6px;
    margin: 12px -4px 10px; padding: 8px 4px; background: var(--bg);
  }
  .draft { padding: 10px 12px 12px; }
  .note { font-size: 14px; margin-left: 0; }
  .fields { grid-template-columns: minmax(0, 1fr); }
  .fields :deep(.field.wide) { grid-column: span 1; }
  .fields :deep(.field) { align-items: flex-start; flex-direction: column; gap: 4px; }
  .fields :deep(.field > label) { width: auto; font-size: 14px; text-align: left; }
  .fields :deep(.field > .ctl) { width: 100%; flex-wrap: wrap; }
}
</style>
