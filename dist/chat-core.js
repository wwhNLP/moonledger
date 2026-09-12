(function (root) {
  'use strict';
  const L = root.Ledger || require('./ledger.js');
  function attachment(book, month, mode, scope = 'month', includeNotes = true, today = L.localDate()) {
    if (!L.validMonth(month) || !L.validDate(today)) throw Error('请先选择有效月份。');
    if (!['month', 'sixMonths', 'all'].includes(scope)) throw Error('请选择有效的账本范围。');
    const valid = L.validateBook(book);
    const months = scope === 'all' ? null : new Set(Array.from({ length: scope === 'month' ? 1 : 6 }, (_, i) => L.shiftMonth(month, -i)));
    const selected = valid.entries.filter(e => !months || months.has(e.date.slice(0, 7)));
    if (selected.length > 3000) throw Error('所选范围超过 3000 笔明细，请缩小到当前月或近六个月。');
    return {
      book: mode === 'demo' ? 'demo' : 'own', referenceMonth: month, today, scope, includeNotes: !!includeNotes,
      entries: selected.map(e => ({ date: e.date, type: e.type, category: e.category, amount: e.amount, kind: e.kind || 'normal', note: includeNotes ? e.note : '' })),
      budgets: Object.fromEntries(Object.entries(valid.budgets).filter(([m]) => !months || months.has(m)))
    };
  }
  function request(history, question, ledger, requestId) {
    question = String(question).trim();
    if (!question || question.length > 4000) throw Error('请输入 1—4000 字的问题。');
    if (history.length >= 40) throw Error('已完成 20 轮对话，请点击“新对话”继续。');
    const payload = { requestId, messages: [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: question }], ledger };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 1900000) throw Error('上下文过大，请缩小账本范围或开启新对话。');
    return payload;
  }
  root.MoonChatCore = { attachment, request };
  if (typeof module !== 'undefined') module.exports = root.MoonChatCore;
})(globalThis);
