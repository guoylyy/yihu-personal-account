<!--
  AI 辅助录入：说一句话 / 贴几行 / 粘贴账单截图 → AI 拆成草稿 → 逐条核对修改 → 确认入账
  你改过的科目会被记住（按对方名），下次同一对方自动套用
-->
<template>
  <div class="ai-entry" :class="{ 'is-compact': compact }">
    <!-- 抽屉有自己的「已引用」条；完整页也要看得见，否则引用在生效却没有地方能看到和移除 -->
    <div v-if="!compact && pinned.length" class="page-pins">
      <span class="muted">已引用：</span>
      <el-tag v-for="p in pinned" :key="`${p.type}${p.id}`" class="pin-tag" closable effect="plain" size="small" @close="unpin(p)">{{ p.label }}</el-tag>
    </div>
    <div class="input-card" @paste="onPaste" @dragover.prevent @drop.prevent="onDrop">
      <el-input v-model="text" type="textarea" :autosize="inputSize" resize="none"
                :placeholder="compact && items.length ? '接着说下一笔…' : placeholder" @keydown.meta.enter="parse" @keydown.ctrl.enter="parse" />
      <div v-if="images.length" class="thumbs">
        <div v-for="(img, i) in images" :key="img.url" class="thumb">
          <img :src="img.url" />
          <el-icon class="rm" @click="images.splice(i, 1)"><CircleCloseFilled /></el-icon>
        </div>
      </div>
      <div class="bar">
        <div v-if="!compact || !items.length" class="examples">
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
      <div v-if="!compact || !items.length" class="muted tip">
        {{ isMobile ? '支持一次多笔（换行分隔），可上传微信/支付宝/银行 App 截图，写好后点「解析」按钮' : '支持一次多笔（换行分隔）、可直接 ⌘V 粘贴微信/支付宝/银行 App 截图 · ⌘+Enter 解析' }}
        <span v-if="status"> · {{ status.enabled ? `AI：${status.provider} / ${status.model}` : status.hint }}</span>
      </div>
    </div>

    <div class="draft-zone">
    <div v-if="parsing" class="parsing muted"><el-icon class="is-loading"><Loading /></el-icon> 正在理解你的输入，通常 10~20 秒；截图会更久一点</div>
    <div v-if="question" class="question"><el-icon><QuestionFilled /></el-icon><span>{{ question }}</span></div>

    <template v-if="items.length">
      <div class="drafts-head">
        <div>
          <b>{{ items.length }}</b> 条草稿
          <span class="muted" style="margin-left: 8px">{{ meta.provider }} · {{ (meta.ms / 1000).toFixed(1) }}s</span>
          <el-tag v-if="meta.error" type="warning" size="small" style="margin-left: 8px">AI 失败，已用规则兜底</el-tag>
        </div>
        <div>
          <el-button text @click="items = []">清空</el-button>
          <el-button v-if="!fixedCommit" type="primary" :loading="committing" :disabled="!selectedCount" @click="commit">
            确认入账（{{ selectedCount }}）
          </el-button>
        </div>
      </div>

      <div v-for="(it, idx) in items" :key="it._k" class="draft" :class="{ off: !it._on, done: it._done, failed: it._err }">
        <div class="d-head">
          <el-checkbox v-model="it._on" :disabled="it._done" />
          <el-tag v-if="it.type === 'update_transaction'" type="warning" effect="plain">修改流水</el-tag>
          <el-select v-else v-model="it.type" size="small" style="width: 110px" @change="refresh(it)">
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
          <el-tag v-if="it._done" :type="it._dup ? 'warning' : 'success'" size="small">{{ it._dup ? `刚才已记过 ${it._ref}` : `已入账 ${it._ref}` }}</el-tag>
          <template v-else>
            <el-button link type="danger" @click="items.splice(idx, 1)">移除</el-button>
            <el-button class="card-submit" type="primary" plain size="small" :loading="it._busy" :disabled="committing" @click="submitCard(it)">入账</el-button>
          </template>
        </div>
        <div v-if="it.targetSummary" class="note">改的是：{{ it.targetSummary }}</div>
        <div v-if="sourceNote(it)" class="note muted">{{ sourceNote(it) }}</div>
        <div v-if="it.note" class="note muted">AI：{{ it.note }}</div>
        <div v-if="it._err" class="note err">入账失败：{{ it._err }}</div>

        <div class="fields">
          <template v-if="it.type === 'update_transaction'">
            <Field label="科目" wide>
              <el-select v-model="it.categoryId" filterable clearable size="small" style="width: 100%" placeholder="不改" @change="onCategory(it)">
                <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label">
                  <el-option v-for="o in g.options" :key="o.value" :label="o.label" :value="o.value" />
                </el-option-group>
              </el-select>
            </Field>
            <Field label="金额"><el-input-number v-model="it.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
            <Field label="账户"><AccountSelect v-model="it.accountId" placeholder="不改" /></Field>
            <Field label="说明" wide><el-input v-model="it.description" size="small" placeholder="不改" /></Field>
            <Field v-if="it.targetCounterparty" label=" " wide>
              <el-checkbox v-model="it.learn" size="small">记住：以后「{{ it.targetCounterparty }}」都这样归类</el-checkbox>
            </Field>
          </template>
          <Field v-else label="日期"><el-date-picker v-model="it.date" type="date" value-format="YYYY-MM-DD" size="small" style="width: 100%" /></Field>

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

    <div v-if="items.length && fixedCommit" class="commit-bar">
      <el-button type="primary" :loading="committing" :disabled="!selectedCount" @click="commit">确认入账（{{ selectedCount }}）</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, h } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElSelect, ElOption } from 'element-plus'
