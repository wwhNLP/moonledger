(function (root) {
  'use strict';
  const L = root.Ledger || require('./ledger.js');
  const money = n => (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const aliases = {
    '餐饮美食': /餐饮|伙食费|伙食|饭钱|饭费|吃喝|饮食|用餐|吃饭|午饭|晚饭|早饭|早餐|午餐|晚餐|外卖|奶茶|咖啡|日料|聚餐|火锅/,
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
    text = String(text).trim().replace(/(\d+(?:\.\d{1,2})?)\s*(?:元|块)\s*(以上|以下)/g, (_, value, op) => (op === '以上' ? '至少' : '至多') + value + '元');
    if (!text || text.length > 600) throw Error('请输入 1—600 字的问题。');
    const averageUnit = /每天|每日|日均|一天/.test(text) ? 'day' : /每笔|每次|笔均|单笔平均/.test(text) ? 'entry' : 'month';
    const focus = /预算|超支|剩余额度/.test(text) ? 'budget' : /平均|月均|日均|笔均|每天|每日|每笔|每次/.test(text) ? 'average' : /最多|最大|排行|哪里|哪类/.test(text) ? 'ranking' : /对比|比较|相比|比上|变化|增加|减少|为什么/.test(text) ? 'compare' : /复盘|分析|合理|建议|节省/.test(text) ? 'review' : 'total';
    let count = focus === 'compare' ? 2 : 1;
    const numerals = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
    const rangePattern = /(?:最近|近|过去)\s*(\d{1,2}|十二|十一|[一二两三四五六七八九十])\s*个?月/g;
    const range = [...text.matchAll(rangePattern)][0];
    if (range) count = Number(range[1]) || numerals[range[1]];
    if (/半年/.test(text)) count = 6;
    let end = anchor;
    if (/上个月|上月/.test(text) && focus !== 'compare') end = L.shiftMonth(anchor, -1);
    if (/今年/.test(text)) count = Number(anchor.slice(5));
    if (/去年/.test(text)) { end = `${Number(anchor.slice(0, 4)) - 1}-12`; count = 12; }
    const explicitPattern = /(?:(19\d{2}|20\d{2}|2100)年\s*)?(\d{1,2})月/g;
    const explicit = [...text.replace(rangePattern, '').matchAll(explicitPattern)].map(m => `${m[1] || anchor.slice(0, 4)}-${m[2].padStart(2, '0')}`);
    if (explicit.some(m => !L.validMonth(m))) throw Error('请检查指定月份。');
    if (explicit.length) { end = explicit[0]; count = focus === 'compare' ? 2 : 1; }
    let months = explicit.length > 1 ? [...new Set(explicit)].sort().reverse() : null;
    if (months && /至|到|~|～/.test(text)) {
      end = months[0];
      const start = months.at(-1);
      count = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5)) - Number(start.slice(5)) + 1;
      months = null;
    }
    if (!Number.isInteger(count) || count < 1 || count > 24 || !L.validMonth(end)) throw Error('一次可分析 1—24 个月，请检查时间范围。');
    months ||= Array.from({ length: count }, (_, i) => L.shiftMonth(end, -i));
    if (months.length > 24 || months.some(m => !L.validMonth(m))) throw Error('月份超出可分析范围。');
    const excludePattern = /(?:去掉|不算|不含|扣除|除去|排除)\s*房租/g;
    const excludeRent = /(?:去掉|不算|不含|扣除|除去|排除)\s*房租/.test(text);
    let rest = text.replace(excludePattern, '').replace(rangePattern, '').replace(explicitPattern, '');
    const bounds = [];
    rest = rest.replace(/(超过|大于|小于|至少|至多|不低于|不高于|高于|低于|>=|<=|>|<|≥|≤)\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)?/g, (_, op, value) => {
      const amount = Math.round(Number(value) * 100);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 99999999999) throw Error('金额筛选超出范围。');
      bounds.push({ op: /至少|不低于|>=|≥/.test(op) ? 'gte' : /至多|不高于|<=|≤/.test(op) ? 'lte' : /超过|大于|高于|>/.test(op) ? 'gt' : 'lt', amount });
      return '';
    });
    const categories = Object.values(L.categories).flat().filter(cat => rest.includes(cat) || aliases[cat]?.test(rest));
    // Specific items and quoted names stay local: filtering precedes anonymous aggregation.
    const quoted = [...rest.matchAll(/[“「"]([^”」"]+)[”」"]/g)].map(m => m[1]);
    const specific = (rest.match(/外卖|咖啡|奶茶|房租|早餐|午餐|晚餐|早饭|午饭|晚饭/g) || []);
    let noteKeyword = quoted.join(' ') || [...new Set(specific)].join(' ');
    rest = rest.replace(/[“「"][^”」"]+[”」"]/g, '');
    for (const cat of Object.values(L.categories).flat()) rest = rest.replaceAll(cat, '');
    for (const pattern of Object.values(aliases)) rest = rest.replace(new RegExp(pattern.source, 'g'), '');
    rest = rest.replace(/这个月|上个月|本月|上月|今年|去年|半年|收支|收入|支出|消费|结余|预算|超支|剩余额度|单笔平均|平均|月均|日均|笔均|每天|每日|一天|每笔|每次|最多|最大|排行|哪里|哪类|哪些分类|分类|变化|增加|减少|为什么|对比|比较|相比|复盘|分析|合计|总共|一共|多少|花费|花了|花得|花|开销|开支|算一下|计算|统计|查询|查一下|查查|算|能不能|可不可以|能否|可以|帮我|请问|询问|告诉我|想知道|想了解|想问|我想|看看|看一下|一下|帮|请|我的|我|的|了|得|比|较|多|少|钱|是|有|和|与|吗|呢|每个月|每月|共|全部|最近|过去|这些|合理|建议|节省|怎么样|如何|商户|备注|包含|含有|关键词|在|去|给|为|到|至|大概|大约/g, '').replace(/[\s，,。.?？!！、：:；;（）()「」“”~～]/g, '');
    const warning = rest ? '有未完全识别的内容，已填入本地备注关键词；请核对下方条件，可修改后重新统计。' : '';
    if (rest) noteKeyword = [noteKeyword, rest].filter(Boolean).join(' ');
    const category = categories.length === 1 ? categories[0] : 'all';
    const measure = /结余/.test(text) ? 'balance' : /收支|收入.*支出|支出.*收入/.test(text) ? 'all' : /收入/.test(text) ? 'income' : /支出|消费|开销|开支|花|预算/.test(text) || categories.some(c => L.categories.expense.includes(c)) || noteKeyword ? 'expense' : categories.some(c => L.categories.income.includes(c)) ? 'income' : 'all';
    return { focus, months, category, categories, excludeRent, measure, averageUnit, noteKeyword, bounds, warning };
  }

  function packet(book, anchor, query = { focus: 'review', months: Array.from({ length: 6 }, (_, i) => L.shiftMonth(anchor, -i)), category: 'all', excludeRent: false }, today = L.localDate()) {
    const measure = query.measure || 'all';
    const averageUnit = query.averageUnit || 'month';
    const isDaily = query.focus === 'average' && averageUnit === 'day';
    const daysIn = month => new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const dayCount = month => isDaily && month === today.slice(0, 7) ? Number(today.slice(8)) : daysIn(month);
    const keywords = String(query.noteKeyword || '').trim().split(/\s+/).filter(Boolean);
    const bounds = query.bounds || [];
    const partialFilter = !!(keywords.length || bounds.length || query.excludeRent);
    const filtered = !!(partialFilter || query.category !== 'all' || query.categories?.length || measure !== 'all');
    const categoryMatches = e => query.categories?.length ? query.categories.includes(e.category) : query.category === 'all' || e.category === query.category;
    const selectedRows = L.accountingEntries(book).filter(e => query.months.includes(e.date.slice(0, 7)) && categoryMatches(e) && (!query.excludeRent || !/房租/.test(e.note)) && (!['income', 'expense'].includes(measure) || e.type === measure) && keywords.every(k => e.note.toLocaleLowerCase().includes(k.toLocaleLowerCase())) && bounds.every(b => ({ gt: Math.abs(e.amount) > b.amount, gte: Math.abs(e.amount) >= b.amount, lt: Math.abs(e.amount) < b.amount, lte: Math.abs(e.amount) <= b.amount })[b.op]) && (!isDaily || e.date.slice(0, 7) !== today.slice(0, 7) || e.date <= today));
    const selectedIds = new Set(selectedRows.map(e => e.id));
    const periods = query.months.map((month, i) => {
      const rows = selectedRows.filter(e => e.date.startsWith(month));
      const income = rows.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
      const expense = rows.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
      const categories = Object.values(L.categories).flat().map(category => {
        const matches = rows.filter(e => e.category === category);
        return { category, amount: matches.reduce((s, e) => s + e.amount, 0), count: matches.length };
      }).filter(c => c.count);
      return { id: `P${i}`, income, expense, balance: income - expense, budget: !partialFilter && !(query.categories?.length > 1) ? (query.category === 'all' ? book.budgets[month] : book.categoryBudgets?.[month]?.[query.category]) || null : null, count: rows.length, categories, ...(isDaily ? { days: dayCount(month) } : {}) };
    });
    const facts = [], labels = {};
    const add = (metric, value, title, periodId = 'P0', category = 'all', unit = 'cents') => {
      const id = `F${facts.length}`;
      facts.push({ id, metric, value, unit, periodId, category });
      labels[id] = { title, display: unit === 'cents' ? `¥${money(value)}` : `${value} ${unit === 'days' ? '天' : '笔'}` };
    };
    const p = periods[0], total = key => periods.reduce((s, row) => s + row[key], 0);
    if (query.focus === 'average') {
      const keys = measure === 'all' ? ['expense', 'income'] : [measure];
      for (const key of keys) {
        const denominator = isDaily ? total('days') : averageUnit === 'entry' ? selectedRows.filter(e => key === 'balance' || e.type === key).length : periods.length;
        const name = { expense: '净支出', income: '收入', balance: '结余' }[key];
        const title = `${{ day: '日均', month: '月均', entry: '笔均' }[averageUnit]}${name}${averageUnit === 'entry' ? '（按筛选记录，含回款）' : '（包含无记录' + (isDaily ? '日期' : '月份') + '）'}`;
        add('average', denominator ? Math.round(total(key) / denominator) : 0, title, 'all', query.category);
        add(key, total(key), `范围内${name}`, 'all', query.category);
        const records = selectedRows.filter(e => key === 'balance' || e.type === key).length;
        if (averageUnit !== 'entry' && records) add('perEntryAverage', Math.round(total(key) / records), `笔均${name}（按筛选记录，含回款）`, 'all', query.category);
      }
      if (isDaily) add('days', total('days'), '日均计算天数', 'all', query.category, 'days');
    } else if (query.focus === 'compare' && periods.length >= 2) {
      const metric = measure === 'income' ? 'income' : measure === 'balance' ? 'balance' : 'expense';
      const name = { income: '收入', expense: '支出', balance: '结余' }[metric];
      add(metric, p[metric], `较新月份${name}`, 'P0', query.category);
      add(metric, periods[1][metric], `对比月份${name}`, 'P1', query.category);
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
    return { payload: { task: query.focus === 'review' ? 'review' : 'question', data: { focus: query.focus, periods, facts, category: query.category, excludeRent: !!query.excludeRent, measure, averageUnit, filtered } }, labels, months: query.months, query, sourceRows: book.entries.filter(e => selectedIds.has(e.id)), scope: `${[...query.months].reverse().join('、')} · ${query.categories?.length ? query.categories.join('、') : query.category === 'all' ? '全部分类' : query.category} · ${{ income: '收入', expense: '支出', balance: '结余', all: '收支' }[measure]}${query.excludeRent ? ' · 排除备注含“房租”的记录' : ''}${keywords.length ? ' · 备注同时包含：' + keywords.join('、') : ''}${bounds.length ? ' · 单笔金额绝对值' + bounds.map(b => ({ gt: '>', gte: '≥', lt: '<', lte: '≤' })[b.op] + '¥' + money(b.amount)).join('且') : ''}${isDaily ? ' · 日均含零消费日；本月截至今天，历史及未来月份按整月' : ''}` };
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
