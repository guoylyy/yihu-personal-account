<!--
  对话里的草稿卡：金额大字 + 「标签：值」+ 还缺什么 + 入账 / 忽略
  字段默认只读，点「修改」才展开表单；你改过的科目会被记住（按对方名），下次同一对方自动套用
-->
<template>
  <div class="draft" :class="{ done: item._done, failed: item._err }">
    <div v-if="item._done" class="d-done">
      <el-icon><CircleCheck /></el-icon>
      <span class="d-done-text">{{ item._dup ? `刚才已记过 ${item._ref}` : `${isData ? '已保存' : '已入账'} ${item._ref}` }}</span>
      <span class="money">{{ amountText }}</span>
    </div>
    <template v-else>
      <div class="d-head">
        <span class="d-kind">{{ kind }}</span>
        <span class="d-amount-wrap">
          <span class="money d-amount" :class="amountClass">{{ amountText }}</span>
          <span v-if="costText" class="cost-days">{{ costText }}</span>
        </span>
      </div>

      <div v-if="!item._edit" class="d-rows">
        <div v-for="r in rows" :key="r.label" class="d-row" :class="{ wide: r.wide }">
          <span class="d-label">{{ r.label }}：</span><span class="d-value">{{ r.value }}</span>
        </div>
      </div>

      <div v-if="item.targetSummary" class="d-note">改的是：{{ item.targetSummary }}</div>
      <div v-if="item.matchedRule" class="d-note">按你之前的记法归的类</div>
      <div v-if="sourceNote" class="d-note">{{ sourceNote }}</div>
      <div v-if="item.note" class="d-note">{{ item.note }}</div>
      <div v-for="w in otherWarnings" :key="w" class="d-note">{{ w }}</div>
      <div v-if="lack.length" class="d-lack">还缺：{{ lack.join('、') }}</div>
      <div v-if="item._err" class="d-lack">入账失败：{{ item._err }}</div>

      <div v-if="item._edit" class="fields">
        <template v-if="AI_UPDATE_TYPES[item.type] && item.type !== 'update_transaction'" />
        <template v-else-if="item.type === 'update_transaction'">
          <Field label="科目" wide>
            <el-select v-model="item.categoryId" filterable clearable size="small" style="width: 100%" placeholder="不改" @change="onCategory">
              <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label">
                <el-option v-for="o in g.options" :key="o.value" :label="o.label" :value="o.value" />
              </el-option-group>
            </el-select>
          </Field>
          <Field label="金额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="账户"><AccountSelect v-model="item.accountId" placeholder="不改" /></Field>
          <Field label="说明" wide><el-input v-model="item.description" size="small" placeholder="不改" /></Field>
          <Field v-if="item.targetCounterparty" label=" " wide>
            <el-checkbox v-model="item.learn" size="small">记住：以后「{{ item.targetCounterparty }}」都这样归类</el-checkbox>
          </Field>
        </template>
        <template v-else>
          <Field label="类型">
            <el-select v-model="item.type" size="small" style="width: 100%" @change="onType">
              <el-option v-for="(label, v) in AI_TYPES" :key="v" :label="label" :value="v" />
            </el-select>
          </Field>
          <Field v-if="item.type !== 'set_budget'" :label="item.type === 'new_asset' ? '买入日期' : '日期'"><el-date-picker v-model="item.date" type="date" value-format="YYYY-MM-DD" size="small" style="width: 100%" /></Field>
          <Field v-else label="年份"><el-input-number v-model="item.year" inputmode="numeric" :precision="0" :min="2000" :max="2100" size="small" controls-position="right" placeholder="今年" style="width: 100%" /></Field>
        </template>

        <!-- 收支 -->
        <template v-if="item.type === 'transaction'">
          <Field label="方向">
            <el-radio-group v-model="item.direction" size="small">
              <el-radio-button value="OUT">支出</el-radio-button><el-radio-button value="IN">收入</el-radio-button>
            </el-radio-group>
          </Field>
          <Field label="金额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="账户"><AccountSelect v-model="item.accountId" /></Field>
          <Field label="科目" wide>
            <el-select v-model="item.categoryId" filterable size="small" style="width: 100%" placeholder="选科目" @change="onCategory">
              <el-option-group v-for="g in categoryGroups()" :key="g.label" :label="g.label">
                <el-option v-for="o in g.options" :key="o.value" :label="o.label" :value="o.value" />
              </el-option-group>
            </el-select>
          </Field>
          <Field label="对方"><el-input v-model="item.counterparty" size="small" /></Field>
          <Field label="说明" wide><el-input v-model="item.description" size="small" /></Field>
          <Field label="公司款">
            <el-switch v-model="item.isBusiness" size="small" />
            <el-select v-if="item.isBusiness" v-model="item.businessOrg" size="small" allow-create filterable placeholder="哪家" style="width: 100px; margin-left: 8px">
              <el-option v-for="o in ORGS" :key="o" :label="o" :value="o" />
            </el-select>
          </Field>
          <Field v-if="item.counterparty" label=" " wide>
            <el-checkbox v-model="item.learn" size="small">记住：以后「{{ item.counterparty }}」都这样归类</el-checkbox>
          </Field>
        </template>

        <template v-else-if="item.type === 'transfer'">
          <Field label="金额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="转出"><AccountSelect v-model="item.accountId" /></Field>
          <Field label="转入"><AccountSelect v-model="item.toAccountId" /></Field>
          <Field label="说明" wide><el-input v-model="item.description" size="small" /></Field>
        </template>

        <template v-else-if="item.type === 'trade'">
          <Field label="持仓"><OptSelect v-model="item.holdingId" :options="opts.holdings" /></Field>
          <Field label="操作"><OptSelect v-model="item.action" :options="TRADE_ACTIONS.filter((a) => a.value !== 'VALUATION')" /></Field>
          <Field label="数量"><el-input-number v-model="item.quantity" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="价格"><el-input-number v-model="item.price" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="金额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="费用"><el-input-number v-model="item.fee" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="资金账户"><AccountSelect v-model="item.accountId" placeholder="可不选" /></Field>
        </template>

        <template v-else-if="item.type === 'holding_valuation'">
          <Field label="持仓"><OptSelect v-model="item.holdingId" :options="opts.holdings" /></Field>
          <Field label="新价格"><el-input-number v-model="item.price" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="或新市值"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
        </template>

        <template v-else-if="item.type === 'asset_valuation'">
          <Field label="资产"><OptSelect v-model="item.assetId" :options="opts.assets" /></Field>
          <Field label="新估值"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="依据" wide><el-input v-model="item.description" size="small" /></Field>
        </template>

        <template v-else-if="item.type === 'balance'">
          <Field label="账户"><AccountSelect v-model="item.accountId" /></Field>
          <Field label="真实余额"><el-input-number v-model="item.amount" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
        </template>

        <template v-else-if="item.type === 'loan_repay'">
          <Field label="借贷"><OptSelect v-model="item.loanId" :options="opts.loans" /></Field>
          <Field label="本金"><el-input-number v-model="item.principal" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="利息"><el-input-number v-model="item.interest" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="账户"><AccountSelect v-model="item.accountId" placeholder="可不选" /></Field>
        </template>

        <template v-else-if="item.type === 'new_loan'">
          <Field label="方向"><OptSelect v-model="item.direction" :options="LOAN_DIRECTIONS" /></Field>
          <Field label="对方"><el-input v-model="item.counterparty" size="small" /></Field>
          <Field label="金额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="类型"><OptSelect v-model="item.kind" :options="LOAN_KINDS" /></Field>
          <Field label="说明" wide><el-input v-model="item.description" size="small" /></Field>
        </template>

        <template v-else-if="item.type === 'new_holding'">
          <Field label="名称"><el-input v-model="item.holding" size="small" /></Field>
          <Field label="类型"><OptSelect v-model="item.holdingType" :options="HOLDING_TYPES" /></Field>
          <Field label="代码"><el-input v-model="item.code" size="small" /></Field>
          <Field label="平台"><el-input v-model="item.platform" size="small" /></Field>
          <Field label="数量"><el-input-number v-model="item.quantity" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="价格"><el-input-number v-model="item.price" inputmode="decimal" :precision="4" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="金额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="资金账户"><AccountSelect v-model="item.accountId" placeholder="可不选" /></Field>
        </template>

        <template v-else-if="item.type === 'new_asset'">
          <Field label="名称"><el-input v-model="item.assetName" size="small" /></Field>
          <Field label="类型"><OptSelect v-model="item.assetType" :options="ASSET_TYPES" /></Field>
          <Field label="现在估值"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="" style="width: 100%" /></Field>
          <Field label="买入价"><el-input-number v-model="item.purchasePrice" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="可不填" style="width: 100%" /></Field>
          <Field label="地址" wide><el-input v-model="item.address" size="small" /></Field>
          <Field label="说明" wide><el-input v-model="item.description" size="small" /></Field>
        </template>

        <template v-else-if="item.type === 'new_account'">
          <Field label="名称"><el-input v-model="item.accountName" size="small" /></Field>
          <Field label="类型"><OptSelect v-model="item.accountType" :options="ACCOUNT_TYPES" /></Field>
          <Field label="当前余额"><el-input-number v-model="item.amount" inputmode="decimal" :precision="2" size="small" controls-position="right" style="width: 100%" /></Field>
          <Field label="机构"><el-input v-model="item.institution" size="small" /></Field>
          <Field label="尾号"><el-input v-model="item.lastNo" size="small" /></Field>
          <template v-if="item.accountType === 'CREDIT'">
            <Field label="额度"><el-input-number v-model="item.creditLimit" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="可不填" style="width: 100%" /></Field>
            <Field label="账单日"><el-input-number v-model="item.billDay" inputmode="numeric" :precision="0" :min="1" :max="31" size="small" controls-position="right" placeholder="可不填" style="width: 100%" /></Field>
            <Field label="还款日"><el-input-number v-model="item.repayDay" inputmode="numeric" :precision="0" :min="1" :max="31" size="small" controls-position="right" placeholder="可不填" style="width: 100%" /></Field>
          </template>
        </template>

        <template v-else-if="item.type === 'set_budget'">
          <Field label="科目" wide>
            <el-select v-model="item.categoryId" filterable size="small" style="width: 100%" placeholder="选支出科目" @change="onCategory">
              <el-option v-for="o in categoryOptions('EXPENSE')" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </Field>
          <Field label="月度"><el-input-number v-model="item.monthly" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="填一个即可" style="width: 100%" /></Field>
          <Field label="年度"><el-input-number v-model="item.annual" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="填一个即可" style="width: 100%" /></Field>
        </template>

        <template v-else-if="item.type === 'update_account'">
          <Field label="新名称"><el-input v-model="item.newName" size="small" placeholder="不改" /></Field>
          <Field label="机构"><el-input v-model="item.institution" size="small" placeholder="不改" /></Field>
          <Field label="尾号"><el-input v-model="item.lastNo" size="small" placeholder="不改" /></Field>
          <Field label="额度"><el-input-number v-model="item.creditLimit" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="账单日"><el-input-number v-model="item.billDay" inputmode="numeric" :precision="0" :min="1" :max="31" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="还款日"><el-input-number v-model="item.repayDay" inputmode="numeric" :precision="0" :min="1" :max="31" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="状态"><OptSelect v-model="item.status" :options="ACCOUNT_STATUS" placeholder="不改" /></Field>
          <Field label="别名" wide><el-input v-model="item.aliases" size="small" placeholder="不改" /></Field>
          <Field label="备注" wide><el-input v-model="item.remark" size="small" placeholder="不改" /></Field>
        </template>

        <template v-else-if="item.type === 'update_holding'">
          <Field label="新名称"><el-input v-model="item.newName" size="small" placeholder="不改" /></Field>
          <Field label="代码"><el-input v-model="item.code" size="small" placeholder="不改" /></Field>
          <Field label="平台"><el-input v-model="item.platform" size="small" placeholder="不改" /></Field>
          <Field label="到期日"><el-date-picker v-model="item.maturityDate" type="date" value-format="YYYY-MM-DD" size="small" placeholder="不改" style="width: 100%" /></Field>
          <Field label="年利率%"><el-input-number v-model="item.annualRate" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="备注" wide><el-input v-model="item.remark" size="small" placeholder="不改" /></Field>
        </template>

        <template v-else-if="item.type === 'update_asset'">
          <Field label="新名称"><el-input v-model="item.newName" size="small" placeholder="不改" /></Field>
          <Field label="状态"><OptSelect v-model="item.status" :options="ASSET_STATUS" placeholder="不改" /></Field>
          <Field label="买入日期"><el-date-picker v-model="item.purchaseDate" type="date" value-format="YYYY-MM-DD" size="small" placeholder="不改" style="width: 100%" /></Field>
          <Field label="买入价"><el-input-number v-model="item.purchasePrice" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="地址" wide><el-input v-model="item.address" size="small" placeholder="不改" /></Field>
          <Field label="备注" wide><el-input v-model="item.remark" size="small" placeholder="不改" /></Field>
        </template>

        <template v-else-if="item.type === 'update_loan'">
          <Field label="月供"><el-input-number v-model="item.monthlyPayment" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="年利率%"><el-input-number v-model="item.annualRate" inputmode="decimal" :precision="2" :min="0" size="small" controls-position="right" placeholder="不改" style="width: 100%" /></Field>
          <Field label="到期日"><el-date-picker v-model="item.dueDate" type="date" value-format="YYYY-MM-DD" size="small" placeholder="不改" style="width: 100%" /></Field>
          <Field label="类型"><OptSelect v-model="item.kind" :options="LOAN_KINDS" placeholder="不改" /></Field>
          <Field label="对方"><el-input v-model="item.counterparty" size="small" placeholder="不改" /></Field>
          <Field label="合同号"><el-input v-model="item.contractNo" size="small" placeholder="不改" /></Field>
          <Field label="备注" wide><el-input v-model="item.remark" size="small" placeholder="不改" /></Field>
        </template>
      </div>

      <div class="d-actions">
        <el-button link class="d-edit" @click="item._edit = !item._edit">{{ item._edit ? '收起' : '修改' }}</el-button>
        <span class="spacer" />
        <el-button text class="d-ignore" :disabled="item._busy" @click="$emit('ignore')">忽略</el-button>
        <el-button class="card-submit" type="primary" plain :loading="item._busy" :disabled="busy" @click="$emit('submit')">{{ isData ? '确认' : '入账' }}</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, h } from 'vue'
