(function () {
  'use strict';
  const P = window.MoonPrivacy;
  const ai = { status: null, tab: 'review', prepared: null, response: null, error: '', busy: false, controller: null, cache: new Map(), question: '', mode: state.mode, drafts: [], smartMode: null, saving: false, smartBusy: false };
  const shortcuts = ['平均每天的伙食支出是多少？', '最近三个月餐饮月均花多少？', '本月咖啡花了多少钱？', '本月超过100元的支出有多少？'];
  const assistant = document.createElement('dialog');
  assistant.id = 'ai-dialog'; assistant.className = 'ai-drawer'; assistant.setAttribute('aria-labelledby', 'ai-title');
  assistant.innerHTML = `<div class="ai-drawer-head"><div class="ai-title-icon">${icon('sparkles')}</div><div><h2 id="ai-title">AI 财务助手</h2><p>给数字一点解释，给生活一点方向</p></div><button class="icon-button" data-ai-action="settings" aria-label="AI 设置">${icon('wallet')}</button><button class="icon-button close-dialog" aria-label="关闭财务助手">${icon('x')}</button></div><div id="ai-body"></div>`;
  document.body.appendChild(assistant);
  const settings = document.createElement('dialog');
  settings.id = 'ai-settings-dialog'; settings.setAttribute('aria-labelledby', 'ai-settings-title');
  settings.innerHTML = `<form id="ai-settings-form"><div class="dialog-heading"><div><span class="eyebrow">PRIVATE BY DESIGN</span><h2 id="ai-settings-title">AI 设置</h2></div><button type="button" class="icon-button close-dialog" aria-label="关闭 AI 设置">${icon('x')}</button></div><div class="ai-privacy-note">${icon('shield')}<div><strong>Key 留在本机，账单按需脱敏</strong><p>仅在你点击发送时调用 DeepSeek。月度汇总含金额；姓名、账户、商户、账单备注和提问原文均不发送。</p></div></div><p id="ai-config-status" class="ai-config-status"></p><label class="field">DeepSeek API Key<input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="填写 API Key，仅保存在本机" maxlength="256"></label><label class="field">模型名称<input id="ai-model" value="deepseek-flash" maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,79}" required></label><p class="ai-setting-hint">Key 不会写入网页、浏览器存储或账本备份。更换设备需要重新配置。没有 Key 时仍可正常记账。</p><p id="ai-settings-error" class="form-error" role="alert"></p><div class="dialog-footer"><button class="text-button danger-text" type="button" data-ai-action="clear-key">删除本地 Key</button><button class="button primary" id="ai-save-settings" type="submit">保存设置</button></div></form>`;
  document.body.appendChild(settings);
  const smart = document.createElement('dialog');
  smart.id = 'smart-dialog'; smart.className = 'smart-dialog'; smart.setAttribute('aria-labelledby', 'smart-title');
  smart.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">A FEW WORDS, A CLEAR RECORD</span><h2 id="smart-title">一句话记账</h2></div><button class="icon-button close-dialog" aria-label="关闭一句话记账">${icon('x')}</button></div><p class="dialog-description">自然地说，逐笔核对后再记入账本。日期中的“今天”以本机日期为准。</p><label class="field">想记下什么？<textarea id="smart-raw" rows="3" maxlength="1200" placeholder="昨天午饭38元，打车26元，今天收到工资18000元"></textarea></label><div class="smart-input-actions"><span>原文仅在本机处理</span><button class="button primary" data-ai-action="parse">生成待确认账单</button></div><p id="smart-error" class="form-error" role="alert"></p><div id="smart-preview"></div>`;
  document.body.appendChild(smart);

  async function loadStatus() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const data = await response.json();
      ai.status = { ...data, available: true };
      if (!response.ok) ai.status.error = data.error;
    } catch (error) { ai.status = { configured: false, available: false, model: 'deepseek-flash' }; }
    mountCard();
    return ai.status;
  }
  function configuredNote() {
    if (!ai.status?.available) return '<div class="ai-config-alert">AI 本地服务尚未启动。请使用「启动月见.command」打开网站。普通记账仍可使用。</div>';
    if (!ai.status.configured) return `<div class="ai-config-alert"><span>填写 DeepSeek API Key 后即可生成 AI 解读。</span><button class="text-button" data-ai-action="settings">去设置 ${icon('arrowRight')}</button></div>`;
    return '';
  }
  function cacheKey(prepared) { return JSON.stringify([state.mode, prepared.months, ai.status?.model, prepared.payload]); }
  function mountCard() {
    const card = document.querySelector('.insight-card');
    if (!card) return;
    const prepared = P.packet(book(), state.month);
    const cached = ai.cache.get(cacheKey(prepared));
    card.classList.add('ai-review-card');
    card.innerHTML = `<div class="ai-review-icon">${icon('sparkles')}</div><div><div class="ai-card-topline"><h3>本月 AI 复盘</h3><span class="ai-small-badge">脱敏分析</span></div><p>${cached ? esc(cached.result.summary.slice(0, 72)) + (cached.result.summary.length > 72 ? '…' : '') : '看见收支变化，找到值得留意的消费。'}</p><button class="text-button" data-ai-action="review">${cached ? '查看复盘' : '生成月度复盘'} ${icon('arrowRight')}</button></div>`;
  }
  function onLedgerRender() {
    mountCard();
    if (ai.mode !== state.mode) { ai.prepared = null; ai.response = null; ai.question = ''; ai.mode = state.mode; }
  }
  document.addEventListener('ledger:render', onLedgerRender);

  function privacyPreview(payload) {
    const isCategorize = payload.task === 'categorize';
    return `<details class="ai-payload"><summary>${icon('shield')}查看实际发送的脱敏内容</summary><p>${isCategorize ? '仅发送匿名编号和白名单分类提示，不发送金额、日期、姓名、账号或原文。' : '仅发送匿名月份、分类汇总、金额（单位：分）、统计天数、平均口径、预算及计算结果。不包含账单明细、绝对日期、商户、备注或提问原文。'}数据将发送至 DeepSeek 官方 API。</p><pre>${esc(JSON.stringify(payload.data, null, 2))}</pre></details>`;
  }
  function localFacts(prepared) {
    return `<div class="ai-facts">${prepared.payload.data.facts.map(f => `<div><span>${esc(prepared.labels[f.id].title)}</span><strong>${esc(prepared.labels[f.id].display)}</strong></div>`).join('')}</div>`;
  }
  function resultHTML(prepared, response) {
    const result = response.result;
    return `<section class="ai-result"><div class="ai-section-label">AI 解读 <span>金额由本地程序计算</span></div><h3>${esc(result.summary)}</h3><div class="ai-insights">${result.insights.map(item => { const fact = prepared.labels[item.factId]; return `<article><div class="ai-fact-reference">${esc(fact.title)} <strong>${esc(fact.display)}</strong></div><p>${esc(item.explanation)}</p></article>`; }).join('')}</div>${result.omittedNumericText ? '<p class="ai-footnote">部分无法核对的额外推算已省略；已保留可核对的解读，本地统计不受影响。</p>' : ''}${result.suggestions.length ? `<div class="ai-suggestions"><strong>可以从这些小事开始</strong>${result.suggestions.map(t => `<p>${icon('leaf')}${esc(t)}</p>`).join('')}</div>` : ''}<div class="ai-result-actions"><button class="text-button" data-ai-action="copy-report">${icon('list')}复制复盘</button><button class="text-button" data-ai-action="regenerate">重新生成</button></div><p class="ai-footnote">AI 解释供你核对。账单不完整时，结论也可能不完整。</p></section>`;
  }
  function sourceRows(prepared) {
    const rows = [...prepared.sourceRows].sort((a, b) => b.date.localeCompare(a.date));
    return `<details class="ai-source-rows"><summary>本地依据 · ${rows.length} 笔账单（不会发送）</summary><p>下列明细只在此设备显示；最多展示最近 50 笔。</p>${rows.slice(0, 50).map(e => `<div><span><strong>${esc(e.note || e.category)}</strong><small>${e.date} · ${e.category}</small></span><b>${e.type === 'income' ? '+' : '−'}${fmt(e.amount)}</b></div>`).join('')}</details>`;
  }
  function queryEditor(prepared) {
    const q = prepared.query;
    const options = (values, current) => Object.entries(values).map(([value, label]) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const categoryOptions = { all: '全部分类', ...(q.categories?.length > 1 ? { selected: q.categories.join('、') } : {}), ...Object.fromEntries(Object.values(L.categories).flat().map(c => [c, c])) };
    const lower = q.bounds?.find(b => ['gt', 'gte'].includes(b.op)), upper = q.bounds?.find(b => ['lt', 'lte'].includes(b.op));
    return `<details class="ai-query-editor" ${q.warning ? 'open' : ''}><summary>调整统计条件 · 仅在本机处理</summary>${q.warning ? `<p class="ai-footnote">${esc(q.warning)}</p>` : ''}<form id="ai-query-form"><div class="ai-query-grid"><label class="field ai-query-wide">统计月份（用逗号分隔，最多 24 个月）<input name="months" value="${esc(q.months.join(', '))}" required></label><label class="field">分类<select name="category">${options(categoryOptions, q.categories?.length > 1 ? 'selected' : q.category)}</select></label><label class="field">关注指标<select name="measure">${options({ expense: '净支出', income: '收入', balance: '结余', all: '收支' }, q.measure)}</select></label><label class="field">分析方式<select name="focus">${options({ total: '合计', average: '平均', compare: '两个月比较', ranking: '分类排行', budget: '预算', review: '复盘' }, q.focus)}</select></label><label class="field">平均口径<select name="averageUnit">${options({ day: '每天（含零消费日）', month: '每月（含无记录月份）', entry: '每笔记录（含回款）' }, q.averageUnit || 'month')}</select></label><label class="field ai-query-wide">备注关键词（仅本地；空格表示同时包含）<input name="noteKeyword" maxlength="600" value="${esc(q.noteKeyword || '')}" placeholder="例如 星巴克；留空统计全部匹配分类"></label><label class="field">单笔最低金额（元）<select name="lowerOp" aria-label="最低金额条件">${options({ gte: '大于等于', gt: '大于' }, lower?.op || 'gte')}</select><input name="lower" aria-label="单笔最低金额（元）" type="number" min="0" max="999999999.99" step="0.01" value="${lower ? lower.amount / 100 : ''}" placeholder="不限"></label><label class="field">单笔最高金额（元）<select name="upperOp" aria-label="最高金额条件">${options({ lte: '小于等于', lt: '小于' }, upper?.op || 'lte')}</select><input name="upper" aria-label="单笔最高金额（元）" type="number" min="0" max="999999999.99" step="0.01" value="${upper ? upper.amount / 100 : ''}" placeholder="不限"></label><label class="ai-query-wide"><input type="checkbox" name="excludeRent" ${q.excludeRent ? 'checked' : ''}> 排除备注包含“房租”的记录</label></div><p id="ai-query-error" class="form-error" role="alert"></p><button class="button secondary" type="submit">应用条件，重新统计</button></form></details>`;
  }
  function renderAssistant() {
    const prepared = ai.prepared;
    $('#ai-body').innerHTML = `<div class="ai-drawer-content"><div class="ai-privacy-strip">${icon('shield')}默认脱敏 · 原始账单留在本机<span>${state.mode === 'demo' ? '示例账本' : '我的账本'}</span></div><div class="ai-tabs" role="tablist" aria-label="财务助手功能"><button role="tab" aria-selected="${ai.tab === 'review'}" class="${ai.tab === 'review' ? 'active' : ''}" data-ai-action="tab-review">月度复盘</button><button role="tab" aria-selected="${ai.tab === 'question'}" class="${ai.tab === 'question' ? 'active' : ''}" data-ai-action="tab-question">问问账本</button></div>${ai.tab === 'question' ? `<div class="ai-question-box"><label for="ai-question">想了解哪些收支变化？</label><textarea id="ai-question" rows="3" maxlength="600" placeholder="我想知道平均每天的伙食支出">${esc(ai.question)}</textarea><div class="ai-shortcuts">${shortcuts.map((q, i) => `<button data-ai-shortcut="${i}">${q}</button>`).join('')}</div><div class="ai-question-bottom"><span>相对月份以 ${state.month} 为基准</span><button class="button secondary" data-ai-action="prepare" ${ai.busy ? 'disabled' : ''}>查看统计与脱敏预览</button></div></div>` : `<div class="ai-intro"><span class="eyebrow">YOUR MONTH, UNDERSTOOD</span><h3>${monthLabel(state.month)} · 财务复盘</h3><p>收入、支出、预算与消费分类，一起看看这个月的变化。</p></div>`}${ai.error ? `<p class="ai-error" role="alert">${esc(ai.error)}</p>` : ''}${prepared ? `${ai.tab === 'question' ? queryEditor(prepared) : ''}<div id="ai-prepared-content"><div class="ai-scope"><span>本次分析范围</span><strong>${esc(prepared.scope)}</strong></div>${localFacts(prepared)}${privacyPreview(prepared.payload)}${configuredNote()}${ai.response ? resultHTML(prepared, ai.response) : `<button class="button primary ai-generate" data-ai-action="generate" ${ai.busy || ai.filterDirty ? 'disabled' : ''}>${icon('sparkles')}${ai.busy ? '正在生成解读…' : '发送脱敏数据，生成解读'}</button>${!prepared.sourceRows.length ? '<p class="ai-footnote">当前条件未匹配到记录，统计值为零；可调整月份、分类或备注关键词。</p>' : ''}`}${ai.busy ? '<p class="ai-loading" role="status">正在等待 DeepSeek，请稍候。不会自动重试或修改账单。</p>' : ''}${sourceRows(prepared)}</div>` : '<div class="ai-question-empty">先在本地确认查询范围，再决定是否发送脱敏汇总。</div>'}</div>`;
  }
  function openAssistant(tabName) {
    ai.tab = tabName; ai.filterDirty = false; ai.error = ''; ai.response = null; ai.mode = state.mode;
    ai.prepared = tabName === 'review' ? P.packet(book(), state.month) : null;
    if (ai.prepared) ai.response = ai.cache.get(cacheKey(ai.prepared)) || null;
    renderAssistant(); assistant.showModal();
  }
  function openSettings() {
    $('#ai-settings-error').textContent = '';
    $('#ai-key').value = '';
    $('#ai-model').value = ai.status?.model || 'deepseek-flash';
    $('#ai-key').placeholder = ai.status?.configured ? '已配置；留空保留，填写可更换' : '填写 API Key，仅保存在本机';
    $('#ai-config-status').textContent = !ai.status?.available ? 'AI 本地服务尚未启动，请使用启动脚本打开网站。' : ai.status?.configured ? `已配置 · ${ai.status.source === 'environment' ? '来自环境变量' : '保存在本机'}（不回传 Key）` : '尚未配置 API Key';
    settings.showModal();
  }
  async function apiRequest(path, body, controller) {
    if (!ai.status?.csrfToken) await loadStatus();
    if (!ai.status?.available || !ai.status.csrfToken) throw Error('AI 本地服务未启动，请使用「启动月见.command」打开网站。');
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moonledger-Token': ai.status.csrfToken }, body: JSON.stringify(body), signal: controller?.signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '请求失败，请重试。');
    return data;
  }
  async function generate(force = false) {
    if (!ai.prepared || ai.busy || ai.filterDirty) return;
    if (!ai.status?.configured) { openSettings(); return; }
    const prepared = ai.prepared, key = cacheKey(prepared), originalMode = state.mode;
    if (!force && ai.cache.has(key)) { ai.response = ai.cache.get(key); renderAssistant(); return; }
    ai.controller = new AbortController(); const controller = ai.controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    ai.busy = true; ai.error = ''; renderAssistant();
    try {
      const response = await apiRequest('/api/ai', prepared.payload, controller);
      if (!assistant.open || controller.signal.aborted || state.mode !== originalMode || ai.prepared !== prepared) return;
      if (!response.result || typeof response.result.summary !== 'string' || !Array.isArray(response.result.insights) || !Array.isArray(response.result.suggestions) || response.result.insights.some(i => !prepared.labels[i.factId])) throw Error('AI 返回格式不正确，请重试。');
      ai.response = response; ai.cache.set(key, response);
      if (ai.cache.size > 20) ai.cache.delete(ai.cache.keys().next().value);
      mountCard();
    } catch (error) {
      if (assistant.open && ai.controller === controller && ai.prepared === prepared) ai.error = error.name === 'AbortError' ? '请求已取消或超时。输入仍保留，可重试。' : error.message;
    } finally {
      clearTimeout(timeout);
      if (ai.controller === controller) { ai.busy = false; ai.controller = null; if (assistant.open) renderAssistant(); }
    }
  }
  assistant.addEventListener('close', () => { ai.controller?.abort(); });

  function openSmart() {
    if (ai.saving) return;
    if ($('#entry-dialog').open) $('#entry-dialog').close();
    ai.drafts = []; ai.smartMode = state.mode; ai.saving = false;
    $('#smart-raw').value = ''; $('#smart-preview').innerHTML = ''; $('#smart-error').textContent = '';
    smart.showModal(); $('#smart-raw').focus();
  }
  function draftHTML() {
    $('#smart-preview').innerHTML = !ai.drafts.length ? '' : `<div class="smart-preview-heading"><strong>待确认 · ${ai.drafts.length} 笔</strong><span>${ai.smartMode === 'demo' ? '将记入示例账本' : '将记入我的账本'}</span></div>${ai.drafts.some(e => e.needsReview) ? '<p class="smart-review-note">部分类型或分类不明确，请核对。退款、报销、转账可能不属于实际消费。</p>' : ''}<form id="smart-save-form"><fieldset id="smart-fields" ${ai.smartBusy || ai.saving ? 'disabled' : ''}>${ai.drafts.map((e, i) => `<article class="smart-draft" data-draft-index="${i}"><div class="smart-draft-number"><strong>${String(i + 1).padStart(2, '0')}</strong><button class="icon-button" type="button" data-ai-remove="${i}" aria-label="移除第 ${i + 1} 笔草稿">${icon('x')}</button></div><div class="smart-draft-grid"><label class="field">收支类型<select data-draft-field="type" aria-label="第 ${i + 1} 笔类型"><option value="expense" ${e.type === 'expense' ? 'selected' : ''}>支出</option><option value="income" ${e.type === 'income' ? 'selected' : ''}>收入</option></select></label><label class="field">分类<select data-draft-field="category" aria-label="第 ${i + 1} 笔分类">${L.categories[e.type].map(c => `<option ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label class="field">金额（元）<input data-draft-field="amount" aria-label="第 ${i + 1} 笔金额" type="number" min="0.01" max="999999999.99" step="0.01" value="${(e.amount / 100).toFixed(2)}" required></label><label class="field">日期<input data-draft-field="date" aria-label="第 ${i + 1} 笔日期" type="date" value="${e.date}" required min="1900-01-01" max="2100-12-31"></label><label class="field smart-note">备注 · 仅在本机<input data-draft-field="note" aria-label="第 ${i + 1} 笔备注" value="${esc(e.note)}" maxlength="100"></label></div></article>`).join('')}${privacyPreview(P.categoryPacket(ai.drafts))}<div class="smart-confirm-bar"><button class="button secondary" type="button" data-ai-action="classify">${icon('sparkles')}${ai.smartBusy ? '正在整理…' : 'AI 辅助分类'}</button><button class="button primary" type="submit" ${ai.saving ? 'disabled' : ''}>确认记入 ${ai.drafts.length} 笔</button></div></fieldset></form><p class="ai-footnote">未配置 AI 也可以直接核对后入账。AI 只辅助分类，不改动本地金额和日期。</p>`;
  }
  function syncDrafts() {
    document.querySelectorAll('.smart-draft').forEach(row => {
      const draft = ai.drafts[Number(row.dataset.draftIndex)];
      row.querySelectorAll('[data-draft-field]').forEach(input => { draft[input.dataset.draftField] = input.dataset.draftField === 'amount' ? L.cents(input.value) : input.value; });
    });
  }
  async function classifyDrafts() {
    if (ai.saving || ai.smartBusy || !ai.drafts.length) return;
    if (!ai.status?.configured) { openSettings(); return; }
    try { syncDrafts(); } catch (error) { $('#smart-error').textContent = error.message; return; }
    const drafts = ai.drafts, mode = state.mode, controller = new AbortController();
    ai.smartController = controller; ai.smartBusy = true; $('#smart-error').textContent = ''; draftHTML();
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await apiRequest('/api/ai', P.categoryPacket(drafts), controller);
      if (!smart.open || controller.signal.aborted || state.mode !== mode || ai.drafts !== drafts) return;
      if (!Array.isArray(response.result?.items) || response.result.items.length !== drafts.length) throw Error('AI 返回的草稿数量不一致，请手动核对。');
      const seen = new Set();
      for (const item of response.result.items) {
        const index = Number(item.id.slice(1));
        if (!/^T\d+$/.test(item.id) || !drafts[index] || seen.has(item.id) || !L.categories[item.type]?.includes(item.category)) throw Error('AI 分类结果不一致，请手动核对。');
        seen.add(item.id);
      }
      for (const item of response.result.items) { const draft = drafts[Number(item.id.slice(1))]; draft.type = item.type; draft.category = item.category; }
      toast('AI 已整理分类，请核对后入账。');
    } catch (error) { if (smart.open && ai.smartController === controller && ai.drafts === drafts) $('#smart-error').textContent = error.name === 'AbortError' ? '分类已取消或超时，草稿仍保留。' : error.message; }
    finally {
      clearTimeout(timeout);
      if (ai.smartController === controller) { ai.smartBusy = false; ai.smartController = null; if (smart.open) draftHTML(); }
    }
  }
  smart.addEventListener('close', () => { ai.smartController?.abort(); });

  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.aiShortcut !== undefined) { ai.question = shortcuts[Number(button.dataset.aiShortcut)]; ai.prepared = null; ai.response = null; ai.error = ''; renderAssistant(); return; }
    if (button.dataset.aiRemove !== undefined) { if (ai.saving) return; try { syncDrafts(); ai.drafts.splice(Number(button.dataset.aiRemove), 1); draftHTML(); } catch (error) { $('#smart-error').textContent = error.message; } return; }
    const action = button.dataset.aiAction;
    if (action === 'open') openAssistant('question');
    if (action === 'review') openAssistant('review');
    if (action === 'settings') openSettings();
    if (action === 'smart') openSmart();
    if (action === 'tab-review' || action === 'tab-question') {
      ai.controller?.abort(); ai.controller = null; ai.busy = false; ai.tab = action.slice(4); ai.error = ''; ai.response = null;
      ai.prepared = ai.tab === 'review' ? P.packet(book(), state.month) : null;
      if (ai.prepared) ai.response = ai.cache.get(cacheKey(ai.prepared)) || null;
      renderAssistant();
    }
    if (action === 'prepare') {
      ai.question = $('#ai-question').value; ai.error = ''; ai.response = null; ai.prepared = null;
      try { ai.filterDirty = false; const query = P.parseQuestion(ai.question, state.month); ai.prepared = P.packet(book(), state.month, query); ai.response = ai.cache.get(cacheKey(ai.prepared)) || null; }
      catch (error) { ai.error = error.message; }
      renderAssistant();
    }
    if (action === 'generate') void generate();
    if (action === 'regenerate') { ai.response = null; void generate(true); }
    if (action === 'copy-report' && ai.response) {
      const prepared = ai.prepared, result = ai.response.result;
      const report = `月见财务复盘\n${prepared.scope}\n\n${result.summary}\n\n${prepared.payload.data.facts.map(f => `${prepared.labels[f.id].title}：${prepared.labels[f.id].display}`).join('\n')}\n\n${result.insights.map(i => i.explanation).join('\n')}\n\n${result.suggestions.join('\n')}`;
      navigator.clipboard?.writeText(report).then(() => toast('复盘已复制')).catch(() => toast('复制被浏览器阻止，请手动选择内容复制。'));
    }
    if (action === 'parse') {
      if (ai.saving || ai.smartBusy) return;
      $('#smart-error').textContent = '';
      try { ai.drafts = P.parseEntries($('#smart-raw').value); ai.saving = false; draftHTML(); }
      catch (error) { $('#smart-error').textContent = error.message; }
    }
    if (action === 'classify') void classifyDrafts();
    if (action === 'clear-key') {
      showConfirm('删除本地 API Key？', '仅删除这台设备保存的 Key，不会删除账本。若设置了环境变量，将继续使用环境变量中的 Key。', '删除本地 Key', () => { void apiRequest('/api/settings', { model: $('#ai-model').value, clearKey: true }).then(async () => { await loadStatus(); settings.close(); toast('本地 Key 已删除'); }).catch(error => { $('#ai-settings-error').textContent = error.message; }); });
    }
  });
  document.addEventListener('input', event => {
    if (event.target.closest('#ai-query-form')) {
      ai.filterDirty = true; ai.response = null; ai.controller?.abort(); ai.controller = null; ai.busy = false;
      const content = $('#ai-prepared-content');
      if (content) content.innerHTML = '<p class="ai-footnote">条件已修改，请点击“应用条件，重新统计”后再发送。</p>';
      return;
    }
    if (event.target.id !== 'ai-question') return;
    ai.question = event.target.value; ai.prepared = null; ai.response = null;
    ai.controller?.abort(); ai.controller = null; ai.busy = false;
    const questionBox = event.target.closest('.ai-question-box');
    while (questionBox.nextElementSibling) questionBox.nextElementSibling.remove();
    questionBox.insertAdjacentHTML('afterend', '<div class="ai-question-empty">问题已修改，请重新在本地确认查询范围。</div>');
    questionBox.querySelector('[data-ai-action="prepare"]').disabled = false;
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-draft-field="type"]')) {
      const row = event.target.closest('.smart-draft'), index = Number(row.dataset.draftIndex), type = event.target.value;
      ai.drafts[index].typeHint = type;
      row.querySelector('[data-draft-field="category"]').innerHTML = L.categories[type].map(c => `<option>${c}</option>`).join('');
    }
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'ai-query-form') return;
    event.preventDefault();
    try {
      const form = new FormData(event.target);
      const months = [...new Set(String(form.get('months')).split(/[,，、\s]+/).filter(Boolean))].sort().reverse();
      if (!months.length || months.length > 24 || months.some(m => !L.validMonth(m))) throw Error('月份请填写 YYYY-MM，例如 2026-09，最多 24 个月。');
      const selected = form.get('category');
      const categories = selected === 'selected' ? ai.prepared.query.categories : selected === 'all' ? [] : [selected];
      const bounds = ['lower', 'upper'].filter(key => form.get(key) !== '').map(key => ({ op: form.get(key + 'Op'), amount: Math.round(Number(form.get(key)) * 100) }));
      if (bounds.some(b => !Number.isSafeInteger(b.amount) || b.amount < 0 || b.amount > 99999999999)) throw Error('请填写有效的金额范围。');
      if (bounds.length === 2 && (bounds[0].amount > bounds[1].amount || bounds[0].amount === bounds[1].amount && (bounds[0].op === 'gt' || bounds[1].op === 'lt'))) throw Error('最低和最高金额之间没有可用范围，请调整。');
      if (form.get('focus') === 'compare' && months.length !== 2) throw Error('两个月比较需要恰好选择两个月。');
      const query = { months, categories, category: categories.length === 1 ? categories[0] : 'all', measure: form.get('measure'), focus: form.get('focus'), averageUnit: form.get('averageUnit'), noteKeyword: String(form.get('noteKeyword')).trim(), excludeRent: form.has('excludeRent'), bounds };
      ai.prepared = P.packet(book(), state.month, query); ai.response = ai.cache.get(cacheKey(ai.prepared)) || null; ai.filterDirty = false; ai.error = ''; renderAssistant();
    } catch (error) { $('#ai-query-error').textContent = error.message; }
  });
  $('#ai-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); $('#ai-settings-error').textContent = ''; $('#ai-save-settings').disabled = true;
    try {
      const key = $('#ai-key').value.trim();
      if (!key && !ai.status?.configured) throw Error('请填写 DeepSeek API Key。Key 不会回传到聊天中。');
      await apiRequest('/api/settings', { apiKey: key, model: $('#ai-model').value.trim() });
      $('#ai-key').value = ''; await loadStatus(); ai.cache.clear(); settings.close(); toast('AI 设置已保存，可在发送前查看脱敏内容。');
      if (assistant.open) renderAssistant();
    } catch (error) { $('#ai-settings-error').textContent = error.message; }
    finally { $('#ai-save-settings').disabled = false; }
  });
  settings.addEventListener('close', () => { $('#ai-key').value = ''; });
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'smart-save-form') return;
    event.preventDefault(); if (ai.saving || ai.smartBusy || !ai.drafts.length) return;
    try {
      if (state.mode !== ai.smartMode) throw Error('账本已切换，请重新打开一句话记账。');
      syncDrafts();
      const entries = ai.drafts.map(e => L.validateEntry({ id: L.uid(), date: e.date, amount: e.amount, type: e.type, category: e.category, note: e.note.trim() }));
      ai.saving = true; draftHTML();
      $('#smart-raw').disabled = true; $('[data-ai-action="parse"]').disabled = true;
      if (await commit({ ...book(), entries: [...book().entries, ...entries] }, `已记入 ${entries.length} 笔账单`)) {
        ai.drafts = []; smart.close(); state.month = entries[0].date.slice(0, 7); render();
      } else { ai.saving = false; }
    } catch (error) { $('#smart-error').textContent = error.message; }
    finally { ai.saving = false; $('#smart-raw').disabled = false; $('[data-ai-action="parse"]').disabled = false; if (smart.open) draftHTML(); }
  });
  mountCard();
  void loadStatus();
})();
