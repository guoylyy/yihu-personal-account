<!--
  通用台账页：筛选 + 列表 + 分页 + 新增/编辑弹窗 + 作废
  各模块只描述「列」和「表单字段」，业务动作用 #row-actions / #toolbar 插槽补。
  手机端（≤768）：表格换成卡片（列上可写 mobile: 'title'|'amount'|'badge'|'full'|'hide' 调整位置），
  筛选收进底部 sheet，分页简化为上一页/下一页。桌面渲染不变。
-->
<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">{{ title }}</div>
        <div class="page-sub" v-if="subtitle">{{ subtitle }}</div>
      </div>
      <div>
        <slot name="toolbar" :reload="reload" :selection="selection" />
        <el-button v-if="canManage" type="primary" @click="openForm()">
          <el-icon><Plus /></el-icon>{{ addText }}
        </el-button>
      </div>
    </div>

    <slot name="stats" :list="list" :total="total" />

    <FilterBar v-if="filters.length || searchable" :active="activeFilters" @done="reload">
      <template v-if="isMobile && searchable" #bar>
        <el-input v-model="query.keyword" :placeholder="searchPlaceholder" clearable :prefix-icon="Search"
                  enterkeyhint="search" @keyup.enter="reload" @clear="reload" />
      </template>
      <template v-for="f in filters" :key="f.prop">
        <el-select v-if="f.type === 'select'" v-model="query[f.prop]" :placeholder="f.label" clearable
                   :style="{ width: (f.width || 140) + 'px' }" @change="reload">
          <el-option v-for="o in resolve(f.options)" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-date-picker v-else-if="f.type === 'daterange'" v-model="dateRange" type="daterange"
                        value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束"
                        style="width: 230px" @change="onDateChange" />
        <el-input v-else v-model="query[f.prop]" :placeholder="f.label" clearable
                  :style="{ width: (f.width || 150) + 'px' }" @keyup.enter="reload" @clear="reload" />
      </template>
      <el-input v-if="searchable && !isMobile" v-model="query.keyword" :placeholder="searchPlaceholder" clearable
                style="width: 200px" @keyup.enter="reload" @clear="reload" />
      <el-button v-if="!isMobile" type="primary" @click="reload">查询</el-button>
      <el-button text @click="resetFilter">重置</el-button>
    </FilterBar>

    <div class="table-card">
      <MobileCards v-if="isMobile" ref="cardsRef" v-loading="loading" :data="list" :fields="mobileFields"
                   :error="loadError" :selectable="selectable" :row-key="(r) => r.id"
                   @selection-change="selection = $event" @retry="load" />
      <el-table v-else ref="tableRef" :data="list" v-loading="loading" size="small" :row-key="(r) => r.id"
                @selection-change="selection = $event">
        <el-table-column v-if="selectable" type="selection" width="40" />
        <el-table-column v-for="col in columns" :key="col.prop" :prop="col.prop" :label="col.label"
                         :width="col.width" :min-width="col.minWidth" :align="col.align"
                         :fixed="col.fixed" :show-overflow-tooltip="col.ellipsis">
          <template #default="{ row }">
            <slot :name="`col-${col.prop}`" :row="row">
              <span v-if="col.type === 'money'" class="money" :class="col.moneyClass?.(row)">
                {{ money(get(row, col.prop)) }}
              </span>
              <span v-else-if="col.type === 'date'">{{ date(get(row, col.prop)) }}</span>
              <span v-else-if="col.type === 'datetime'">{{ datetime(get(row, col.prop)) }}</span>
              <el-tag v-else-if="col.type === 'tag'" size="small" :type="tagOf(col.tagList, get(row, col.prop))">
                {{ labelOf(col.tagList, get(row, col.prop)) }}
              </el-tag>
              <span v-else-if="col.type === 'enum'">{{ labelOf(col.tagList, get(row, col.prop)) }}</span>
              <span v-else>{{ col.formatter ? col.formatter(row) : (get(row, col.prop) ?? '—') }}</span>
            </slot>
          </template>
        </el-table-column>

        <el-table-column v-if="canManage || $slots['row-actions']" label="操作"
                         :width="actionWidth" fixed="right">
          <template #default="{ row }">
            <slot name="row-actions" :row="row" :reload="reload" />
            <el-button v-if="canManage && !hideEdit" link type="primary" @click="openForm(row)">编辑</el-button>
            <el-button v-if="canManage && !hideDelete" link type="danger" @click="remove(row)">作废</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span v-if="loadError" class="money-out">加载失败：{{ loadError }}
            <el-button link type="primary" @click="load">重试</el-button>
          </span>
          <template v-else>暂无数据</template>
        </template>
      </el-table>

      <div class="pager">
        <ResponsivePager v-model:current-page="page" v-model:page-size="pageSize" :total="total"
                         :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @change="load" />
      </div>
    </div>

    <el-dialog v-model="formVisible" :title="form.id ? `编辑${entityName}` : `新增${entityName}`" :width="dialogWidth">
      <el-form :model="form" label-width="100px">
        <el-form-item v-for="f in formFields" :key="f.prop" :label="f.label" :required="f.required">
          <el-select v-if="f.type === 'select'" v-model="form[f.prop]" :multiple="f.multiple" clearable
                     style="width: 100%" @change="f.onChange?.(form)">
            <el-option v-for="o in resolve(f.options, form)" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <el-date-picker v-else-if="f.type === 'date'" v-model="form[f.prop]" type="date"
                          value-format="YYYY-MM-DD" style="width: 100%" />
          <!-- iOS 的 decimal 键盘没有负号：可填负数的字段（信用卡余额）用 f.negative 退回默认键盘 -->
          <el-input-number v-else-if="f.type === 'money'" v-model="form[f.prop]" :precision="2" :step="100" style="width: 100%"
                           :inputmode="f.negative ? undefined : 'decimal'" />
          <el-input-number v-else-if="f.type === 'number'" v-model="form[f.prop]" style="width: 100%" inputmode="decimal" />
          <el-switch v-else-if="f.type === 'switch'" v-model="form[f.prop]" />
          <el-input v-else-if="f.type === 'textarea'" v-model="form[f.prop]" type="textarea" :rows="2" />
          <el-input v-else v-model="form[f.prop]" :placeholder="f.placeholder" />
          <div v-if="f.hint" class="muted" style="font-size: 12px">{{ f.hint }}</div>
        </el-form-item>
        <slot name="form-extra" :form="form" />
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, h, useSlots, onMounted, onActivated } from 'vue'
import { ElMessage, ElMessageBox, ElButton, ElTag } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { labelOf, tagOf } from '@/constants'
import { money, date, datetime } from '@/utils/format'
import MobileCards from '@/components/mobile/MobileCards'
import ResponsivePager from '@/components/mobile/ResponsivePager'
import FilterBar from '@/components/mobile/FilterBar.vue'
import { useViewport } from '@/composables/useViewport'

