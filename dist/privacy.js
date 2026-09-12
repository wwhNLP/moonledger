(function (root) {
  'use strict';
  const L = root.Ledger || require('./ledger.js');
  const money = n => (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const aliases = {
    '餐饮美食': /餐饮|吃饭|午饭|晚饭|早饭|早餐|午餐|晚餐|外卖|奶茶|咖啡|日料|聚餐|火锅/,
    '居家生活': /居家|房租|水电|电费|水费|网费|网络|物业|日用品|燃气/,
    '购物消费': /购物|买衣|衣服|鞋|网购|手机|电脑|耳机|超市/,
    '交通出行': /交通|打车|地铁|公交|通勤|高铁|机票|停车|加油|出租车/,
    '休闲娱乐': /娱乐|电影|展览|游戏|旅游|旅行|演唱会/,
    '医疗健康': /医疗|健康|医院|药|挂号|看病|体检|健身/,
    '学习成长': /学习|课程|培训|书籍|学费|买书/,
    '工资薪酬': /工资|薪酬|薪水|奖金|年终奖/,
    '兼职收入': /兼职|稿费|项目款|项目尾款|设计费/,
    '投资收益': /投资收益|理财收益|利息|分红/
  };
  const hintMap = { '餐饮美食': '餐饮', '居家生活': '居家', '购物消费': '购物', '交通出行': '交通', '休闲娱乐': '娱乐', '医疗健康': '健康', '学习成长': '学习', '工资薪酬': '工资', '兼职收入': '兼职', '投资收益': '投资' };

  function parseQuestion(text, anchor) {
    if (!L.validMonth(anchor)) throw Error('请先选择有效月份。');
    text = String(text).trim();
    if (!text || text.length > 600) throw Error('请输入 1—600 字的问题。');
    if (!/收支|收入|支出|消费|结余|花|预算|多少|平均|复盘|分析|变化|对比|比较|餐饮|购物|交通|居家|娱乐|医疗|学习|工资|兼职|理财/.test(text)) {
      throw Error('为避免发送原文，目前支持按月份、分类查收支。可以使用下面的快捷问题。');
    }
    if (/手机号|身份证|银行卡|账号|姓名|商户|订单号|转给|转账给/.test(text)) {
      throw Error('当前隐私模式不按姓名、商户或账号查账。请使用月份、分类和收支金额提问。');
    }
    if (/(?:超过|大于|小于|至少|至多|以上|以下|高于|低于|[><≥≤])\s*(?:\d|[一二三四五六七八九十])|\d+(?:\.\d+)?\s*(?:元|块)/.test(text)) {
      throw Error('当前暂不支持金额门槛筛选。请使用月份与标准分类提问，避免查询范围被误解。');
    }
    if ([...text.matchAll(/(?:19\d{2}|20\d{2}|2100)年\s*\d{1,2}月/g)].length > 1) {
      throw Error('一次请指定一个参考月，或使用“最近几个月”。跨指定月份的比较请先调整参考月。');
    }
    let focus = /预算|超支|剩余额度/.test(text) ? 'budget' : /平均|月均/.test(text) ? 'average' : /最多|最大|排行|哪里|哪类/.test(text) ? 'ranking' : /较|比|变化|增加|减少|为什么/.test(text) ? 'compare' : /复盘|分析/.test(text) ? 'review' : 'total';
    let count = focus === 'compare' ? 2 : 1;
    const numerals = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十二: 12 };
    const range = text.match(/(?:最近|近|过去)\s*(\d{1,2}|十二|[一二两三四五六七八九十])\s*个?月/);
    if (range) count = Number(range[1]) || numerals[range[1]];
    if (/半年/.test(text)) count = 6;
    let end = anchor;
    if (/上个月|上月/.test(text) && !/比|较|对比|比较/.test(text)) end = L.shiftMonth(anchor, -1);
    if (/今年/.test(text)) { end = anchor; count = Number(anchor.slice(5)); }
    if (/去年/.test(text)) { end = `${Number(anchor.slice(0, 4)) - 1}-12`; count = 12; }
    const explicit = text.match(/(19\d{2}|20\d{2}|2100)年\s*(\d{1,2})月/);
    if (explicit) { end = `${explicit[1]}-${explicit[2].padStart(2, '0')}`; count = 1; }
    if (!Number.isInteger(count) || count < 1 || count > 24 || !L.validMonth(end)) throw Error('一次可分析 1—24 个月，请检查时间范围。');
    const excludeRent = /(?:去掉|不算|不含|扣除|除去)\s*房租/.test(text);
    let category = 'all';
    const categoryText = excludeRent ? text.replace(/(?:去掉|不算|不含|扣除|除去)\s*房租/g, '') : text;
    for (const cat of Object.values(L.categories).flat()) {
      if (categoryText.includes(cat) || (aliases[cat] && aliases[cat].test(categoryText))) { category = cat; break; }
    }
    if (/外卖|咖啡|房租/.test(categoryText)) {
      throw Error('当前 AI 问答按标准分类汇总，不单独统计备注中的外卖、咖啡或房租。可改问“餐饮”或在账单明细中搜索。');
    }
    let residue = text.replace(/(?:去掉|不算|不含|扣除|除去)\s*房租/g, '').replace(/(?:19\d{2}|20\d{2}|2100)年\s*\d{1,2}月/g, '').replace(/(?:最近|近|过去)\s*(?:\d{1,2}|十二|[一二两三四五六七八九十])\s*个?月/g, '');
    for (const cat of Object.values(L.categories).flat()) residue = residue.replaceAll(cat, '');
    for (const pattern of Object.values(aliases)) residue = residue.replace(new RegExp(pattern.source, 'g'), '');
    residue = residue.replace(/这个月|上个月|本月|上月|今年|去年|半年|收支|收入|支出|消费|结余|预算|超支|剩余额度|平均|月均|最多|最大|排行|哪里|哪类|哪些分类|分类|变化|增加|减少|为什么|对比|比较|复盘|分析|合计|总共|一共|多少|花费|花了|花得|花|能不能|能否|帮我|请问|看看|看一下|一下|帮|请|我的|我|的|了|得|比|较|多|少|钱|是|有|和|与|吗|呢|每月|每个月|共|全部|最近|过去|这些/g, '').replace(/[\s，,。.?？!！、：:；;（）()「」“”]/g, '');
    if (residue) throw Error('问题里包含暂未支持的条件。为避免扩大查询范围，请改用下面的快捷问题或标准分类。');
    const measure = /结余/.test(text) ? 'balance' : /收入/.test(text) && !/支出|消费|花|收支/.test(text) ? 'income' : /支出|消费|花|预算/.test(text) ? 'expense' : 'all';
    const months = Array.from({ length: count }, (_, i) => L.shiftMonth(end, -i));
    if (months.some(m => !L.validMonth(m))) throw Error('月份超出可分析范围。');
    return { focus, months, category, excludeRent, measure };
  }

  function packet(book, anchor, query = { focus: 'review', months: Array.from({ length: 6 }, (_, i) => L.shiftMonth(anchor, -i)), category: 'all', excludeRent: false }) {
    const measure = query.measure || 'all';
    const selectedRows = L.accountingEntries(book).filter(e => query.months.includes(e.date.slice(0, 7)) && (query.category === 'all' || e.category === query.category) && (!query.excludeRent || !/房租/.test(e.note)) && (!['income', 'expense'].includes(measure) || e.type === measure));
    const selectedIds = new Set(selectedRows.map(e => e.id));
    const periods = query.months.map((month, i) => {
      const rows = selectedRows.filter(e => e.date.startsWith(month));
      const income = rows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
      const expense = rows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
      const categories = Object.values(L.categories).flat().map(category => {
        const matches = rows.filter(e => e.category === category);
        return { category, amount: matches.reduce((s, e) => s + e.amount, 0), count: matches.length };
      }).filter(c => c.count);
      return { id: `P${i}`, income, expense, balance: income - expense, budget: !query.excludeRent ? (query.category === 'all' ? book.budgets[month] : book.categoryBudgets?.[month]?.[query.category]) || null : null, count: rows.length, categories };
    });
    const facts = [], labels = {};
    const add = (metric, value, title, periodId = 'P0', category = 'all', unit = 'cents') => {
      const id = `F${facts.length}`;
      facts.push({ id, metric, value, unit, periodId, category });
      labels[id] = { title, display: unit === 'cents' ? `¥${money(value)}` : `${value} 笔` };
    };
    const p = periods[0], total = key => periods.reduce((s, row) => s + row[key], 0);
    if (query.focus === 'average') {
      if (measure !== 'income') add('average', Math.round(total('expense') / periods.length), '月均支出（包含无记录月份）', 'all', query.category);
      if (measure !== 'expense') add('average', Math.round(total('income') / periods.length), '月均收入（包含无记录月份）', 'all', query.category);
    } else if (query.focus === 'compare' && periods.length >= 2) {
      const metric = measure === 'income' ? 'income' : measure === 'balance' ? 'balance' : 'expense';
      const name = { income: '收入', expense: '支出', balance: '结余' }[metric];
      add(metric, p[metric], `较新月份${name}`, 'P0', query.category);
      add(metric, periods[1][metric], `前一个月${name}`, 'P1', query.category);
      add('difference', p[metric] - periods[1][metric], `${name}差额（正数为增加）`, 'P0', query.category);
    } else if (query.focus === 'budget') {
      add('expense', p.expense, '参考月净支出');
      if (p.budget !== null) { add('budget', p.budget, '参考月预算'); add('remaining', p.budget - p.expense, '剩余预算（负数为超支）'); }
    } else {
      const isReview = query.focus === 'review';
      if (measure !== 'expense') add('income', isReview ? p.income : total('income'), isReview ? '参考月收入' : '范围内收入', isReview ? 'P0' : 'all', query.category);
      if (measure !== 'income') add('expense', isReview ? p.expense : total('expense'), isReview ? '参考月净支出' : '范围内净支出', isReview ? 'P0' : 'all', query.category);
      if (['all', 'balance'].includes(measure)) add('balance', isReview ? p.balance : total('balance'), isReview ? '参考月结余' : '范围内结余', isReview ? 'P0' : 'all', query.category);
      if (isReview && p.budget !== null) add('remaining', p.budget - p.expense, '参考月剩余预算');
    }
    const categoryPeriods = query.focus === 'review' ? [p] : periods;
    const top = L.categories.expense.map(category => ({ category, amount: categoryPeriods.reduce((s, period) => s + (period.categories.find(c => c.category === category)?.amount || 0), 0) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 4);
    for (const row of top) add('category', row.amount, row.category, query.focus === 'review' ? 'P0' : 'all', row.category);
    add('count', query.focus === 'review' ? p.count : total('count'), '参与统计账单数', query.focus === 'review' ? 'P0' : 'all', query.category, 'count');
    return { payload: { task: query.focus === 'review' ? 'review' : 'question', data: { focus: query.focus, periods, facts, category: query.category, excludeRent: query.excludeRent, measure } }, labels, months: query.months, query, sourceRows: book.entries.filter(e => selectedIds.has(e.id)), scope: `${query.months.at(-1)} 至 ${query.months[0]} · ${query.category === 'all' ? '全部分类' : query.category} · ${{ income: '收入', expense: '支出', balance: '结余', all: '收支' }[measure]}${query.excludeRent ? ' · 排除备注含“房租”的记录' : ''}` };
  }

  function redactIdentifiers(text) {
    return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[本地保留]')
      .replace(/(?:\+?86[-\s]?)?1[3-9](?:[-\s]?\d){9}(?!\d)/g, '[本地保留]')
      .replace(/(?<!\d)\d{17}[\dXx](?!\d)|(?<!\d)\d{15,19}(?!\d)/g, '[本地保留]')
      .replace(/(?:订单号?|账号|账户|身份证|卡号|电话|手机|单号)\s*[:：]?\s*[A-Za-z0-9-]+/g, '[本地保留]');
  }

  function dateFrom(text, today) {
    const [year, month] = today.split('-');
    const full = text.match(/(19\d{2}|20\d{2}|2100)[年/-](\d{1,2})[月/-](\d{1,2})日?/);
    const short = text.match(/(?<!\d)(\d{1,2})月(\d{1,2})日?/);
    let date = full ? `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}` : short ? `${year}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}` : today;
    if (!full && !short && /昨天|前天/.test(text)) {
      const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - (/前天/.test(text) ? 2 : 1)); date = L.localDate(d);
    }
    if (!L.validDate(date)) throw Error('输入中有无效日期，请检查后重试。');
    return date;
  }

  function parseEntries(text, today = L.localDate()) {
    if (!text.trim() || text.length > 1200) throw Error('请输入 1—1200 字，例如“昨天午饭38元，打车26元”。');
    const globalDate = dateFrom(text, today), entries = [];
    const clauses = text.split(/[，,；;\n]+|还有|然后|以及/).filter(s => s.trim());
    for (const original of clauses) {
      const date = /\d月|\d{4}[-/]|今天|昨天|前天/.test(original) ? dateFrom(original, today) : globalDate;
      const safe = redactIdentifiers(original).replace(/(?:19\d{2}|20\d{2}|2100)[年/-]\d{1,2}[月/-]\d{1,2}日?|\d{1,2}月\d{1,2}日?/g, '');
      const matches = [...safe.matchAll(/(?<![\d.])(?:[¥￥]\s*)?((?:0|[1-9]\d{0,8})(?:\.\d{1,2})?)(?![\d.])\s*(元|块|人民币)?/g)];
      let cursor = 0;
      for (const match of matches) {
        const before = safe.slice(cursor, match.index), after = safe.slice(match.index + match[0].length);
        if (!match[2] && !/[¥￥]/.test(match[0]) && /^(?:份|本|杯|个|件|张|次|天|人|斤|公斤|瓶|盒|支|条)/.test(after.trim())) continue;
        if (/[-负]\s*$/.test(before)) throw Error('请使用正数金额，并在预览中选择收入或支出。');
        const category = Object.keys(aliases).find(cat => aliases[cat].test(before)) || null;
        if (!match[2] && !/[¥￥]/.test(match[0]) && !category && !/收入|支出|收到|花了|付款|付了/.test(before)) { cursor = match.index + match[0].length; continue; }
        const ambiguous = /退款|报销|还款|还钱|转账|转给/.test(before);
        const type = category && L.categories.income.includes(category) || /收入|收到|入账/.test(before) ? 'income' : 'expense';
        const fallback = type === 'income' ? '其他收入' : '其他支出';
        const hints = category ? [hintMap[category]] : [type === 'income' ? '收入' : '支出'];
        if (ambiguous) hints.push('待确认');
        entries.push({ id: `T${entries.length}`, date, amount: L.cents(match[1]), type, category: ambiguous ? fallback : category || fallback, note: (before.trim() || original.trim()).slice(0, 100), hints, typeHint: ambiguous ? 'unknown' : type, needsReview: ambiguous || !category });
        cursor = match.index + match[0].length;
      }
      if (!matches.length && /\d/.test(safe)) throw Error('部分金额无法识别，请使用最多两位小数，并在金额后加“元”。');
    }
    if (!entries.length) throw Error('没有识别到明确金额。可写“午饭38元，打车26元”，或使用普通记账。');
    if (entries.length > 20) throw Error('一次最多整理 20 笔，请分批输入。');
    return entries;
  }

  function categoryPacket(entries) {
    return { task: 'categorize', data: { candidates: entries.map((e, i) => ({ id: `T${i}`, hints: [...e.hints], typeHint: e.typeHint })) } };
  }

  root.MoonPrivacy = { parseQuestion, packet, parseEntries, categoryPacket, redactIdentifiers, dateFrom };
  if (typeof module !== 'undefined') module.exports = root.MoonPrivacy;
})(globalThis);
