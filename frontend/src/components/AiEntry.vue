<!--
  AI 助手的对话：抽屉和 /ai 完整页共用一套。从上到下：头部 → 一行说明 → 引用 → 消息（草稿卡插在对话里）→ 确认入账 → 输入条
  一个输入框两种用途：记账走 /ai/parse，提问走 /ai/ask；两个接口都不记上下文，反问和追问的前文由这里拼好带过去
-->
<template>
  <div class="ai-entry" :class="{ 'is-compact': compact }">
    <header v-if="compact" class="ai-head">
      <slot name="handle" />
      <div class="ai-head-row">
        <span class="ai-title">AI 记账</span>
        <el-tooltip content="清空对话" placement="bottom">
          <el-button text circle class="ai-clear" aria-label="清空对话" :disabled="!messages.length || !!sending" @click="clearChat">
            <el-icon :size="16"><Delete /></el-icon>
          </el-button>
        </el-tooltip>
        <el-button text circle class="ai-close" aria-label="关闭 AI 记账" @click="$emit('close')">
          <el-icon :size="18"><Close /></el-icon>
        </el-button>
      </div>
    </header>
    <div class="ai-hint">
      <span>说一句话就能记，草稿确认后才入账</span>
      <el-button v-if="!compact" text circle class="ai-clear" aria-label="清空对话" title="清空对话" :disabled="!messages.length || !!sending" @click="clearChat">
        <el-icon :size="16"><Delete /></el-icon>
      </el-button>
    </div>
    <div class="ai-ctx">
      <template v-if="pinned.length">
        <el-tag v-for="p in pinned" :key="`${p.type}${p.id}`" class="pin-tag" closable effect="plain" size="small" @close="unpin(p)">@{{ p.label }}</el-tag>
      </template>
      <span v-else class="muted">在列表里点 @ 引用记录</span>
    </div>

    <div ref="listRef" class="ai-messages">
      <div v-if="!messages.length" class="ai-empty">
        <p>记账、问账都可以直接说，一次可以说几笔，也可以贴账单截图。例如：</p>
        <p class="eg" role="button" tabindex="0" @click="text = EXAMPLE" @keydown.enter="text = EXAMPLE">「{{ EXAMPLE }}」</p>
        <p v-if="status && !status.enabled">{{ status.hint }}</p>
      </div>
      <div v-for="m in messages" :key="m.id" class="msg" :class="m.role" :data-msg="m.id">
        <div v-if="m.images?.length" class="thumbs">
          <div v-for="img in m.images" :key="img.url" class="thumb"><img :src="img.url" alt="截图" /></div>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -- md() 已转义原始 HTML -->
        <div v-if="m.html" class="bubble md" v-html="m.html" />
        <div v-else-if="m.content" class="bubble" :class="{ warn: m.warn }">{{ m.content }}</div>
        <AiDraftCard v-for="d in m.drafts || []" :key="d._k" :item="d" :opts="opts" :busy="committing"
                     @submit="submitCard(d)" @ignore="ignore(m, d)" />
      </div>
      <div v-if="sending" class="msg assistant"><div class="bubble muted">{{ sending }}</div></div>
    </div>

    <div v-if="pendingDrafts.length" class="commit-bar">
      <el-button type="primary" :loading="committing" @click="commit">确认入账（{{ pendingDrafts.length }}）</el-button>
    </div>

    <div class="composer" @paste="onPaste" @dragover.prevent @drop.prevent="onDrop">
      <div v-if="images.length" class="thumbs">
        <div v-for="(img, i) in images" :key="img.url" class="thumb">
          <img :src="img.url" alt="待发送的截图" />
          <el-icon class="rm" @click="images.splice(i, 1)"><CircleCloseFilled /></el-icon>
        </div>
      </div>
      <div class="composer-row">
        <el-input v-model="text" class="composer-input" type="textarea" :autosize="{ minRows: 1, maxRows: 5 }" resize="none"
                  :placeholder="isMobile ? '说一笔账，或问个问题' : '说一笔账，或问个问题（Enter 发送）'" @keydown="onKeydown" />
        <div class="composer-actions">
          <el-upload class="img-upload" :show-file-list="false" accept="image/*" multiple :auto-upload="false" :on-change="onFile">
            <el-button text circle class="img-btn" aria-label="上传截图" title="上传截图"><el-icon :size="18"><Picture /></el-icon></el-button>
          </el-upload>
          <el-button type="primary" class="send-btn" :loading="!!sending" :disabled="!canSend" @click="send">发送</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Marked } from 'marked'
