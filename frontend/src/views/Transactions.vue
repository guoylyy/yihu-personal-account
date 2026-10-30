<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">收支流水</div>
        <div class="page-sub">个人口径 = 不含公司款、不含转移类（互转/还卡/买理财/借贷本金/家庭划转）</div>
      </div>
      <div>
        <el-button @click="router.push('/import')"><el-icon><Upload /></el-icon>&nbsp;导入账单</el-button>
        <el-button type="primary" @click="openForm()"><el-icon><Plus /></el-icon>&nbsp;手工记一笔</el-button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card is-success"><div class="label">收入</div><div class="value">¥{{ money(summary.in) }}</div></div>
      <div class="stat-card is-danger"><div class="label">支出</div><div class="value">¥{{ money(summary.out) }}</div></div>
      <div class="stat-card"><div class="label">净额</div><div class="value" :class="summary.net >= 0 ? 'money-in' : 'money-out'">{{ money(summary.net, true) }}</div><div class="foot">共 {{ total }} 笔（按当前筛选）</div></div>
    </div>

    <FilterBar :active="activeFilters" @done="reload">
      <template v-if="isMobile" #bar>
        <el-input v-model="q.keyword" placeholder="对方 / 说明 / 编号" clearable :prefix-icon="Search"
                  enterkeyhint="search" @keyup.enter="reload" @clear="reload" />
      </template>
      <el-select v-model="q.period" placeholder="月份" clearable style="width: 110px" @change="reload">
        <el-option v-for="p in periodOptions(24)" :key="p" :label="p" :value="p" />
      </el-select>
      <el-radio-group v-model="q.scope" @change="reload">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="personal">个人</el-radio-button>
        <el-radio-button value="business">公司款</el-radio-button>
        <el-radio-button value="transfer">转移</el-radio-button>
      </el-radio-group>
      <el-select v-model="q.account_id" placeholder="账户" clearable style="width: 120px" @change="reload">
        <el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" />
      </el-select>
      <el-select v-model="q.category_id" placeholder="科目" clearable filterable style="width: 150px" @change="reload">
        <el-option label="⚠ 未分类" value="none" />
        <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label">
          <el-option v-for="o in g.options" :key="o.value" v-bind="o" />
        </el-option-group>
      </el-select>
      <el-select v-model="q.direction" placeholder="收/支" clearable style="width: 90px" @change="reload">
        <el-option label="支出" value="OUT" /><el-option label="收入" value="IN" />
      </el-select>
      <el-select v-if="q.scope === 'business'" v-model="q.biz_status" placeholder="剥离状态" clearable style="width: 110px" @change="reload">
        <el-option v-for="o in BIZ_STATUS" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-input v-if="!isMobile" v-model="q.keyword" placeholder="对方 / 说明 / 编号" clearable style="width: 180px" @keyup.enter="reload" @clear="reload" />
      <el-button v-if="!isMobile" type="primary" @click="reload">查询</el-button>
      <el-button text @click="reset">重置</el-button>
    </FilterBar>

    <div v-if="selection.length" class="batch-bar">
      已选 <b>{{ selection.length }}</b> 笔：
      <el-select v-model="batchCat" placeholder="改科目" filterable size="small" style="width: 150px">
        <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label">
          <el-option v-for="o in g.options" :key="o.value" v-bind="o" />
        </el-option-group>
      </el-select>
      <el-checkbox v-model="batchLearn" size="small">记住对方</el-checkbox>
      <el-button size="small" :disabled="!batchCat" @click="doBatch({ categoryId: batchCat, learn: batchLearn })">应用</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" @click="markBiz">标为公司款</el-button>
      <el-button size="small" @click="doBatch({ isBusiness: false })">标为个人</el-button>
      <el-button size="small" @click="doBatch({ bizStatus: 'REIMBURSED' })">已报销</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="primary" plain :loading="aiLoading" @click="aiClassify"><el-icon><MagicStick /></el-icon>&nbsp;AI 归类</el-button>
    </div>

    <div class="table-card">
      <ResponsiveTable ref="tableRef" :data="list" v-loading="loading" size="small" row-key="id" @selection-change="selection = $event">
        <el-table-column type="selection" width="36" />
        <el-table-column label="日期" width="92"><template #default="{ row }">{{ date(row.txnDate) }}</template></el-table-column>
        <el-table-column label="金额" align="right" width="110" mobile="amount">
          <template #default="{ row }">
            <span class="money" :class="row.direction === 'IN' ? 'money-in' : 'money-out'">{{ row.direction === 'IN' ? '+' : '−' }}{{ money(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="科目" width="130">
          <template #default="{ row }">
            <span v-if="row.category" :class="{ muted: row.category.kind === 'TRANSFER' }">{{ row.category.code }} {{ row.category.name }}</span>
            <el-tag v-else type="warning" size="small" effect="plain">未分类</el-tag>
            <div v-if="suggest[row.id]" class="suggest" @click="applySuggest(row)">AI 建议：{{ suggest[row.id].label }} <el-icon><Check /></el-icon></div>
          </template>
        </el-table-column>
        <el-table-column prop="counterparty" label="对方" min-width="140" show-overflow-tooltip mobile="title" />
        <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip mobile="full" />
        <el-table-column label="账户" width="96"><template #default="{ row }">{{ row.account?.name || '—' }}</template></el-table-column>
        <el-table-column label="公私" width="96">
          <template #default="{ row }">
            <el-tag v-if="row.isBusiness" size="small" :type="tagOf(BIZ_STATUS, row.bizStatus)">{{ row.businessOrg || '公司' }}·{{ labelOf(BIZ_STATUS, row.bizStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="60"><template #default="{ row }"><el-tag size="small" effect="plain" :type="tagOf(SOURCES, row.source)">{{ labelOf(SOURCES, row.source) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="96" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openForm(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">作废</el-button>
          </template>
        </el-table-column>
      </ResponsiveTable>
      <div class="pager">
        <ResponsivePager v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[50, 100, 200]"
                         layout="total, sizes, prev, pager, next" @change="load" />
      </div>
    </div>

    <el-dialog v-model="form.visible" :title="form.id ? `编辑 ${form.code}` : '手工记一笔'" width="560px">
      <el-form label-width="80px">
        <el-form-item label="方向">
          <el-radio-group v-model="form.direction"><el-radio-button value="OUT">支出</el-radio-button><el-radio-button value="IN">收入</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item label="金额"><el-input-number v-model="form.amount" inputmode="decimal" :precision="2" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="form.txnDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="账户"><el-select v-model="form.accountId" clearable style="width: 100%"><el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" /></el-select></el-form-item>
        <el-form-item label="科目">
          <el-select v-model="form.categoryId" filterable clearable style="width: 100%">
            <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label"><el-option v-for="o in g.options" :key="o.value" v-bind="o" /></el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="对方"><el-input v-model="form.counterparty" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" /></el-form-item>
        <el-form-item label="公司款">
          <el-switch v-model="form.isBusiness" />
          <template v-if="form.isBusiness">
            <el-select v-model="form.businessOrg" allow-create filterable placeholder="哪家公司" style="width: 130px; margin-left: 10px"><el-option v-for="o in ORGS" :key="o" :label="o" :value="o" /></el-select>
            <el-select v-model="form.bizStatus" style="width: 110px; margin-left: 8px"><el-option v-for="o in BIZ_STATUS" :key="o.value" :label="o.label" :value="o.value" /></el-select>
          </template>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
        <el-form-item v-if="form.counterparty" label=" "><el-checkbox v-model="form.learn">记住：以后「{{ form.counterparty }}」都这样归类</el-checkbox></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="form.visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onActivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import api from '@/api'
import { money, date, periodOptions } from '@/utils/format'
import { BIZ_STATUS, SOURCES, ORGS, labelOf, tagOf } from '@/constants'
import { accountOptions, categoryGroups, categories, loadMeta } from '@/composables/useMeta'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'
import ResponsivePager from '@/components/mobile/ResponsivePager'
import FilterBar from '@/components/mobile/FilterBar.vue'
import { useViewport } from '@/composables/useViewport'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const list = ref([])
const total = ref(0)
const summary = ref({ in: 0, out: 0, net: 0 })
const page = ref(1)
const pageSize = ref(50)
const selection = ref([])
const tableRef = ref()
const empty = { period: '', scope: '', account_id: '', category_id: '', direction: '', biz_status: '', keyword: '' }
const q = reactive({ ...empty })
const batchCat = ref('')
const batchLearn = ref(true)
const aiLoading = ref(false)
const suggest = ref({})
const { isMobile } = useViewport()
const activeFilters = computed(() => ['period', 'scope', 'account_id', 'category_id', 'direction', 'biz_status'].filter((k) => q[k]).length)

function fromRoute() { Object.assign(q, empty, route.query) }

async function load() {
  loading.value = true
  try {
    const d = await api.transactions.list({ ...q, page: page.value, page_size: pageSize.value })
    list.value = d.list
    total.value = d.total
    summary.value = d.summary
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
function reload() { page.value = 1; suggest.value = {}; load() }
function reset() { Object.assign(q, empty); router.replace('/transactions'); reload() }

async function doBatch(body) {
  try {
    await api.transactions.batch({ ids: selection.value.map((r) => r.id), ...body })
    ElMessage.success('已更新')
    tableRef.value.clearSelection()
    load()
  } catch (e) { ElMessage.error(e.message) }
}
async function markBiz() {
  const { value } = await ElMessageBox.prompt('属于哪家公司？', '标为公司款', { inputPlaceholder: '示例科技 / 示例教育 / …' }).catch(() => ({}))
  if (value !== undefined) doBatch({ isBusiness: true, businessOrg: value })
}

async function aiClassify() {
  aiLoading.value = true
  try {
    const rows = selection.value.slice(0, 120)
    const res = await api.transactions.aiClassify(rows.map((r) => ({ direction: r.direction, amount: Number(r.amount), counterparty: r.counterparty, description: r.description })))
    const map = {}
    for (const s of res) {
      const row = rows[s.i]
      const c = categories.value.find((x) => String(x.id) === s.categoryId)
      if (row && c) map[row.id] = { ...s, label: `${c.code} ${c.name}${s.isBusiness ? '·公司' : ''}` }
    }
    suggest.value = map
    ElMessage.success(`AI 给出 ${Object.keys(map).length} 条建议，点「AI 建议」采纳，或全部采纳`)
    if (Object.keys(map).length) {
      await ElMessageBox.confirm(`全部采纳这 ${Object.keys(map).length} 条建议？（会按对方名记住规则）`, 'AI 归类', { confirmButtonText: '全部采纳', cancelButtonText: '我逐条看' })
      for (const row of rows) if (map[row.id]) await applySuggest(row, true)
      ElMessage.success('已采纳')
      load()
    }
  } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || e) } finally { aiLoading.value = false }
}
async function applySuggest(row, silent) {
  const s = suggest.value[row.id]
  await api.transactions.update(row.id, { categoryId: s.categoryId, isBusiness: s.isBusiness, businessOrg: s.businessOrg, learn: true })
  delete suggest.value[row.id]
  if (!silent) load()
}

const form = reactive({ visible: false })
function openForm(row) {
  if (row) {
    Object.assign(form, {
      visible: true, id: row.id, code: row.code, direction: row.direction, amount: Number(row.amount), txnDate: date(row.txnDate),
      accountId: row.accountId ? String(row.accountId) : '', categoryId: row.categoryId ? String(row.categoryId) : '',
      counterparty: row.counterparty, description: row.description, isBusiness: row.isBusiness, businessOrg: row.businessOrg,
      bizStatus: row.bizStatus || 'PENDING', remark: row.remark, learn: false
    })
  } else {
    Object.assign(form, { visible: true, id: null, code: '', direction: 'OUT', amount: 0, txnDate: dayjs().format('YYYY-MM-DD'), accountId: '', categoryId: '', counterparty: '', description: '', isBusiness: false, businessOrg: '', bizStatus: 'PENDING', remark: '', learn: false })
  }
}
async function save() {
  const { visible, id, code, ...body } = form
  try {
    if (id) await api.transactions.update(id, body)
    else await api.transactions.create(body)
    ElMessage.success('已保存')
    form.visible = false
    load()
  } catch (e) { ElMessage.error(e.message) }
}
async function remove(row) {
  await ElMessageBox.confirm(`作废 ${row.code}？${row.transferGroup ? '这是一笔互转，两边会一起作废。' : ''}`, '确认', { type: 'warning' })
  await api.transactions.remove(row.id)
  ElMessage.success('已作废')
  load()
}

watch(() => route.query, () => { if (route.path === '/transactions') { fromRoute(); reload() } })
onMounted(() => { loadMeta(); fromRoute(); load() })
onActivated(load)
</script>

<style scoped>
.batch-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #eef5f1; border: 1px solid #cfe3d8; border-radius: var(--card-radius); padding: 8px 12px; margin-bottom: 10px; font-size: 13px; }
.suggest { font-size: 12px; color: var(--accent); cursor: pointer; }
@media (max-width: 768px) {
  .batch-bar { font-size: 14px; padding: 10px 12px; }
  .batch-bar :deep(.el-divider) { display: none; }
  .suggest { font-size: 14px; min-height: 44px; display: flex; align-items: center; gap: 4px; }
}
</style>
