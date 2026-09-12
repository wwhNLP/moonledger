const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../dist/ledger.js');
const P = require('../dist/privacy.js');

test('review packets contain no transaction identifiers, exact dates, notes or names', () => {
  const book = { entries: [{ id: 'private-id-ABCDE', date: '2026-09-12', type: 'expense', category: '餐饮美食', amount: 3800, note: '张三 13812345678 jane@example.com 星巴克' }], budgets: { '2026-09': 200000 } };
  const result = P.packet(book, '2026-09'), text = JSON.stringify(result.payload);
  for (const privateText of ['private-id', '2026-09', '09-12', '张三', '13812345678', 'jane@example.com', '星巴克', 'note']) assert.ok(!text.includes(privateText), privateText);
  assert.equal(result.payload.data.periods[0].expense, 3800);
  assert.equal(result.sourceRows[0].note, book.entries[0].note);
});
test('natural-language questions become bounded queries without forwarding the original text', () => {
  const query = P.parseQuestion('最近三个月餐饮平均花多少？', '2026-09');
  assert.deepEqual(query.months, ['2026-09', '2026-08', '2026-07']);
  assert.equal(query.category, '餐饮美食'); assert.equal(query.focus, 'average'); assert.equal(query.measure, 'expense');
  assert.equal(P.parseQuestion('去掉房租，这个月花了多少？', '2026-09').excludeRent, true);
  assert.equal(P.parseQuestion('这个月为什么比上个月花得多？', '2026-09').months.length, 2);
  assert.equal(P.parseQuestion('本月哪些分类花得最多？', '2026-09').focus, 'ranking');
});
test('daily food questions accept ordinary phrasing and use calendar days including zero-spend days', () => {
  const entries = [
    { id: 'a', date: '2026-09-01', type: 'expense', category: '餐饮美食', amount: 13000, note: '合成午餐' },
    { id: 'future', date: '2026-09-20', type: 'expense', category: '餐饮美食', amount: 90000, note: '未来计划' },
    { id: 'income', date: '2026-09-01', type: 'income', category: '工资薪酬', amount: 800000, note: '' }
  ];
  for (const text of ['平均每天的伙食支出', '我想询问平均每天的伙食支出', '帮我算一下每日伙食费平均多少钱？', '每天吃饭的开销大概多少']) {
    const q = P.parseQuestion(text, '2026-09');
    assert.equal(q.noteKeyword, '', text);
    assert.equal(q.category, '餐饮美食'); assert.equal(q.averageUnit, 'day'); assert.equal(q.measure, 'expense');
    const result = P.packet({ entries, budgets: {} }, '2026-09', q, '2026-09-13');
    assert.equal(result.payload.data.facts.find(f => f.metric === 'average').value, 1000);
    assert.equal(result.payload.data.facts.find(f => f.metric === 'days').value, 13);
    assert.deepEqual(result.sourceRows.map(r => r.id), ['a']);
    assert.ok(!JSON.stringify(result.payload).includes(text));
  }
});
test('daily averages cover leap years and combine complete and partial months', () => {
  const book = { entries: [{ id: 'a', date: '2024-02-01', type: 'expense', category: '餐饮美食', amount: 4200, note: '' }], budgets: {} };
  const q = P.parseQuestion('最近两个月日均伙食支出', '2024-03');
  const data = P.packet(book, '2024-03', q, '2024-03-13').payload.data;
  assert.equal(data.facts.find(f => f.metric === 'days').value, 42);
  assert.equal(data.facts.find(f => f.metric === 'average').value, 100);
  assert.equal(P.packet(book, '2024-02', P.parseQuestion('每天伙食支出', '2024-02'), '2026-09-13').payload.data.periods[0].days, 29);
});
test('monthly and per-entry averages keep distinct denominators and balance works', () => {
  const book = { entries: [{ id: 'a', date: '2026-08-01', type: 'expense', category: '餐饮美食', amount: 900, note: '' }, { id: 'b', date: '2026-08-02', type: 'expense', category: '餐饮美食', amount: 300, note: '' }], budgets: {} };
  const value = text => P.packet(book, '2026-09', P.parseQuestion(text, '2026-09'), '2026-09-13').payload.data.facts.find(f => f.metric === 'average').value;
  assert.equal(value('最近三个月伙食月均支出'), 400);
  assert.equal(value('最近三个月伙食每笔平均支出'), 600);
  assert.equal(value('最近三个月月均结余'), -400);
  assert.equal(value('本月笔均支出'), 0);
});
test('merchant and amount conditions filter locally without sending names, notes or identifiers', () => {
  const privateNote = '合成商户张三 13812345678 example@example.com';
  const book = { entries: [10000, 10001, 20000].map((amount, i) => ({ id: 'secret-' + i, date: '2026-09-01', type: 'expense', category: '餐饮美食', amount, note: i === 2 ? '另一家' : privateNote })), budgets: { '2026-09': 90000 } };
  const q = P.parseQuestion('本月“合成商户张三”超过100元的支出有多少', '2026-09');
  const result = P.packet(book, '2026-09', q), encoded = JSON.stringify(result.payload);
  assert.equal(result.payload.data.periods[0].expense, 10001);
  assert.equal(result.payload.data.periods[0].budget, null);
  assert.equal(result.payload.data.filtered, true);
  for (const secret of ['合成商户张三', '13812345678', 'example@example.com', 'secret-', 'noteKeyword', '2026-09']) assert.ok(!encoded.includes(secret), secret);
  const coffee = P.parseQuestion('本月咖啡花多少', '2026-09');
  assert.equal(coffee.noteKeyword, '咖啡');
  assert.equal(P.parseQuestion('本月星巴克花了多少钱', '2026-09').noteKeyword, '星巴克');
  const inclusive = P.packet(book, '2026-09', P.parseQuestion('本月100元以上的支出', '2026-09')).payload.data;
  assert.equal(inclusive.periods[0].expense, 40001);
});
test('explicit month comparisons and multiple categories retain their complete scope', () => {
  assert.deepEqual(P.parseQuestion('2026年7月和2026年9月支出比较', '2026-09').months, ['2026-09', '2026-07']);
  assert.deepEqual(P.parseQuestion('2026年7月到2026年9月餐饮平均支出', '2026-09').months, ['2026-09', '2026-08', '2026-07']);
  assert.deepEqual(P.parseQuestion('本月餐饮和交通支出', '2026-09').categories, ['餐饮美食', '交通出行']);
  assert.deepEqual(P.parseQuestion('2026年8月和上月伙食支出对比', '2026-09').months, ['2026-08', '2026-07']);
  assert.throws(() => P.parseQuestion('最近99个月支出多少', '2026-09'));
  assert.throws(() => P.parseQuestion('2026年13月支出多少', '2026-09'));
});
test('expense-only questions do not send income values', () => {
  const packet = P.packet(L.demoBook('2026-09'), '2026-09', P.parseQuestion('这个月花了多少？', '2026-09')).payload;
  assert.equal(packet.data.measure, 'expense'); assert.equal(packet.data.periods[0].income, 0);
  assert.ok(packet.data.periods.every(p => p.categories.every(c => L.categories.expense.includes(c.category))));
});
test('smart entry keeps amounts, exact dates and original labels out of AI classification requests', () => {
  const rows = P.parseEntries('昨天和张三午饭38元，打车26元，今天收到工资18000元', '2026-09-12');
  assert.equal(rows.length, 3); assert.equal(rows[0].date, '2026-09-11'); assert.equal(rows[2].date, '2026-09-12');
  assert.deepEqual(rows.map(e => e.amount), [3800, 2600, 1800000]);
  const text = JSON.stringify(P.categoryPacket(rows));
  for (const privateText of ['张三', '38', '26', '18000', '2026', '昨天', '"note"', '"amount"', '"date"']) assert.ok(!text.includes(privateText), privateText);
});
test('quantities, phone numbers and order identifiers are not extra expenses', () => {
  assert.deepEqual(P.parseEntries('午饭2份共38元', '2026-09-12').map(e => e.amount), [3800]);
  assert.deepEqual(P.parseEntries('买书3本60元', '2026-09-12').map(e => e.amount), [6000]);
  assert.deepEqual(P.parseEntries('咖啡38元，订单号12345678，电话13812345678', '2026-09-12').map(e => e.amount), [3800]);
  assert.throws(() => P.parseEntries('午饭38.001元', '2026-09-12'));
  assert.throws(() => P.parseEntries('午饭-38元', '2026-09-12'));
});
test('two tabs adding different records merge without overwriting, while conflicting edits reject', () => {
  const base = { entries: [], budgets: {} };
  const a = { id: 'a', date: '2026-09-12', type: 'expense', category: '餐饮美食', amount: 100, note: 'A' };
  const b = { ...a, id: 'b', note: 'B' };
  const first = L.mergeChanges(base, { entries: [a], budgets: {} }, base);
  const second = L.mergeChanges(base, { entries: [b], budgets: {} }, first);
  assert.deepEqual(second.entries.map(e => e.id).sort(), ['a', 'b']);
  const edit1 = { entries: [{ ...a, amount: 200 }], budgets: {} };
  const edit2 = { entries: [{ ...a, amount: 300 }], budgets: {} };
  assert.throws(() => L.mergeChanges(first, edit2, edit1), /另一个页面修改/);
});