import api from '@/api'
import { money } from '@/utils/format'
import { categories, categoryGroups, accountOptions, loadMeta } from '@/composables/useMeta'
import { AI_TYPES, ORGS, TRADE_ACTIONS, LOAN_DIRECTIONS, LOAN_KINDS, HOLDING_TYPES } from '@/constants'
import { useViewport } from '@/composables/useViewport'
import { text, images, items, meta, question, pinned, unpin, committedTick, aiContext } from '@/composables/useAiAssistant'

const props = defineProps({ compact: Boolean })
const route = useRoute()
const { isMobile } = useViewport()

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
const fixedCommit = computed(() => isMobile.value || props.compact)
// 抽屉里草稿在上、输入贴底，有草稿时输入框收矮，把位置让给草稿
const inputSize = computed(() => (props.compact ? { minRows: items.value.length ? 1 : 3, maxRows: items.value.length ? 3 : 8 } : { minRows: 5, maxRows: 12 }))
let seq = 0

async function loadOptions() {
  const [h1, a1, l1] = await Promise.all([
    api.holdings.list({ page_size: 200, status: 'HOLDING' }), api.assets.list({ page_size: 200 }), api.loans.list({ page_size: 200 })
  ])
  holdingOpts.value = h1.list.map((x) => ({ value: String(x.id), label: x.name }))
  assetOpts.value = a1.list.map((x) => ({ value: String(x.id), label: x.name }))
  loanOpts.value = l1.list.filter((x) => x.status !== 'SETTLED').map((x) => ({ value: String(x.id), label: `${x.counterparty}（${x.direction === 'LEND' ? '应收' : '负债'}）` }))
}

onMounted(() => {
  loadMeta().catch(() => {})
  api.ai.status().then((s) => (status.value = s)).catch(() => {})
  loadOptions().catch(() => {})
})
// 抽屉一直挂着，入账可能新增了持仓/借贷
watch(committedTick, () => loadOptions().catch(() => {}))

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
  Object.assign(it, { warnings: r.warnings, missing: r.missing })
}