import { ElSelect, ElOption } from 'element-plus'
import api from '@/api'
import { money } from '@/utils/format'
import { lackOf } from '@/utils/aiDraft'
import { accounts, categories, categoryGroups, categoryOptions, accountOptions } from '@/composables/useMeta'
import { costDays } from '@/composables/useFreedom'
import { AI_TYPES, AI_UPDATE_TYPES, AI_DATA_TYPES, ORGS, TRADE_ACTIONS, LOAN_DIRECTIONS, LOAN_KINDS, HOLDING_TYPES, ASSET_TYPES, ACCOUNT_TYPES } from '@/constants'

const props = defineProps({
  item: { type: Object, required: true },
  opts: { type: Object, required: true }, // { holdings, assets, loans }
  busy: Boolean
})
defineEmits(['submit', 'ignore'])

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

const labelIn = (list, v) => (list || []).find((o) => o.value === v)?.label || v
const accountName = (id, name) => accounts.value.find((a) => String(a.id) === String(id))?.name || (id ? name : null)
const categoryName = (id) => categories.value.find((c) => String(c.id) === String(id))?.name
const picked = (list, id, name) => labelIn(list, id) || name
const number = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
const bought = (it) => (it.amount != null ? it.amount : it.quantity && it.price ? it.quantity * it.price : null)

