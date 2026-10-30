<template>
  <div>
    <CrudTable ref="table" :api="api.accounts" title="账户" entity-name="账户" add-text="新增账户"
               subtitle="余额 = 校准日真实余额 + 之后的流水。和 App 里对不上时点「校准」，不用去改流水"
               :columns="columns" :form-fields="formFields" :default-form="{ type: 'BANK', owner: 'ME', status: 'ACTIVE', initialBalance: 0, initialDate: today }"
               :action-width="224" @loaded="onLoaded">
      <template #toolbar>
        <el-button @click="openTransfer"><el-icon><Switch /></el-icon>&nbsp;转账 / 还信用卡</el-button>
      </template>
      <template #stats>
        <div class="stat-grid">
          <div class="stat-card is-accent"><div class="label">现金类合计</div><div class="value">¥{{ money(sum.cash) }}</div></div>
          <div class="stat-card is-danger"><div class="label">信用卡欠款</div><div class="value">¥{{ money(sum.debt) }}</div></div>
        </div>
      </template>
      <template #col-balance="{ row }">
        <span class="money" :class="{ 'money-out': Number(row.balance) < 0 }">{{ money(row.balance) }}</span>
      </template>
      <template #col-initialDate="{ row }">
        <span :class="{ 'money-out': stale(row) }">{{ date(row.initialDate) }}</span>
      </template>
      <template #row-actions="{ row }">
        <PinButton type="account" :id="row.id" :label="row.name" />
        <el-button link type="primary" @click="openCalibrate(row)">校准</el-button>
        <el-button link @click="router.push(`/transactions?account_id=${row.id}`)">流水</el-button>
      </template>
    </CrudTable>

    <el-dialog v-model="cal.visible" :title="`校准余额 · ${cal.row?.name}`" width="420px">
      <el-form label-width="90px">
        <el-form-item label="系统余额"><span class="money">{{ money(cal.row?.balance) }}</span></el-form-item>
        <el-form-item label="真实余额"><el-input-number v-model="cal.balance" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item label="截至日期"><el-date-picker v-model="cal.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <div class="muted m-form-hint" style="font-size: 12px; padding-left: 90px">信用卡填负数表示欠款，如欠 3,000 填 -3000。之前的流水保留，只是不再影响余额。</div>
      </el-form>
      <template #footer>
        <el-button @click="cal.visible = false">取消</el-button>
        <el-button type="primary" @click="saveCalibrate">校准</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="tr.visible" title="账户互转" width="440px">
      <el-form label-width="80px">
        <el-form-item label="转出"><el-select v-model="tr.fromAccountId" style="width: 100%"><el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" /></el-select></el-form-item>
        <el-form-item label="转入"><el-select v-model="tr.toAccountId" style="width: 100%"><el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" /></el-select></el-form-item>
        <el-form-item label="金额"><el-input-number v-model="tr.amount" inputmode="decimal" :precision="2" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="tr.txnDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="tr.description" placeholder="如：还光大信用卡" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tr.visible = false">取消</el-button>
        <el-button type="primary" @click="saveTransfer">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import api from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import PinButton from '@/components/PinButton.vue'
import { money, date } from '@/utils/format'
import { ACCOUNT_TYPES, OWNERS, opts } from '@/constants'
import { accountOptions, loadMeta } from '@/composables/useMeta'
import { onAiCommitted } from '@/composables/useAiAssistant'

const router = useRouter()
const table = ref()
onAiCommitted(() => table.value?.reload())
const today = dayjs().format('YYYY-MM-DD')
const sum = reactive({ cash: 0, debt: 0 })
const stale = (row) => !row.initialDate || dayjs().diff(dayjs(row.initialDate), 'day') > 35

const columns = [
  { prop: 'name', label: '账户', minWidth: 120 },
  { prop: 'type', label: '类型', type: 'enum', tagList: ACCOUNT_TYPES, width: 110 },
  { prop: 'institution', label: '机构', width: 110 },
  { prop: 'lastNo', label: '尾号', width: 70 },
  { prop: 'owner', label: '归属', type: 'enum', tagList: OWNERS, width: 70 },
  { prop: 'balance', label: '当前余额', align: 'right', width: 140, mobile: 'amount' },
  { prop: 'initialDate', label: '校准日', width: 110 },
  { prop: 'aliases', label: '识别别名', minWidth: 160, ellipsis: true, mobile: 'full' },
  { prop: 'remark', label: '备注', minWidth: 120, ellipsis: true, mobile: 'full' }
]
const formFields = [
  { prop: 'name', label: '账户名', required: true },
  { prop: 'type', label: '类型', type: 'select', options: opts(ACCOUNT_TYPES), required: true },
  { prop: 'institution', label: '机构' },
  { prop: 'lastNo', label: '尾号' },
  { prop: 'owner', label: '归属', type: 'select', options: opts(OWNERS) },
  { prop: 'initialBalance', label: '期初余额', type: 'money', negative: true, hint: '期初日当天的真实余额；信用卡欠款填负数' },
  { prop: 'initialDate', label: '期初日', type: 'date' },
  { prop: 'aliases', label: '识别别名', placeholder: '逗号分隔', hint: '导入账单 / AI 识别时用：如「泰隆银行储蓄卡(0595),0595」' },
  { prop: 'creditLimit', label: '信用额度', type: 'money' },
  { prop: 'repayDay', label: '还款日', type: 'number' },
  { prop: 'sort', label: '排序', type: 'number' },
  { prop: 'status', label: '状态', type: 'select', options: [{ value: 'ACTIVE', label: '使用中' }, { value: 'CLOSED', label: '已停用' }] },
  { prop: 'remark', label: '备注', type: 'textarea' }
]

function onLoaded({ list }) {
  sum.cash = list.filter((a) => a.type !== 'CREDIT' && a.status === 'ACTIVE').reduce((s, a) => s + Number(a.balance), 0)
  sum.debt = list.filter((a) => a.type === 'CREDIT').reduce((s, a) => s + Math.max(-Number(a.balance), 0), 0)
  loadMeta(true)
}

const cal = reactive({ visible: false, row: null, balance: 0, date: today })
function openCalibrate(row) { Object.assign(cal, { visible: true, row, balance: Number(row.balance), date: today }) }
async function saveCalibrate() {
  try {
    await api.accounts.calibrate(cal.row.id, { balance: cal.balance, date: cal.date })
    ElMessage.success('已校准')
    cal.visible = false
    table.value.reload()
  } catch (e) { ElMessage.error(e.message) }
}

const tr = reactive({ visible: false, fromAccountId: '', toAccountId: '', amount: 0, txnDate: today, description: '' })
function openTransfer() { Object.assign(tr, { visible: true, amount: 0, txnDate: today, description: '' }) }
async function saveTransfer() {
  try {
    await api.accounts.transfer({ ...tr })
    ElMessage.success('已记录转账')
    tr.visible = false
    table.value.reload()
  } catch (e) { ElMessage.error(e.message) }
}
</script>
