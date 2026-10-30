<template>
  <div>
    <CrudTable :api="api.categories" title="科目与规则" entity-name="科目" add-text="新增科目"
               subtitle="科目代码沿用 Q4 记账台账（A 必要 / B 弹性 / C 经营 / I 收入 / T 转移）。关键字用于导入和 AI 录入时自动归类"
               :columns="columns" :form-fields="formFields" :default-form="{ kind: 'EXPENSE' }"
               :filters="[{ prop: 'kind', label: '类别', type: 'select', options: CATEGORY_KINDS }]" @loaded="loadMeta(true)" />

    <div class="page" style="padding-top: 0">
      <div class="section-title">学到的规则 <span class="muted" style="font-size: 12px; font-weight: 400">（你改过分类、勾过「记住」的对方；优先级高于关键字和 AI）</span></div>
      <div class="table-card">
        <ResponsiveTable :data="rules" size="small">
          <el-table-column prop="pattern" label="对方包含" />
          <el-table-column label="归到"><template #default="{ row }">{{ row.category.code }} {{ row.category.name }}</template></el-table-column>
          <el-table-column label="公司款" width="80"><template #default="{ row }"><el-tag v-if="row.isBusiness" size="small" type="warning">是</el-tag></template></el-table-column>
          <el-table-column prop="hits" label="命中/更新" width="90" />
          <el-table-column prop="source" label="来源" width="90" />
          <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link type="danger" @click="removeRule(row)">删除</el-button></template></el-table-column>
        </ResponsiveTable>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated } from 'vue'
import api from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'
import { CATEGORY_KINDS, opts } from '@/constants'
import { loadMeta } from '@/composables/useMeta'

const rules = ref([])
const columns = [
  { prop: 'code', label: '代码', width: 70 },
  { prop: 'name', label: '科目', width: 120 },
  { prop: 'kind', label: '类别', type: 'tag', tagList: CATEGORY_KINDS, width: 130 },
  { prop: 'groupName', label: '分组', width: 70 },
  { prop: 'keywords', label: '关键字', minWidth: 260, ellipsis: true, mobile: 'full' },
  { prop: 'remark', label: '说明', minWidth: 160, ellipsis: true, mobile: 'full' }
]
const formFields = [
  { prop: 'code', label: '代码', required: true },
  { prop: 'name', label: '名称', required: true },
  { prop: 'kind', label: '类别', type: 'select', options: opts(CATEGORY_KINDS), required: true },
  { prop: 'groupName', label: '分组', placeholder: '必要 / 弹性 / 经营 / 收入 / 转移' },
  { prop: 'keywords', label: '关键字', type: 'textarea', hint: '逗号分隔；对方或说明里包含即命中' },
  { prop: 'sort', label: '排序', type: 'number' },
  { prop: 'remark', label: '说明', type: 'textarea', hint: '会作为提示给 AI' }
]
async function loadRules() { rules.value = (await api.categories.rules()).list }
async function removeRule(row) { await api.categories.removeRule(row.id); loadRules() }
onMounted(loadRules)
onActivated(loadRules)
</script>