const ACCOUNT_STATUS = [{ value: 'ACTIVE', label: '使用中' }, { value: 'CLOSED', label: '已停用' }]
const ASSET_STATUS = [{ value: 'HOLDING', label: '持有' }, { value: 'SOLD', label: '已卖出' }]
const kind = computed(() => AI_UPDATE_TYPES[props.item.type] || AI_TYPES[props.item.type] || props.item.type)
const isData = computed(() => AI_DATA_TYPES.includes(props.item.type))

const amountValue = computed(() => {
  const it = props.item
  if (it.type === 'loan_repay') return (number(it.principal) || 0) + (number(it.interest) || 0) || null
  if (['trade', 'new_holding'].includes(it.type)) return bought(it)
  if (it.type === 'new_asset') return it.amount ?? it.purchasePrice
  if (it.type === 'set_budget') return it.monthly ?? (it.annual != null ? it.annual / 12 : null)
  if (AI_UPDATE_TYPES[it.type] && it.type !== 'update_transaction') return null
  return it.amount
})
const amountText = computed(() => {
  const it = props.item
  const v = amountValue.value
  if (v === undefined || v === null || v === '') return it.type === 'holding_valuation' && it.price != null ? `价格 ${it.price}` : ''
  return it.type === 'transaction' ? `${it.direction === 'IN' ? '+' : '−'}${money(v)}` : money(v)
})
// 只算花出去的个人弹性支出
const costText = computed(() => {
  const it = props.item
  if (it.type !== 'transaction' || it.direction === 'IN' || it.isBusiness) return ''
  const group = categories.value.find((c) => String(c.id) === String(it.categoryId))?.groupName
  const d = costDays(it.amount, group)
  return d ? `≈ ${d} 天` : ''
})
const amountClass = computed(() => (props.item.type === 'transaction' ? (props.item.direction === 'IN' ? 'money-in' : 'money-out') : ''))