const props = defineProps({
  api: { type: Object, required: true },
  title: String,
  subtitle: String,
  entityName: { type: String, default: '记录' },
  addText: { type: String, default: '新增' },
  columns: { type: Array, default: () => [] },
  formFields: { type: Array, default: () => [] },
  filters: { type: Array, default: () => [] },
  defaultForm: { type: Object, default: () => ({}) },
  extraQuery: { type: Object, default: () => ({}) },
  canManage: { type: Boolean, default: true },
  searchable: { type: Boolean, default: true },
  searchPlaceholder: { type: String, default: '搜索关键字' },
  actionWidth: { type: [Number, String], default: 150 },
  dialogWidth: { type: String, default: '520px' },
  selectable: Boolean,
  hideEdit: Boolean,
  hideDelete: Boolean,
  beforeSave: Function,
  // 保存成功后的回调：(row, form, isCreate) => Promise，用于顺带做后续动作
  afterSave: Function
})
const emit = defineEmits(['loaded'])

const loading = ref(false)
const saving = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const query = reactive({ keyword: '' })
const dateRange = ref([])
const formVisible = ref(false)
const form = ref({})
const selection = ref([])
const tableRef = ref(null)
const cardsRef = ref(null)
const loadError = ref('')
const slots = useSlots()
const { isMobile } = useViewport()

const get = (row, path) => path.split('.').reduce((o, k) => o?.[k], row)
const resolve = (options, ctx) => (typeof options === 'function' ? options(ctx) : options || [])

