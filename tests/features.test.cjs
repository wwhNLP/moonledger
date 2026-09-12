const test=require('node:test');
const assert=require('node:assert/strict');
const L=require('../dist/ledger.js');
const F=require('../dist/features-core.js');
const P=require('../dist/privacy.js');
const entry=(overrides={})=>({id:'original',date:'2024-01-31',type:'expense',category:'餐饮美食',amount:10000,note:'午饭',...overrides});
const book=(entries=[],extra={})=>L.validateBook({entries,budgets:{},...extra});
const template=(overrides={})=>({id:'rent',name:'房租',type:'expense',category:'居家生活',amount:300000,day:31,startMonth:'2024-01',endMonth:'',active:true,...overrides});
const csv=(rows)=>'账单说明\n交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态,交易单号\n'+rows.join('\n');

test('cross-month refunds and reimbursements reduce expenses on receipt date; transfers do not count',()=>{
  const b=book([entry({pendingReimbursement:true}),entry({id:'refund',date:'2024-02-02',kind:'refund',type:'income',amount:3000,relatedId:'original'}),entry({id:'reimburse',date:'2024-02-03',kind:'reimbursement',type:'income',amount:4000,relatedId:'original'}),entry({id:'transfer',date:'2024-02-03',kind:'transfer',amount:900000})]);
  assert.equal(L.summarize(b,'2024-01').expense,10000);
  assert.deepEqual(L.summarize(b,'2024-02'),{income:0,expense:-7000,balance:7000,rate:null,count:3});
  assert.equal(L.breakdown(b,'2024-02')[0].amount,-7000);
  assert.equal(F.pendingClaims(b)[0].remaining,3000);
});
test('relations reject over-refunds, earlier receipt dates, missing originals, and linked original deletion',()=>{
  const refund=entry({id:'refund',date:'2024-02-02',kind:'refund',type:'income',amount:10001,relatedId:'original'});
  assert.throws(()=>book([entry(),refund]),/不能超过/);
  assert.throws(()=>book([entry(),{...refund,amount:100,date:'2024-01-01'}]),/早于/);
  assert.throws(()=>book([{...refund,amount:100}]),/原支出不存在/);
  const b=book([entry(),{...refund,amount:100}]);
  assert.throws(()=>L.mergeChanges(b,{...b,entries:b.entries.filter(e=>e.id!=='original')},b),/原支出不存在/);
  const changed=book([{...entry(),category:'购物消费'},{...refund,amount:100}]);
  assert.equal(changed.entries[1].category,'购物消费');
});
test('AI aggregation shares accounting semantics and excludes all new private metadata',()=>{
  const b=book([entry({source:'wechat',sourceId:'secret-order',pendingReimbursement:true}),entry({id:'refund',date:'2024-02-02',kind:'refund',type:'income',amount:3000,relatedId:'original',note:'私密报销人姓名'}),entry({id:'transfer',date:'2024-02-02',kind:'transfer'})],{categoryBudgets:{'2024-02':{'餐饮美食':100000}}});
  const packet=P.packet(b,'2024-02',P.parseQuestion('本月餐饮预算多少','2024-02'));
  assert.equal(packet.payload.data.periods[0].expense,-3000);
  assert.equal(packet.payload.data.periods[0].income,0);
  assert.equal(packet.payload.data.periods[0].budget,100000);
  assert.equal(packet.sourceRows[0].note,'私密报销人姓名');
  const json=JSON.stringify(packet.payload);
  for(const privateText of ['secret-order','original','refund','私密报销人姓名','sourceId','relatedId','templateId','2024-02'])assert.ok(!json.includes(privateText),privateText);
});
test('recurring templates clamp leap months, respect start/end/pause, and cannot be booked twice across tabs',()=>{
  const t=template(),b=book([],{recurring:[t]});
  assert.equal(F.templateDate(t,'2024-02'),'2024-02-29');
  assert.equal(F.templateDate(t,'2025-02'),'2025-02-28');
  assert.equal(F.occurrences(b,'2023-12').length,0);
  assert.equal(F.occurrences(book([],{recurring:[template({active:false})]}),'2024-02').length,0);
  const one=F.templateEntry(t,'2024-02'),two=F.templateEntry(t,'2024-02');
  const latest=L.mergeChanges(b,{...b,entries:[one]},b);
  assert.throws(()=>L.mergeChanges(b,{...b,entries:[two]},latest),/固定账单已经入账/);
  assert.ok(F.occurrences(latest,'2024-02')[0].existing);
});
test('category budget daily allowance includes today and reflects recoveries',()=>{
  const b=book([entry({date:'2024-02-28',amount:4000}),entry({id:'refund',type:'income',kind:'refund',date:'2024-02-29',amount:1000,relatedId:'original'})],{categoryBudgets:{'2024-02':{'餐饮美食':10000}}});
  const r=F.budgetRows(b,'2024-02','2024-02-28')[0];
  assert.equal(r.spent,3000);assert.equal(r.remaining,7000);assert.equal(r.remainingDays,2);assert.equal(r.daily,3500);
});
test('annual totals and signed category totals reconcile',()=>{
  const b=book([entry(),entry({id:'refund',date:'2024-02-02',kind:'refund',type:'income',amount:3000,relatedId:'original'}),entry({id:'salary',date:'2024-01-05',type:'income',category:'工资薪酬',amount:50000})]);
  const s=F.yearSummary(b,'2024');assert.equal(s.income,50000);assert.equal(s.expense,7000);assert.equal(s.balance,43000);assert.equal(s.average,583);assert.equal(s.categories.reduce((s,c)=>s+c.amount,0),s.expense);
});
test('confirmed duplicates stay dismissed until content changes and do not silently delete entries',()=>{
  const b=book([entry(),entry({id:'second'})]);const pairs=F.duplicatePairs(b);assert.equal(pairs.length,1);
  const confirmed=book(b.entries,{ignoredDuplicates:[pairs[0].key]});assert.equal(F.duplicatePairs(confirmed).length,0);assert.equal(confirmed.entries.length,2);
  confirmed.entries[1].note='另一次午饭';assert.equal(F.duplicatePairs(confirmed).length,1);
});
test('provider import scans headers, preserves numeric IDs, and keeps failed/refund/neutral cases unselected',()=>{
  const text=csv(['2024-02-01 12:00:00,转账,房东,房租,支出,3000,朋友已收钱,123456789012345678901234','2024-02-02 12:00:00,商户消费,餐厅,午饭,支出,38,已退款,refund-original','2024-02-03 12:00:00,退款,餐厅,退款,收入,10,退款成功,refund-event','2024-02-03 12:00:00,提现,本人,提现,不计收支,100,已到账,/','2024-02-03 12:00:00,商户消费,餐厅,午饭,支出,38,交易关闭,failed']);
  const result=F.importText(text);assert.equal(result.rows.length,5);assert.equal(result.rows[0].entry.sourceId,'123456789012345678901234');assert.ok(!result.rows[0].entry.kind);assert.ok(result.rows[0].selected);assert.deepEqual(result.rows.slice(1).map(r=>r.selected),[false,false,false,false]);assert.equal(result.rows[1].entry.type,'expense');assert.equal(result.rows[2].entry.kind,'refund');assert.equal(result.rows[3].entry.kind,'transfer');
});
test('missing IDs do not collide; imported source identity survives changing kind',()=>{
  const preview=F.markDuplicates(F.importText(csv(['2024-02-01 12:00:00,商户消费,餐厅,午饭,支出,38,支付成功,/','2024-02-02 12:00:00,商户消费,餐厅,午饭,支出,39,支付成功,/'])),book());
  assert.deepEqual(preview.rows.map(r=>r.selected),[true,true]);assert.ok(preview.rows.every(r=>!r.duplicate));
  const single=csv(['2024-02-01 12:00:00,转账,公司,款项,收入,38,已到账,123456']);const e=F.importText(single).rows[0].entry;
  const edited=book([{...e,kind:'transfer'}]);const again=F.markDuplicates(F.importText(single),edited);assert.ok(again.rows[0].duplicate);assert.equal(again.rows[0].selected,false);
});
test('same provider transaction cannot be committed concurrently with two random local IDs',()=>{
  const raw=csv(['2024-02-01 12:00:00,商户消费,餐厅,午饭,支出,38,支付成功,777']);const a=F.importText(raw).rows[0].entry,b=F.importText(raw).rows[0].entry,base=book();
  const latest=L.mergeChanges(base,{...base,entries:[a]},base);
  assert.throws(()=>L.mergeChanges(base,{...base,entries:[b]},latest),/同一平台交易/);
});
test('v2 backup merge restores template-only and category-budget-only books and relinks deduplicated originals',()=>{
  const incoming=book([],{recurring:[template()],categoryBudgets:{'2024-02':{'餐饮美食':90000}}});
  const restored=F.mergeBackup(book(),incoming).next;assert.equal(restored.recurring[0].name,'房租');assert.equal(restored.categoryBudgets['2024-02']['餐饮美食'],90000);
  const current=book([entry({id:'existing'})]);const other=book([entry(),entry({id:'refund',date:'2024-02-02',kind:'refund',type:'income',amount:3000,relatedId:'original'})]);
  const merged=F.mergeBackup(current,other);assert.equal(merged.added,1);assert.equal(merged.next.entries.find(e=>e.id==='refund').relatedId,'existing');
});
test('extended CSV round trip retains source IDs and relations with formula-safe escaping',()=>{
  const entries=book([entry({id:'+original',source:'wechat',sourceId:'@order'}),entry({id:'refund',date:'2024-02-02',kind:'refund',type:'income',amount:3000,relatedId:'+original'})]).entries;
  const result=L.importCSV(L.exportCSV(entries));assert.deepEqual(result,entries);
});
test('concurrent metadata changes are merged independently, conflicting edits reject',()=>{
  const base=book(),one={...base,recurring:[template()]},two={...base,categoryBudgets:{'2024-02':{'餐饮美食':100}}};
  const latest=L.mergeChanges(base,one,base),merged=L.mergeChanges(base,two,latest);assert.equal(merged.recurring.length,1);assert.equal(merged.categoryBudgets['2024-02']['餐饮美食'],100);
  const a={...merged,recurring:[template({amount:100})]},b={...merged,recurring:[template({amount:200})]};assert.throws(()=>L.mergeChanges(merged,b,a),/固定账单模板/);
});
