(function(root){
  'use strict';
  const L=root.Ledger||require('./ledger.js');
  const kindNames={normal:'普通收支',refund:'退款',reimbursement:'报销到账',transfer:'内部转账'};
  const sourceKey=e=>e.source&&e.sourceId?JSON.stringify([e.source,e.sourceId,e.sourceEvent||((e.kind==='refund')?`refund:${e.date}:${e.amount}`:'payment')]):'';
  const rules=[
    ['餐饮美食',/餐饮|餐厅|午餐|晚餐|早餐|饭|外卖|咖啡|奶茶|火锅|美团|饿了么/],
    ['居家生活',/房租|租金|水费|电费|燃气|物业|宽带|日用/],
    ['交通出行',/打车|滴滴|地铁|公交|火车|铁路|高铁|机票|加油|停车|出行/],
    ['医疗健康',/医院|药房|药店|挂号|医疗|体检|健康/],
    ['学习成长',/书店|书籍|课程|学费|培训|教育/],
    ['休闲娱乐',/电影|游戏|视频|音乐|会员|旅行|酒店|娱乐/],
    ['购物消费',/购物|淘宝|天猫|京东|拼多多|商场|超市|服饰|数码/],
    ['工资薪酬',/工资|薪酬|奖金/],['兼职收入',/兼职|稿费|项目款/],['投资收益',/利息|分红|理财收益/]
  ];
  function inferCategory(text,type){return rules.find(([cat,re])=>L.categories[type].includes(cat)&&re.test(text))?.[0]||(type==='income'?'其他收入':'其他支出');}
  function remaining(book,originalId,exceptId){const e=book.entries.find(e=>e.id===originalId);return e?e.amount-book.entries.filter(x=>x.relatedId===originalId&&x.id!==exceptId).reduce((s,x)=>s+x.amount,0):0;}
  function pendingClaims(book){return book.entries.filter(e=>e.pendingReimbursement&&!e.kind).map(e=>({...e,remaining:remaining(book,e.id)})).filter(e=>e.remaining>0);}
  function templateDate(template,month){const [year,m]=month.split('-').map(Number);return `${month}-${String(Math.min(template.day,new Date(year,m,0).getDate())).padStart(2,'0')}`;}
  function occurrences(book,month,today=L.localDate()){
    return (book.recurring||[]).filter(t=>t.active&&t.startMonth<=month&&(!t.endMonth||month<=t.endMonth)).map(t=>{
      const date=templateDate(t,month),existing=book.entries.find(e=>e.templateId===t.id&&e.templateMonth===month);
      return {template:t,date,existing,due:date<=today};
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.template.name.localeCompare(b.template.name));
  }
  function templateEntry(template,month){return L.validateEntry({id:L.uid(),date:templateDate(template,month),type:template.type,category:template.category,amount:template.amount,note:template.name,templateId:template.id,templateMonth:month});}
  function fingerprint(e){return JSON.stringify([e.id,e.date,e.type,e.category,e.amount,e.note,e.kind||'',e.relatedId||'']);}
  function duplicateKey(a,b){return JSON.stringify([fingerprint(a),fingerprint(b)].sort());}
  function duplicatePairs(book,limit=100){
    const ignored=new Set(book.ignoredDuplicates||[]),buckets=new Map(),result=[];
    const entries=[...book.entries].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
    for(const e of entries){
      if(e.kind==='transfer')continue;
      const key=JSON.stringify([e.date,e.type,e.kind||'normal',e.amount]);
      const matches=buckets.get(key)||[];
      for(const other of matches){const pairKey=duplicateKey(e,other);if(!ignored.has(pairKey)){const exact=e.note.trim()===other.note.trim()&&e.category===other.category;result.push({a:e,b:other,key:pairKey,reason:exact?'同日、同额，备注与分类相同':'同日、同额，请核对是否为两次真实消费'});if(result.length>=limit)return result;}}
      matches.push(e);buckets.set(key,matches);
    }
    return result;
  }
  function yearSummary(book,year){
    const months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
    const rows=months.map(month=>({month,...L.summarize(book,month)}));
    const income=rows.reduce((s,r)=>s+r.income,0),expense=rows.reduce((s,r)=>s+r.expense,0);
    const end=String(year)===L.monthNow().slice(0,4)?Number(L.monthNow().slice(5)):12;
    const average=Math.round(rows.slice(0,end).reduce((s,r)=>s+r.expense,0)/end);
    const categories=L.categories.expense.map((name,i)=>({name,color:L.colors[i],amount:months.reduce((s,month)=>s+(L.breakdown(book,month).find(c=>c.name===name)?.amount||0),0)})).sort((a,b)=>b.amount-a.amount);
    return {rows,income,expense,balance:income-expense,average,averageMonths:end,categories,count:rows.reduce((s,r)=>s+r.count,0),peak:rows.filter(r=>r.count).sort((a,b)=>b.expense-a.expense)[0]||null};
  }
  function budgetRows(book,month,today=L.localDate()){
    const breakdown=L.breakdown(book,month),[y,m]=month.split('-').map(Number),days=new Date(y,m,0).getDate();
    const remainingDays=month<today.slice(0,7)?0:month===today.slice(0,7)?days-Number(today.slice(8))+1:days;
    return L.categories.expense.map((category,i)=>{const amount=book.categoryBudgets?.[month]?.[category]||0,spent=breakdown.find(c=>c.name===category)?.amount||0;return {category,color:L.colors[i],amount,spent,remaining:amount-spent,percent:amount?Math.max(0,spent/amount*100):0,daily:amount&&remainingDays?Math.floor(Math.max(0,amount-spent)/remainingDays):null,remainingDays};});
  }
  function parseDate(value){
    const s=String(value).trim(),m=s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if(m){const date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;if(L.validDate(date))return date;}
    if(/^\d{5}(?:\.\d+)?$/.test(s)){const d=new Date(Date.UTC(1899,11,30)+Math.floor(Number(s))*86400000),date=d.toISOString().slice(0,10);if(L.validDate(date))return date;}
    throw Error('无法识别日期，请使用有效的交易日期。');
  }
  const normalized=value=>String(value??'').replace(/^\uFEFF/,'').trim().replace(/[\s　]/g,'').replace(/（/g,'(').replace(/）/g,')');
  function importRows(rows){
    if(!Array.isArray(rows)||rows.length>50050)throw Error('一次最多读取 50,000 笔账单。');
    const headerIndex=rows.findIndex(row=>{const h=row.map(normalized);return (h.includes('交易时间')||h.includes('交易创建时间')||h.includes('日期'))&&(h.includes('金额')||h.includes('金额(元)'))&&(h.includes('收/支')||h.includes('类型'));});
    if(headerIndex<0)throw Error('没有识别到交易表头。请选择微信／支付宝对账 CSV、XLSX，或月见 CSV 模板。');
    const header=rows[headerIndex].map(normalized);
    if(header.includes('日期')&&header.includes('类型')&&header.includes('分类')){
      const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
      const csv=rows.slice(headerIndex).map(row=>row.map(quote).join(',')).join('\n');
      return {provider:'csv',headerIndex,rows:L.importCSV(csv).map((entry,i)=>({entry,rowNumber:i+headerIndex+2,selected:true,status:'标准账单',warning:'',sourceKey:entry.source&&entry.sourceId?`${entry.source}:${entry.sourceId}`:''})),errors:[]};
    }
    const provider=header.includes('当前状态')||header.includes('商品')?'wechat':'alipay';
    const index=names=>names.map(name=>header.indexOf(name)).find(i=>i>=0);
    const columns={date:index(['交易时间','交易创建时间']),amount:index(['金额(元)','金额']),direction:index(['收/支']),category:index(['交易分类','交易类型']),merchant:index(['交易对方']),product:index(['商品','商品说明','商品名称']),status:index(['当前状态','交易状态']),id:index(['交易单号','交易订单号','交易号']),note:index(['备注'])};
    if(['date','amount','direction'].some(k=>columns[k]===undefined))throw Error('缺少交易时间、金额或收/支列，请核对导出文件。');
    const result={provider,headerIndex,rows:[],errors:[]};
    for(let i=headerIndex+1;i<rows.length;i++){
      const raw=rows[i],get=key=>String(raw[columns[key]]??'').trim().replace(/^\t/,'');
      if(!raw.some(v=>String(v??'').trim()))continue;
      if(!/^(?:\d{4}[-/年]|\d{5}(?:\.|$))/.test(get('date'))){if(/^-{2,}|^共\d|^说明|^注[：:]|^导出|^收入|^支出/.test(raw.join('')))continue;result.errors.push({rowNumber:i+1,message:'该行缺少有效交易日期，未导入。'});continue;}
      try{
        const date=parseDate(get('date')),amount=L.cents(get('amount').replace(/[¥￥,，\s]/g,'').replace(/元$/,''));
        const status=get('status'),description=[get('merchant'),get('product'),get('note')].filter(v=>v&&v!=='/'&&v!=='-').join(' · '),direction=get('direction');
        const neutral=['/','-','不计收支','不计支出','不计收入','其他'].includes(direction);
        let type=direction==='收入'?'income':'expense',kind=neutral?'transfer':'normal',warning='';
        const refund=type==='income'&&/退款|退货/.test(`${get('category')} ${status} ${get('product')}`);
        if(refund)kind='refund';
        const failed=/关闭|失败|撤销|待支付|未支付|等待|处理中|退款中/.test(status);
        const success=/成功|已收钱|已到账|已入账|已存入|完成|已支付|已转账|已退款|部分退款/.test(status);
        if(!['收入','支出'].includes(direction)&&!neutral)warning='收支方向未知，请核对';
        if(refund)warning='退款到账：请核对金额并关联原支出';
        else if(/退款|退货/.test(status))warning='原订单含退款状态；仍按原支付金额预览，请核对是否另有退款流水';
        else if(neutral)warning='不计收支：默认标记内部转账，请确认';
        else if(!success&&!failed)warning='交易状态未识别，请确认是否已完成';
        if(failed)warning='交易未完成，默认不导入';
        const category=inferCategory(`${get('category')} ${description}`,kind==='refund'?'expense':type);
        let sourceId=get('id').replace(/^'+/,'');
        if(['/','-','—','无'].includes(sourceId))sourceId='';
        if(/^\d(?:[\d.]+)?[eE][+-]?\d+$/.test(sourceId)){sourceId='';warning='交易号已变成科学计数，无法可靠去重；请核对或重新导出';}
        const time=get('date').match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0]||'';
        const sourceEvent=refund?`refund:${date}:${time}:${amount}`:'payment';
        const entry=L.validateEntry({id:L.uid(),date,type,category,amount,note:(description||get('category')||'导入账单').slice(0,100),kind,source:provider,sourceId,sourceEvent});
        result.rows.push({entry,rowNumber:i+1,status:status||'未知',warning,selected:!failed&&!warning,sourceKey:sourceId?`${provider}:${sourceId}:${kind}`:''});
      }catch(error){result.errors.push({rowNumber:i+1,message:error.message});}
    }
    if(!result.rows.length)throw Error(result.errors.length?`未找到有效账单。第 ${result.errors[0].rowNumber} 行：${result.errors[0].message}`:'文件中没有交易记录。');
    return result;
  }
  function importText(text){return importRows(L.parseCSV(text));}
  function markDuplicates(preview,book){
    const existing=new Map();
    const dayAmounts=new Set(book.entries.map(e=>JSON.stringify([e.date,e.type,e.amount,e.kind||'normal'])));
    for(const e of book.entries)if(sourceKey(e))existing.set(sourceKey(e),e);
    const seen=new Map();
    for(const row of preview.rows){
      const e=row.entry,key=sourceKey(e);
      const duplicate=key&&(existing.get(key)||seen.get(key));
      if(duplicate){row.selected=false;row.duplicate=true;row.warning=duplicate.amount===e.amount&&duplicate.date===e.date?'同平台交易号已存在，默认跳过':'同平台交易号的金额或日期不一致，请先核对已有账单';}
      else if(dayAmounts.has(JSON.stringify([e.date,e.type,e.amount,e.kind||'normal']))){row.selected=false;row.warning=[row.warning,'已有同日同额账单，请核对后选择'].filter(Boolean).join('；');}
      if(key)seen.set(key,e);
    }
    return preview;
  }
  function mergeBackup(current,incoming){
    current=L.validateBook(current);incoming=L.validateBook(incoming);
    const signature=e=>JSON.stringify([e.date,e.type,e.category,e.amount,e.note,e.kind||'']);
    const ids=new Map(current.entries.map(e=>[e.id,e])),sources=new Map(current.entries.filter(e=>sourceKey(e)).map(e=>[sourceKey(e),e])),available=new Map(),used=new Set(),remap=new Map(),additions=[];
    for(const e of current.entries){const key=signature(e);available.set(key,[...(available.get(key)||[]),e]);}
    for(const e of incoming.entries){
      let match=ids.get(e.id)||sources.get(sourceKey(e));
      if(!match)match=(available.get(signature(e))||[]).find(x=>!used.has(x.id));
      if(match){remap.set(e.id,match.id);used.add(match.id);}else additions.push({...e});
    }
    for(const e of additions)if(e.relatedId)e.relatedId=remap.get(e.relatedId)||e.relatedId;
    const categoryBudgets={...incoming.categoryBudgets};for(const [month,values]of Object.entries(current.categoryBudgets))categoryBudgets[month]={...categoryBudgets[month],...values};
    const recurring=[...current.recurring,...incoming.recurring.filter(t=>!current.recurring.some(old=>old.id===t.id))];
    const next=L.validateBook({...current,entries:[...current.entries,...additions],budgets:{...incoming.budgets,...current.budgets},categoryBudgets,recurring,ignoredDuplicates:[...new Set([...current.ignoredDuplicates,...incoming.ignoredDuplicates])]});
    return {next,added:additions.length,skipped:incoming.entries.length-additions.length};
  }
  root.MoonFeatures={kindNames,sourceKey,inferCategory,remaining,pendingClaims,occurrences,templateDate,templateEntry,fingerprint,duplicateKey,duplicatePairs,yearSummary,budgetRows,importRows,importText,markDuplicates,mergeBackup};
  if(typeof module!=='undefined')module.exports=root.MoonFeatures;
})(globalThis);