// 只列有值的字段，缺的统一写在「还缺」那一行
const ROWS = {
  transaction: (it) => [['科目', categoryName(it.categoryId)], ['账户', accountName(it.accountId, it.account)], ['日期', it.date], ['公司款', it.isBusiness ? it.businessOrg || '是' : null], ['对方', it.counterparty, true], ['说明', it.description, true]],
  transfer: (it) => [['转出', accountName(it.accountId, it.account)], ['转入', accountName(it.toAccountId, it.toAccount)], ['日期', it.date], ['说明', it.description, true]],
  trade: (it, o) => [['持仓', picked(o.holdings, it.holdingId, it.holding), true], ['操作', labelIn(TRADE_ACTIONS, it.action)], ['日期', it.date], ['数量', it.quantity], ['价格', it.price], ['费用', it.fee], ['资金账户', accountName(it.accountId, it.account)]],
  holding_valuation: (it, o) => [['持仓', picked(o.holdings, it.holdingId, it.holding), true], ['日期', it.date]],
  asset_valuation: (it, o) => [['资产', picked(o.assets, it.assetId, it.asset), true], ['日期', it.date], ['依据', it.description, true]],
  balance: (it) => [['账户', accountName(it.accountId, it.account)], ['日期', it.date]],
  loan_repay: (it, o) => [['借贷', picked(o.loans, it.loanId, it.loan), true], ['本金', it.principal], ['利息', it.interest], ['账户', accountName(it.accountId, it.account)], ['日期', it.date]],
  new_loan: (it) => [['方向', labelIn(LOAN_DIRECTIONS, it.direction)], ['类型', labelIn(LOAN_KINDS, it.kind)], ['日期', it.date], ['对方', it.counterparty, true], ['说明', it.description, true]],
  new_holding: (it) => [['名称', it.holding, true], ['类型', labelIn(HOLDING_TYPES, it.holdingType)], ['代码', it.code], ['平台', it.platform], ['数量', it.quantity], ['价格', it.price], ['资金账户', accountName(it.accountId, it.account)], ['日期', it.date]],
  update_transaction: (it) => [['科目', categoryName(it.categoryId)], ['账户', accountName(it.accountId, it.account)], ['日期', it.date], ['对方', it.counterparty, true], ['说明', it.description, true]],
  new_asset: (it) => [['名称', it.assetName, true], ['类型', labelIn(ASSET_TYPES, it.assetType)], ['买入价', it.purchasePrice != null ? money(it.purchasePrice) : null], ['买入日期', it.date], ['地址', it.address, true], ['说明', it.description, true]],
  new_account: (it) => [['名称', it.accountName, true], ['类型', labelIn(ACCOUNT_TYPES, it.accountType)], ['机构', it.institution], ['尾号', it.lastNo], ['额度', it.creditLimit != null ? money(it.creditLimit) : null], ['账单日', it.billDay], ['还款日', it.repayDay]],
  set_budget: (it) => [['科目', categoryName(it.categoryId)], ['年份', it.year || new Date().getFullYear()], ['月度', it.monthly], ['年度', it.annual]],
  update_account: (it) => [['新名称', it.newName], ['机构', it.institution], ['尾号', it.lastNo], ['额度', it.creditLimit], ['账单日', it.billDay], ['还款日', it.repayDay], ['状态', it.status && labelIn(ACCOUNT_STATUS, it.status)], ['别名', it.aliases, true], ['备注', it.remark, true]],
  update_holding: (it) => [['新名称', it.newName], ['代码', it.code], ['平台', it.platform], ['到期日', it.maturityDate], ['年利率', it.annualRate != null ? `${it.annualRate}%` : null], ['备注', it.remark, true]],
  update_asset: (it) => [['新名称', it.newName], ['状态', it.status && labelIn(ASSET_STATUS, it.status)], ['买入日期', it.purchaseDate], ['买入价', it.purchasePrice != null ? money(it.purchasePrice) : null], ['地址', it.address, true], ['备注', it.remark, true]],
  update_loan: (it) => [['月供', it.monthlyPayment != null ? money(it.monthlyPayment) : null], ['年利率', it.annualRate != null ? `${it.annualRate}%` : null], ['到期日', it.dueDate], ['类型', it.kind && labelIn(LOAN_KINDS, it.kind)], ['对方', it.counterparty], ['合同号', it.contractNo], ['备注', it.remark, true]]
}
const rows = computed(() => (ROWS[props.item.type]?.(props.item, props.opts) || [])
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([label, value, wide]) => ({ label, value, wide })))

