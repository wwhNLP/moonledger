(function () {
  'use strict';
  const C = window.MoonChatCore;
  const chat = { mode: state.mode, scope: 'month', includeNotes: true, history: [], rows: [], draft: '', busy: false, error: '', status: null, model: '', requestId: null, controller: null, token: null, generation: 0 };
  const shortcuts = ['平均每天的伙食支出是多少？', '有哪些开支可以适当减少？', '我想比较一下工作日和周末的消费'];
  let host = null;
  function snapshot() { return C.attachment(book(), state.month, state.mode, chat.scope, chat.includeNotes); }
  function scopeName() { return chat.scope === 'month' ? `${state.month} 当前月` : chat.scope === 'sixMonths' ? `截至 ${state.month} 的近六个月` : '全部账本'; }
  function plain(text) {
    // Escape all model output before minimal Markdown formatting. No raw HTML or links.
    return esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  }
  function render() {
    if (!host?.isConnected) return;
    let count = 0, attachmentError = '';
    try { count = snapshot().entries.length; } catch (error) { attachmentError = error.message; }
    host.innerHTML = `<div class="chat-intro"><span class="eyebrow">YOUR MONTH, IN CONVERSATION</span><h3>和账本聊一聊</h3><p>可以追问、补充条件，也可以聊聊接下来的安排。</p><div class="chat-engine"><span class="chat-dot"></span>${chat.model ? esc(chat.model) : '本机 Pi · 沿用已有登录和默认模型'}</div></div><div class="chat-context"><div class="chat-context-top"><label>账本范围<select id="chat-scope" ${chat.busy ? 'disabled' : ''}><option value="month" ${chat.scope === 'month' ? 'selected' : ''}>当前月</option><option value="sixMonths" ${chat.scope === 'sixMonths' ? 'selected' : ''}>近六个月</option><option value="all" ${chat.scope === 'all' ? 'selected' : ''}>全部账本</option></select></label><label class="chat-note-toggle"><input id="chat-notes" type="checkbox" ${chat.includeNotes ? 'checked' : ''} ${chat.busy ? 'disabled' : ''}>附带备注</label><button class="text-button" data-chat-action="new">新对话</button></div><p>${esc(scopeName())} · ${count} 笔明细 · ${state.mode === 'demo' ? '示例账本' : '我的账本'}</p><p>你的原话、对话历史和所选账单会交给 Pi 当前模型处理${chat.includeNotes ? '，包含备注' : '，本次账单附件不含备注'}。对话仅保留在当前页面。</p><details id="chat-context-preview"><summary>查看本轮将附带的内容</summary><p>本地服务还会补充月汇总、日均和星期。范围及备注开关影响新附件；已有对话仍会随发送，新对话可清空历史。</p><pre></pre></details></div>${attachmentError ? `<p class="ai-error">${esc(attachmentError)}</p>` : ''}${chat.status && !chat.status.available ? '<p class="ai-error">未找到本机 Pi。请先在终端安装并配置 pi，然后重启本地服务。</p>' : ''}<div class="chat-messages" id="chat-messages" aria-label="对话记录">${chat.rows.length ? chat.rows.map((row, i) => rowHTML(row, i)).join('') : `<div class="chat-empty"><div>${icon('sparkles')}</div><strong>想了解什么，直接说就好。</strong><p>比如先问每天的伙食支出，再追问<br>“如果不算周末聚餐呢？”</p><div class="chat-prompts">${shortcuts.map((q, i) => `<button data-chat-shortcut="${i}">${q}</button>`).join('')}</div></div>`}</div><p id="chat-error" class="form-error" role="alert">${esc(chat.error)}</p><form id="chat-form" class="chat-composer"><label class="sr-only" for="chat-input">与账本对话</label><textarea id="chat-input" rows="3" maxlength="4000" placeholder="发消息，或接着上一句话继续问…" ${chat.busy ? 'disabled' : ''}>${esc(chat.draft)}</textarea><div><span>${chat.history.length / 2} / 20 轮 · Enter 发送，Shift+Enter 换行</span>${chat.busy ? '<button class="button secondary" type="button" data-chat-action="stop">停止生成</button>' : `<button class="button primary" type="submit" ${attachmentError || chat.status?.available === false ? 'disabled' : ''}>发送 ${icon('arrowRight')}</button>`}</div></form><p class="chat-bottom-note">Pi 读取本次附带的账本上下文。建议由你决定，账单仍由你确认后修改。</p>`;
    host.querySelector('#chat-context-preview').addEventListener('toggle', event => {
      if (!event.target.open) return;
      try { event.target.querySelector('pre').textContent = JSON.stringify({ conversation: [...chat.history, ...(chat.draft.trim() ? [{ role: 'user', content: chat.draft }] : [])], ledger: snapshot() }, null, 2); }
      catch (error) { event.target.querySelector('pre').textContent = error.message; }
    });
  }
  function rowHTML(row, i) {
    return `<article class="chat-message ${row.role}" data-chat-row="${i}"><div class="chat-speaker">${row.role === 'user' ? '你' : 'Pi'}${row.scope ? ` <span>${esc(row.scope)}</span>` : ''}</div><div class="chat-message-text">${row.content ? plain(row.content) : row.failed ? '未生成回复。' : '<span class="chat-thinking">正在思考…</span>'}</div>${row.failed ? '<small class="chat-failed">本轮未完成，不会加入后续上下文。</small>' : ''}</article>`;
  }
  async function refreshStatus() {
    try { const response = await fetch('/api/chat/status', { cache: 'no-store' }); chat.status = await response.json(); if (!response.ok) chat.status = { available: false }; }
    catch (error) { chat.status = { available: false }; }
    render();
  }
  function updateReply(row) {
    if (!host?.isConnected) return;
    const index = chat.rows.indexOf(row), node = host.querySelector(`[data-chat-row="${index}"] .chat-message-text`);
    const dialog = host.closest('dialog'), follow = dialog && dialog.scrollHeight - dialog.scrollTop - dialog.clientHeight < 160;
    if (node) node.innerHTML = row.content ? plain(row.content) : '<span class="chat-thinking">正在思考…</span>';
    if (follow) dialog.scrollTop = dialog.scrollHeight;
  }
  async function stop() {
    if (!chat.busy) return;
    const id = chat.requestId, token = chat.token;
    chat.controller?.abort();
    if (id && token) {
      try { await fetch('/api/chat/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moonledger-Token': token }, body: JSON.stringify({ requestId: id }), keepalive: true }); }
      catch (error) { /* The disconnected stream also terminates its Pi process. */ }
    }
  }
  function reset() {
    void stop();
    chat.generation++; chat.mode = state.mode; chat.history = []; chat.rows = []; chat.draft = ''; chat.error = ''; chat.model = ''; chat.busy = false; chat.controller = null; chat.requestId = null;
    render();
  }
  async function send() {
    if (chat.busy) return;
    let payload;
    const question = chat.draft.trim(), requestId = crypto.randomUUID();
    try { payload = C.request(chat.history, question, snapshot(), requestId); }
    catch (error) { chat.error = error.message; render(); return; }
    const generation = chat.generation, controller = new AbortController();
    chat.busy = true; chat.controller = controller; chat.requestId = requestId; chat.draft = ''; chat.error = '';
    const userRow = { role: 'user', content: question, scope: scopeName() }, answerRow = { role: 'assistant', content: '' };
    chat.rows.push(userRow, answerRow); render();
    const timeout = setTimeout(() => controller.abort(), 200000);
    let completed = false;
    try {
      const statusResponse = await fetch('/api/status', { cache: 'no-store', signal: controller.signal });
      const status = await statusResponse.json();
      if (!status.csrfToken) throw Error('本地服务尚未启动，请刷新页面后重试。');
      chat.token = status.csrfToken;
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moonledger-Token': chat.token }, body: JSON.stringify(payload), signal: controller.signal });
      if (!response.ok) { const error = await response.json(); throw Error(error.error || 'Pi 对话未能启动。'); }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      const accept = line => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (generation !== chat.generation) return;
        if (event.type === 'delta') { answerRow.content += event.text; updateReply(answerRow); }
        if (event.type === 'error') throw Error(event.error || 'Pi 回复失败。');
        if (event.type === 'cancelled') throw Error('已停止生成。');
        if (event.type === 'done') { answerRow.content = event.text; chat.model = [event.provider, event.model].filter(Boolean).join(' / '); completed = true; updateReply(answerRow); }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) { buffer += decoder.decode(); break; }
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 250000) throw Error('回复流异常，请重试。');
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      }
      accept(buffer);
      if (!completed) throw Error('连接已中断，本轮未完成，可重新发送。');
      if (generation === chat.generation) chat.history.push({ role: 'user', content: question }, { role: 'assistant', content: answerRow.content });
    } catch (error) {
      if (generation === chat.generation) { answerRow.failed = true; chat.draft = question; chat.error = error.name === 'AbortError' ? '已停止或等待超时，问题已保留，可重新发送。' : error.message; }
      controller.abort();
    } finally {
      clearTimeout(timeout);
      if (generation === chat.generation) { chat.busy = false; chat.controller = null; chat.requestId = null; render(); }
    }
  }
  document.addEventListener('submit', event => { if (event.target.id === 'chat-form') { event.preventDefault(); void send(); } });
  document.addEventListener('input', event => {
    if (event.target.id === 'chat-input') {
      chat.draft = event.target.value;
      const preview = host?.querySelector('#chat-context-preview');
      if (preview) preview.open = false;
    }
  });
  document.addEventListener('keydown', event => { if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } });
  document.addEventListener('change', event => {
    if (event.target.id === 'chat-scope') { chat.scope = event.target.value; render(); }
    if (event.target.id === 'chat-notes') { chat.includeNotes = event.target.checked; render(); }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.chatAction === 'new') reset();
    if (button.dataset.chatAction === 'stop') void stop();
    if (button.dataset.chatShortcut !== undefined) { chat.draft = shortcuts[Number(button.dataset.chatShortcut)]; render(); host.querySelector('#chat-input').focus(); }
  });
  document.addEventListener('ledger:render', () => { if (chat.mode !== state.mode) reset(); else render(); });
  window.addEventListener('pagehide', () => { void stop(); });
  window.MoonChat = { mount(element) { host = element; if (chat.mode !== state.mode) reset(); render(); if (!chat.status) void refreshStatus(); }, stop };
})();