import api from '@/api'
import AiDraftCard from './AiDraftCard.vue'
import { loadMeta } from '@/composables/useMeta'
import { useViewport } from '@/composables/useViewport'
import { lackOf, LACK_ASK, looksLikeQuestion } from '@/utils/aiDraft'
import {
  text, images, messages, sending, clarify, session, pinned, unpin, drawerOpen, committedTick, pendingDrafts,
  aiContext, addMessage, clearConversation, nextId
} from '@/composables/useAiAssistant'

const props = defineProps({ compact: Boolean })
defineEmits(['close'])
const route = useRoute()
const { isMobile } = useViewport()

const EXAMPLE = '今天午饭 45 微信'
const HISTORY_TURNS = 6 // 追问时带上的前文条数
const committing = ref(false)
const status = ref(null)
const listRef = ref(null)
const opts = ref({ holdings: [], assets: [], loans: [] })
const canSend = computed(() => !!text.value.trim() || images.value.length > 0)

// 回答可能引用账本里的对方名、说明：原始 HTML 一律当文字显示
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const md = new Marked({ renderer: { html: ({ text: raw }) => escapeHtml(raw) } })

async function loadOptions() {
  const [h1, a1, l1] = await Promise.all([
    api.holdings.list({ page_size: 200, status: 'HOLDING' }), api.assets.list({ page_size: 200 }), api.loans.list({ page_size: 200 })
  ])
  opts.value = {
    holdings: h1.list.map((x) => ({ value: String(x.id), label: x.name })),
    assets: a1.list.map((x) => ({ value: String(x.id), label: x.name })),
    loans: l1.list.filter((x) => x.status !== 'SETTLED').map((x) => ({ value: String(x.id), label: `${x.counterparty}（${x.direction === 'LEND' ? '应收' : '负债'}）` }))
  }
}

onMounted(() => {
  loadMeta().catch(() => {})
  api.ai.status().then((s) => (status.value = s)).catch(() => {})
  loadOptions().catch(() => {})
})
// 抽屉一直挂着，入账可能新增了持仓/借贷
watch(committedTick, () => loadOptions().catch(() => {}))

const scrollToEnd = () => nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
// 草稿可能有好几张，停在这条回复的开头，从第一张看起
function scrollToLatest() {
  nextTick(() => {
    const last = messages.value[messages.value.length - 1]
    const node = last?.drafts?.length && listRef.value?.querySelector(`[data-msg="${last.id}"]`)
    if (node) listRef.value.scrollTop = node.offsetTop - 8
    else scrollToEnd()
  })
}
watch(() => messages.value.length, scrollToLatest)
watch(sending, (v) => { if (v) scrollToEnd() })
// 隐藏后滚动位置会被浏览器清零
if (props.compact) watch(drawerOpen, (open) => { if (open) scrollToEnd() })
onActivated(scrollToEnd)

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

