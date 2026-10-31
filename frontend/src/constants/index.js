// 业务枚举与中文标签（与后端入库的英文常量对应）
export const ACCOUNT_TYPES = [
  { value: 'BANK', label: '银行卡' },
  { value: 'WECHAT', label: '微信' },
  { value: 'ALIPAY', label: '支付宝' },
  { value: 'CASH', label: '现金' },
  { value: 'CREDIT', label: '信用卡/花呗', tag: 'warning' }
]
export const OWNERS = [
  { value: 'ME', label: '我' },
  { value: 'SPOUSE', label: '配偶' },
  { value: 'JOINT', label: '共有' }
]
export const CATEGORY_KINDS = [
  { value: 'EXPENSE', label: '支出', tag: 'danger' },
  { value: 'INCOME', label: '收入', tag: 'success' },
  { value: 'TRANSFER', label: '转移（不计收支）', tag: 'info' }
]
export const DIRECTIONS = [
  { value: 'OUT', label: '支出', tag: 'danger' },
  { value: 'IN', label: '收入', tag: 'success' }
]
export const SOURCES = [
  { value: 'MANUAL', label: '手工', tag: 'info' },
  { value: 'AI', label: 'AI', tag: 'success' },
  { value: 'IMPORT', label: '导入', tag: '' },
  { value: 'SYSTEM', label: '系统', tag: 'info' }
]
export const BIZ_STATUS = [
  { value: 'PENDING', label: '待剥离', tag: 'warning' },
  { value: 'REIMBURSED', label: '已报销', tag: 'success' },
  { value: 'WRITTEN_OFF', label: '不追回', tag: 'info' }
]
export const ORGS = ['示例科技', '示例教育', '示例云', '示例联合', '示例贸易', '火锅店', '其他']
export const HOLDING_TYPES = [
  { value: 'STOCK', label: '股票' },
  { value: 'FUND', label: '基金' },
  { value: 'WEALTH', label: '理财' },
  { value: 'DEPOSIT', label: '定存' },
  { value: 'INSURANCE', label: '储蓄险' },
  { value: 'EQUITY', label: '股权' },
  { value: 'OTHER', label: '其他' }
]
export const MARKETS = [
  { value: 'A', label: 'A 股' }, { value: 'HK', label: '港股' }, { value: 'US', label: '美股' }
]
export const TRADE_ACTIONS = [
  { value: 'BUY', label: '买入/追加', tag: 'danger' },
  { value: 'SELL', label: '卖出/赎回', tag: 'success' },
  { value: 'DIVIDEND', label: '分红/利息', tag: 'success' },
  { value: 'VALUATION', label: '更新市值', tag: 'info' }
]
export const ASSET_TYPES = [
  { value: 'PROPERTY', label: '房产' },
  { value: 'VEHICLE', label: '车辆' },
  { value: 'OTHER', label: '其他大件' }
]
export const LOAN_DIRECTIONS = [
  { value: 'LEND', label: '我借出（应收）', tag: 'success' },
  { value: 'BORROW', label: '我借入（负债）', tag: 'danger' }
]
export const LOAN_KINDS = [
  { value: 'PERSONAL', label: '个人' }, { value: 'COMPANY', label: '与公司往来' },
  { value: 'MORTGAGE', label: '房贷' }, { value: 'CAR', label: '车贷' },
  { value: 'CONSUMER', label: '消费贷' }, { value: 'OTHER', label: '其他' }
]
export const LOAN_STATUS = [
  { value: 'ACTIVE', label: '未结清', tag: 'warning' },
  { value: 'SETTLED', label: '已结清', tag: 'success' },
  { value: 'TO_CONFIRM', label: '待核实', tag: 'danger' }
]
export const HOLDING_STATUS = [
  { value: 'HOLDING', label: '持有', tag: 'success' },
  { value: 'CLOSED', label: '已清仓', tag: 'info' }
]
export const AI_TYPES = {
  transaction: '收支', transfer: '账户互转', trade: '投资交易', holding_valuation: '持仓估值',
  asset_valuation: '资产估值', balance: '余额校准', loan_repay: '借贷还款', new_loan: '新增借贷', new_holding: '新增持仓',
  new_asset: '新增资产', new_account: '新增账户', set_budget: '设预算'
}
// 修改已有记录：目标定了就不能换类型，不进上面的下拉
export const AI_UPDATE_TYPES = {
  update_transaction: '修改流水', update_account: '修改账户', update_holding: '修改持仓', update_asset: '修改资产', update_loan: '修改借贷'
}
// 不动钱，只改资料：卡片上按钮说「确认」不说「入账」
export const AI_DATA_TYPES = ['new_asset', 'new_account', 'set_budget', 'update_account', 'update_holding', 'update_asset', 'update_loan']

export const labelOf = (list, v) => list?.find((x) => x.value === v)?.label ?? v ?? '—'
export const tagOf = (list, v) => list?.find((x) => x.value === v)?.tag ?? ''
export const opts = (list) => list.map((x) => ({ value: x.value, label: x.label }))