const lack = computed(() => lackOf(props.item))
// 缺字段类的警告已经进了「还缺」，这里只留别的提醒，比如改流水时另一边不动
const otherWarnings = computed(() => (props.item.warnings || []).filter((w) => !/^(缺|未|转账需要|没找到)/.test(w)))

const SOURCE_LABEL = { pinned: '来自 @ 引用', filter: '来自当前页筛选' }
const FIELD_LABEL = { targetId: '修改目标', accountId: '账户', toAccountId: '转入账户', holdingId: '持仓', assetId: '资产', loanId: '借贷', isBusiness: '公司款' }
const sourceNote = computed(() => {
  const list = Object.entries(props.item.refSource || {}).map(([k, v]) => `${FIELD_LABEL[k] || k}${SOURCE_LABEL[v] || ''}`)
  return list.length ? `${list.join('，')}，不对可以改` : ''
})

function onCategory() {
  const it = props.item
  const c = categories.value.find((x) => String(x.id) === it.categoryId)
  it.categoryCode = c?.code
  if (c?.code === 'C') it.isBusiness = true
}

async function onType() {
  const it = props.item
  const [r] = await api.ai.resolve([it])
  Object.assign(it, { warnings: r.warnings, missing: r.missing })
}
</script>

<style scoped>
.draft { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; padding: 12px; margin-top: 8px; width: 100%; min-width: 0; box-sizing: border-box; }
.draft.failed { border-color: #efc4c0; }
.draft.done { border-color: #cfe3d8; background: #f6faf8; padding: 8px 12px; }
.d-done { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--accent); }
.d-done-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.d-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.d-kind { font-size: 12px; color: var(--text-muted); }
.d-amount-wrap { display: inline-flex; align-items: baseline; gap: 8px; }
.d-amount { font-size: 18px; font-weight: 700; }
.d-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; margin-top: 8px; font-size: 13px; line-height: 1.6; }
.d-row { min-width: 0; word-break: break-word; }
.d-row.wide { grid-column: span 2; }
.d-label { color: var(--text-muted); }
.d-note { font-size: 12px; line-height: 1.6; margin-top: 6px; color: var(--text-muted); word-break: break-word; }
.d-lack { font-size: 13px; line-height: 1.6; margin-top: 6px; color: var(--danger); word-break: break-word; }
.d-actions { display: flex; align-items: center; gap: 4px; margin-top: 10px; }
.d-actions .el-button + .el-button { margin-left: 0; }
.d-edit { font-size: 13px; }
.spacer { flex: 1; }
.fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-top: 10px; }
.fields :deep(.field) { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fields :deep(.field > label) { width: 52px; flex-shrink: 0; font-size: 12px; color: var(--text-muted); text-align: right; }
.fields :deep(.field > .ctl) { flex: 1; min-width: 0; display: flex; align-items: center; }

@media (max-width: 768px) {
  .d-done, .d-rows { font-size: 14px; }
  .d-kind, .d-note, .d-lack { font-size: 14px; }
  .d-actions .el-button { min-height: 44px; min-width: 44px; font-size: 14px; }
  .card-submit { min-width: 88px; }
  .fields :deep(.field) { align-items: flex-start; flex-direction: column; gap: 4px; }
  .fields :deep(.field > label) { width: auto; font-size: 14px; text-align: left; }
  .fields :deep(.field > .ctl) { width: 100%; flex-wrap: wrap; }
}
</style>
