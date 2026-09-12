const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../dist/chat-core.js');
const record = { id: 'private-original-id', date: '2026-09-01', type: 'expense', category: '餐饮美食', amount: 13000, note: '合成聚餐', source: 'wechat', sourceId: 'synthetic-order' };
const book = { entries: [record, { ...record, id: 'older', sourceId: 'synthetic-order-older', date: '2026-08-01' }], budgets: { '2026-09': 100000, '2026-08': 120000 } };
test('chat shares selected detailed records and optional notes without storage or source identifiers', () => {
  const current = C.attachment(book, '2026-09', 'own', 'month', true, '2026-09-13');
  assert.equal(current.entries.length, 1);
  assert.equal(current.entries[0].note, '合成聚餐');
  assert.equal(current.entries[0].date, '2026-09-01');
  assert.ok(!JSON.stringify(current).includes('private-original-id'));
  assert.ok(!JSON.stringify(current).includes('synthetic-order'));
  assert.deepEqual(Object.keys(current.budgets), ['2026-09']);
  assert.equal(C.attachment(book, '2026-09', 'demo', 'sixMonths', false, '2026-09-13').entries.length, 2);
  assert.ok(C.attachment(book, '2026-09', 'own', 'all', false).entries.every(e => e.note === ''));
});
test('followups preserve the real question and previous assistant response instead of parsing keywords', () => {
  const history = [{ role: 'user', content: '平均每天伙食多少钱？' }, { role: 'assistant', content: '日均10元。' }];
  const payload = C.request(history, '那扣掉周末聚餐呢？可以具体聊聊吗？', C.attachment(book, '2026-09', 'own'), '00000000-0000-4000-8000-000000000000');
  assert.deepEqual(payload.messages.slice(0, 2), history);
  assert.equal(payload.messages[2].content, '那扣掉周末聚餐呢？可以具体聊聊吗？');
  assert.equal(history.length, 2);
  assert.throws(() => C.request(Array(40).fill(history[0]), '继续', payload.ledger, payload.requestId), /新对话/);
});
