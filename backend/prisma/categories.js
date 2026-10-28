// 标准科目：沿用 Q4 记账台账的代码，关键字用于自动归类
// seed.js 与「新平台用户开户」共用这份；新增科目改这里（CLAUDE.md 约定的 seed.js CATEGORIES 即此）
export const CATEGORIES = [
  // 必要
  { code: 'A1', name: '小孩抚养', kind: 'EXPENSE', groupName: '必要', keywords: '母婴,童装,奶粉,尿不湿,儿童,宝宝,早教,幼儿园,玩具' },
  { code: 'A2', name: '阿姨', kind: 'EXPENSE', groupName: '必要', keywords: '阿姨,育儿嫂,保姆' },
  { code: 'A3', name: '孝亲父母', kind: 'EXPENSE', groupName: '必要', keywords: '父母,孝亲' },
  { code: 'A4', name: '水电燃气', kind: 'EXPENSE', groupName: '必要', keywords: '电力,燃气,水务,自来水,电费,水费,煤气,供电' },
  { code: 'A5', name: '老婆社保', kind: 'EXPENSE', groupName: '必要', keywords: '社保,公积金,社会保险' },
  { code: 'A6', name: '个人工作室', kind: 'EXPENSE', groupName: '必要', keywords: '工作室,物业' },
  { code: 'A7', name: '车辆出行', kind: 'EXPENSE', groupName: '必要', keywords: 'ETC,通行,高速,充电,停车,加油,石化,石油,滴滴,打车,出租,地铁,公交,车险,洗车,保养,速通,哈啰,高德打车,T3,曹操' },
  { code: 'A8', name: '保险', kind: 'EXPENSE', groupName: '必要', keywords: '人寿,保险,重疾,平安,太平洋,人保' },
  { code: 'A9', name: '住房利息', kind: 'EXPENSE', groupName: '必要', keywords: '房贷利息,贷款利息' },
  { code: 'A10', name: 'AI 算力', kind: 'EXPENSE', groupName: '必要', keywords: 'OpenAI,ChatGPT,Claude,Anthropic,智谱,Kimi,月之暗面,DeepSeek,腾讯云,阿里云,火山引擎,Cursor,GitHub,Stripe,算力' },
  { code: 'A11', name: '健康保健', kind: 'EXPENSE', groupName: '必要', keywords: '医院,药房,大药房,诊所,体检,按摩,足疗,推拿,理疗,健身' },
  { code: 'A12', name: '通讯订阅', kind: 'EXPENSE', groupName: '必要', keywords: '话费,移动,联通,电信,宽带,会员,网盘,WPS,iCloud,Apple,订阅' },
  { code: 'A13', name: '税费', kind: 'EXPENSE', groupName: '必要', keywords: '个人所得税,税务,缴税' },
  // 弹性
  { code: 'B1', name: '吃喝玩乐', kind: 'EXPENSE', groupName: '弹性', keywords: '餐饮,饭,咖啡,Manner,星巴克,瑞幸,奶茶,喜茶,美团,饿了么,外卖,火锅,烧烤,餐厅,超市,便利店,全家,罗森,盒马,京东,拼多多,淘宝,天猫,电影,影城,KTV,酒店,携程,飞猪,航空,机票,铁路,12306,景区,门票' },
  { code: 'B2', name: '学习与投资', kind: 'EXPENSE', groupName: '弹性', keywords: '课程,书店,当当,得到,极客时间,知识星球,培训,学费,小鹅通' },
  { code: 'B3', name: '人情社交', kind: 'EXPENSE', groupName: '弹性', keywords: '红包,礼物,捐赠,基金会,份子,校友' },
  // 经营
  { code: 'C', name: '经营混账', kind: 'EXPENSE', groupName: '经营', remark: '公司的钱从个人账户付出，月度剥离；配合「公司款」标记使用' },
  // 收入
  { code: 'I1', name: '示例公司工资', kind: 'INCOME', groupName: '收入', keywords: '示例公司,工资,薪资,代发' },
  { code: 'I2', name: '示例贸易薪酬', kind: 'INCOME', groupName: '收入', keywords: '示例贸易' },
  { code: 'I3', name: '分红/项目款', kind: 'INCOME', groupName: '收入', keywords: '分红,项目款' },
  { code: 'I4', name: '其他收入', kind: 'INCOME', groupName: '收入', keywords: '退款,利息,报销' },
  { code: 'I5', name: '投资收益', kind: 'INCOME', groupName: '收入', keywords: '基金分红,股息,收益' },
  // 转移（不计收支）
  { code: 'T1', name: '账户互转', kind: 'TRANSFER', groupName: '转移', keywords: '余额宝转入,转入余额宝,零钱通,提现' },
  { code: 'T2', name: '信用卡还款', kind: 'TRANSFER', groupName: '转移', keywords: '信用卡还款,还款,花呗还款' },
  { code: 'T3', name: '投资买卖', kind: 'TRANSFER', groupName: '转移', keywords: '申购,赎回,证券,基金' },
  { code: 'T4', name: '家庭内部划转', kind: 'TRANSFER', groupName: '转移', remark: '夫妻之间转账，不计收支' },
  { code: 'T5', name: '借贷本金', kind: 'TRANSFER', groupName: '转移', remark: '借出/收回/借入/归还本金' }
]
