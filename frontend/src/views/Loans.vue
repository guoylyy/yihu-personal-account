<template>
  <div>
    <CrudTable ref="table" :api="api.loans" title="借贷往来" entity-name="借贷" add-text="新增借贷"
               subtitle="个人视角：我借出去的是应收（资产），我借进来的是负债（含房贷）。方向或金额待核实的，状态选「待核实」暂不计入净资产"
               :columns="columns" :form-fields="formFields" :default-form="{ direction: 'LEND', kind: 'PERSONAL', status: 'ACTIVE', includeInNetWorth: true }"
               :filters="[{ prop: 'direction', label: '方向', type: 'select', options: LOAN_DIRECTIONS }, { prop: 'status', label: '状态', type: 'select', options: LOAN_STATUS }]"
               :action-width="224" @loaded="onLoaded">
      <template #stats>
        <div class="stat-grid">
          <div class="stat-card is-success"><div class="label">应收（别人欠我）</div><div class="value">¥{{ money(sum.lend) }}</div></div>
          <div class="stat-card is-danger"><div class="label">负债（我欠别人）</div><div class="value">¥{{ money(sum.borrow) }}</div></div>
          <div class="stat-card"><div class="label">待核实（未计入）</div><div class="value">¥{{ money(sum.pending) }}</div></div>
        </div>
      </template>
      <template #col-balance="{ row }">
        <span class="money" :class="row.direction === 'LEND' ? 'money-in' : 'money-out'"><b>{{ money(row.balance) }}</b></span>
        <div class="muted" style="font-size: 12px">本金 {{ money(row.principal) }}</div>
      </template>
      <template #row-actions="{ row }">
        <PinButton type="loan" :id="row.id" :label="row.counterparty" />
        <el-button v-if="row.status !== 'SETTLED'" link type="primary" @click="openRepay(row)">{{ row.direction === 'LEND' ? '登记回款' : '登记还款' }}</el-button>
        <el-button link @click="openHistory(row)">记录</el-button>
      </template>
    </CrudTable>

    <el-dialog v-model="rp.visible" :title="`${rp.row?.counterparty} · ${rp.row?.direction === 'LEND' ? '回款' : '还款'}`" width="440px">
      <el-form label-width="80px">
        <el-form-item label="日期"><el-date-picker v-model="rp.repayDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="本金"><el-input-number v-model="rp.principalPart" inputmode="decimal" :precision="2" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="利息"><el-input-number v-model="rp.interestPart" inputmode="decimal" :precision="2" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="资金账户">
          <el-select v-model="rp.accountId" clearable placeholder="不选则不记现金流水" style="width: 100%"><el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" /></el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="rp.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="rp.visible = false">取消</el-button><el-button type="primary" @click="saveRepay">确定</el-button></template>
    </el-dialog>

    <el-drawer v-model="hist.visible" :title="`${hist.row?.counterparty} · 还款记录`" size="480px">
      <ResponsiveTable :data="hist.list" size="small">
        <el-table-column label="日期" width="100"><template #default="{ row }">{{ date(row.repayDate) }}</template></el-table-column>
        <el-table-column label="本金" align="right"><template #default="{ row }"><span class="money">{{ money(row.principalPart) }}</span></template></el-table-column>
        <el-table-column label="利息" align="right"><template #default="{ row }"><span class="money">{{ money(row.interestPart) }}</span></template></el-table-column>
        <el-table-column prop="remark" label="备注" mobile="full" />
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
import PinButton from '@/components/PinButton.vue'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'
import { money, date } from '@/utils/format'
import { LOAN_DIRECTIONS, LOAN_KINDS, LOAN_STATUS, opts } from '@/constants'
import { accountOptions } from '@/composables/useMeta'
import { onAiCommitted } from '@/composables/useAiAssistant'

const table = ref()
onAiCommitted(() => table.value?.reload())
const sum = reactive({ lend: 0, borrow: 0, pending: 0 })
const columns = [
  { prop: 'direction', label: '方向', type: 'tag', tagList: LOAN_DIRECTIONS, width: 120 },
  { prop: 'counterparty', label: '对方', minWidth: 130 },
  { prop: 'kind', label: '类型', type: 'enum', tagList: LOAN_KINDS, width: 100 },
  { prop: 'balance', label: '未还余额', align: 'right', width: 150, mobile: 'amount' },
  { prop: 'annualRate', label: '年利率%', width: 80 },
  { prop: 'monthlyPayment', label: '月供', type: 'money', align: 'right', width: 100 },
  { prop: 'startDate', label: '起始', type: 'date', width: 100 },
  { prop: 'status', label: '状态', type: 'tag', tagList: LOAN_STATUS, width: 90 },
  { prop: 'remark', label: '备注', minWidth: 200, ellipsis: true, mobile: 'full' }
]
const formFields = [
  { prop: 'direction', label: '方向', type: 'select', options: opts(LOAN_DIRECTIONS), required: true },
  { prop: 'counterparty', label: '对方', required: true },
  { prop: 'kind', label: '类型', type: 'select', options: opts(LOAN_KINDS) },
  { prop: 'principal', label: '本金', type: 'money', required: true },
  { prop: 'balance', label: '未还余额', type: 'money', hint: '新增时不填默认等于本金' },
  { prop: 'annualRate', label: '年利率%', type: 'number' },
  { prop: 'monthlyPayment', label: '月供', type: 'money' },
  { prop: 'startDate', label: '起始日', type: 'date' },
  { prop: 'dueDate', label: '到期日', type: 'date' },
  { prop: 'contractNo', label: '合同号' },
  { prop: 'status', label: '状态', type: 'select', options: opts(LOAN_STATUS) },
  { prop: 'includeInNetWorth', label: '计入净资产', type: 'switch' },
  { prop: 'remark', label: '备注', type: 'textarea' }
]
function onLoaded({ list }) {
  const counted = (l) => l.includeInNetWorth && l.status !== 'TO_CONFIRM' && l.status !== 'SETTLED'
  sum.lend = list.filter((l) => l.direction === 'LEND' && counted(l)).reduce((s, l) => s + Number(l.balance), 0)
  sum.borrow = list.filter((l) => l.direction === 'BORROW' && counted(l)).reduce((s, l) => s + Number(l.balance), 0)
  sum.pending = list.filter((l) => l.status !== 'SETTLED' && !counted(l)).reduce((s, l) => s + Number(l.balance), 0)
}

const rp = reactive({ visible: false })
function openRepay(row) { Object.assign(rp, { visible: true, row, repayDate: dayjs().format('YYYY-MM-DD'), principalPart: 0, interestPart: 0, accountId: '', remark: '' }) }
async function saveRepay() {
  const { visible, row, ...body } = rp
  try { await api.loans.repay(row.id, body); ElMessage.success('已登记'); rp.visible = false; table.value.reload() } catch (e) { ElMessage.error(e.message) }
}
const hist = reactive({ visible: false, row: null, list: [] })
async function openHistory(row) { Object.assign(hist, { visible: true, row, list: (await api.loans.repayments(row.id)).list }) }
</script>
