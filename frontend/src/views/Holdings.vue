<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">投资持仓</div>
        <div class="page-sub">股票、基金按「数量 × 现价」算市值；理财、定存、股权直接填市值。买卖时选资金账户会自动记一笔转移流水（不算消费）</div>
      </div>
      <div>
        <el-radio-group v-model="status" style="margin-right: 10px" @change="load">
          <el-radio-button value="HOLDING">持有中</el-radio-button><el-radio-button value="">全部</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="openForm()"><el-icon><Plus /></el-icon>&nbsp;新增持仓</el-button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card is-accent"><div class="label">金融投资市值</div><div class="value">¥{{ money(total.mv) }}</div><div class="foot">成本 {{ money(total.cost) }}</div></div>
      <div class="stat-card"><div class="label">浮动盈亏</div><div class="value" :class="total.pnl >= 0 ? 'money-in' : 'money-out'">{{ money(total.pnl, true) }}</div><div class="foot">不含股权</div></div>
      <div class="stat-card"><div class="label">股权估值</div><div class="value">¥{{ money(total.equity) }}</div><div class="foot">{{ total.equityPending }} 家待估值</div></div>
    </div>

    <div class="table-card">
      <ResponsiveTable :data="list" v-loading="loading" size="small">
        <el-table-column label="类型" width="72"><template #default="{ row }">{{ labelOf(HOLDING_TYPES, row.type) }}</template></el-table-column>
        <el-table-column label="名称" min-width="150" mobile="title">
          <template #default="{ row }">
            <b>{{ row.name }}</b> <span class="muted">{{ row.code }}</span>
            <div class="muted" style="font-size: 12px">{{ row.platform }}{{ row.ratio ? ` · 持股 ${Number(row.ratio)}%` : '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="数量" align="right" width="100"><template #default="{ row }">{{ Number(row.quantity) ? Number(row.quantity) : '—' }}</template></el-table-column>
        <el-table-column label="现价" align="right" width="90"><template #default="{ row }">{{ row.price != null ? Number(row.price) : '—' }}</template></el-table-column>
        <el-table-column label="成本" align="right" width="120"><template #default="{ row }"><span class="money">{{ money(row.costAmount) }}</span></template></el-table-column>
        <el-table-column label="市值" align="right" width="130" mobile="amount"><template #default="{ row }"><span class="money"><b>{{ money(row.mv) }}</b></span></template></el-table-column>
        <el-table-column label="浮盈" align="right" width="140">
          <template #default="{ row }">
            <span v-if="row.pnl != null" class="money" :class="row.pnl >= 0 ? 'money-in' : 'money-out'">{{ money(row.pnl, true) }} <small>{{ row.pnlRate }}%</small></span>
          </template>
        </el-table-column>
        <el-table-column label="已实现" align="right" width="100"><template #default="{ row }"><span v-if="Number(row.realizedPnl)" class="money">{{ money(row.realizedPnl) }}</span></template></el-table-column>
        <el-table-column label="估值" width="160" mobile="full">
          <template #default="{ row }"><span class="muted" style="font-size: 12px">{{ date(row.valuedAt) }} {{ row.valuationNote }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="256" fixed="right">
          <template #default="{ row }">
            <PinButton type="holding" :id="row.id" :label="row.name" />
            <el-button link type="primary" @click="openTrade(row)">交易/估值</el-button>
            <el-button link @click="openTrades(row)">记录</el-button>
            <el-button link @click="openForm(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删</el-button>
          </template>
        </el-table-column>
      </ResponsiveTable>
    </div>

    <el-dialog v-model="form.visible" :title="form.id ? '编辑持仓' : '新增持仓'" width="540px">
      <el-form label-width="90px">
        <el-form-item label="类型"><el-select v-model="form.type" style="width: 100%"><el-option v-for="o in HOLDING_TYPES" :key="o.value" v-bind="o" /></el-select></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item v-if="['STOCK', 'FUND'].includes(form.type)" label="代码/市场">
          <el-input v-model="form.code" style="width: 60%" placeholder="00700 / 510300" />
          <el-select v-model="form.market" clearable style="width: 38%; margin-left: 2%"><el-option v-for="o in MARKETS" :key="o.value" v-bind="o" /></el-select>
        </el-form-item>
        <el-form-item label="平台"><el-input v-model="form.platform" placeholder="券商 / 且慢 / 银行" /></el-form-item>
        <template v-if="!form.id">
          <el-form-item v-if="['STOCK', 'FUND'].includes(form.type)" label="持有数量"><el-input-number v-model="form.quantity" inputmode="decimal" :precision="4" style="width: 100%" /></el-form-item>
          <el-form-item v-if="['STOCK', 'FUND'].includes(form.type)" label="现价"><el-input-number v-model="form.price" inputmode="decimal" :precision="4" style="width: 100%" /></el-form-item>
          <el-form-item label="成本"><el-input-number v-model="form.costAmount" inputmode="decimal" :precision="2" style="width: 100%" /></el-form-item>
        </template>
        <el-form-item label="当前市值"><el-input-number v-model="form.marketValue" inputmode="decimal" :precision="2" style="width: 100%" /><div class="muted" style="font-size: 12px">股票基金有数量和现价时自动算，可留空</div></el-form-item>
        <el-form-item v-if="form.type === 'EQUITY'" label="持股比例%"><el-input-number v-model="form.ratio" inputmode="decimal" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item label="估值口径"><el-input v-model="form.valuationNote" /></el-form-item>
        <el-form-item v-if="['DEPOSIT', 'WEALTH', 'INSURANCE'].includes(form.type)" label="到期/年化">
          <el-date-picker v-model="form.maturityDate" type="date" value-format="YYYY-MM-DD" style="width: 55%" />
          <el-input-number v-model="form.annualRate" inputmode="decimal" :precision="2" placeholder="%" style="width: 43%; margin-left: 2%" />
        </el-form-item>
        <el-form-item label="计入净资产"><el-switch v-model="form.includeInNetWorth" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="form.visible = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="trade.visible" :title="`${trade.row?.name} · 交易 / 估值`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="操作">
          <el-radio-group v-model="trade.action"><el-radio-button v-for="a in TRADE_ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="trade.tradeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <template v-if="['BUY', 'SELL'].includes(trade.action)">
          <el-form-item label="数量"><el-input-number v-model="trade.quantity" inputmode="decimal" :precision="4" style="width: 100%" /></el-form-item>
          <el-form-item label="价格"><el-input-number v-model="trade.price" inputmode="decimal" :precision="4" style="width: 100%" /></el-form-item>
        </template>
        <el-form-item v-if="trade.action === 'VALUATION'" label="新价格"><el-input-number v-model="trade.price" inputmode="decimal" :precision="4" style="width: 100%" /></el-form-item>
        <el-form-item :label="trade.action === 'VALUATION' ? '或新市值' : '金额'">
          <el-input-number v-model="trade.amount" inputmode="decimal" :precision="2" style="width: 100%" />
          <div class="muted" style="font-size: 12px">{{ trade.action === 'VALUATION' ? '理财/股权直接填新市值' : '不填则按 数量 × 价格' }}</div>
        </el-form-item>
        <el-form-item v-if="['BUY', 'SELL'].includes(trade.action)" label="费用"><el-input-number v-model="trade.fee" inputmode="decimal" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item v-if="trade.action !== 'VALUATION'" label="资金账户">
          <el-select v-model="trade.cashAccountId" clearable placeholder="不选则不记现金流水" style="width: 100%"><el-option v-for="o in accountOptions()" :key="o.value" v-bind="o" /></el-select>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="trade.visible = false">取消</el-button><el-button type="primary" @click="saveTrade">确定</el-button></template>
    </el-dialog>

    <el-drawer v-model="trades.visible" :title="`${trades.row?.name} · 交易记录`" size="560px">
      <ResponsiveTable :data="trades.list" size="small">
        <el-table-column label="日期" width="92"><template #default="{ row }">{{ date(row.tradeDate) }}</template></el-table-column>
        <el-table-column label="操作" width="90" mobile="badge"><template #default="{ row }">{{ labelOf(TRADE_ACTIONS, row.action) }}</template></el-table-column>
        <el-table-column label="数量×价格"><template #default="{ row }">{{ row.quantity ? `${Number(row.quantity)} × ${Number(row.price)}` : '' }}</template></el-table-column>
        <el-table-column label="金额" align="right" mobile="amount"><template #default="{ row }"><span class="money">{{ money(row.amount) }}</span></template></el-table-column>
        <el-table-column label="收益" align="right"><template #default="{ row }"><span v-if="row.pnl != null" class="money">{{ money(row.pnl, true) }}</span></template></el-table-column>
      </ResponsiveTable>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onActivated } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import api from '@/api'
import { money, date } from '@/utils/format'
import { HOLDING_TYPES, MARKETS, TRADE_ACTIONS, labelOf } from '@/constants'
import { accountOptions, loadMeta } from '@/composables/useMeta'
import ResponsiveTable from '@/components/mobile/ResponsiveTable'
import PinButton from '@/components/PinButton.vue'
import { onAiCommitted } from '@/composables/useAiAssistant'

const loading = ref(false)
const list = ref([])
const status = ref('HOLDING')
const today = () => dayjs().format('YYYY-MM-DD')

const total = computed(() => {
  const inv = list.value.filter((h) => h.type !== 'EQUITY' && h.status === 'HOLDING')
  const eq = list.value.filter((h) => h.type === 'EQUITY' && h.status === 'HOLDING')
  const mv = inv.reduce((s, h) => s + h.mv, 0)
  const cost = inv.reduce((s, h) => s + Number(h.costAmount), 0)
  return { mv, cost, pnl: mv - cost, equity: eq.reduce((s, h) => s + h.mv, 0), equityPending: eq.filter((h) => !h.mv).length }
})

async function load() {
  loading.value = true
  try { list.value = (await api.holdings.overview({ status: status.value })).list } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

const form = reactive({ visible: false })
function openForm(row) {
  if (row) {
    Object.assign(form, { ...row, visible: true, marketValue: Number(row.marketValue), ratio: row.ratio != null ? Number(row.ratio) : null, annualRate: row.annualRate != null ? Number(row.annualRate) : null, maturityDate: row.maturityDate ? date(row.maturityDate) : null })
  } else {
    Object.keys(form).forEach((k) => delete form[k])
    Object.assign(form, { visible: true, id: null, type: 'FUND', name: '', includeInNetWorth: true, quantity: 0, price: null, costAmount: 0, marketValue: 0, valuedAt: today() })
  }
}
async function save() {
  const { visible, id, mv, pnl, pnlRate, trades: _t, createdAt, updatedAt, deletedAt, ...body } = form
  if (!id && ['STOCK', 'FUND'].includes(body.type) && body.quantity && body.price) body.marketValue = Math.round(body.quantity * body.price * 100) / 100
  try {
    if (id) await api.holdings.update(id, body); else await api.holdings.create(body)
    ElMessage.success('已保存'); form.visible = false; load(); loadMeta(true)
  } catch (e) { ElMessage.error(e.message) }
}
async function remove(row) {
  await ElMessageBox.confirm(`删除持仓「${row.name}」？交易记录保留。`, '确认', { type: 'warning' })
  await api.holdings.remove(row.id); load()
}

const trade = reactive({ visible: false })
function openTrade(row) {
  Object.assign(trade, { visible: true, row, action: ['STOCK', 'FUND'].includes(row.type) ? 'BUY' : 'VALUATION', tradeDate: today(), quantity: null, price: row.price != null ? Number(row.price) : null, amount: null, fee: 0, cashAccountId: '' })
}
async function saveTrade() {
  const { visible, row, ...body } = trade
  try { await api.holdings.trade(row.id, body); ElMessage.success('已记录'); trade.visible = false; load() } catch (e) { ElMessage.error(e.message) }
}

const trades = reactive({ visible: false, row: null, list: [] })
async function openTrades(row) { Object.assign(trades, { visible: true, row, list: (await api.holdings.trades(row.id)).list }) }

onMounted(() => { loadMeta(); load() })
onActivated(load)
onAiCommitted(load)
</script>
