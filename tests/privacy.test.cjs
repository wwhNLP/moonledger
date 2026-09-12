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
test('unsupported merchants, thresholds and multiple explicit months fail closed', () => {
  for (const question of ['本月星巴克花了多少钱', '本月超过1000元的支出有多少', '2026年7月和2026年8月支出比较', '手机号13812345678花了多少钱', '最近99个月支出多少', '本月外卖花多少']) assert.throws(() => P.parseQuestion(question, '2026-09'), question);
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