async function load() {
  loading.value = true
  try {
    const data = await props.api.list({ ...props.extraQuery, ...query, page: page.value, page_size: pageSize.value })
    list.value = data.list
    total.value = data.total ?? data.list.length
    loadError.value = ''
    emit('loaded', data)
  } catch (e) {
    loadError.value = e.message
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function reload() { page.value = 1; load() }

// ---- 手机端卡片：列定义 → 卡片字段 ----
const activeFilters = computed(() => props.filters.filter((f) =>
  f.type === 'daterange' ? dateRange.value?.length : query[f.prop] !== '' && query[f.prop] != null).length)

function cellOf(col, row) {
  const slot = slots[`col-${col.prop}`]
  if (slot) return slot({ row })
  const v = get(row, col.prop)
  if (col.type === 'money') return h('span', { class: ['money', col.moneyClass?.(row)] }, money(v))
  if (col.type === 'date') return date(v)
  if (col.type === 'datetime') return datetime(v)
  if (col.type === 'tag') return h(ElTag, { size: 'small', type: tagOf(col.tagList, v) }, () => labelOf(col.tagList, v))
  if (col.type === 'enum') return labelOf(col.tagList, v)
  return col.formatter ? col.formatter(row) : (v ?? '—')
}

const mobileFields = computed(() => {
  const cols = props.columns.filter((c) => c.mobile !== 'hide')
  // 标题：显式指定 > 名称/标题类字段 > 第一个非金额/标签/日期列
  const title = cols.find((c) => c.mobile === 'title')
    || cols.find((c) => !c.mobile && /(^|\.)(name|title)$/i.test(c.prop))
    || cols.find((c) => !c.mobile && !['money', 'tag', 'date', 'datetime'].includes(c.type)) || cols[0]
  const amount = cols.find((c) => c.mobile === 'amount') || cols.find((c) => !c.mobile && c.type === 'money')
  const fields = cols.map((col) => ({
    label: col.label,
    role: col === title ? 'title' : col === amount ? 'amount' : col.mobile || (col.type === 'tag' ? 'badge' : undefined),
    strong: col.type === 'money',
    render: (row) => cellOf(col, row)
  }))
  if (props.canManage || slots['row-actions']) {
    fields.push({
      label: '操作',
      role: 'actions',
      render: (row) => [
        ...(slots['row-actions']?.({ row, reload }) || []),
        props.canManage && !props.hideEdit ? h(ElButton, { link: true, type: 'primary', onClick: () => openForm(row) }, () => '编辑') : null,
        props.canManage && !props.hideDelete ? h(ElButton, { link: true, type: 'danger', onClick: () => remove(row) }, () => '作废') : null
      ].filter(Boolean)
    })
  }
  return fields
})

function onDateChange(v) {
  query.date_from = v?.[0] || ''
  query.date_to = v?.[1] || ''
  reload()
}

function resetFilter() {
  Object.keys(query).forEach((k) => (query[k] = ''))
  dateRange.value = []
  reload()
}

function openForm(row) {
  if (row) {
    const f = { ...row }
    // 后端返回的 BigInt 是字符串，Decimal 也是字符串，转成表单可用的类型
    for (const field of props.formFields) {
      const v = row[field.prop]
      if (v == null) continue
      if (field.type === 'money' || field.type === 'number') f[field.prop] = Number(v)
      if (field.type === 'date') f[field.prop] = String(v).slice(0, 10)
      if (field.type === 'select') f[field.prop] = String(v)
    }
    form.value = f
  } else {
    form.value = { ...props.defaultForm }
  }
  formVisible.value = true
}

async function save() {
  const payload = props.beforeSave ? props.beforeSave(form.value) : form.value
  if (!payload) return
  saving.value = true
  try {
    const isCreate = !payload.id
    const row = isCreate ? await props.api.create(payload) : await props.api.update(payload.id, payload)
    if (props.afterSave) await props.afterSave(row, payload, isCreate)
    ElMessage.success('已保存')
    formVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function remove(row) {
  await ElMessageBox.confirm(`确认作废这条${props.entityName}？作废后不再参与统计，但记录会保留。`, '确认', { type: 'warning' })
  try {
    await props.api.remove(row.id)
    ElMessage.success('已作废')
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

onMounted(load)
// 列表页被 keep-alive 缓存着，从别的页面回来要重新拉一次，
// 否则会看到别处已经改过的旧数据（比如刚登记完回款，余额还是老的）
onActivated(load)
defineExpose({ reload, load, openForm, selection, clearSelection: () => (isMobile.value ? cardsRef : tableRef).value?.clearSelection() })
</script>
