const test=require('node:test');
const assert=require('node:assert/strict');
const L=require('../dist/ledger.js');
const entry=(overrides={})=>({id:'test-1',date:'2026-09-12',type:'expense',category:'餐饮美食',amount:100,note:'测试',...overrides});
test('money is calculated as integer cents and rejects invalid amounts',()=>{
  assert.equal(L.cents('0.10')+L.cents('0.20'),30);
  for(const value of ['',0,-1,'1.001','NaN','Infinity','1e3','01','1000000000'])assert.throws(()=>L.cents(value));
  assert.equal(L.cents('999999999.99'),99999999999);
});
test('calendar dates, leap years and year boundaries are exact',()=>{
  assert.equal(L.validDate('2024-02-29'),true);
  for(const date of ['2026-02-29','2026-04-31','2026-00-01','2026-01-00','2026-1-1','1899-01-01'])assert.equal(L.validDate(date),false);
  assert.equal(L.shiftMonth('2026-01',-1),'2025-12');
  assert.deepEqual(Array.from({length:6},(_,i)=>L.shiftMonth('2026-02',i-5)),['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02']);
});
test('monthly totals, zero income, negative balance and category amounts',()=>{
  const book={entries:[entry(),entry({id:'2',amount:10}),entry({id:'3',date:'2026-08-31',amount:999}),entry({id:'4',type:'income',category:'工资薪酬',amount:50})],budgets:{}};
  assert.deepEqual(L.summarize(book,'2026-09'),{income:50,expense:110,balance:-60,rate:-120,count:3});
  assert.equal(L.breakdown(book,'2026-09').reduce((sum,c)=>sum+c.amount,0),110);
  assert.equal(L.summarize(book,'2026-08').rate,null);
  assert.equal(L.summarize(book,'2025-01').count,0);
});
test('CSV round trip preserves commas, quotes, line breaks and spreadsheet-safe notes',()=>{
  const notes=['一份午餐','两人,晚餐','一个"小"愿望','第一行\n第二行','=1+1',"'=1+1",'+123','@SUM(A1:A2)','  保留空格  ','\t开头'];
  const entries=notes.map((note,i)=>entry({id:String(i),note,amount:10+i}));
  const csv=L.exportCSV(entries),parsed=L.importCSV(csv);
  assert.deepEqual(parsed.map(({id,...e})=>e),entries.map(({id,...e})=>e));
  assert.ok(csv.includes("'=1+1"));
});
test('CSV errors reject complete batch and identify the invalid row',()=>{
  assert.throws(()=>L.importCSV('日期,类型,分类,金额,备注\n2026-09-01,支出,餐饮美食,10,午餐\n2026-02-30,支出,餐饮美食,1,晚餐'),/第 3 行/);
  assert.throws(()=>L.importCSV('日期,类型,金额\n2026-09-01,支出,1'),/表头/);
  assert.throws(()=>L.parseCSV('a,"unclosed'),/引号/);
  assert.throws(()=>L.importCSV('日期,类型,分类,金额,备注\n2026-09-01,未知,餐饮美食,10,午餐'),/第 2 行/);
});
test('backup validation rejects duplicate identifiers and invalid budgets',()=>{
  assert.throws(()=>L.validateBook({entries:[entry(),entry()]}),/重复/);
  assert.throws(()=>L.validateBook({entries:[],budgets:{'2026-13':1}}),/预算/);
  assert.throws(()=>L.validateBook({entries:[],budgets:{'2026-09':-1}}),/预算/);
  assert.deepEqual(L.validateBook({entries:[entry()],budgets:{'2026-09':100000}}).entries,[entry()]);
});
test('six-month demo is valid and all categories reconcile with expense',()=>{
  const demo=L.validateBook(L.demoBook('2026-09'));
  for(let offset=-5;offset<=0;offset++){const month=L.shiftMonth('2026-09',offset);assert.equal(L.breakdown(demo,month).reduce((a,c)=>a+c.amount,0),L.summarize(demo,month).expense);}
  assert.equal(L.summarize({entries:[],budgets:{}},'2026-09').count,0);
});