// 手机没有 Shift 键：软键盘回车只换行，点「发送」按钮发送
function onKeydown(e) {
  if (isMobile.value) return
  // 输入法组字中的 Enter 不算发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

async function clearChat() {
  const n = pendingDrafts.value.length
  if (n) {
    try {
      await ElMessageBox.confirm(`还有 ${n} 条草稿没入账，清空后就没了。`, '清空对话', { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' })
    } catch { return }
  }
  clearConversation()
}

function replyOf(r, drafts) {
  if (r.question) return { reply: r.question, asking: true }
  const prefix = r.notice ? `${r.notice}。` : ''
  if (drafts.length > 1) return { reply: `${prefix}拆成 ${drafts.length} 笔，${drafts.some((d) => lackOf(d).length) ? '标红的补一下再入账' : '核对后入账'}。` }
  // 规则兜底没有模型帮忙合并回答，反问了也接不住，缺的就让用户在卡片上改
  const ask = r.provider?.startsWith('rule') ? null : LACK_ASK[lackOf(drafts[0])[0]]
  return ask ? { reply: ask, asking: true } : { reply: `${prefix}草稿好了，核对后入账。` }
}

/** 记账：有待回答的反问时把这句并进原话重新识别，新草稿取代上一轮没入账的 */
async function runParse(said, imgs, sid) {
  const prev = clarify.value
  const input = prev?.text ? `${prev.text}（补充：${said}）` : said
  const allImages = [...(prev?.images || []), ...imgs]
  const fd = new FormData()
  fd.append('text', input)
  fd.append('context', JSON.stringify(aiContext(route)))
  for (const img of allImages) fd.append('images', img.file)
  sending.value = '正在识别…'
  const r = await api.ai.parse(fd)
  if (sid !== session.value) return
  const drafts = r.items.map((i) => ({ ...i, _k: nextId(), learn: false }))
  if (!drafts.length && !r.question) {
    if (r.notice && imgs.length) return addMessage({ role: 'assistant', warn: true, content: r.notice })
    if (!said || imgs.length) return addMessage({ role: 'assistant', content: '没看出可以入账的内容，换张清楚点的试试。' })
    return runAsk(said, sid)
  }
  if (prev && drafts.length) prev.msg.drafts = (prev.msg.drafts || []).filter((d) => d._done)
  const { reply, asking } = replyOf(r, drafts)
  const msg = addMessage({ role: 'assistant', content: reply, drafts })
  clarify.value = asking ? { text: input, images: allImages, msg } : null
}

/** 提问：前文和 @ 的记录拼进问题，追问「那上个月呢」才接得上 */
async function runAsk(said, sid) {
  const turns = messages.value.filter((m) => m.content).slice(-HISTORY_TURNS - 1, -1)
  const history = turns.map((m) => `${m.role === 'user' ? '我' : '助手'}：${m.content.slice(0, 300)}`).join('\n')
  const pins = pinned.value.map((p) => p.label).join('、')
  const question = [history && `之前的对话：\n${history}`, pins && `我引用的记录：${pins}`, history || pins ? `现在的问题：${said}` : said].filter(Boolean).join('\n\n')
  sending.value = '正在查账…'
  try {
    const r = await api.ai.ask(question)
    if (sid !== session.value) return
    addMessage({ role: 'assistant', warn: !!r.error, content: r.answer, html: md.parse(r.answer || '') })
  } catch (e) {
    if (sid !== session.value) return
    addMessage({ role: 'assistant', warn: true, content: status.value?.enabled === false ? '现在没开 AI，只能记账，问答用不了。' : e.message })
  }
}

async function send() {
  const said = text.value.trim()
  const imgs = images.value
  if ((!said && !imgs.length) || sending.value) return
  const sid = session.value
  addMessage({ role: 'user', content: said, images: imgs })
  text.value = ''
  images.value = []
  try {
    await (!imgs.length && looksLikeQuestion(said) ? runAsk(said, sid) : runParse(said, imgs, sid))
  } catch (e) {
    if (sid !== session.value) return
    addMessage({ role: 'assistant', warn: true, content: e.message })
    // 失败了把原话放回输入框，改一下能直接重发
    if (!text.value) text.value = said
    if (!images.value.length) images.value = imgs
  } finally {
    if (sid === session.value) sending.value = ''
  }
}

function ignore(msg, d) {
  msg.drafts = msg.drafts.filter((x) => x !== d)
  clarify.value = null
}

const cleanItem = ({ _k, _edit, _done, _err, _ref, _dup, _busy, ...rest }) => rest

// 入账走 drafts/:id/submit：连点、并发、重新解析出同样内容，服务端都只记一笔，并告诉我们是重复
async function submitOne(it) {
  if (it._done || it._busy) return null
  it._busy = true
  try {
    const r = await api.ai.submitDraft(it.draftId, cleanItem(it))
    Object.assign(it, { _done: true, _edit: false, _ref: r.code || r.id, _dup: r.duplicate, _err: null })
    clarify.value = null
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

// 成败都写在卡片上，不再弹提示
async function submitCard(it) {
  const r = await submitOne(it)
  if (r && !r.duplicate) afterCommit()
}

async function commit() {
  const todo = pendingDrafts.value.slice()
  committing.value = true
  const done = []
  // 一条一条来：流水编号按顺序取，也让失败的那条停在原处
  for (const it of todo) {
    const r = await submitOne(it)
    if (r) done.push(r)
  }
  committing.value = false
  const dups = done.filter((r) => r.duplicate).length
  const okN = done.length - dups
  const bad = todo.length - done.length
  const parts = [okN && `已入账 ${okN} 条`, dups && `${dups} 条刚才已记过`, bad && `${bad} 条没入账，改一下再提交`].filter(Boolean)
  addMessage({ role: 'assistant', content: parts.join('，'), warn: !!bad })
  if (okN) afterCommit()
}
</script>

<style scoped>
.ai-entry { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; background: var(--surface); }
.ai-head { flex-shrink: 0; border-bottom: 1px solid var(--border); }
.ai-head-row { display: flex; align-items: center; gap: 2px; height: 55px; padding: 0 8px 0 16px; }
.ai-title { font-size: 15px; font-weight: 600; flex: 1; }
.ai-head-row .el-button + .el-button { margin-left: 0; }
.ai-hint { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; min-height: 30px; padding: 4px 16px; font-size: 12px; color: var(--text-muted); background: #fcfbfa; border-bottom: 1px solid var(--border); }
.ai-ctx { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 6px 16px; font-size: 12px; overflow-x: auto; border-bottom: 1px solid var(--border); }
.pin-tag { flex-shrink: 0; max-width: 240px; }
.pin-tag :deep(.el-tag__content) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ai-messages { position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }
.ai-empty { color: var(--text-muted); font-size: 14px; line-height: 1.8; }
.ai-empty p { margin: 0; }
.ai-empty .eg { display: inline-block; color: var(--accent); cursor: pointer; }
.msg { display: flex; flex-direction: column; min-width: 0; margin-bottom: 12px; }
.msg.user { align-items: flex-end; }
/* 完整页很宽，对话收在中间一列 */
.ai-entry:not(.is-compact) .msg, .ai-entry:not(.is-compact) .ai-empty { max-width: 720px; margin-left: auto; margin-right: auto; }
.bubble { max-width: 100%; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.msg.user .bubble { max-width: 88%; padding: 7px 11px; border-radius: 10px; background: #f0eee9; }
.bubble.warn { color: var(--warning); }
.bubble.md { white-space: normal; overflow-x: auto; }
.bubble.md :deep(p) { margin: 0 0 6px; }
.bubble.md :deep(p:last-child) { margin-bottom: 0; }
.bubble.md :deep(ul), .bubble.md :deep(ol) { margin: 0 0 6px; padding-left: 18px; }
.bubble.md :deep(table) { border-collapse: collapse; margin: 6px 0; }
.bubble.md :deep(td), .bubble.md :deep(th) { border: 1px solid var(--border); padding: 2px 8px; }

.commit-bar { flex-shrink: 0; padding: 8px 12px; border-top: 1px solid var(--border); }
.commit-bar .el-button { width: 100%; }

.composer { flex-shrink: 0; padding: 10px 12px; border-top: 1px solid var(--border); }
.composer-row { display: flex; align-items: flex-end; gap: 8px; }
.composer-input { flex: 1; min-width: 0; }
.composer-input :deep(.el-textarea__inner) { font-size: 14px; line-height: 1.6; padding: 5px 10px; }
.composer-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.composer-actions .el-button + .el-button { margin-left: 0; }
.img-upload { display: inline-flex; }
.thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.msg.user .thumbs { justify-content: flex-end; margin-bottom: 4px; }
.thumb { position: relative; width: 64px; height: 64px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.rm { position: absolute; top: 2px; right: 2px; cursor: pointer; color: var(--danger); background: #fff; border-radius: 50%; }

/* 手机：输入框在上、按钮在下；字号和点按区域放大 */
@media (max-width: 768px) {
  .ai-head-row { height: 48px; padding: 0 4px 0 14px; }
  .ai-title { font-size: 16px; }
  .ai-head .el-button, .ai-hint .el-button { width: 44px; height: 44px; }
  .ai-hint { font-size: 14px; padding: 4px 14px; }
  .ai-entry:not(.is-compact) .ai-hint { padding-right: 4px; }
  .ai-ctx { font-size: 14px; padding: 6px 14px; }
  .pin-tag { font-size: 14px; height: 44px; max-width: 220px; }
  .pin-tag :deep(.el-tag__close) { width: 44px; height: 44px; font-size: 16px; }
  .ai-messages { overscroll-behavior: contain; }
  .ai-empty .eg { display: flex; align-items: center; min-height: 44px; }
  .bubble { font-size: 15px; }
  .commit-bar .el-button { min-height: 48px; font-size: 15px; }
  .composer-row { flex-direction: column; align-items: stretch; gap: 6px; }
  /* 自适应高度写在行内样式里，要 !important 才盖得住 */
  .composer-input :deep(.el-textarea__inner) { font-size: 16px; min-height: 44px !important; padding: 9px 10px; }
  .composer-actions { justify-content: space-between; }
  .img-btn { width: 44px; height: 44px; }
  .send-btn { min-height: 44px; min-width: 88px; font-size: 15px; }
  .thumb { width: 88px; height: 88px; }
  .rm { top: 0; right: 0; width: 44px; height: 44px; font-size: 22px; background: transparent; }
  .ai-entry:not(.is-compact) .composer { padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
}
</style>
