(function(){
  'use strict';
  const F=window.MoonFeatures;
  const ui={calendarDate:'',template:null,templateMode:null,import:null,importPage:1,importMode:null,importBusy:false,templateBusy:false,actionBusy:false};
  Object.assign(titles,{
    calendar:['消费日历','日常花费，一目了然','每天的消费与收回款项，都有迹可循。'],
    annual:['年度总览','把一年的生活，慢慢看清','从每个月的变化，看见长期的积累。'],
    tools:['账本工具','少一点操作，多一点清楚','把导入、固定账单和日常核对放在一起。'],
    recurring:['固定账单','规律的收支，轻松记下','每月先生成待确认记录，核对后才入账。'],
    duplicates:['重复检查','让每一笔，只被记一次','这里只提示疑似重复，由你决定保留哪笔。'],
    claims:['报销与退款','那些待收回的钱','待报销不会提前冲减支出，到账后再记录。']
  });
  const go=(view,label,description,iconName='arrowRight')=>`<button class="feature-tile" data-view="${view}"><span class="feature-tile-icon">${icon(iconName)}</span><strong>${label}</strong><span>${description}</span>${icon('arrowRight')}</button>`;
  const note=text=>`<p class="accounting-note">${icon('shield')}<span>${text}</span></p>`;
  const empty=(title,description)=>`<div class="empty-state">${icon('inbox')}<strong>${title}</strong><p>${description}</p></div>`;
  function recordLine(e,actions=''){
    return `<div class="feature-record"><span class="category-icon ${e.type}">${icon(catIcon(e.category))}</span><div class="feature-record-label"><strong>${esc(e.note||e.category)}</strong><small>${e.date} · ${esc(e.category)} · ${F.kindNames[e.kind||'normal']}</small></div><strong class="feature-money ${e.type}">${e.kind==='transfer'?'↔':e.type==='income'?'+':'−'}¥${fmt(e.amount)}</strong>${actions}</div>`;
  }
  function toolsView(){
    const due=F.occurrences(book(),state.month).filter(r=>r.due&&!r.existing).length,claims=F.pendingClaims(book());
    return `<div class="tools-intro"><span class="feature-kicker">YOUR EVERYDAY SHORTCUTS</span><h2>把琐碎的事情，交给账本</h2><p>所有账单整理都在本机完成；导入与固定账单需要你确认。</p></div><div class="feature-tiles"><button class="feature-tile import-tile" data-feature="import"><span class="feature-tile-icon">${icon('upload')}</span><strong>智能导入账单</strong><span>微信、支付宝 CSV / XLSX<br>自动识别，先核对再入账</span>${icon('arrowRight')}</button>${go('recurring','固定账单',due?`本月 ${due} 笔到期，等待确认`:'工资、房租、订阅费，一次设置','wallet')}${go('duplicates','疑似重复检查','比较同日同额账单，保留真实消费','list')}${go('claims','报销与退款',claims.length?`${claims.length} 笔待报销 · ¥${fmt(claims.reduce((s,e)=>s+e.remaining,0))}`:'记录待报销，关联每次到账','arrowDown')}${go('calendar','消费日历','按天查看消费和收回款项','grid')}${go('annual','年度总览','全年结余、月均与分类变化','chart')}</div>${note('原始账单不发送给 AI。XLSX 由本机服务在内存中读取，不会保存上传文件。')}`;
  }
  function calendarView(){
    const month=state.month,[year,m]=month.split('-').map(Number),days=new Date(year,m,0).getDate(),offset=(new Date(year,m-1,1).getDay()+6)%7;
    if(!ui.calendarDate.startsWith(month))ui.calendarDate=month===L.monthNow()?L.localDate():L.forMonth(book(),month).map(e=>e.date).sort().at(-1)||`${month}-01`;
    const daily=Array.from({length:days},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`,rows=book().entries.filter(e=>e.date===date),gross=rows.filter(e=>e.type==='expense'&&!e.kind).reduce((s,e)=>s+e.amount,0),recovered=rows.filter(e=>['refund','reimbursement'].includes(e.kind)).reduce((s,e)=>s+e.amount,0),income=rows.filter(e=>e.type==='income'&&!e.kind).reduce((s,e)=>s+e.amount,0);return{date,rows,gross,recovered,income};});
    const max=Math.max(1,...daily.map(d=>d.gross)),selected=daily.find(d=>d.date===ui.calendarDate),s=L.summarize(book(),month);
    return `<div class="calendar-layout"><section class="panel calendar-panel"><div class="panel-heading"><div><h2>${monthLabel(month)}</h2><p class="panel-subtitle">颜色按实际消费深浅显示；收回款项另列</p></div><span class="tag">${s.count} 笔记录</span></div><div class="calendar-week">${['一','二','三','四','五','六','日'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-grid">${'<span class="calendar-blank"></span>'.repeat(offset)}${daily.map((d,i)=>`<button class="calendar-day ${d.date===ui.calendarDate?'selected':''} ${d.date===L.localDate()?'today':''}" style="--heat:${d.gross?0.06+d.gross/max*0.21:0}" data-calendar-date="${d.date}" aria-label="${d.date}，消费 ${fmt(d.gross)} 元，收回 ${fmt(d.recovered)} 元，收入 ${fmt(d.income)} 元，${d.rows.length} 笔"><span>${i+1}</span>${d.gross?`<strong>−${compact(d.gross)}</strong>`:'<strong class="calendar-zero">—</strong>'}${d.recovered?`<small>退 / 报 +${compact(d.recovered)}</small>`:d.income?`<small>收入 +${compact(d.income)}</small>`:''}</button>`).join('')}</div><div class="calendar-legend"><span>消费少</span><i></i><i></i><i></i><i></i><span>消费多</span></div></section><section class="panel day-panel"><div class="panel-heading"><div><h2>${selected.date.slice(5).replace('-',' 月 ')} 日</h2><p class="panel-subtitle">净支出 ¥${fmt(selected.gross-selected.recovered)} · ${selected.rows.length} 笔</p></div></div><div class="day-records">${selected.rows.length?selected.rows.map(e=>recordLine(e,`<button class="icon-button" data-edit="${esc(e.id)}" aria-label="编辑 ${esc(e.note||e.category)}">${icon('edit')}</button>`)).join(''):empty('这一天还没有记录','点击另一个日期，或记下今天的日常。')}</div><button class="button secondary calendar-add" data-feature="calendar-add">${icon('plus')}记在这一天</button></section></div>${note('内部转账保留在当天明细中，不计入消费、收入或预算。退款和报销按实际到账日冲减支出。')}`;
  }
  function annualView(){
    const year=state.month.slice(0,4),s=F.yearSummary(book(),year),max=Math.max(1,...s.rows.flatMap(r=>[r.income,Math.abs(r.expense)])),positive=Math.max(1,...s.categories.map(c=>Math.abs(c.amount)));
    const prior=F.yearSummary(book(),String(Number(year)-1));
    return `<div class="annual-head"><div><span class="feature-kicker">A YEAR IN PERSPECTIVE</span><h2>${year} <span>年度账本</span></h2></div><label class="field">查看年份<input id="annual-year" type="number" min="1900" max="2100" value="${year}" aria-label="查看年份"></label></div><div class="stats-grid annual-stats"><article class="stat-card featured"><div class="stat-top">全年结余</div><div class="stat-amount">¥${fmt(s.balance)}</div><p>全年收入 − 全年净支出</p></article><article class="stat-card"><div class="stat-top">全年收入</div><div class="stat-amount">¥${fmt(s.income)}</div><p>不包含退款、报销与内部转账</p></article><article class="stat-card"><div class="stat-top">全年净支出</div><div class="stat-amount">¥${fmt(s.expense)}</div><p>${s.count} 笔记录</p></article><article class="stat-card"><div class="stat-top">月均净支出</div><div class="stat-amount">¥${fmt(s.average)}</div><p>${s.averageMonths===12?'全年 12 个月':'截至本月，共 '+s.averageMonths+' 个月'}，包含无记录月份</p></article></div><section class="panel annual-chart"><div class="panel-heading"><div><h2>每个月，留下了什么</h2><p class="panel-subtitle">${s.peak?`净支出最高：${Number(s.peak.month.slice(5))} 月 · ¥${fmt(s.peak.expense)}`:'记录收支后即可查看月度变化'} · 点击月份查看账单</p></div><div class="legend"><span><i style="background:#557957"></i>收入</span><span><i style="background:#d3a27c"></i>净支出</span></div></div><div class="annual-bars">${s.rows.map(r=>`<button class="annual-month" data-annual-month="${r.month}" aria-label="${r.month} 收入 ${fmt(r.income)} 元，净支出 ${fmt(r.expense)} 元，结余 ${fmt(r.balance)} 元"><span class="annual-bar-pair"><i class="annual-income" style="height:${r.income/max*100}%"></i><i class="annual-expense ${r.expense<0?'negative':''}" style="height:${Math.abs(r.expense)/max*100}%"></i></span><span>${Number(r.month.slice(5))}月</span></button>`).join('')}</div><p class="chart-caption">斜纹柱表示净支出为负（当月收回款项更多）；金额以表格中的正负号为准。</p></section><div class="annual-bottom"><section class="panel"><div class="panel-heading"><div><h2>全年消费分类</h2><p class="panel-subtitle">对比上一完整年度的净支出</p></div></div><div class="annual-categories">${s.categories.filter(c=>c.amount!==0||prior.categories.find(p=>p.name===c.name)?.amount).map(c=>{const old=prior.categories.find(p=>p.name===c.name)?.amount||0,diff=c.amount-old;return `<div class="annual-category"><span>${c.name}</span><strong>¥${fmt(c.amount)}</strong><div class="budget-track"><div style="width:${Math.abs(c.amount)/positive*100}%;background:${c.color}"></div></div><small>${old?`较去年 ${diff>=0?'+':'−'}¥${fmt(Math.abs(diff))}`:'去年无该分类净支出'}</small></div>`;}).join('')||empty('还没有消费记录','新增记录后自动按分类汇总。')}</div></section><section class="panel"><div class="panel-heading"><h2>十二个月的明细</h2></div><div class="table-scroll"><table class="annual-table"><thead><tr><th>月份</th><th>收入</th><th>净支出</th><th>结余</th></tr></thead><tbody>${s.rows.map(r=>`<tr><td><button class="text-button" data-annual-month="${r.month}">${Number(r.month.slice(5))}月</button></td><td>${fmt(r.income)}</td><td>${fmt(r.expense)}</td><td>${fmt(r.balance)}</td></tr>`).join('')}</tbody></table></div></section></div>${note('全年合计覆盖所选年份 1—12 月的已记账单。当前年的月均只统计截至本月的记录；未来日期账单仍会出现在全年合计中。')}`;
  }
  function budgetView(){
    const month=state.month,rows=F.budgetRows(book(),month),total=book().budgets[month]||0,spent=L.summarize(book(),month).expense,assigned=rows.reduce((s,r)=>s+r.amount,0),alerts=rows.filter(r=>r.amount&&r.percent>=80);
    return `<section class="panel budget-top"><div><span class="feature-kicker">MAKE ROOM FOR WHAT MATTERS</span><h2>${monthLabel(month)} · 预算</h2><p>月度总预算与分类预算分别设置；退款和报销会补回额度。</p></div><div><small>本月净支出</small><strong>¥${fmt(spent)}</strong><span>${total?'总预算还剩 ¥'+fmt(total-spent):'尚未设置总预算'}</span></div></section>${alerts.length?`<div class="budget-alerts" role="status">${icon('wallet')}<span>${alerts.map(r=>`${r.category}${r.remaining<0?'已超支 ¥'+fmt(-r.remaining):'已用 '+r.percent.toFixed(0)+'%'}`).join('；')}</span></div>`:''}<form id="category-budget-form" class="panel category-budget-editor"><div class="panel-heading"><div><h2>给不同的日常，留出空间</h2><p class="panel-subtitle">填写 0 或留空取消对应预算；各个月份独立保存。</p></div><button type="button" class="text-button" data-feature="copy-budgets">沿用上月</button></div><label class="total-budget-field field">本月总预算（元）<input id="feature-total-budget" type="number" min="0" max="999999999.99" step="0.01" value="${total?(total/100).toFixed(2):''}" placeholder="例如 8000"></label><div class="category-budget-grid">${rows.map(r=>`<article class="category-budget-card"><div class="category-budget-name"><span class="category-icon">${icon(catIcon(r.category))}</span><strong>${r.category}</strong><span>${r.amount?(r.percent>100?'已超支':r.percent>=80?'接近预算':'预算内'):'未设置'}</span></div><label class="field">分类预算（元）<input type="number" min="0" max="999999999.99" step="0.01" data-category-budget="${r.category}" aria-label="${r.category}预算" value="${r.amount?(r.amount/100).toFixed(2):''}" placeholder="不限"></label><div class="budget-line"><span>已花 ¥${fmt(r.spent)}</span><strong>${r.amount?'剩余 ¥'+fmt(r.remaining):'—'}</strong></div><div class="budget-track"><div class="${r.percent>100?'over-budget':''}" style="width:${Math.min(r.percent,100)}%"></div></div><p>${r.daily!==null?`含今天，还可安排 ¥${fmt(r.daily)} / 天`:r.remainingDays===0?'该月份已结束':'设置后显示每日可用额度'}</p></article>`).join('')}</div><div class="feature-form-footer"><p>已保存分类额度合计 ¥${fmt(assigned)}${total&&assigned>total?'，高于总预算；两者将分别提醒。':'。分类额度不自动改变总预算。'}</p><button class="button primary" type="submit">保存全部预算</button></div><p id="category-budget-error" class="form-error" role="alert"></p></form>`;
  }
  function recurringView(){
    const items=F.occurrences(book(),state.month),templates=book().recurring||[],due=items.filter(r=>r.due&&!r.existing);
    return `<div class="feature-toolbar"><div><h2>${monthLabel(state.month)} · 固定收支</h2><p>${due.length?`${due.length} 笔已到期，确认后记入当前账本。`:'没有到期待确认的记录。'}</p></div><button class="button primary" data-feature="new-template">${icon('plus')}新建模板</button></div><section class="panel occurrence-panel"><div class="panel-heading"><h2>本月待办</h2><span class="tag">${items.length} 笔计划</span></div>${items.length?items.map(({template:t,date,existing,due})=>`<div class="occurrence-row"><span class="occurrence-date">${date.slice(8)}<small>日</small></span><div><strong>${esc(t.name)}</strong><small>${t.category} · ${existing?'已入账':due?'已到期待确认':'尚未到期'}</small></div><b class="feature-money">${t.type==='income'?'+':'−'}¥${fmt(t.amount)}</b>${existing?`<button class="text-button" data-edit="${esc(existing.id)}">查看记录</button>`:`<button class="button ${due?'primary':'secondary'}" data-occurrence="${esc(t.id)}">${due?'确认入账':'提前记入'}</button>`}</div>`).join(''):empty('本月还没有固定账单','新建工资、房租或订阅模板，每月在这里确认入账。')}</section><section class="panel template-panel"><div class="panel-heading"><h2>我的模板</h2><span class="tag">${templates.length} 个</span></div>${templates.length?templates.map(t=>`<div class="template-row"><span class="category-icon">${icon(catIcon(t.category))}</span><div><strong>${esc(t.name)}</strong><small>每月 ${t.day} 日 · ${t.startMonth} 起${t.endMonth?' · 至 '+t.endMonth:''} · ${t.active?'使用中':'已暂停'}</small></div><b>¥${fmt(t.amount)}</b><button class="icon-button" data-template-edit="${esc(t.id)}" aria-label="编辑模板 ${esc(t.name)}">${icon('edit')}</button><button class="icon-button" data-template-delete="${esc(t.id)}" aria-label="删除模板 ${esc(t.name)}">${icon('trash')}</button></div>`).join(''):empty('让重复发生的事，简单一点','模板可随时编辑、暂停或删除，已入账记录仍会保留。')}</section>${note('模板日期超出当月天数时使用当月最后一天。每个模板每月只能入账一次；不会在后台自动扣款或写入账单。')}`;
  }
  function duplicatesView(){
    const pairs=F.duplicatePairs(book()),ignored=book().ignoredDuplicates||[];
    return `<div class="feature-toolbar"><div><h2>疑似重复 · ${pairs.length}${pairs.length===100?'＋':''} 组</h2><p>检查整个当前账本，按最近日期排列。相同金额也可能是两次真实消费。</p></div>${ignored.length?'<button class="text-button" data-feature="reset-duplicates">重新显示已确认项</button>':''}</div><div class="duplicate-list">${pairs.map((pair,i)=>`<section class="panel duplicate-pair"><div class="duplicate-heading"><span class="tag">${String(i+1).padStart(2,'0')}</span><strong>${pair.reason}</strong></div>${recordLine(pair.a,`<button class="text-button danger-text" data-delete="${esc(pair.a.id)}">删除这笔</button>`)}${recordLine(pair.b,`<button class="text-button danger-text" data-delete="${esc(pair.b.id)}">删除这笔</button>`)}<div class="duplicate-footer"><button class="button secondary" data-keep-pair="${i}">确实是两笔，都保留</button></div></section>`).join('')||`<section class="panel">${empty('暂未发现疑似重复','新增或修改账单后会重新检查；已确认的同一组不再提示。')}</section>`}</div>`;
  }
  function claimsView(){
    const claims=F.pendingClaims(book()),recoveries=book().entries.filter(e=>['refund','reimbursement'].includes(e.kind)).sort((a,b)=>b.date.localeCompare(a.date));
    return `<div class="claims-summary"><span class="feature-kicker">MONEY COMING BACK</span><h2>待报销 <strong>¥${fmt(claims.reduce((s,e)=>s+e.remaining,0))}</strong></h2><p>编辑原支出，勾选“待报销”；收到款项后，在这里关联到账。</p></div><section class="panel"><div class="panel-heading"><h2>等待报销</h2><span class="tag">${claims.length} 笔</span></div>${claims.length?claims.map(e=>`<div class="claim-row"><div><strong>${esc(e.note||e.category)}</strong><small>${e.date} · 原支出 ¥${fmt(e.amount)} · 待收 ¥${fmt(e.remaining)}</small></div><button class="button secondary" data-recover="${esc(e.id)}">报销到账</button><button class="icon-button" data-edit="${esc(e.id)}" aria-label="编辑 ${esc(e.note||e.category)}">${icon('edit')}</button></div>`).join(''):empty('没有等待报销的账单','可在普通支出的编辑窗口标记待报销。')}</section><section class="panel recoveries-panel"><div class="panel-heading"><div><h2>已收到的退款与报销</h2><p class="panel-subtitle">按实际到账月份冲减支出，最多显示最近 50 笔。</p></div><button class="text-button" data-feature="new-refund">记录退款</button></div>${recoveries.length?recoveries.slice(0,50).map(e=>recordLine(e,`<button class="icon-button" data-edit="${esc(e.id)}" aria-label="编辑 ${esc(e.note||e.category)}">${icon('edit')}</button>`)).join(''):empty('还没有到账记录','支持部分退款和多次报销到账。')}</section>${note('同一原支出的累计退款与报销不能超过原金额。未关联的到账记录可单独记录；请在备注中保留便于核对的信息。')}`;
  }

  // Extend the existing entry dialog so all entry paths use the same validation.
  $('.type-toggle').insertAdjacentHTML('afterend',`<label class="field">账单性质<select id="entry-kind"><option value="normal">普通收支</option><option value="refund">退款到账 · 冲减支出</option><option value="reimbursement">报销到账 · 冲减支出</option><option value="transfer">自己的账户间转账 · 不计收支</option></select></label><div id="entry-relation-area" hidden><label class="field">关联原支出<select id="entry-related"></select></label><p class="entry-relation-note">可以部分到账；原支出未记在本账本时可暂不关联。</p></div><label class="entry-check" id="entry-pending-label"><input id="entry-pending" type="checkbox">这笔支出待报销</label>`);
  function recoveryOptions(selected='',exclude=''){
    let entries=book().entries.filter(e=>e.type==='expense'&&!e.kind&&e.id!==exclude).sort((a,b)=>b.date.localeCompare(a.date));
    const chosen=entries.find(e=>e.id===selected);entries=entries.slice(0,500);if(chosen&&!entries.includes(chosen))entries.push(chosen);
    return `<option value="">暂不关联（原单未记录）</option>${entries.map(e=>`<option value="${esc(e.id)}" ${e.id===selected?'selected':''}>${e.date} · ${esc(e.note||e.category)} · 可收回 ¥${fmt(F.remaining(book(),e.id,exclude))}</option>`).join('')}`;
  }
  function refreshEntryExtras(){
    const kind=$('#entry-kind').value,recovery=['refund','reimbursement'].includes(kind),type=$('#entry-form input[name="type"]:checked').value;
    if(recovery)$('#entry-form input[value="income"]').checked=true;
    $('#entry-form input[value="expense"]').disabled=recovery;
    $('#entry-relation-area').hidden=!recovery;
    $('#entry-pending-label').hidden=kind!=='normal'||type!=='expense';
    if(kind!=='normal'||type!=='expense')$('#entry-pending').checked=false;
  }
  function populateEntry(entry){
    $('#entry-kind').value=entry?.kind||'normal';$('#entry-pending').checked=Boolean(entry?.pendingReimbursement);
    $('#entry-related').innerHTML=recoveryOptions(entry?.relatedId||'',entry?.id||'');
    const recovery=['refund','reimbursement'].includes(entry?.kind);
    $('#entry-form input[value="expense"]').disabled=recovery;
    $('#entry-relation-area').hidden=!recovery;$('#entry-pending-label').hidden=Boolean(entry?.kind)||(entry?.type||'expense')!=='expense';
  }
  function entryExtras(){const kind=$('#entry-kind').value;return {kind:kind==='normal'?undefined:kind,relatedId:['refund','reimbursement'].includes(kind)?$('#entry-related').value:undefined,pendingReimbursement:kind==='normal'&&$('#entry-form input[value="expense"]').checked&&$('#entry-pending').checked};}
  function entryBadge(e){return e.kind?`<small class="entry-kind-badge">${F.kindNames[e.kind]}</small>`:e.pendingReimbursement?'<small class="entry-kind-badge">待报销</small>':e.templateId?'<small class="entry-kind-badge">固定账单</small>':'';}
  window.MoonFeaturesUI={views:{tools:toolsView,calendar:calendarView,annual:annualView,budget:budgetView,recurring:recurringView,duplicates:duplicatesView,claims:claimsView},populateEntry,entryExtras,entryBadge,entryCategoryType:type=>['refund','reimbursement'].includes($('#entry-kind').value)?'expense':type,openImport,handleImportFile};

  const templateDialog=document.createElement('dialog');templateDialog.id='template-dialog';templateDialog.setAttribute('aria-labelledby','template-title');
  templateDialog.innerHTML=`<form id="template-form"><div class="dialog-heading"><div><span class="eyebrow">EVERY MONTH, A LITTLE EASIER</span><h2 id="template-title">固定账单模板</h2></div><button type="button" class="icon-button close-dialog" aria-label="关闭固定账单模板">${icon('x')}</button></div><label class="field">模板名称<input id="template-name" maxlength="60" required placeholder="例如：每月房租"></label><div class="form-grid"><label class="field">收支类型<select id="template-type"><option value="expense">支出</option><option value="income">收入</option></select></label><label class="field">分类<select id="template-category"></select></label></div><div class="form-grid"><label class="field">金额（元）<input id="template-amount" type="number" min="0.01" max="999999999.99" step="0.01" required></label><label class="field">每月几日<input id="template-day" type="number" min="1" max="31" step="1" value="1" required></label></div><div class="form-grid"><label class="field">开始月份<input id="template-start" type="month" min="1900-01" max="2100-12" required></label><label class="field">结束月份（可留空）<input id="template-end" type="month" min="1900-01" max="2100-12"></label></div><label class="entry-check"><input id="template-active" type="checkbox" checked>启用此模板</label><p id="template-error" class="form-error" role="alert"></p><div class="dialog-footer"><button class="button secondary close-dialog" type="button">取消</button><button class="button primary" type="submit">保存模板</button></div></form>`;document.body.appendChild(templateDialog);
  function templateCategories(selected){$('#template-category').innerHTML=L.categories[$('#template-type').value].map(c=>`<option ${c===selected?'selected':''}>${c}</option>`).join('');}
  function openTemplate(id){
    if(ui.templateBusy)return;const t=(book().recurring||[]).find(t=>t.id===id);ui.template=t?{...t}:null;ui.templateMode=state.mode;
    $('#template-form').reset();$('#template-error').textContent='';$('#template-name').value=t?.name||'';$('#template-type').value=t?.type||'expense';templateCategories(t?.category);$('#template-amount').value=t?(t.amount/100).toFixed(2):'';$('#template-day').value=t?.day||1;$('#template-start').value=t?.startMonth||state.month;$('#template-end').value=t?.endMonth||'';$('#template-active').checked=t?.active??true;templateDialog.showModal();
  }
  const importDialog=document.createElement('dialog');importDialog.id='smart-import-dialog';importDialog.className='smart-import-dialog';importDialog.setAttribute('aria-labelledby','smart-import-title');
  importDialog.innerHTML=`<div class="dialog-heading"><div><span class="eyebrow">BRING YOUR RECORDS TOGETHER</span><h2 id="smart-import-title">智能导入账单</h2></div><button class="icon-button close-dialog" aria-label="关闭智能导入">${icon('x')}</button></div><div class="import-local-note">${icon('shield')}文件只在本机处理，原文与交易号不发送给 AI。</div><div class="import-picker"><div><strong>微信、支付宝或月见账单</strong><p>支持 CSV（UTF-8 / GBK）与未加密 XLSX，单个文件不超过 10 MB。</p></div><button class="button secondary" data-feature="choose-smart-import">${icon('upload')}选择文件</button><input id="smart-import-file" type="file" accept=".csv,.xlsx" hidden></div><p class="import-hint">在支付应用中导出“用于个人对账”的账单。ZIP 请先解压，PDF 证明版和旧 XLS 请先转换为 CSV / XLSX。</p><details class="import-paste"><summary>也可以粘贴 CSV 文件内容</summary><label class="field">CSV 内容<textarea id="import-paste" rows="4" placeholder="交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态,交易单号"></textarea></label><button class="button secondary" data-feature="parse-import-text">在本地识别</button></details><p id="smart-import-error" class="form-error" role="alert"></p><div id="smart-import-preview"></div>`;document.body.appendChild(importDialog);
  function openImport(){if(ui.importBusy||ui.actionBusy)return;if($('#data-dialog').open)$('#data-dialog').close();ui.import=null;ui.importMode=state.mode;ui.importPage=1;$('#smart-import-preview').innerHTML='';$('#smart-import-error').textContent='';$('#smart-import-file').value='';$('#import-paste').value='';importDialog.showModal();}
  async function handleImportFile(file){
    if(ui.importBusy||ui.actionBusy)return;ui.importBusy=true;$('#smart-import-error').textContent='正在本机读取文件…';ui.import=null;$('#smart-import-preview').innerHTML='';const mode=state.mode;
    try{
      if(file.size>10*1024*1024)throw Error('请选择 10 MB 以内的文件。');
      const bytes=new Uint8Array(await file.arrayBuffer());let parsed;
      if(/\.xlsx$/i.test(file.name)){
        const statusResponse=await fetch('/api/status',{cache:'no-store'}),status=await statusResponse.json();
        if(!status.csrfToken)throw Error('请使用本地启动脚本打开网站后再导入 XLSX。');
        let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
        const response=await fetch('/api/import-xlsx',{method:'POST',headers:{'Content-Type':'application/json','X-Moonledger-Token':status.csrfToken},body:JSON.stringify({file:btoa(binary)})});
        const result=await response.json();if(!response.ok)throw Error(result.error||'表格无法读取。');
        const options=[];for(const sheet of result.sheets){try{options.push({...F.importRows(sheet.rows),sheet:sheet.name});}catch(error){/* Instruction/summary worksheets need not contain transactions. */}}
        if(options.length!==1)throw Error(options.length?'发现多个交易工作表，请各自另存为 CSV 后分次导入，避免遗漏或重复。':'没有识别到交易工作表，请检查是否为个人对账文件。');
        parsed=options[0];
      }else if(/\.csv$/i.test(file.name)){
        let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(error){text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}parsed=F.importText(text);
      }else throw Error('请选择 CSV 或 XLSX；完整 JSON 备份请在“数据与备份”中恢复。');
      if(!importDialog.open||state.mode!==mode)return;
      ui.import=F.markDuplicates(parsed,book());ui.importMode=mode;ui.importPage=1;$('#smart-import-error').textContent='';renderImport();
    }catch(error){$('#smart-import-error').textContent=error.message||'文件读取失败，请使用标准 CSV。';}
    finally{ui.importBusy=false;}
  }
  function renderImport(){
    const preview=ui.import;if(!preview)return;const pageSize=12,pages=Math.ceil(preview.rows.length/pageSize);ui.importPage=Math.min(ui.importPage,pages);const start=(ui.importPage-1)*pageSize,rows=preview.rows.slice(start,start+pageSize),selected=preview.rows.filter(r=>r.selected);
    $('#smart-import-preview').innerHTML=`<div class="import-summary"><div><span class="feature-kicker">${preview.provider==='wechat'?'微信账单':preview.provider==='alipay'?'支付宝账单':'月见 CSV'}</span><h3>识别到 ${preview.rows.length} 笔记录</h3><p>已选 ${selected.length} 笔 · ${state.mode==='demo'?'将记入示例账本':'将记入我的账本'}${preview.sheet?' · '+esc(preview.sheet):''}</p></div><button class="text-button" data-feature="select-safe-import">选择无疑问项</button></div><p class="import-hint">分类可以修改。黄色提示行默认不选；确认真实发生后可手动勾选。同平台交易号重复项不再导入。</p><div class="import-table-wrap"><table class="import-preview-table"><thead><tr><th>选入</th><th>日期 / 原始状态</th><th>账单与提醒</th><th>性质</th><th>分类</th><th>金额（元）</th></tr></thead><tbody>${rows.map((row,i)=>{const e=row.entry,n=i+start;return `<tr class="${row.warning?'import-review-row':''}"><td><input type="checkbox" data-import-select="${n}" aria-label="选择第 ${row.rowNumber} 行" ${row.selected?'checked':''} ${row.duplicate?'disabled':''}></td><td><strong>${e.date}</strong><small>第 ${row.rowNumber} 行 · ${esc(row.status)}</small></td><td><strong>${esc(e.note)}</strong>${row.warning?`<small class="import-warning">${esc(row.warning)}</small>`:''}${['refund','reimbursement'].includes(e.kind)?`<label class="field import-related-label">关联原支出<select data-import-related="${n}" aria-label="第 ${row.rowNumber} 行关联原支出">${importRelatedOptions(e)}</select></label>`:''}</td><td><select data-import-kind="${n}" aria-label="第 ${row.rowNumber} 行性质" ${row.duplicate?'disabled':''}>${[['expense','普通支出'],['income','普通收入'],['refund','退款到账'],['reimbursement','报销到账'],['transfer','内部转账']].map(([v,t])=>`<option value="${v}" ${(e.kind||e.type)===v?'selected':''}>${t}</option>`).join('')}</select></td><td><select data-import-category="${n}" aria-label="第 ${row.rowNumber} 行分类" ${row.duplicate?'disabled':''}>${L.categories[['refund','reimbursement'].includes(e.kind)?'expense':e.type].map(c=>`<option ${c===e.category?'selected':''}>${c}</option>`).join('')}</select></td><td><input type="number" data-import-amount="${n}" aria-label="第 ${row.rowNumber} 行金额" min="0.01" max="999999999.99" step="0.01" value="${(e.amount/100).toFixed(2)}" ${row.duplicate?'disabled':''}></td></tr>`;}).join('')}</tbody></table></div>${pages>1?`<div class="import-pagination"><button class="button secondary" data-import-page="${ui.importPage-1}" ${ui.importPage===1?'disabled':''}>上一页</button><span>${ui.importPage} / ${pages}</span><button class="button secondary" data-import-page="${ui.importPage+1}" ${ui.importPage===pages?'disabled':''}>下一页</button></div>`:''}${preview.errors.length?`<details class="import-errors"><summary>${preview.errors.length} 行无法导入，展开查看原因</summary>${preview.errors.slice(0,100).map(e=>`<p>第 ${e.rowNumber} 行：${esc(e.message)}</p>`).join('')}</details>`:''}<div class="import-confirm-bar"><p>未选记录不会写入账本。导入后可以在账单明细中继续编辑。</p><button class="button primary" data-feature="commit-import" ${!selected.length||ui.actionBusy?'disabled':''}>确认导入 ${selected.length} 笔</button></div>`;
  }
  function importRelatedOptions(entry){
    const entries=[...book().entries,...ui.import.rows.map(r=>r.entry)].filter(e=>e.type==='expense'&&!e.kind&&e.date<=entry.date&&e.id!==entry.id).sort((a,b)=>b.date.localeCompare(a.date));
    return '<option value="">暂不关联</option>'+entries.slice(0,500).map(e=>`<option value="${esc(e.id)}" ${e.id===entry.relatedId?'selected':''}>${e.date} · ${esc(e.note||e.category)} · ¥${fmt(e.amount)}</option>`).join('');
  }

  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='entry-kind'){refreshEntryExtras();populateCategories($('#entry-form input[name="type"]:checked').value);}
    if(el.name==='type'){refreshEntryExtras();}
    if(el.id==='entry-related'&&el.value){const original=book().entries.find(e=>e.id===el.value);if(original)$('#entry-category').value=original.category;}
    if(el.id==='template-type')templateCategories();
    if(el.id==='annual-year'){const year=Number(el.value);if(!Number.isInteger(year)||year<1900||year>2100){toast('年份须为 1900—2100。');return;}setMonth(`${year}-${state.month.slice(5)}`);}
    if(el.id==='smart-import-file'&&el.files[0])void handleImportFile(el.files[0]);
    if(el.dataset.importSelect!==undefined){ui.import.rows[Number(el.dataset.importSelect)].selected=el.checked;renderImport();}
    if(el.dataset.importKind!==undefined){const row=ui.import.rows[Number(el.dataset.importKind)],e=row.entry;delete e.relatedId;if(['income','expense'].includes(el.value)){delete e.kind;e.type=el.value;}else{e.kind=el.value;e.type=el.value==='transfer'?'expense':'income';}e.category=F.inferCategory(e.note,['refund','reimbursement'].includes(e.kind)?'expense':e.type);renderImport();}
    if(el.dataset.importCategory!==undefined)ui.import.rows[Number(el.dataset.importCategory)].entry.category=el.value;
    if(el.dataset.importRelated!==undefined){const entry=ui.import.rows[Number(el.dataset.importRelated)].entry;entry.relatedId=el.value;const original=[...book().entries,...ui.import.rows.map(r=>r.entry)].find(e=>e.id===el.value);if(original)entry.category=original.category;renderImport();}
    if(el.dataset.importAmount!==undefined){try{ui.import.rows[Number(el.dataset.importAmount)].entry.amount=L.cents(el.value);$('#smart-import-error').textContent='';}catch(error){$('#smart-import-error').textContent=error.message;el.value=(ui.import.rows[Number(el.dataset.importAmount)].entry.amount/100).toFixed(2);}}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.calendarDate){ui.calendarDate=button.dataset.calendarDate;render();return;}
    if(button.dataset.annualMonth){state.month=button.dataset.annualMonth;setView('transactions');return;}
    if(button.dataset.templateEdit){openTemplate(button.dataset.templateEdit);return;}
    if(button.dataset.templateDelete){const t=(book().recurring||[]).find(t=>t.id===button.dataset.templateDelete);if(!t)return;const expected=JSON.stringify(t);showConfirm('删除这个固定账单模板？',`“${t.name}”将不再生成待办。已入账的历史记录保留。`,'删除模板',()=>{if(JSON.stringify((book().recurring||[]).find(x=>x.id===t.id))!==expected){toast('模板已在另一页修改，请重新核对后删除。');return false;}return commit({...book(),recurring:book().recurring.filter(x=>x.id!==t.id)},'模板已删除');});return;}
    if(button.dataset.occurrence){
      const item=F.occurrences(book(),state.month).find(x=>x.template.id===button.dataset.occurrence);if(!item||item.existing)return;
      const mode=state.mode,month=state.month,template={...item.template};
      showConfirm('确认这笔固定账单？',`${item.date} · ${template.name} · ${template.type==='income'?'收入':'支出'} ¥${fmt(template.amount)}。确认后记入${mode==='demo'?'示例账本':'我的账本'}。`,'确认入账',()=>{if(state.mode!==mode||JSON.stringify((book().recurring||[]).find(t=>t.id===template.id))!==JSON.stringify(template)){toast('账本或模板已改变，请重新确认。');return false;}return commit({...book(),entries:[...book().entries,F.templateEntry(template,month)]},'固定账单已入账');});return;
    }
    if(button.dataset.keepPair!==undefined){const pair=F.duplicatePairs(book())[Number(button.dataset.keepPair)];if(pair)await commit({...book(),ignoredDuplicates:[...(book().ignoredDuplicates||[]),pair.key]},'已确认两笔都保留');return;}
    if(button.dataset.recover){const e=book().entries.find(e=>e.id===button.dataset.recover);if(!e)return;openEntry();$('#entry-kind').value='reimbursement';$('#entry-related').value=e.id;refreshEntryExtras();populateCategories('income',e.category);$('#entry-amount').value=(F.remaining(book(),e.id)/100).toFixed(2);$('#entry-date').value=L.localDate();$('#entry-note').value=('报销到账 · '+(e.note||e.category)).slice(0,100);return;}
    if(button.dataset.importPage){ui.importPage=Number(button.dataset.importPage);renderImport();return;}
    const action=button.dataset.feature;
    if(action==='import')openImport();
    if(action==='choose-smart-import'&&!ui.importBusy&&!ui.actionBusy)$('#smart-import-file').click();
    if(action==='new-template')openTemplate();
    if(action==='calendar-add'){openEntry();$('#entry-date').value=ui.calendarDate;}
    if(action==='new-refund'){openEntry();$('#entry-kind').value='refund';refreshEntryExtras();populateCategories('income');}
    if(action==='copy-budgets'){const prev=L.shiftMonth(state.month,-1);$('#feature-total-budget').value=book().budgets[prev]?(book().budgets[prev]/100).toFixed(2):'';document.querySelectorAll('[data-category-budget]').forEach(input=>{const value=book().categoryBudgets?.[prev]?.[input.dataset.categoryBudget]||0;input.value=value?(value/100).toFixed(2):'';});toast('已填入上月预算，点击保存后生效。');}
    if(action==='reset-duplicates')showConfirm('重新检查已确认项？','之前选择“两笔都保留”的记录将重新参与检查。账单不会删除。','重新检查',()=>commit({...book(),ignoredDuplicates:[]},'已重新检查重复项'));
    if(action==='parse-import-text'&&!ui.importBusy&&!ui.actionBusy){try{if($('#import-paste').value.length>10*1024*1024)throw Error('CSV 内容过大。');ui.import=F.markDuplicates(F.importText($('#import-paste').value),book());ui.importMode=state.mode;ui.importPage=1;$('#smart-import-error').textContent='';renderImport();}catch(error){$('#smart-import-error').textContent=error.message;}}
    if(action==='select-safe-import'&&ui.import&&!ui.actionBusy){ui.import.rows.forEach(r=>r.selected=!r.warning&&!r.duplicate);renderImport();}
    if(action==='commit-import'&&ui.import&&!ui.actionBusy){
      try{
        if(state.mode!==ui.importMode)throw Error('账本已切换，请重新导入。');
        const selected=ui.import.rows.filter(r=>r.selected&&!r.duplicate).map(r=>L.validateEntry(r.entry));if(!selected.length)return;
        const ids=new Set(book().entries.map(e=>e.id)),sources=new Set(book().entries.filter(e=>e.sourceId).map(F.sourceKey));
        const additions=selected.filter(e=>!ids.has(e.id)&&!(e.sourceId&&sources.has(F.sourceKey(e))));
        if(!additions.length)throw Error('所选账单已存在，没有需要导入的新记录。');
        const next=L.validateBook({...book(),entries:[...book().entries,...additions]});ui.actionBusy=true;renderImport();
        if(await commit(next,`已导入 ${additions.length} 笔账单`)){importDialog.close();ui.import=null;state.month=additions.slice().sort((a,b)=>b.date.localeCompare(a.date))[0].date.slice(0,7);setView('transactions');}
      }catch(error){$('#smart-import-error').textContent=error.message;}
      finally{ui.actionBusy=false;if(importDialog.open)renderImport();}
    }
  });
  $('#template-form').addEventListener('submit',async event=>{
    event.preventDefault();if(ui.templateBusy)return;
    try{
      if(state.mode!==ui.templateMode)throw Error('账本已切换，请重新打开模板。');
      if(ui.template&&JSON.stringify((book().recurring||[]).find(t=>t.id===ui.template.id))!==JSON.stringify(ui.template))throw Error('模板已在另一页修改，请关闭后重新打开。');
      const template=L.validateTemplate({id:ui.template?.id||L.uid(),name:$('#template-name').value.trim(),type:$('#template-type').value,category:$('#template-category').value,amount:L.cents($('#template-amount').value),day:Number($('#template-day').value),startMonth:$('#template-start').value,endMonth:$('#template-end').value,active:$('#template-active').checked});
      const recurring=[...(book().recurring||[]).filter(t=>t.id!==template.id),template];ui.templateBusy=true;$('#template-form button[type="submit"]').disabled=true;
      if(await commit({...book(),recurring},'固定账单模板已保存'))templateDialog.close();
    }catch(error){$('#template-error').textContent=error.message;}
    finally{ui.templateBusy=false;$('#template-form button[type="submit"]').disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='category-budget-form')return;event.preventDefault();if(ui.actionBusy)return;
    try{
      const money=input=>!input.value.trim()||Number(input.value)===0?0:L.cents(input.value),budgets={...book().budgets},categoryBudgets={...book().categoryBudgets},values={};
      const total=money($('#feature-total-budget'));if(total)budgets[state.month]=total;else delete budgets[state.month];
      document.querySelectorAll('[data-category-budget]').forEach(input=>{const value=money(input);if(value)values[input.dataset.categoryBudget]=value;});if(Object.keys(values).length)categoryBudgets[state.month]=values;else delete categoryBudgets[state.month];
      ui.actionBusy=true;event.target.querySelector('button[type="submit"]').disabled=true;await commit({...book(),budgets,categoryBudgets},'本月总预算和分类预算已保存');
    }catch(error){$('#category-budget-error').textContent=error.message;}
    finally{ui.actionBusy=false;const submit=$('#category-budget-form button[type="submit"]');if(submit)submit.disabled=false;}
  });
  document.addEventListener('ledger:render',()=>{
    if(state.view==='overview'){
      const due=F.occurrences(book(),state.month).filter(r=>r.due&&!r.existing).length;
      $('#view-content').insertAdjacentHTML('afterbegin',`<div class="overview-shortcuts"><button data-feature="import">${icon('upload')}导入账单</button><button data-view="recurring">${icon('wallet')}固定账单${due?`<b>${due} 笔待确认</b>`:''}</button><button data-view="calendar">${icon('grid')}消费日历</button><button data-view="annual">${icon('chart')}年度总览</button><button data-view="duplicates">${icon('list')}重复检查</button></div>`);
      const refunds=L.forMonth(book(),state.month).filter(e=>['refund','reimbursement'].includes(e.kind)).reduce((s,e)=>s+e.amount,0);
      if(refunds)$('#view-content').insertAdjacentHTML('beforeend',note(`本月收回退款与报销 ¥${fmt(refunds)}，已冲减净支出。内部转账不计收支。`));
    }
    if(['recurring','duplicates','claims'].includes(state.view))document.querySelector('[data-view="tools"]').classList.add('active');
  });
  $('#data-dialog .import-area p').textContent='支持月见 JSON、微信／支付宝 CSV 与 XLSX';
  $('#import-file').accept='.json,.csv,.xlsx';
  $('#data-dialog .import-hint').textContent='支付账单会先打开智能预览，可改分类、检查退款和重复项；JSON 用于完整备份恢复。';
  render();
})();