const SOURCE_LABEL = { pinned: '来自 @ 引用', filter: '来自当前页筛选' }
const FIELD_LABEL = { accountId: '账户', toAccountId: '转入账户', holdingId: '持仓', assetId: '资产', loanId: '借贷', isBusiness: '公司款' }
function sourceNote(it) {
  const list = Object.entries(it.refSource || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}${SOURCE_LABEL[v] || ''}`)
  return list.length ? `${list.join('，')}，不对可以改` : ''
}

async function parse() {
  if (!text.value.trim() && !images.value.length) return ElMessage.warning('说点什么，或粘贴一张截图')
  parsing.value = true
  question.value = ''
  try {
    const fd = new FormData()
    fd.append('text', text.value)
    fd.append('context', JSON.stringify(aiContext(route)))
    for (const img of images.value) fd.append('images', img.file)
    const r = await api.ai.parse(fd)
    meta.value = { provider: r.provider, ms: r.ms, error: r.error, logId: r.logId }
    question.value = r.question || ''
    // 抽屉常开：新解析的接在没入账的草稿后面，输入框清空好记下一句；要反问时留着原话方便补充
    items.value = [...items.value, ...r.items.map((i) => ({ ...i, _k: ++seq, _on: true, learn: false }))]
    if (r.items.length) {
      text.value = ''
      images.value = []
    } else if (!r.question) ElMessage.warning('没识别出可以入账的内容，换个说法试试')
  } catch (e) {
    question.value = e.message
    ElMessage.error(e.message)
  } finally {
    parsing.value = false
  }
}

const cleanItem = ({ _k, _on, _done, _err, _ref, _dup, _busy, ...rest }) => rest
const dropDone = (ms) => setTimeout(() => { items.value = items.value.filter((i) => !i._done) }, ms)

// 入账走 drafts/:id/submit：连点、并发、重新解析出同样内容，服务端都只记一笔，并告诉我们是重复
async function submitOne(it) {
  if (it._done || it._busy) return null
  it._busy = true
  try {
    const r = await api.ai.submitDraft(it.draftId, cleanItem(it))
    Object.assign(it, { _done: true, _ref: r.code || r.id, _dup: r.duplicate, _err: null })
    return r
  } catch (e) {
    it._err = e.message
    return null
  } finally {
    it._busy = false
  }
}

function afterCommit() {
  loadMeta(true)
  committedTick.value++
}

async function submitCard(it) {
  const r = await submitOne(it)
  if (!r) return ElMessage.warning('入账失败，改一下再提交')
  ElMessage[r.duplicate ? 'warning' : 'success'](r.duplicate ? `这笔刚才已记过（${r.code || r.id}）` : `已入账 ${r.code || ''}`)
  dropDone(r.duplicate ? 4000 : 1200)
  if (!r.duplicate) afterCommit()
}

async function commit() {
  const todo = items.value.filter((i) => i._on && !i._done)
  committing.value = true
  const done = []
  // 一条一条来：流水编号按顺序取，也让失败的那条停在原处
  for (const it of todo) {
    const r = await submitOne(it)
    if (r) done.push(r)
  }
  committing.value = false
  const dups = done.filter((r) => r.duplicate)
  const okN = done.length - dups.length
  const bad = todo.length - done.length
  const dupText = dups.length ? `；${dups.length} 条刚才已记过（${dups.map((r) => r.code || r.id).join('、')}）` : ''
  if (bad) ElMessage.warning(`入账 ${okN} 条，${bad} 条失败，改一下再提交${dupText}`)
  else if (okN) ElMessage.success(`已入账 ${okN} 条${dupText}`)
  else ElMessage.warning(`这笔刚才已记过（${dups.map((r) => r.code || r.id).join('、')}）`)
  if (!bad) dropDone(dups.length ? 4000 : 1200)
  if (okN) afterCommit()
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
.question { display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; padding: 10px 12px; font-size: 13px; background: #fdf6ec; border: 1px solid #f5dab1; border-radius: var(--card-radius); }
.question .el-icon { margin-top: 3px; flex-shrink: 0; }
.commit-bar .el-button { width: 100%; }
.page-pins { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 13px; }

/* 抽屉：草稿在上可滚动，确认按钮和输入区贴底 */
.ai-entry.is-compact { display: flex; flex-direction: column; min-height: 0; }
.is-compact .draft-zone { order: 1; flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 8px; }
.is-compact .commit-bar { order: 2; padding: 8px 12px; background: var(--surface); border-top: 1px solid var(--border); }
.is-compact .input-card { order: 3; border-width: 1px 0 0; border-radius: 0; flex-shrink: 0; }
.is-compact .drafts-head { margin-top: 12px; }
.is-compact .fields { grid-template-columns: minmax(0, 1fr); }
.is-compact .fields :deep(.field.wide) { grid-column: span 1; }
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
  .ai-entry { padding-bottom: calc(132px + env(safe-area-inset-bottom)); }
  .ai-entry.is-compact { padding-bottom: 0; }
  /* 自适应高度写在行内样式里，要 !important 才盖得住 */
  .is-compact .input-card :deep(.el-textarea__inner) { min-height: 44px !important; }
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
  /* 完整页：解析条固定在底部，确认入账叠在它上面 */
  .commit-bar {
    position: fixed; left: 0; right: 0; bottom: calc(69px + env(safe-area-inset-bottom)); z-index: 10;
    padding: 8px 12px; background: var(--surface); border-top: 1px solid var(--border);
  }
  .commit-bar .el-button { min-height: 48px; font-size: 15px; }
  .is-compact .commit-bar { position: static; }
  .is-compact .actions { position: static; padding: 8px 0 0; border-top: none; background: none; flex: 1 1 100%; }
  .card-submit { min-height: 44px; min-width: 88px; font-size: 14px; }
  .d-head .el-button--danger { min-height: 44px; min-width: 44px; }
  .tip { font-size: 14px; line-height: 1.6; }
  .page-pins { font-size: 14px; }
  .pin-tag { font-size: 14px; height: auto; min-height: 44px; }
  .pin-tag :deep(.el-tag__close) { width: 44px; height: 44px; font-size: 16px; }
  .thumb { width: 88px; height: 88px; }
  .rm { top: 0; right: 0; width: 44px; height: 44px; font-size: 22px; background: transparent; }
  .parsing { font-size: 14px; }
  .drafts-head {
    position: sticky; top: -12px; z-index: 5; flex-wrap: wrap; gap: 6px;
    margin: 12px 0 10px; padding: 8px 0; background: var(--bg);
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
