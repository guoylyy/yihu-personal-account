<template>
  <div>
    <CrudTable ref="table" :api="api.assets" title="固定资产" entity-name="资产" add-text="新增资产"
               subtitle="房产、车辆、大件。估值按市场可成交价，每季度或有变化时更新一次；对应贷款记在「借贷往来」"
               :columns="columns" :form-fields="formFields" :default-form="{ type: 'PROPERTY', owner: 'ME', status: 'HOLDING', includeInNetWorth: true }"
               :action-width="200" :filters="[{ prop: 'type', label: '类型', type: 'select', options: ASSET_TYPES }]" @loaded="onLoaded">
      <template #stats>
        <div class="stat-grid">
          <div class="stat-card is-accent"><div class="label">固定资产估值合计</div><div class="value">¥{{ money(sum) }}</div></div>
        </div>
      </template>
      <template #col-currentValue="{ row }">
        <span class="money"><b>{{ money(row.currentValue) }}</b></span>
        <div v-if="row.purchasePrice" class="muted" style="font-size: 12px">买入 {{ moneyShort(row.purchasePrice) }}</div>
      </template>
      <template #row-actions="{ row }">
        <el-button link type="primary" @click="openVal(row)">更新估值</el-button>
        <el-button link @click="openHistory(row)">历史</el-button>
      </template>
    </CrudTable>

    <el-dialog v-model="val.visible" :title="`更新估值 · ${val.row?.name}`" width="420px">
      <el-form label-width="80px">
        <el-form-item label="新估值"><el-input-number v-model="val.value" inputmode="decimal" :precision="2" :step="10000" style="width: 100%" /></el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="val.valDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="依据"><el-input v-model="val.note" placeholder="如：同小区 9 月成交均价 × 面积" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="val.visible = false">取消</el-button><el-button type="primary" @click="saveVal">保存</el-button></template>
    </el-dialog>

    <el-drawer v-model="hist.visible" :title="`${hist.row?.name} · 估值历史`" size="460px">
      <ResponsiveTable :data="hist.list" size="small">
        <el-table-column label="日期" width="100"><template #default="{ row }">{{ date(row.valDate) }}</template></el-table-column>
        <el-table-column label="估值" align="right" mobile="amount"><template #default="{ row }"><span class="money">{{ money(row.value) }}</span></template></el-table-column>
        <el-table-column prop="note" label="依据" mobile="full" />
      </ResponsiveTable>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import api from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'
import { money, moneyShort, date } from '@/utils/format'
import { ASSET_TYPES, OWNERS, opts } from '@/constants'

const table = ref()
const sum = ref(0)
const columns = [
  { prop: 'type', label: '类型', type: 'enum', tagList: ASSET_TYPES, width: 80 },
  { prop: 'name', label: '名称', minWidth: 140 },
  { prop: 'owner', label: '产权', type: 'enum', tagList: OWNERS, width: 70 },
  { prop: 'currentValue', label: '当前估值', align: 'right', width: 150, mobile: 'amount' },
  { prop: 'valuedAt', label: '估值日', type: 'date', width: 100 },
  { prop: 'valuationNote', label: '估值依据', minWidth: 140, ellipsis: true, mobile: 'full' },
  { prop: 'address', label: '地址', minWidth: 140, ellipsis: true, mobile: 'full' },
  { prop: 'remark', label: '备注', minWidth: 120, ellipsis: true, mobile: 'full' }
]
const formFields = [
  { prop: 'type', label: '类型', type: 'select', options: opts(ASSET_TYPES), required: true },
  { prop: 'name', label: '名称', required: true },
  { prop: 'owner', label: '产权人', type: 'select', options: opts(OWNERS) },
  { prop: 'address', label: '地址' },
  { prop: 'purchaseDate', label: '购入日期', type: 'date' },
  { prop: 'purchasePrice', label: '购入价', type: 'money' },
  { prop: 'currentValue', label: '当前估值', type: 'money', hint: '日常更新估值请用「更新估值」，会留历史' },
  { prop: 'valuedAt', label: '估值日', type: 'date' },
  { prop: 'valuationNote', label: '估值依据' },
  { prop: 'includeInNetWorth', label: '计入净资产', type: 'switch' },
  { prop: 'status', label: '状态', type: 'select', options: [{ value: 'HOLDING', label: '持有' }, { value: 'SOLD', label: '已出售' }] },
  { prop: 'remark', label: '备注', type: 'textarea' }
]
function onLoaded({ list }) { sum.value = list.filter((a) => a.status === 'HOLDING' && a.includeInNetWorth).reduce((s, a) => s + Number(a.currentValue), 0) }

const val = reactive({ visible: false })
function openVal(row) { Object.assign(val, { visible: true, row, value: Number(row.currentValue), valDate: dayjs().format('YYYY-MM-DD'), note: '' }) }
async function saveVal() {
  try { await api.assets.valuate(val.row.id, { value: val.value, valDate: val.valDate, note: val.note }); ElMessage.success('已更新'); val.visible = false; table.value.reload() } catch (e) { ElMessage.error(e.message) }
}
const hist = reactive({ visible: false, row: null, list: [] })
async function openHistory(row) { Object.assign(hist, { visible: true, row, list: (await api.assets.valuations(row.id)).list }) }
</script>
