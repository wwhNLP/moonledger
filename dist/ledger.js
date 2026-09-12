(function(root){
  'use strict';
  const categories={expense:['餐饮美食','居家生活','购物消费','交通出行','休闲娱乐','医疗健康','学习成长','其他支出'],income:['工资薪酬','兼职收入','投资收益','其他收入']};
  const colors=['#426745','#8ba16b','#b6c999','#deb994','#e6d9b6','#8dada0','#b4bcd2','#d4c5b4'];
  const pad=n=>String(n).padStart(2,'0');
  const localDate=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const monthNow=()=>localDate().slice(0,7);
  function shiftMonth(month,offset){const [y,m]=month.split('-').map(Number);const d=new Date(y,m-1+offset,1);return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;}
  function validMonth(month){return typeof month==='string'&&/^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month);}
  function validDate(date){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validMonth(date.slice(0,7)))return false;const [y,m,d]=date.split('-').map(Number);return d>0&&d<=new Date(y,m,0).getDate();}
  function cents(value){if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(value)))throw Error('金额须为大于 0、最多两位小数的数字。');const n=Math.round(Number(value)*100);if(n<=0)throw Error('金额须大于 0。');return n;}
  function validateEntry(raw){
    if(!raw||typeof raw!=='object')throw Error('账单格式不正确。');
    if(!validDate(raw.date))throw Error('请填写有效日期（1900—2100 年）。');
    if(!categories[raw.type])throw Error('类型须为收入或支出。');
    const kind=raw.kind||'normal',recovery=['refund','reimbursement'].includes(kind);
    if(!['normal','refund','reimbursement','transfer'].includes(kind))throw Error('账单性质无效。');
    if(recovery&&raw.type!=='income')throw Error('退款或报销到账须为收款。');
    if(!categories[recovery?'expense':raw.type].includes(raw.category))throw Error(`未知分类「${String(raw.category).slice(0,30)}」，请使用标准分类。`);
    if(!Number.isSafeInteger(raw.amount)||raw.amount<=0||raw.amount>99999999999)throw Error('金额无效，最多支持 999,999,999.99 元。');
    if(typeof raw.note!=='string'||raw.note.length>100)throw Error('备注最多 100 字。');
    if(raw.id!=null&&(typeof raw.id!=='string'||raw.id.length>100))throw Error('账单编号格式不正确。');
    const entry={id:raw.id||uid(),date:raw.date,type:raw.type,category:raw.category,amount:raw.amount,note:raw.note};
    if(kind!=='normal')entry.kind=kind;
    if(raw.relatedId){if(!recovery||typeof raw.relatedId!=='string'||raw.relatedId.length>100)throw Error('关联账单无效。');entry.relatedId=raw.relatedId;}
    if(raw.pendingReimbursement){if(raw.type!=='expense'||kind!=='normal')throw Error('仅普通支出可标记待报销。');entry.pendingReimbursement=true;}
    if(raw.source){if(!['wechat','alipay','csv'].includes(raw.source)||typeof raw.sourceId!=='string'||raw.sourceId.length>200)throw Error('账单来源无效。');entry.source=raw.source;entry.sourceId=['/','-','—','无'].includes(raw.sourceId.trim())?'':raw.sourceId;entry.sourceEvent=raw.sourceEvent||(kind==='refund'?`refund:${raw.date}:${raw.amount}`:'payment');if(typeof entry.sourceEvent!=='string'||entry.sourceEvent.length>100||!/^payment$|^refund:[\d T:./-]+$/.test(entry.sourceEvent))throw Error('原始交易事件编号无效。');}
    if(raw.templateId){if(typeof raw.templateId!=='string'||raw.templateId.length>100||!validMonth(raw.templateMonth))throw Error('固定账单来源无效。');entry.templateId=raw.templateId;entry.templateMonth=raw.templateMonth;}
    return entry;
  }
  function uid(){return globalThis.crypto?.randomUUID?.()||`entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  function validateBook(raw){
    if(!raw||!Array.isArray(raw.entries)||raw.entries.length>50000)throw Error('备份必须包含有效账单，最多 50,000 笔。');
    const entries=raw.entries.map(validateEntry),byId=new Map(entries.map(e=>[e.id,e]));
    if(byId.size!==entries.length)throw Error('备份中存在重复账单编号。');
    const returned=new Map(),occurrences=new Set(),sources=new Set();
    for(const e of entries){
      if(e.sourceId){const key=JSON.stringify([e.source,e.sourceId,e.sourceEvent]);if(sources.has(key))throw Error('同一平台交易已经入账，已阻止重复保存。');sources.add(key);}
      if(e.relatedId){const original=byId.get(e.relatedId);if(!original||original.type!=='expense'||original.kind)throw Error('关联的原支出不存在，或不是普通支出。请先处理关联的退款或报销记录。');if(e.date<original.date)throw Error('到账日期不能早于原支出。');e.category=original.category;returned.set(original.id,(returned.get(original.id)||0)+e.amount);if(returned.get(original.id)>original.amount)throw Error('退款与报销合计不能超过原支出金额。');}
      if(e.templateId){const key=JSON.stringify([e.templateId,e.templateMonth]);if(occurrences.has(key))throw Error('这个月的固定账单已经入账，请刷新后查看。');occurrences.add(key);}
    }
    const budgets={};
    if(raw.budgets!=null){if(typeof raw.budgets!=='object'||Array.isArray(raw.budgets))throw Error('预算格式不正确。');for(const [month,amount]of Object.entries(raw.budgets)){if(!validMonth(month)||!Number.isSafeInteger(amount)||amount<0||amount>99999999999)throw Error('预算月份或金额无效。');budgets[month]=amount;}}
    const categoryBudgets={};
    if(raw.categoryBudgets!=null){if(typeof raw.categoryBudgets!=='object'||Array.isArray(raw.categoryBudgets))throw Error('分类预算格式不正确。');for(const [month,values]of Object.entries(raw.categoryBudgets)){if(!validMonth(month)||!values||typeof values!=='object'||Array.isArray(values))throw Error('分类预算月份无效。');categoryBudgets[month]={};for(const [cat,amount]of Object.entries(values)){if(!categories.expense.includes(cat)||!Number.isSafeInteger(amount)||amount<0||amount>99999999999)throw Error('分类预算金额或分类无效。');if(amount)categoryBudgets[month][cat]=amount;}}}
    if(raw.recurring!=null&&(!Array.isArray(raw.recurring)||raw.recurring.length>500))throw Error('固定账单模板最多 500 个。');
    const recurring=(raw.recurring||[]).map(validateTemplate);
    if(new Set(recurring.map(t=>t.id)).size!==recurring.length)throw Error('固定账单模板编号重复。');
    if(raw.ignoredDuplicates!=null&&(!Array.isArray(raw.ignoredDuplicates)||raw.ignoredDuplicates.length>5000||raw.ignoredDuplicates.some(s=>typeof s!=='string'||s.length>1200)))throw Error('重复账单确认记录无效。');
    return {entries,budgets,categoryBudgets,recurring,ignoredDuplicates:[...new Set(raw.ignoredDuplicates||[])]};
  }
  function validateTemplate(raw){
    if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!raw.id||raw.id.length>100||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>60)throw Error('请填写有效的固定账单名称。');
    const entry=validateEntry({id:raw.id,date:`${raw.startMonth}-01`,type:raw.type,category:raw.category,amount:raw.amount,note:raw.name});
    if(!Number.isInteger(raw.day)||raw.day<1||raw.day>31||typeof raw.active!=='boolean')throw Error('每月日期须为 1—31 日。');
    if(raw.endMonth&&(!validMonth(raw.endMonth)||raw.endMonth<raw.startMonth))throw Error('结束月份不能早于开始月份。');
    return {id:entry.id,name:raw.name.trim(),type:entry.type,category:entry.category,amount:entry.amount,day:raw.day,startMonth:raw.startMonth,endMonth:raw.endMonth||'',active:raw.active};
  }
  const forMonth=(book,month)=>book.entries.filter(e=>e.date.slice(0,7)===month);
  function accountingEntries(book){const byId=new Map(book.entries.map(e=>[e.id,e]));return book.entries.filter(e=>e.kind!=='transfer').map(e=>['refund','reimbursement'].includes(e.kind)?{...e,type:'expense',category:byId.get(e.relatedId)?.category||e.category,amount:-e.amount}:e);}
  function summarize(book,month){const entries=accountingEntries(book).filter(e=>e.date.slice(0,7)===month);const income=entries.filter(e=>e.type==='income').reduce((a,e)=>a+e.amount,0);const expense=entries.filter(e=>e.type==='expense').reduce((a,e)=>a+e.amount,0);return{income,expense,balance:income-expense,rate:income?((income-expense)/income*100):null,count:forMonth(book,month).length};}
  function breakdown(book,month){const rows=accountingEntries(book).filter(e=>e.date.slice(0,7)===month&&e.type==='expense');const result=categories.expense.map((name,i)=>({name,amount:rows.filter(e=>e.category===name).reduce((a,e)=>a+e.amount,0),color:colors[i]})).filter(c=>c.amount!==0).sort((a,b)=>b.amount-a.amount);const positive=result.reduce((a,c)=>a+Math.max(c.amount,0),0);return result.map(c=>({...c,percent:positive?Math.max(c.amount,0)/positive*100:0}));}
  function demoBook(month=monthNow()) {const entries=[],budgets={};for(let i=-5;i<=0;i++){const mo=shiftMonth(month,i);budgets[mo]=1200000;const factor=[.91,1.1,.94,1.06,1.17,1][i+5];const add=(day,type,category,amount,note)=>entries.push({id:`demo-${mo}-${entries.length}`,date:`${mo}-${pad(day)}`,type,category,amount:Math.round(amount*100),note});add(5,'income','工资薪酬',[14200,18900,16400,22900,19200,18000][i+5],'每月工资');add(8,'income','兼职收入',2800+(i===-1?700:0),'设计项目尾款');add(10,'income','投资收益',680,'理财收益');add(1,'expense','居家生活',3200,'房租');add(2,'expense','居家生活',168*factor,'水电与网络');add(3,'expense','购物消费',680*factor,'换季添置');add(4,'expense','交通出行',228*factor,'地铁与打车');add(6,'expense','餐饮美食',268*factor,'周末和朋友聚餐');add(7,'expense','餐饮美食',38,'街角咖啡');add(8,'expense','休闲娱乐',196*factor,'电影与展览');add(9,'expense','购物消费',399*factor,'一双新的运动鞋');add(10,'expense','餐饮美食',156*factor,'晚餐 · 日料');add(11,'expense','餐饮美食',860*factor,'日常餐食');add(12,'expense','交通出行',32,'打车回家');if(i<0){add(18,'expense','餐饮美食',750*factor,'下半月餐食');add(22,'expense','休闲娱乐',260*factor,'周末出游');add(26,'expense','居家生活',180*factor,'日用品');}}return {entries,budgets};}
  function parseCSV(text){const rows=[];let row=[],field='',quoted=false,closed=false;const s=text.replace(/^\uFEFF/,'');for(let i=0;i<s.length;i++){const c=s[i];if(quoted){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}else if(c==='"'){if(field||closed)throw Error('CSV 引号格式不正确。');quoted=true;}else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&s[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}}else{if(closed)throw Error('CSV 引号后有多余字符。');field+=c;}}if(quoted)throw Error('CSV 中存在未闭合的引号。');if(field||row.length||closed){row.push(field);if(row.some(v=>v.trim()))rows.push(row);}return rows;}
  function importCSV(text){const rows=parseCSV(text);const header=rows.shift()?.map(c=>c.trim());const expected=['日期','类型','分类','金额','备注'];if(!header||expected.some(c=>!header.includes(c)))throw Error('CSV 缺少表头，请使用「日期、类型、分类、金额、备注」。');if(rows.length>50000)throw Error('一次最多导入 50,000 笔。');return rows.map((row,i)=>{try{if(row.length!==header.length)throw Error('列数与表头不一致。');const get=k=>(row[header.indexOf(k)]||'').trim().replace(/^'(?=[=+\-@\t\r'])/,'');const note=row[header.indexOf('备注')].replace(/^'(?=[=+\-@\t\r'])/,'');return validateEntry({date:get('日期'),type:({'收入':'income','支出':'expense'})[get('类型')],category:get('分类'),amount:cents(get('金额')),note,...(header.includes('账单编号')?{id:get('账单编号'),kind:({'普通收支':'normal','退款':'refund','报销到账':'reimbursement','内部转账':'transfer'})[get('性质')]||get('性质'),relatedId:get('关联账单'),pendingReimbursement:get('待报销')==='是',source:get('来源'),sourceId:get('来源编号'),sourceEvent:get('来源事件'),templateId:get('模板编号'),templateMonth:get('模板月份')}: {})});}catch(e){throw Error(`第 ${i+2} 行：${e.message}`);}});}
  function exportCSV(entries){
    const escape=value=>{let s=String(value??'');if(/^[=+\-@\t\r']/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    const extended=entries.some(e=>e.kind||e.pendingReimbursement||e.source||e.templateId);
    const header=['日期','类型','分类','金额','备注',...(extended?['账单编号','性质','关联账单','待报销','来源','来源编号','来源事件','模板编号','模板月份']:[])];
    const names={normal:'普通收支',refund:'退款',reimbursement:'报销到账',transfer:'内部转账'};
    return '\uFEFF'+[header,...entries.map(e=>[e.date,e.type==='income'?'收入':'支出',e.category,(e.amount/100).toFixed(2),e.note,...(extended?[e.id,names[e.kind||'normal'],e.relatedId||'',e.pendingReimbursement?'是':'',e.source||'',e.sourceId||'',e.sourceEvent||'',e.templateId||'',e.templateMonth||'']:[])])].map(row=>row.map(escape).join(',')).join('\r\n');
  }
  function mergeChanges(base,next,latest){
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const baseline=new Map(base.entries.map(e=>[e.id,e]));
    const proposed=new Map(next.entries.map(e=>[e.id,e]));
    const merged=new Map(latest.entries.map(e=>[e.id,e]));
    for(const [id,oldEntry]of baseline){
      const replacement=proposed.get(id);
      if(same(oldEntry,replacement))continue;
      if(!same(merged.get(id),oldEntry)&&!same(merged.get(id),replacement))throw Error('同一笔账单已在另一个页面修改，请刷新后重试。');
      if(replacement)merged.set(id,replacement);else merged.delete(id);
    }
    for(const [id,entry]of proposed){
      if(baseline.has(id))continue;
      if(merged.has(id)&&!same(merged.get(id),entry))throw Error('账单编号冲突，请刷新后重试。');
      merged.set(id,entry);
    }
    const budgets={...latest.budgets};
    for(const month of new Set([...Object.keys(base.budgets),...Object.keys(next.budgets)])){
      if(base.budgets[month]===next.budgets[month])continue;
      if(latest.budgets[month]!==base.budgets[month]&&latest.budgets[month]!==next.budgets[month])throw Error('本月预算已在另一个页面修改，请刷新后重试。');
      if(next.budgets[month]!==undefined)budgets[month]=next.budgets[month];else delete budgets[month];
    }
    function mergeMap(oldMap,newMap,latestMap,label){const result={...latestMap};for(const key of new Set([...Object.keys(oldMap),...Object.keys(newMap)])){if(same(oldMap[key],newMap[key]))continue;if(!same(latestMap[key],oldMap[key])&&!same(latestMap[key],newMap[key]))throw Error(`${label}已在另一个页面修改，请刷新后重试。`);if(newMap[key]===undefined)delete result[key];else result[key]=newMap[key];}return result;}
    const categoryBudgets=mergeMap(base.categoryBudgets||{},next.categoryBudgets??base.categoryBudgets??{},latest.categoryBudgets||{},'分类预算');
    const asMap=rows=>Object.fromEntries((rows||[]).map(row=>[row.id,row]));
    const recurring=Object.values(mergeMap(asMap(base.recurring),asMap(next.recurring??base.recurring),asMap(latest.recurring),'固定账单模板'));
    const asSetMap=rows=>Object.fromEntries((rows||[]).map(key=>[key,true]));
    const ignoredDuplicates=Object.keys(mergeMap(asSetMap(base.ignoredDuplicates),asSetMap(next.ignoredDuplicates??base.ignoredDuplicates),asSetMap(latest.ignoredDuplicates),'重复账单确认'));
    return validateBook({entries:[...merged.values()],budgets,categoryBudgets,recurring,ignoredDuplicates});
  }
  root.Ledger={categories,colors,localDate,monthNow,shiftMonth,validMonth,validDate,cents,validateEntry,validateBook,validateTemplate,uid,forMonth,accountingEntries,summarize,breakdown,demoBook,parseCSV,importCSV,exportCSV,mergeChanges};
  if(typeof module!=='undefined')module.exports=root.Ledger;
})(globalThis);
