// V2.2 HIST-01 / INST-02 / CARD-03：保留既有資料庫及原交易 ID。
'use strict';
// V2.2 Stage 1. Never open or touch the V2.0 database.
const DB_NAME='payment-tax-v229-isolated-test', DB_VERSION=1;
const STORES=['installmentPlans','installments','installmentPayments','taxTemplates','taxBills','taxPayments','cards','cardPeriods','cardTransactions','cardRefunds','attachments','audit','historyCleanup','meta'];
let db;
const $=id=>document.getElementById(id);
const uid=()=>crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const money=n=>'NT$'+new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0,minimumFractionDigits:0}).format(Math.round(n));
const cents=v=>Math.round(Number(v))*100; // V2.2 新輸入金額以整數元儲存；舊測試資料不自動改寫
const fmtDate=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
function monthDue(first,offset){const [y,m,d]=first.split('-').map(Number);const target=new Date(Date.UTC(y,m-1+offset,1));const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(d,last));return fmtDate(target)}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{for(const name of STORES){if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'})}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('資料庫被其他頁面占用'))})}
function all(store){return new Promise((resolve,reject)=>{const t=db.transaction(store,'readonly');const r=t.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function saveMany(data){return new Promise((resolve,reject)=>{const names=[...new Set(data.map(x=>x.store)),'audit'];const tx=db.transaction(names,'readwrite');for(const {store,value} of data){tx.objectStore(store).put(value);tx.objectStore('audit').put({id:uid(),at:new Date().toISOString(),action:'create',store,entityId:value.id,after:value})}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function message(s){$('message').textContent=s;window.scrollTo({top:0,behavior:'smooth'})}
function textNode(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e}
function addItem(root,title,lines,chip){const el=document.createElement('article');el.className='item';el.append(textNode('strong',title));for(const line of lines)el.append(textNode('small',line));if(chip)el.append(textNode('span',chip,'chip'));root.append(el)}
async function renderStage1Unused(){const [plans,inst,tax,periods]=await Promise.all(['installmentPlans','installments','taxBills','cardPeriods'].map(all));$('nPlans').textContent=plans.length;$('nTax').textContent=tax.length;$('nPeriods').textContent=periods.length;for(const id of ['planList','taxList','cardList','recent'])$(id).replaceChildren();for(const p of plans.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){const related=inst.filter(x=>x.planId===p.id);addItem($('planList'),p.name,[`共 ${p.count} 期｜總額 ${money(p.totalCents/100)}`,`第一期 ${p.firstDue}｜最後一期 ${related.at(-1)?.due??''}`],'未開始繳款紀錄');addItem($('recent'),`分期｜${p.name}`,[p.createdAt.slice(0,10)])}for(const t of tax.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){addItem($('taxList'),`${t.year} 年｜${t.name}`,[`截止日 ${t.due}`,t.amountCents===null?'待確認稅額':`應繳 ${money(t.amountCents/100)}`],t.amountCents===null?'待確認稅額':'尚未建立繳款紀錄');addItem($('recent'),`稅務｜${t.name}`,[t.createdAt.slice(0,10)])}for(const p of periods.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){addItem($('cardList'),p.cardName,[`${{monthly:'每月',single:'單月',bimonthly:'雙月'}[p.mode]}｜${p.start}～${p.end}`,`最低消費 ${money(p.thresholdCents/100)}`],'尚未建立消費紀錄');addItem($('recent'),`信用卡｜${p.cardName}`,[p.createdAt.slice(0,10)])}if(!plans.length&&!tax.length&&!periods.length)$('recent').append(textNode('p','尚無測試資料。'))}
function formData(form){return Object.fromEntries(new FormData(form))}
function validMoney(v,allowZero=false){return v!==''&&Number.isFinite(Number(v))&&(allowZero?Math.round(Number(v))>=0:Math.round(Number(v))>0)&&Number.isSafeInteger(cents(v))}
async function createPlan(e){e.preventDefault();const f=e.currentTarget,v=formData(f);try{const count=Number(v.count);if(!Number.isInteger(count)||count<1||count>600)throw Error('期數需介於 1～600');if(!/^\d{4}-\d{2}-\d{2}$/.test(v.firstDue))throw Error('請填寫第一期到期日');const hasTotal=v.total!=='',hasPer=v.per!=='';if(hasTotal===hasPer)throw Error('總金額與每期金額請擇一填寫');const raw=hasTotal?v.total:v.per;if(!validMoney(raw))throw Error('金額必須大於零');const total=hasTotal?cents(raw):cents(raw)*count;if(!Number.isSafeInteger(total)||total<count)throw Error('金額或期數超出有效範圍');const base=hasTotal?Math.floor((total/100)/count)*100:cents(raw);const planId=uid(),at=new Date().toISOString();const plan={id:planId,name:v.name.trim(),count,totalCents:total,firstDue:v.firstDue,createdAt:at,status:'active',archived:false};if(!plan.name)throw Error('請輸入計畫名稱');const entries=[{store:'installmentPlans',value:plan}];for(let i=0;i<count;i++)entries.push({store:'installments',value:{id:uid(),planId,number:i+1,due:monthDue(v.firstDue,i),amountCents:i===0?total-base*(count-1):base,paidCents:0,reconciled:false,status:'active'}});await saveMany(entries);f.reset();await render();message('分期計畫已建立（階段 1 測試資料）')}catch(err){message(`無法建立：${err.message}`)}}
async function createTax(e){e.preventDefault();const f=e.currentTarget,v=formData(f);try{if(!Number.isInteger(Number(v.year))||Number(v.year)<1900||Number(v.year)>2200)throw Error('年度不正確');if(v.amount!==''&&!validMoney(v.amount,true))throw Error('稅額不正確');const record={id:uid(),sourceTemplateId:null,year:Number(v.year),name:v.name.trim(),due:v.due,amountCents:v.amount===''?null:cents(v.amount),paidCents:0,status:v.amount===''?'amount-pending':'unpaid',createdAt:new Date().toISOString()};if(!record.name||!record.due)throw Error('請填寫名稱及截止日');await saveMany([{store:'taxBills',value:record}]);f.reset();f.elements.year.value=new Date().getFullYear();await render();message('稅單已建立（階段 1 測試資料）')}catch(err){message(`無法建立：${err.message}`)}}
async function createCard(e){e.preventDefault();const f=e.currentTarget,v=formData(f);try{if(!validMoney(v.threshold,true))throw Error('最低消費門檻不正確');if(!v.start||!v.end||v.start>v.end)throw Error('結束日期不可早於開始日期');const cardId=uid(),periodId=uid(),at=new Date().toISOString();const card={id:cardId,name:v.name.trim(),mode:v.mode,createdAt:at};if(!card.name)throw Error('請輸入信用卡名稱');const period={id:periodId,cardId,cardName:card.name,mode:v.mode,start:v.start,end:v.end,thresholdCents:cents(v.threshold),createdAt:at};await saveMany([{store:'cards',value:card},{store:'cardPeriods',value:period}]);f.reset();await render();message('信用卡期間已建立（階段 1 測試資料）')}catch(err){message(`無法建立：${err.message}`)}}
async function exportData(){try{const out={format:'payment-tax-v22-stage2-test-export',exportedAt:new Date().toISOString(),stores:{}};for(const s of STORES)out.stores[s]=await all(s);const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`payment-tax-v22-stage2-test-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);message('測試資料已匯出，請確認檔案已儲存。')}catch(err){message(`匯出失敗：${err.message}`)}}

function txWrite(stores,callback){return new Promise((resolve,reject)=>{const tx=db.transaction([...new Set([...stores,'audit'])],'readwrite');let failed=false;try{callback(tx)}catch(err){failed=true;try{tx.abort()}catch{};reject(err)}if(!failed){tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('資料庫交易失敗'));tx.onabort=()=>reject(tx.error||new Error('資料庫交易取消'))}})}
function audit(tx,action,store,entityId,after){tx.objectStore('audit').put({id:uid(),at:new Date().toISOString(),action,store,entityId,after})}
function safeDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function element(tag,attrs={},children=[]){const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else e.setAttribute(k,v)}for(const child of children)e.append(child);return e}
function formField(label,name,type,attrs={}){const input=element('input',{name,type,...attrs});return element('label',{text:label},[input])}
function actionForm(kind,parentId,remaining){const form=element('form',{class:'inline-form payment-entry-form-v229'});form.dataset.kind=kind;form.dataset.parent=parentId;const amount=formField('本次繳款金額','amount','number',{required:'',min:'1',max:String(Math.floor(remaining/100)),step:'1',placeholder:'輸入金額'});const date=formField('實際付款日','paidAt','date',{required:'',value:today()});const note=formField('備註（選填）','note','text',{maxlength:'120'});const actions=element('div',{class:'payment-submit-v229'},[element('button',{type:'submit',class:'primary',text:'記錄付款'})]);form.append(amount,date,note,actions);form.addEventListener('submit',recordPayment);return form}
function reconciliationButton(kind,payment){const b=element('button',{type:'button',text:payment.reconciled?'已核對':'核對這筆付款'});b.disabled=!!payment.reconciled;b.addEventListener('click',()=>reconcilePayment(kind,payment.id));return b}
async function recordPayment(e){e.preventDefault();const f=e.currentTarget,kind=f.dataset.kind,recordId=f.dataset.parent,v=formData(f);try{if(!validMoney(v.amount)||!safeDate(v.paidAt))throw Error('請填寫有效的付款金額及日期');const amount=cents(v.amount);const isInst=kind==='installment';const parentStore=isInst?'installments':'taxBills',payStore=isInst?'installmentPayments':'taxPayments';let result='';await txWrite([parentStore,payStore],tx=>{const parentReq=tx.objectStore(parentStore).get(recordId);parentReq.onsuccess=()=>{const p=parentReq.result;if(!p){tx.abort();return}if(!isInst&&(p.amountCents===null||p.status==='exempt')){tx.abort();return}if(isInst&&p.status==='cancelled'){tx.abort();return}const due=p.amountCents-p.paidCents;if(amount<=0||amount>due){tx.abort();return}const payment={id:uid(),[isInst?'installmentId':'taxBillId']:recordId,amountCents:amount,paidAt:v.paidAt,note:(v.note||'').trim(),reconciled:false,createdAt:new Date().toISOString()};p.paidCents+=amount;if(!isInst&&p.amountCents!==null)p.status=p.paidCents>=p.amountCents?'paid':'unpaid';tx.objectStore(parentStore).put(p);tx.objectStore(payStore).put(payment);audit(tx,'create',payStore,payment.id,payment);audit(tx,'update',parentStore,p.id,p);result='付款已記錄，尚待核對'};parentReq.onerror=()=>tx.abort()});await render();f.reset();message(result||'付款已記錄')}catch(err){message('無法記錄付款：請確認金額未超過剩餘應繳金額，且稅額已確定。')}}
async function reconcilePayment(kind,paymentId){if(!confirm('確認已核對這筆付款？'))return;const payStore=kind==='installment'?'installmentPayments':'taxPayments';try{await txWrite([payStore],tx=>{const req=tx.objectStore(payStore).get(paymentId);req.onsuccess=()=>{const p=req.result;if(!p||p.reconciled){tx.abort();return}p.reconciled=true;p.reconciledAt=new Date().toISOString();tx.objectStore(payStore).put(p);audit(tx,'reconcile',payStore,p.id,p)};req.onerror=()=>tx.abort()});await render();message('已核對付款')}catch{message('核對失敗，資料未變更')}}
async function setTaxAmount(id){const input=prompt('請輸入已確認的稅額（元），可以填 0；取消則不修改');if(input===null)return;if(!validMoney(input,true)){message('稅額不正確');return}try{await txWrite(['taxBills'],tx=>{const r=tx.objectStore('taxBills').get(id);r.onsuccess=()=>{const p=r.result;if(!p||p.paidCents>cents(input)){tx.abort();return}p.amountCents=cents(input);p.status=p.paidCents>=p.amountCents?'paid':'unpaid';tx.objectStore('taxBills').put(p);audit(tx,'update','taxBills',id,p)};r.onerror=()=>tx.abort()});await render();message('稅額已更新')}catch{message('稅額修改失敗，請確認金額不少於已付款金額')}}
// Stage 2.1: presentation-only navigation; no schema changes or rewriting existing records.
const planView={search:'',filter:'active',page:1,selectedId:null,pageSize:10};
function planOutstanding(plan,inst){return inst.filter(x=>x.planId===plan.id&&x.status!=='cancelled').reduce((sum,x)=>sum+Math.max(0,x.amountCents-x.paidCents),0)}
function planState(plan,inst){return planOutstanding(plan,inst)>0?'active':'closed'}
function planNextDue(plan,inst){return inst.filter(x=>x.planId===plan.id&&x.status!=='cancelled'&&x.amountCents>x.paidCents).map(x=>x.due).sort()[0]||null}
function renderPlanBrowser(plans,inst,ip){
  const browser=$('planBrowser'),detail=$('planDetailView');
  const selected=plans.find(p=>p.id===planView.selectedId);
  if(planView.selectedId&&!selected)planView.selectedId=null;
  const inDetail=!!planView.selectedId;
  browser.hidden=inDetail;detail.hidden=!inDetail;$('planForm').hidden=inDetail;
  $('planList').replaceChildren();$('installmentDetails').replaceChildren();$('planDetailHeader').replaceChildren();
  if(inDetail){
    const p=plans.find(x=>x.id===planView.selectedId),related=inst.filter(x=>x.planId===p.id).sort((a,b)=>a.number-b.number);
    const left=planOutstanding(p,inst),state=planState(p,inst);
    $('planDetailHeader').append(element('h3',{text:p.name}),textNode('p',`總金額 ${money(p.totalCents/100)}｜剩餘待繳 ${money(left/100)}｜${state==='closed'?'已結清':'進行中'}`,'plan-summary'));
    for(const x of related){
      const remaining=Math.max(0,x.amountCents-x.paidCents),paidFor=ip.filter(y=>y.installmentId===x.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const card=element('article',{class:'item'},[element('strong',{text:`第 ${x.number} 期`}),textNode('small',`到期日 ${x.due}｜應繳 ${money(x.amountCents/100)}｜已繳 ${money(x.paidCents/100)}｜剩餘 ${money(remaining/100)}`)]);
      if(remaining>0&&x.status!=='cancelled')card.append(actionForm('installment',x.id,remaining));
      for(const pay of paidFor){const line=element('div',{class:'payment-line'},[textNode('small',`付款 ${pay.paidAt}｜${money(pay.amountCents/100)}｜${pay.reconciled?'已核對':'待核對'}${pay.note?'｜'+pay.note:''}`)]);if(!pay.reconciled){line.append(reconciliationButton('installment',pay),editPaymentButton('installment',pay))}card.append(line)}
      $('installmentDetails').append(card);
    }
    if(!related.length)$('installmentDetails').append(textNode('p','這筆計畫尚無期數資料。'));
    return;
  }
  const t=today();
  const matching=plans.filter(p=>(planView.filter==='all'||planState(p,inst)===planView.filter)&&p.name.toLocaleLowerCase('zh-TW').includes(planView.search.toLocaleLowerCase('zh-TW')));
  matching.sort((a,b)=>{
    const aDue=planNextDue(a,inst),bDue=planNextDue(b,inst);
    const aLate=aDue!==null&&aDue<t,bLate=bDue!==null&&bDue<t;
    if(aLate!==bLate)return aLate?-1:1;
    if(aDue!==bDue)return (aDue||'9999-12-31').localeCompare(bDue||'9999-12-31');
    return (b.createdAt||'').localeCompare(a.createdAt||'')||a.id.localeCompare(b.id);
  });
  const pages=Math.max(1,Math.ceil(matching.length/planView.pageSize));planView.page=Math.min(Math.max(1,planView.page),pages);
  const start=(planView.page-1)*planView.pageSize;
  $('planCount').textContent=`符合條件 ${matching.length} 筆｜第 ${planView.page} / ${pages} 頁`;
  for(const p of matching.slice(start,start+planView.pageSize)){
    const due=planNextDue(p,inst),remaining=planOutstanding(p,inst),late=due!==null&&due<t;
    const button=element('button',{type:'button',class:'plan-row', 'aria-label':`查看 ${p.name} 的分期明細`});
    const title=element('div',{class:'plan-row-head'},[element('strong',{text:p.name}),element('span',{class:late?'plan-badge overdue':'plan-badge',text:late?'逾期':remaining>0?'進行中':'已結清'})]);
    const values=element('div',{class:'plan-row-values'},[element('span',{text:`剩餘待繳 ${money(remaining/100)}`}),element('span',{text:`最近到期 ${due||'無待繳期數'}`})]);
    button.append(title,values);button.addEventListener('click',()=>{planView.selectedId=p.id;renderPlanBrowser(plans,inst,ip);$('plans').scrollIntoView({block:'start'})});
    $('planList').append(button);
  }
  if(!matching.length)$('planList').append(textNode('p','找不到符合條件的分期計畫。'));
  const pager=$('planPagination');pager.replaceChildren();
  if(pages>1){for(const [label,target,disabled] of [['上一頁',planView.page-1,planView.page===1],['下一頁',planView.page+1,planView.page===pages]]){const b=element('button',{type:'button',text:label});b.disabled=disabled;b.addEventListener('click',()=>{planView.page=target;renderPlanBrowser(plans,inst,ip)});pager.append(b)}}
}
async function render(){const [plans,inst,tax,periods,ip,tp]=await Promise.all(['installmentPlans','installments','taxBills','cardPeriods','installmentPayments','taxPayments'].map(all));const totalDue=inst.filter(x=>x.status!=='cancelled').reduce((s,x)=>s+Math.max(0,x.amountCents-x.paidCents),0)+tax.reduce((s,x)=>s+(x.amountCents===null||x.status==='exempt'?0:Math.max(0,x.amountCents-x.paidCents)),0);const paid=[...ip,...tp];$('dueAmount').textContent=money(totalDue/100);$('netPaid').textContent=money(paid.reduce((s,p)=>s+p.amountCents,0)/100);$('unreconciled').textContent=money(paid.filter(p=>!p.reconciled).reduce((s,p)=>s+p.amountCents,0)/100);$('unknownTax').textContent=`${tax.filter(t=>t.amountCents===null&&t.status!=='exempt').length} 筆`;
for(const id of ['planList','cardList','installmentDetails','taxDetails','upcoming'])$(id).replaceChildren();const t=today(),cutoff=new Date(t+'T00:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()+7);const near=cutoff.toISOString().slice(0,10);const upcoming=[];
renderPlanBrowser(plans,inst,ip);
for(const p of plans){for(const x of inst.filter(i=>i.planId===p.id)){const remaining=x.amountCents-x.paidCents;if(remaining>0&&Math.round(remaining/100)>0&&x.status!=='cancelled'&&x.due<=near)upcoming.push({date:x.due,title:`${p.name} 第 ${x.number} 期（分期）`,amount:remaining})}}
for(const bill of tax.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){const card=element('article',{class:'item'},[element('strong',{text:`${bill.year} 年｜${bill.name}`}),textNode('small',`截止日 ${bill.due}｜${bill.amountCents===null?'待確認稅額':`剩餘 ${money(Math.max(0,bill.amountCents-bill.paidCents)/100)}`}`)]);if(bill.amountCents===null){const b=element('button',{type:'button',text:'填寫稅額'});b.addEventListener('click',()=>setTaxAmount(bill.id));card.append(b)}else if(bill.status!=='exempt'&&bill.amountCents>bill.paidCents)card.append(actionForm('tax',bill.id,bill.amountCents-bill.paidCents));for(const pay of tp.filter(y=>y.taxBillId===bill.id)){const line=element('div',{class:'payment-line'},[textNode('small',`付款 ${pay.paidAt}｜${money(pay.amountCents/100)}｜${pay.reconciled?'已核對':'待核對'}`)]);if(!pay.reconciled){line.append(reconciliationButton('tax',pay),editPaymentButton('tax',pay))}card.append(line)}$('taxDetails').append(card);if(bill.amountCents===null&&bill.due<t)upcoming.push({date:bill.due,title:`${bill.name}（待確認稅額）`,amount:null});else if(bill.amountCents!==null&&bill.amountCents>bill.paidCents&&Math.round((bill.amountCents-bill.paidCents)/100)>0&&bill.due<=near&&bill.status!=='exempt')upcoming.push({date:bill.due,title:`${bill.name}（稅務）`,amount:bill.amountCents-bill.paidCents})}
await renderCardSection(periods);for(const u of upcoming.sort((a,b)=>a.date.localeCompare(b.date))){const line=element('div',{class:'upcoming-row'});line.append(textNode('span',u.title,'upcoming-name'));const right=element('div',{class:'upcoming-right'});right.append(textNode('time',u.date,'upcoming-date'),textNode('span',u.amount===null?'金額未確定':money(u.amount/100),'upcoming-amount'),textNode('span',u.date<t?'已逾期':'即將到期',u.date<t?'chip upcoming-status overdue':'chip upcoming-status'));line.append(right);$('upcoming').append(line)}if(!upcoming.length)$('upcoming').append(textNode('p','目前沒有 7 天內到期或已逾期的項目。'));await renderHistory(plans,inst,tax,ip,tp);await renderTaxTemplates()}

// Stage 2.2. All changes are confined to payment-tax-v22; no automatic data migration.
function editPaymentButton(kind,payment){const b=element('button',{type:'button',text:'修改'});b.addEventListener('click',()=>editPayment(kind,payment.id));return b}
async function editPayment(kind,id){
 const isInst=kind==='installment',payStore=isInst?'installmentPayments':'taxPayments',parentStore=isInst?'installments':'taxBills';
 const current=(await all(payStore)).find(x=>x.id===id);if(!current||current.reconciled){message('這筆付款已核對，不能直接修改');return}
 const amount=prompt('修改付款金額（整數元）',String(Math.round(current.amountCents/100)));if(amount===null)return;
 const date=prompt('修改付款日期（YYYY-MM-DD）',current.paidAt);if(date===null)return;
 const note=prompt('修改備註',current.note||'');if(note===null)return;
 if(!validMoney(amount)||!safeDate(date)){message('請輸入有效的整數金額及日期');return}
 const next=cents(amount);try{
 await txWrite([payStore,parentStore],tx=>{
  const r=tx.objectStore(payStore).get(id);r.onsuccess=()=>{const pay=r.result;if(!pay||pay.reconciled){tx.abort();return}
   const parentId=pay[isInst?'installmentId':'taxBillId'];const q=tx.objectStore(parentStore).get(parentId);
   q.onsuccess=()=>{const parent=q.result;if(!parent||parent.status==='cancelled'||parent.status==='exempt'||parent.amountCents===null){tx.abort();return}
    const total=parent.paidCents-pay.amountCents+next;if(next<=0||total>parent.amountCents||total<0){tx.abort();return}
    parent.paidCents=total;if(!isInst)parent.status=total>=parent.amountCents?'paid':'unpaid';
    pay.amountCents=next;pay.paidAt=date;pay.note=note.trim();tx.objectStore(payStore).put(pay);tx.objectStore(parentStore).put(parent);
    audit(tx,'update',payStore,pay.id,pay);audit(tx,'update',parentStore,parent.id,parent)};q.onerror=()=>tx.abort()};r.onerror=()=>tx.abort()});await render();message('繳款資料已修改，相關餘額已更新')
 }catch{message('修改失敗，請確認付款仍未核對，且金額沒有超過應繳總額。原資料未變更。')}
}
function templateDue(year,month,day){const d=new Date(Date.UTC(year,month,0)).getUTCDate();return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,d)).padStart(2,'0')}`}
async function createTaxTemplate(e){e.preventDefault();const v=formData(e.currentTarget),month=Number(v.month),day=Number(v.day);if(!v.name.trim()||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31){message('請輸入有效的稅務名稱、月份及日期');return}
 const rec={id:uid(),name:v.name.trim(),month,day,active:true,createdAt:new Date().toISOString()};await saveMany([{store:'taxTemplates',value:rec}]);e.currentTarget.reset();await render();message('年度稅務設定已建立，請選擇年度產生稅單')}
async function renderTaxTemplates(){const templates=await all('taxTemplates');const root=$('taxTemplateList');root.replaceChildren();for(const t of templates)addItem(root,t.name,[`每年 ${t.month} 月 ${t.day} 日｜${t.active===false?'停用':'啟用'}`]);if(!templates.length)root.append(textNode('p','尚未建立年度稅務設定。','hint'))}
async function generateYearTaxes(){const year=Number($('generateTaxYear').value);if(!Number.isInteger(year)||year<1900||year>2200){message('請輸入有效年度');return}const templates=(await all('taxTemplates')).filter(t=>t.active!==false);if(!templates.length){message('請先新增年度稅務設定');return}if(!confirm(`依 ${templates.length} 筆設定檢查並建立 ${year} 年稅單？既有稅單不會覆寫。`))return;
 let count=0;try{await txWrite(['taxBills'],tx=>{const store=tx.objectStore('taxBills');const req=store.getAll();req.onsuccess=()=>{const existing=req.result;for(const t of templates){if(existing.some(b=>b.sourceTemplateId===t.id&&b.year===year))continue;const b={id:uid(),sourceTemplateId:t.id,year,name:t.name,due:templateDue(year,t.month,t.day),amountCents:null,paidCents:0,status:'amount-pending',createdAt:new Date().toISOString()};store.put(b);audit(tx,'create','taxBills',b.id,b);existing.push(b);count++}};req.onerror=()=>tx.abort()});await render();message(`年度稅單檢查完成，新增 ${count} 筆，原有資料保留。`)}catch{message('年度稅單建立失敗，資料未變更')}}
async function createCardTransaction(e){e.preventDefault();const f=e.currentTarget,v=formData(f);if(!validMoney(v.amount)||!safeDate(v.spentAt)){message('請輸入有效消費日期及金額');return}const amount=cents(v.amount);
 try{await txWrite(['cardPeriods','cardTransactions'],tx=>{const r=tx.objectStore('cardPeriods').get(v.periodId);r.onsuccess=()=>{const p=r.result;if(!p||v.spentAt<p.start||v.spentAt>p.end){tx.abort();return}const t={id:uid(),cardId:p.cardId,periodId:p.id,spentAt:v.spentAt,amountCents:amount,note:(v.note||'').trim(),createdAt:new Date().toISOString()};tx.objectStore('cardTransactions').put(t);audit(tx,'create','cardTransactions',t.id,t)};r.onerror=()=>tx.abort()});f.reset();await render();message('信用卡消費已記錄') }catch{message('消費日期必須在選擇的期間內，原資料未變更')}}
// 信用卡消費修改：只更新原交易；不建立修改前快照或 audit 紀錄。
async function updateCardTransaction(transactionId,period,form){
 const v=formData(form);
 if(!safeDate(v.spentAt)||!validMoney(v.amount)||!/^\d+$/.test(String(v.amount))){message('請輸入有效日期與大於 0 的整數金額');return}
 if(v.spentAt<period.start||v.spentAt>period.end){message(`消費日期必須介於 ${period.start} 至 ${period.end}，原資料未變更`);return}
 const amount=cents(v.amount);
 try{
  await txWrite(['cardTransactions'],tx=>{
   const store=tx.objectStore('cardTransactions'),req=store.get(transactionId);
   req.onsuccess=()=>{
    const current=req.result;
    if(!current||current.periodId!==period.id){tx.abort();return}
    current.spentAt=v.spentAt;current.amountCents=amount;current.note=(v.note||'').trim();
    store.put(current);
   };
   req.onerror=()=>tx.abort();
  });
  await render();message('信用卡消費已修改，最低消費金額已重新計算');
 }catch{message('信用卡消費修改失敗，原資料未變更')}
}
function cardTransactionItem(t,p){
 const card=element('article',{class:'item'});
 const info=element('div');
 info.append(textNode('strong',`${p.cardName}｜${t.spentAt}｜消費`),textNode('small',`${money(t.amountCents/100)}${t.note?'｜'+t.note:''}`));
 const button=element('button',{type:'button',text:'修改'});
 button.addEventListener('click',()=>{
  button.hidden=true;
  const form=element('form',{class:'card-edit-form'});
  const dateLabel=element('label',{text:'消費日期'}),date=element('input',{type:'date',name:'spentAt',required:'required',min:p.start,max:p.end});date.value=t.spentAt;dateLabel.append(date);
  const amountLabel=element('label',{text:'金額（整數元）'}),amount=element('input',{type:'number',name:'amount',min:'1',step:'1',required:'required'});amount.value=String(Math.round(t.amountCents/100));amountLabel.append(amount);
  const noteLabel=element('label',{text:'備註'}),note=element('input',{name:'note',maxlength:'120'});note.value=t.note||'';noteLabel.append(note);
  const save=element('button',{type:'submit',text:'儲存修改',class:'primary'}),cancel=element('button',{type:'button',text:'取消'});
  cancel.addEventListener('click',()=>{form.remove();button.hidden=false});
  form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;await updateCardTransaction(t.id,p,form);save.disabled=false});
  form.append(dateLabel,amountLabel,noteLabel,save,cancel);card.append(form);
 });
 card.append(info,button);return card;
}
async function renderCardSection(periods){
 const transactions=await all('cardTransactions'),refunds=await all('cardRefunds'),select=$('cardPeriodSelect');
 const prior=select.value;select.replaceChildren();$('cardTransactionList').replaceChildren();
 for(const p of [...periods].sort((a,b)=>b.start.localeCompare(a.start))){
  const o=element('option',{value:p.id,text:`${p.cardName}｜${p.start}～${p.end}`});select.append(o);
  const txs=transactions.filter(t=>t.periodId===p.id);
  const sum=txs.reduce((n,t)=>n+t.amountCents,0)-refunds.filter(r=>r.periodId===p.id).reduce((n,r)=>n+r.amountCents,0);
  const left=Math.max(0,p.thresholdCents-sum),status=sum>=p.thresholdCents?'已達標':p.end<today()?'逾期未達標':'未達標';
  addItem($('cardList'),`${p.cardName}｜${p.start}～${p.end}`,[`最低消費 ${money(p.thresholdCents/100)}｜淨消費 ${money(sum/100)}`,`尚差 ${money(left/100)}｜${status}`]);
  for(const t of txs.sort((a,b)=>b.spentAt.localeCompare(a.spentAt)))$('cardTransactionList').append(cardTransactionItem(t,p));
 }
 if([...select.options].some(o=>o.value===prior))select.value=prior;
 if(!periods.length)$('cardTransactionList').append(textNode('p','請先建立信用卡消費期間。','hint'));
}

let historyRows=[];
async function renderHistory(plans,inst,tax,ip,tp){const cards=await all('cards'),periods=await all('cardPeriods'),txs=await all('cardTransactions'),refunds=await all('cardRefunds');const planById=new Map(plans.map(x=>[x.id,x])),instById=new Map(inst.map(x=>[x.id,x])),billById=new Map(tax.map(x=>[x.id,x])),cardById=new Map(cards.map(x=>[x.id,x])),periodById=new Map(periods.map(x=>[x.id,x]));const rows=[];
 for(const p of ip){const i=instById.get(p.installmentId),plan=i&&planById.get(i.planId);rows.push({category:'installment',date:p.paidAt,name:`${plan?.name||'分期'} 第 ${i?.number||'?'} 期`,type:'付款',amount:p.amountCents,note:p.note||'',status:p.reconciled?'已核對':'待核對',id:p.id})}
 for(const p of tp){const b=billById.get(p.taxBillId);rows.push({category:'tax',date:p.paidAt,name:`${b?.year||''} 年｜${b?.name||'稅務'}`,type:'付款',amount:p.amountCents,note:p.note||'',status:p.reconciled?'已核對':'待核對',id:p.id})}
 for(const t of txs){const p=periodById.get(t.periodId);rows.push({category:'card',date:t.spentAt||t.date||'',name:cardById.get(t.cardId)?.name||p?.cardName||'信用卡',type:'消費',amount:t.amountCents||0,note:t.note||'',status:'已記錄',id:t.id})}
 for(const r of refunds){const original=txs.find(t=>t.id===r.transactionId||t.id===r.cardTransactionId);rows.push({category:'card',date:r.refundedAt||r.date||'',name:cardById.get(original?.cardId)?.name||'信用卡',type:'退款',amount:r.amountCents||0,note:r.note||'',status:'已記錄',id:r.id})}
 const cat=$('historyCategory').value,q=$('historySearch').value.trim().toLocaleLowerCase('zh-TW');historyRows=rows.filter(r=>(cat==='all'||cat===r.category)&&[r.date,r.name,r.note,r.type,r.status].join(' ').toLocaleLowerCase('zh-TW').includes(q)).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));const root=$('historyList');root.replaceChildren();for(const r of historyRows){const line=element('article',{class:'history-row'}),left=element('div');left.append(element('strong',{text:`${r.date}｜${r.name}｜${r.type}`}),textNode('small',`${r.status}${r.note?'｜'+r.note:''}`));line.append(left,element('strong',{class:'history-money',text:money(r.amount/100)}));root.append(line)}if(!historyRows.length)root.append(textNode('p','沒有符合條件的交易紀錄。','hint'))}
function exportHistoryCsv(){const lines=[['日期','類別','名稱','交易類型','金額(元)','狀態','備註'],...historyRows.map(r=>[r.date,r.category,r.name,r.type,String(Math.round(r.amount/100)),r.status,r.note])];const csv='\ufeff'+lines.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='V2.2-交易歷史.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function printHistory(){const rows=historyRows.map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.type)}</td><td>${money(r.amount/100)}</td><td>${escapeHtml(r.status)}</td></tr>`).join('');const w=window.open('','_blank');if(!w){message('瀏覽器封鎖了列印視窗，請允許彈出視窗');return}w.document.write(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>V2.2 交易歷史</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:9px;text-align:left}</style><h2>付款與消費歷史</h2><table><tr><th>日期</th><th>名稱</th><th>類型</th><th>金額</th><th>狀態</th></tr>${rows}</table></html>`);w.document.close();w.focus();w.print()}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

// HIST-01 / INST-02 / CARD-03: atomic, audit-free state changes.
const isConfirmed=x=>x.reconciled===true;
const twDate=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`};
function shiftDay(date,n){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function rowV22(root,values,buttons=[]){const r=element('div',{class:'data-row'});for(const v of values)r.append(element('span',{text:String(v)}));for(const b of buttons)r.append(b);root.append(r);return r}
function btnV22(label,callback){const b=element('button',{type:'button',text:label});if(label==='刪除'||label.startsWith('刪除'))b.classList.add('delete-action-v228');b.addEventListener('click',callback);return b}
function txAtomicV22(names,handler){return new Promise((resolve,reject)=>{const tx=db.transaction([...new Set(names)],'readwrite'),data={},stores=[...new Set(names)];let remaining=stores.length,err=null;
 for(const name of stores){const req=tx.objectStore(name).getAll();req.onsuccess=()=>{data[name]=req.result;if(--remaining===0){try{handler(data,{put:(s,v)=>tx.objectStore(s).put(v),del:(s,id)=>tx.objectStore(s).delete(id)})}catch(e){err=e;tx.abort()}}};req.onerror=()=>{err=req.error;tx.abort()}}
 tx.oncomplete=()=>resolve();tx.onerror=()=>reject(err||tx.error||Error('資料庫交易失敗'));tx.onabort=()=>reject(err||tx.error||Error('操作取消，資料未變更'))})}
function assertV22(test,msg){if(!test)throw Error(msg)}
function parentInfoV22(kind,pay,data){const inst=kind==='installment',parent=data[inst?'installments':'taxBills'].find(x=>x.id===pay[inst?'installmentId':'taxBillId']);assertV22(parent,'找不到原始應繳資料');if(inst){const plan=data.installmentPlans.find(x=>x.id===parent.planId);assertV22(plan&&!plan.archived,'分期已歸檔，請先恢復');assertV22(parent.status!=='cancelled','期數已取消')}else assertV22(!parent.archived&&parent.status!=='exempt'&&parent.amountCents!==null,'稅單已歸檔或無法操作，請先還原');return parent}
function recalcParentV22(kind,parent,data,put){const inst=kind==='installment',store=inst?'installmentPayments':'taxPayments',key=inst?'installmentId':'taxBillId';parent.paidCents=data[store].filter(p=>p[key]===parent.id&&isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0);if(!inst)parent.status=parent.paidCents>=parent.amountCents?'paid':'unpaid';put(inst?'installments':'taxBills',parent)}
function paymentCapacityV22(kind,parent,data){const store=kind==='installment'?'installmentPayments':'taxPayments',key=kind==='installment'?'installmentId':'taxBillId';return data[store].filter(p=>p[key]===parent.id).reduce((s,p)=>s+p.amountCents,0)}
function periodForV22(periods,cardId,date){const found=periods.filter(p=>p.cardId===cardId&&p.start<=date&&date<=p.end);assertV22(found.length===1,found.length?'消費期間重疊，請先修正期間':'找不到對應消費期間，請先建立期間');return found[0]}
function refundOriginalV22(refund,txs){return txs.find(t=>t.id===(refund.transactionId||refund.cardTransactionId))}
function refundTotalV22(tid,refunds,omitId){return refunds.filter(r=>(r.transactionId||r.cardTransactionId)===tid&&r.id!==omitId).reduce((s,r)=>s+r.amountCents,0)}
function cardDateV22(x,refund=false){return refund?(x.refundedAt||x.date):(x.spentAt||x.date)}
async function performV22(names,handler,success){try{await txAtomicV22(names,handler);await render();message(success)}catch(e){message(`操作失敗：${e.message}。原資料未變更。`)}}
recordPayment=async function(e){e.preventDefault();const f=e.currentTarget,v=formData(f),kind=f.dataset.kind,inst=kind==='installment',store=inst?'installmentPayments':'taxPayments',key=inst?'installmentId':'taxBillId';if(!validMoney(v.amount)||!safeDate(v.paidAt))return message('請輸入有效日期及金額');const amt=cents(v.amount);
 await performV22([store,inst?'installments':'taxBills','installmentPlans'],(d,ops)=>{const parent=d[inst?'installments':'taxBills'].find(x=>x.id===f.dataset.parent);assertV22(parent,'找不到期數或稅單');parentInfoV22(kind,{[key]:parent.id},d);assertV22(paymentCapacityV22(kind,parent,d)+amt<=parent.amountCents,'付款合計超過應繳金額');const p={id:uid(),[key]:parent.id,amountCents:amt,paidAt:v.paidAt,note:(v.note||'').trim(),reconciled:false,createdAt:new Date().toISOString()};ops.put(store,p)},'付款已記錄，請到付款紀錄核對');f.reset()};
reconcilePayment=async function(kind,id){if(!confirm('確定核對這筆付款？'))return;const inst=kind==='installment',store=inst?'installmentPayments':'taxPayments';await performV22([store,inst?'installments':'taxBills','installmentPlans'],(d,ops)=>{const p=d[store].find(x=>x.id===id);assertV22(p&&!isConfirmed(p),'這筆付款已核對或不存在');const parent=parentInfoV22(kind,p,d);p.reconciled=true;p.reconciledAt=new Date().toISOString();ops.put(store,p);recalcParentV22(kind,parent,d,ops.put)},'付款已核對')};
editPayment=async function(kind,id){const store=kind==='installment'?'installmentPayments':'taxPayments',p=(await all(store)).find(x=>x.id===id);if(!p||isConfirmed(p))return message('只有待核對付款可以修改');const a=prompt('修改金額（整數元）',String(p.amountCents/100));if(a===null)return;const date=prompt('修改付款日期（YYYY-MM-DD）',p.paidAt);if(date===null)return;const note=prompt('修改備註',p.note||'');if(note===null)return;if(!validMoney(a)||!safeDate(date))return message('日期或金額無效');await performV22([store,kind==='installment'?'installments':'taxBills','installmentPlans'],(d,ops)=>{const cur=d[store].find(x=>x.id===id);assertV22(cur&&!isConfirmed(cur),'付款已核對或不存在');const parent=parentInfoV22(kind,cur,d);assertV22(paymentCapacityV22(kind,parent,d)-cur.amountCents+cents(a)<=parent.amountCents,'付款合計超額');cur.amountCents=cents(a);cur.paidAt=date;cur.note=note.trim();ops.put(store,cur)},'付款已修改')};
async function deletePaymentV22(kind,id){if(!confirm('確定刪除這筆待核對付款？刪除後無法在歷史查詢。'))return;const store=kind==='installment'?'installmentPayments':'taxPayments';await performV22([store,kind==='installment'?'installments':'taxBills','installmentPlans'],(d,ops)=>{const p=d[store].find(x=>x.id===id);assertV22(p&&!isConfirmed(p),'僅能刪除待核對付款');parentInfoV22(kind,p,d);ops.del(store,id)},'付款已刪除')}
async function reverseV22(kind,id){if(!confirm('確定將這筆已核對交易還原為待核對？'))return;const store=kind==='installment'?'installmentPayments':kind==='tax'?'taxPayments':kind==='purchase'?'cardTransactions':'cardRefunds';const names=kind==='installment'?[store,'installments','installmentPlans']:kind==='tax'?[store,'taxBills','installmentPlans']: [store];await performV22(names,(d,ops)=>{const p=d[store].find(x=>x.id===id);assertV22(p&&isConfirmed(p),'交易不存在或已是待核對');let parent;if(kind==='installment'||kind==='tax')parent=parentInfoV22(kind,p,d);p.reconciled=false;delete p.reconciledAt;ops.put(store,p);if(parent)recalcParentV22(kind,parent,d,ops.put)},'還原成功')}
async function archiveV22(id,restore){if(!confirm(restore?'確定恢復這筆分期？':'確定歸檔這筆已結清分期？'))return;await performV22(['installmentPlans','installments','installmentPayments'],(d,ops)=>{const p=d.installmentPlans.find(x=>x.id===id);assertV22(p,'找不到分期');assertV22(!!p.archived===!!restore,'歸檔狀態已改變');if(!restore){const periods=d.installments.filter(x=>x.planId===id&&x.status!=='cancelled');assertV22(periods.length>0,'沒有可歸檔期數');for(const i of periods){const pays=d.installmentPayments.filter(x=>x.installmentId===i.id);assertV22(!pays.some(x=>!isConfirmed(x)),'仍有待核對付款');assertV22(pays.reduce((s,x)=>s+x.amountCents,0)===i.amountCents,'分期尚未完全繳清')}}p.archived=!restore;ops.put('installmentPlans',p)},restore?'分期已恢復，付款金額不變':'分期已歸檔，資料維持唯讀')}
function planDueV22(plan,inst,ip){return inst.filter(i=>i.planId===plan.id&&i.status!=='cancelled').reduce((s,i)=>s+Math.max(0,i.amountCents-ip.filter(p=>p.installmentId===i.id&&isConfirmed(p)).reduce((n,p)=>n+p.amountCents,0)),0)}
function planNextV22(plan,inst,ip){return inst.filter(i=>i.planId===plan.id&&i.status!=='cancelled'&&i.amountCents>ip.filter(p=>p.installmentId===i.id&&isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0)).map(i=>i.due).sort()[0]||null}
function filterPlanV22(p,inst,ip){const closed=planDueV22(p,inst,ip)===0;return !p.archived&&(planView.filter==='all'||(planView.filter==='closed'&&closed)||(planView.filter==='active'&&!closed))}
renderPlanBrowser=function(plans,inst,ip){const selected=plans.find(p=>p.id===planView.selectedId),detail=!!selected;$('planBrowser').hidden=detail;$('planDetailView').hidden=!detail;$('planForm').hidden=detail;$('planList').replaceChildren();$('installmentDetails').replaceChildren();$('planDetailHeader').replaceChildren();if(detail){const p=selected,remaining=planDueV22(p,inst,ip);$('planDetailHeader').append(element('h3',{text:p.name}),textNode('p',`總額 ${money(p.totalCents/100)}｜剩餘待繳 ${money(remaining/100)}｜${remaining?'進行中':'已結清'}｜${p.archived?'已歸檔':'未歸檔'}`));$('planDetailHeader').append(btnV22(p.archived?'恢復分期':'歸檔分期',()=>archiveV22(p.id,!!p.archived)));for(const i of inst.filter(x=>x.planId===p.id).sort((a,b)=>a.number-b.number)){const payments=ip.filter(x=>x.installmentId===i.id),paid=payments.filter(isConfirmed).reduce((s,x)=>s+x.amountCents,0),left=Math.max(0,i.amountCents-paid);const line=rowV22($('installmentDetails'),[`第 ${i.number} 期`,`到期 ${i.due}`,`應繳 ${money(i.amountCents/100)}`,`已核對 ${money(paid/100)}`,`剩餘待繳 ${money(left/100)}`]);const available=Math.max(0,i.amountCents-payments.reduce((s,x)=>s+x.amountCents,0));if(!p.archived&&available>0){const entry=element('div',{class:'installment-payment-entry'});entry.append(textNode('strong','記錄付款'),actionForm('installment',i.id,available));$('installmentDetails').append(entry)}for(const pay of payments){const actions=pay.earlySettlementGroup?[]:!p.archived&&!isConfirmed(pay)?[btnV22('核對',()=>reconcilePayment('installment',pay.id)),btnV22('修改',()=>editPayment('installment',pay.id)),btnV22('刪除',()=>deletePaymentV22('installment',pay.id))]:[];rowV22($('installmentDetails'),['付款',pay.paidAt,money(pay.amountCents/100),isConfirmed(pay)?'已核對':'待核對',pay.note||''],actions)}}return}
 const filtered=plans.filter(p=>filterPlanV22(p,inst,ip)&&p.name.toLowerCase().includes(planView.search.toLowerCase())).sort((a,b)=>(planNextV22(a,inst,ip)||'9999').localeCompare(planNextV22(b,inst,ip)||'9999'));const pages=Math.max(1,Math.ceil(filtered.length/planView.pageSize));planView.page=Math.min(planView.page,pages);$('planCount').textContent=`符合條件 ${filtered.length} 筆｜第 ${planView.page} / ${pages} 頁`;for(const p of filtered.slice((planView.page-1)*planView.pageSize,planView.page*planView.pageSize))rowV22($('planList'),[p.name,`原始金額 ${money(p.totalCents/100)}`,`剩餘待繳 ${money(planDueV22(p,inst,ip)/100)}`,planDueV22(p,inst,ip)?'進行中':'已結清'],[btnV22('查看',()=>{planView.selectedId=p.id;render();$('plans').scrollIntoView({block:'start'})})]);$('planPagination').replaceChildren();if(pages>1){if(planView.page>1)$('planPagination').append(btnV22('上一頁',()=>{planView.page--;render()}));if(planView.page<pages)$('planPagination').append(btnV22('下一頁',()=>{planView.page++;render()}))}}
async function updateCardV22(type,id,values){const refund=type==='refund',store=refund?'cardRefunds':'cardTransactions',date=refund?values.refundedAt:values.spentAt;assertV22(safeDate(date)&&validMoney(values.amount)&&/^\d+$/.test(String(values.amount)),'請輸入有效日期與整數金額');await performV22([store,'cardPeriods','cardTransactions','cardRefunds'],(d,ops)=>{const current=d[store].find(x=>x.id===id);assertV22(current&&!isConfirmed(current),'只能修改待核對交易');const original=refund?refundOriginalV22(current,d.cardTransactions):current;assertV22(original,'找不到原始消費');const period=periodForV22(d.cardPeriods,original.cardId,date),amt=cents(values.amount);if(refund)assertV22(refundTotalV22(original.id,d.cardRefunds,id)+amt<=original.amountCents,'關聯退款合計超過原始消費');else assertV22(refundTotalV22(original.id,d.cardRefunds)<=amt,'原始消費金額低於現存退款合計');current.periodId=period.id;current.cardId=original.cardId;current[refund?'refundedAt':'spentAt']=date;current.amountCents=amt;current.note=(values.note||'').trim();ops.put(store,current)},'信用卡交易已修改')}
async function deleteCardV22(type,id){if(!confirm('確定刪除這筆待核對交易？'))return;const refund=type==='refund',store=refund?'cardRefunds':'cardTransactions';await performV22([store,'cardRefunds'],(d,ops)=>{const p=d[store].find(x=>x.id===id);assertV22(p&&!isConfirmed(p),'只能刪除待核對交易');if(!refund)assertV22(!d.cardRefunds.some(r=>(r.transactionId||r.cardTransactionId)===id),'請先刪除所有關聯退款');ops.del(store,id)},'交易已刪除')}
async function reconcileCardV22(type,id){if(!confirm('確定核對這筆信用卡交易？'))return;const store=type==='refund'?'cardRefunds':'cardTransactions';await performV22([store],(d,ops)=>{const p=d[store].find(x=>x.id===id);assertV22(p&&!isConfirmed(p),'交易不存在或已核對');p.reconciled=true;p.reconciledAt=new Date().toISOString();ops.put(store,p)},'信用卡交易已核對')}
createCardTransaction=async function(e){e.preventDefault();const f=e.currentTarget,v=formData(f);if(!validMoney(v.amount)||!safeDate(v.spentAt))return message('日期或金額無效');await performV22(['cardPeriods','cardTransactions'],(d,ops)=>{const selected=d.cardPeriods.find(x=>x.id===v.periodId);assertV22(selected,'消費期間不存在');const p=periodForV22(d.cardPeriods,selected.cardId,v.spentAt);assertV22(p.id===selected.id,'請選擇日期對應的期間');ops.put('cardTransactions',{id:uid(),cardId:p.cardId,periodId:p.id,spentAt:v.spentAt,amountCents:cents(v.amount),note:(v.note||'').trim(),reconciled:false,createdAt:new Date().toISOString()})},'信用卡消費已記錄，請核對');f.reset()};
async function createRefundV22(e){e.preventDefault();const f=e.currentTarget,v=formData(f);if(!validMoney(v.amount)||!safeDate(v.refundedAt))return message('日期或金額無效');await performV22(['cardRefunds','cardTransactions','cardPeriods'],(d,ops)=>{const t=d.cardTransactions.find(x=>x.id===v.transactionId);assertV22(t,'找不到原始消費');const p=periodForV22(d.cardPeriods,t.cardId,v.refundedAt),amount=cents(v.amount);assertV22(refundTotalV22(t.id,d.cardRefunds)+amount<=t.amountCents,'退款合計超過原始消費');ops.put('cardRefunds',{id:uid(),transactionId:t.id,cardId:t.cardId,periodId:p.id,refundedAt:v.refundedAt,amountCents:amount,note:(v.note||'').trim(),reconciled:false,createdAt:new Date().toISOString()})},'退款已記錄，請核對');f.reset()}
function cardEditorV22(root,type,t){const refund=type==='refund',form=element('form',{class:'inline-form'}),date=formField(refund?'退款日期':'消費日期',refund?'refundedAt':'spentAt','date',{required:''}),amount=formField('金額','amount','number',{min:'1',step:'1',required:''}),note=formField('備註','note','text',{maxlength:'120'});date.querySelector('input').value=cardDateV22(t,refund);amount.querySelector('input').value=String(t.amountCents/100);note.querySelector('input').value=t.note||'';form.append(date,amount,note);const save=element('button',{type:'submit',text:'儲存'}),cancel=btnV22('取消',()=>form.remove());form.append(save,cancel);form.addEventListener('submit',async e=>{e.preventDefault();await updateCardV22(type,t.id,formData(form))});root.append(form)}
function cardNetV22(period,txs,refunds){return txs.filter(t=>t.periodId===period.id&&isConfirmed(t)).reduce((s,t)=>s+t.amountCents,0)-refunds.filter(r=>r.periodId===period.id&&isConfirmed(r)).reduce((s,r)=>s+r.amountCents,0)}
async function renderCardSection(periods){const [txs,refunds,cards]=await Promise.all(['cardTransactions','cardRefunds','cards'].map(all)),sel=$('cardPeriodSelect'),refsel=$('refundTransactionSelect'),prior=sel.value;sel.replaceChildren();refsel.replaceChildren();const existing=$('existingCardSelect'),priorCard=existing.value;existing.replaceChildren();for(const c of cards)existing.append(element('option',{value:c.id,text:c.name}));if([...existing.options].some(o=>o.value===priorCard))existing.value=priorCard;$('cardList').replaceChildren();$('cardTransactionList').replaceChildren();$('cardReminders').replaceChildren();const now=twDate(),reminders=[];
 for(const p of [...periods].sort((a,b)=>b.start.localeCompare(a.start))){sel.append(element('option',{value:p.id,text:`${p.cardName}｜${p.start}～${p.end}`}));const net=cardNetV22(p,txs,refunds),pending=refunds.filter(r=>r.periodId===p.id&&!isConfirmed(r)),threshold=p.thresholdCents||0;rowV22($('cardList'),[p.cardName,`${p.start}～${p.end}`,`最低 ${money(threshold/100)}`,`已確認淨消費 ${money(net/100)}`,`尚差 ${money(Math.max(0,threshold-net)/100)}`]);const days=Number.isInteger(p.remindDays)?p.remindDays:7;if(now<=shiftDay(p.end,5)){const under=net<threshold&&(now>=shiftDay(p.end,-days)),pendingShow=pending.length>0;if(under||pendingShow){reminders.push({p,under,pending,net,threshold})}}}
 for(const t of [...txs].sort((a,b)=>cardDateV22(b).localeCompare(cardDateV22(a)))){const p=periods.find(x=>x.id===t.periodId);refsel.append(element('option',{value:t.id,text:`${p?.cardName||'信用卡'}｜${cardDateV22(t)}｜${money(t.amountCents/100)}`}));const actions=isConfirmed(t)?[]:[btnV22('核對',()=>reconcileCardV22('purchase',t.id)),btnV22('修改',()=>cardEditorV22(row,'purchase',t)),btnV22('刪除',()=>deleteCardV22('purchase',t.id))];const row=rowV22($('cardTransactionList'),['消費',p?.cardName||'',cardDateV22(t),money(t.amountCents/100),isConfirmed(t)?'已核對':'待核對',t.note||''],actions)}
 for(const r of [...refunds].sort((a,b)=>cardDateV22(b,true).localeCompare(cardDateV22(a,true)))){const p=periods.find(x=>x.id===r.periodId),original=refundOriginalV22(r,txs);const actions=isConfirmed(r)?[]:[btnV22('核對',()=>reconcileCardV22('refund',r.id)),btnV22('修改',()=>cardEditorV22(row,'refund',r)),btnV22('刪除',()=>deleteCardV22('refund',r.id))];const row=rowV22($('cardTransactionList'),['退款',p?.cardName||'',cardDateV22(r,true),money(r.amountCents/100),isConfirmed(r)?'已核對':'待核對',`原消費 ${original?money(original.amountCents/100):'找不到'}`,r.note||''],actions)}
 if([...sel.options].some(o=>o.value===prior))sel.value=prior;
 for(const c of []){const ps=periods.filter(p=>p.cardId===c.id);if(!ps.length)continue;const current=Number.isInteger(c.remindDays)?c.remindDays:7;const row=rowV22($('cardList'),[c.name,'提前提醒天數']);const input=element('input',{type:'number',min:'0',max:'365',step:'1',value:String(current)});input.style.width='90px';row.append(input,btnV22('儲存',async()=>{const n=Number(input.value);if(!Number.isInteger(n)||n<0||n>365)return message('提醒天數需介於 0～365');await performV22(['cards','cardPeriods'],(d,ops)=>{const card=d.cards.find(x=>x.id===c.id);assertV22(card,'找不到信用卡');card.remindDays=n;ops.put('cards',card);for(const p of d.cardPeriods.filter(x=>x.cardId===c.id)){p.remindDays=n;ops.put('cardPeriods',p)}},'提醒天數已更新')}))}
 for(const r of reminders.sort((a,b)=>a.p.end.localeCompare(b.p.end)||a.p.cardName.localeCompare(b.p.cardName,'zh-TW')||a.p.cardId.localeCompare(b.p.cardId))){const words=[r.p.cardName,`截止 ${r.p.end}`];if(r.under)words.push(`最低消費尚差 ${money((r.threshold-r.net)/100)}`);if(r.pending.length)words.push(`待核對退款 ${r.pending.length} 筆，合計 ${money(r.pending.reduce((s,x)=>s+x.amountCents,0)/100)}`);rowV22($('cardReminders'),words)}if(!reminders.length)rowV22($('cardReminders'),['目前沒有符合條件的信用卡提醒'])}
async function renderHistory(plans,inst,tax,ip,tp){const [cards,periods,txs,refunds]=await Promise.all(['cards','cardPeriods','cardTransactions','cardRefunds'].map(all));const rows=[],pMap=new Map(plans.map(p=>[p.id,p])),iMap=new Map(inst.map(i=>[i.id,i])),bMap=new Map(tax.map(b=>[b.id,b])),cMap=new Map(cards.map(c=>[c.id,c])),periodMap=new Map(periods.map(p=>[p.id,p]));const settlementGroups=new Map();for(const p of ip){const i=iMap.get(p.installmentId),plan=pMap.get(i?.planId);if(p.earlySettlementGroup){const key=p.earlySettlementGroup;if(!settlementGroups.has(key))settlementGroups.set(key,{plan,records:[]});settlementGroups.get(key).records.push(p);continue}rows.push({category:'installment',kind:'installment',date:p.paidAt,name:`${plan?.name||'分期'} 第 ${i?.number||'?'} 期`,type:'付款',amount:p.amountCents,status:isConfirmed(p)?'已核對':'待核對',note:p.note||'',id:p.id,blocked:!!plan?.archived,archived:!!plan?.archived})}for(const {plan,records} of settlementGroups.values()){const p=records[0];rows.push({category:'installment',kind:'installment',date:p.paidAt,name:`${plan?.name||'分期'} 提前結清`,type:'提前結清',amount:records.reduce((n,x)=>n+x.amountCents,0),status:records.every(isConfirmed)?'已核對':'待核對',note:p.note||'',id:p.id,blocked:!!plan?.archived,archived:!!plan?.archived})}for(const p of tp){const b=bMap.get(p.taxBillId);rows.push({category:'tax',kind:'tax',date:p.paidAt,name:`${b?.name||'稅務'} ${b?.year||''}`,type:'付款',amount:p.amountCents,status:isConfirmed(p)?'已核對':'待核對',note:p.note||'',id:p.id,blocked:!!b?.archived,archived:!!b?.archived})}for(const t of txs)rows.push({category:'card',kind:'purchase',date:cardDateV22(t),name:cMap.get(t.cardId)?.name||periodMap.get(t.periodId)?.cardName||'信用卡',type:'消費',amount:t.amountCents,status:isConfirmed(t)?'已核對':'待核對',note:t.note||'',id:t.id,archived:!!cMap.get(t.cardId)?.archived});for(const r of refunds){const t=refundOriginalV22(r,txs);rows.push({category:'card',kind:'refund',date:cardDateV22(r,true),name:cMap.get(t?.cardId)?.name||periodMap.get(r.periodId)?.cardName||'信用卡',type:'退款',amount:r.amountCents,status:isConfirmed(r)?'已核對':'待核對',note:r.note||'',id:r.id,archived:!!cMap.get(t?.cardId)?.archived})}const cat=$('historyCategory').value,q=$('historySearch').value.trim().toLowerCase(),archiveFilter=$('historyArchiveV227')?.value||'all';historyRows=rows.filter(r=>(archiveFilter==='all'||(archiveFilter==='archived')===!!r.archived)&&(cat==='all'||cat===r.category)&&[r.date,r.name,r.type,r.status,r.note].join(' ').toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));$('historyList').replaceChildren();for(const r of historyRows){const actions=r.status==='已核對'?[btnV22(r.blocked?'請先還原歸檔':'還原',()=>r.blocked?message('請先到「歸檔」頁面還原所屬資料，再從歷史還原核對'):reverseV22(r.kind,r.id))]:[];rowV22($('historyList'),[r.date,r.name,r.type,money(r.amount/100),r.status,r.note],[...actions,btnV22('附件',()=>openAttachmentsV226(r.kind,r.id))])}if(!historyRows.length)rowV22($('historyList'),['沒有符合條件的交易紀錄'])}
render=async function(){const [plans,inst,tax,periods,ip,tp]=await Promise.all(['installmentPlans','installments','taxBills','cardPeriods','installmentPayments','taxPayments'].map(all));const paidFor=(i)=>ip.filter(p=>p.installmentId===i.id&&isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0),paidTax=b=>tp.filter(p=>p.taxBillId===b.id&&isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0),due=inst.filter(i=>i.status!=='cancelled').reduce((s,i)=>s+Math.max(0,i.amountCents-paidFor(i)),0)+tax.filter(b=>!b.archived&&b.amountCents!==null&&b.status!=='exempt').reduce((s,b)=>s+Math.max(0,b.amountCents-paidTax(b)),0);$('dueAmount').textContent=money(due/100);$('netPaid').textContent=money([...ip,...tp].filter(isConfirmed).reduce((s,p)=>s+p.amountCents,0)/100);$('unreconciled').textContent=money([...ip,...tp].filter(p=>!isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0)/100);$('unknownTax').textContent=`${tax.filter(b=>!b.archived&&b.amountCents===null&&b.status!=='exempt').length} 筆`;renderPlanBrowser(plans,inst,ip);$('taxDetails').replaceChildren();$('upcoming').replaceChildren();$('archiveList').replaceChildren();const now=twDate(),near=shiftDay(now,7),up=[];
 for(const p of plans){rowV22($('archiveList'),[p.name,`剩餘待繳 ${money(planDueV22(p,inst,ip)/100)}`,p.archived?'已歸檔':'未歸檔'],[btnV22(p.archived?'恢復':'歸檔',()=>archiveV22(p.id,!!p.archived))]);if(p.archived)continue;for(const i of inst.filter(x=>x.planId===p.id&&x.status!=='cancelled')){const left=Math.max(0,i.amountCents-paidFor(i));if(left>0&&i.due<=near)up.push({date:i.due,name:`${p.name} 第 ${i.number} 期`,amount:left})}}
 for(const b of tax.filter(x=>!x.archived).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){const paid=paidTax(b),left=b.amountCents===null?null:Math.max(0,b.amountCents-paid),line=rowV22($('taxDetails'),[`${b.year} 年`,b.name,`截止 ${b.due}`,left===null?'待確認稅額':`剩餘待繳 ${money(left/100)}`]);if(b.amountCents===null)line.append(btnV22('填寫稅額',()=>setTaxAmount(b.id)));else if(b.status!=='exempt'&&left>0){const available=Math.max(0,b.amountCents-tp.filter(p=>p.taxBillId===b.id).reduce((s,p)=>s+p.amountCents,0));if(available>0)line.append(actionForm('tax',b.id,available))}for(const p of tp.filter(x=>x.taxBillId===b.id)){const actions=!isConfirmed(p)?[btnV22('核對',()=>reconcilePayment('tax',p.id)),btnV22('修改',()=>editPayment('tax',p.id)),btnV22('刪除',()=>deletePaymentV22('tax',p.id))]:[];rowV22($('taxDetails'),['付款',p.paidAt,money(p.amountCents/100),isConfirmed(p)?'已核對':'待核對',p.note||''],actions)}if(b.status!=='exempt'&&b.due<=near&&(left===null||left>0))up.push({date:b.due,name:b.name,amount:left})}
 for(const x of up.sort((a,b)=>a.date.localeCompare(b.date)))rowV22($('upcoming'),[x.name,x.date,x.amount===null?'待確認稅額':money(x.amount/100),x.date<now?'已逾期':'即將到期']);if(!up.length)rowV22($('upcoming'),['目前沒有 7 天內到期或已逾期的項目']);await renderCardSection(periods);await renderHistory(plans,inst,tax,ip,tp);await renderTaxTemplates()};

async function createExistingPeriodV22(e){e.preventDefault();const f=e.currentTarget,v=formData(f);if(!safeDate(v.start)||!safeDate(v.end)||v.end<v.start||!validMoney(v.threshold,true))return message('消費期間日期或金額不正確');await performV22(['cards','cardPeriods'],(d,ops)=>{const c=d.cards.find(x=>x.id===v.cardId);assertV22(c,'找不到信用卡');assertV22(!d.cardPeriods.some(p=>p.cardId===c.id&&v.start<=p.end&&p.start<=v.end),'同一張信用卡的消費期間不能重疊');ops.put('cardPeriods',{id:uid(),cardId:c.id,cardName:c.name,mode:c.mode,start:v.start,end:v.end,thresholdCents:cents(v.threshold),remindDays:Number.isInteger(c.remindDays)?c.remindDays:7,createdAt:new Date().toISOString()})},'已新增信用卡消費期間');f.reset()}
setTaxAmount=async function(id){const input=prompt('請輸入已確認稅額（元，可填 0）');if(input===null)return;if(!validMoney(input,true))return message('稅額不正確');await performV22(['taxBills','taxPayments'],(d,ops)=>{const bill=d.taxBills.find(b=>b.id===id);assertV22(bill&&!bill.archived,'稅單已歸檔或不存在');const paid=d.taxPayments.filter(p=>p.taxBillId===id&&isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0);const pending=d.taxPayments.filter(p=>p.taxBillId===id&&!isConfirmed(p)).reduce((s,p)=>s+p.amountCents,0);assertV22(cents(input)>=paid+pending,'稅額不可小於既有付款合計');bill.amountCents=cents(input);bill.paidCents=paid;bill.status=paid>=bill.amountCents?'paid':'unpaid';ops.put('taxBills',bill)},'稅額已更新')};


// payment-tax-test card schedule port: original odd/even/monthly frequency and day arithmetic.
function cardDayV23(y,m,d){const date=new Date(Date.UTC(y,m-1,Math.min(d,new Date(Date.UTC(y,m,0)).getUTCDate())));return fmtDate(date)}
function cardNextV23(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return fmtDate(d)}
function cardScheduleV23(c){
 const current=twDate().slice(0,7)+'-01',offset=Number(c.offset ?? 1),startMonth=monthDue(current,-offset).slice(0,7)+'-01';
 assertV22(Number.isInteger(offset)&&offset>=0&&offset<=2,'往前月份必須為 0～2');
 const out=[];
 if(c.frequency==='monthly'){
  const base=new Date(current+'T00:00:00Z');
  for(let y=base.getUTCFullYear()-1;y<=base.getUTCFullYear()+1;y++)for(let m=1;m<=12;m++){
   const begin=cardDayV23(y,m,c.startDay);
   if(begin<startMonth||y>base.getUTCFullYear()+1)continue;
   const next=new Date(Date.UTC(y,m,1));
   const end=cardDayV23(next.getUTCFullYear(),next.getUTCMonth()+1,c.endDay);
   assertV22(begin<=end,'信用卡週期日期錯誤');out.push({start:begin,end,year:y,month:m});
  }
 }else{
  const baseYear=Number(current.slice(0,4));
  for(let y=baseYear-1;y<=baseYear+1;y++)for(let m=1;m<=12;m++){
   if(c.frequency==='odd'&&m%2===0||c.frequency==='even'&&m%2!==0)continue;
   const end=cardDayV23(y,m,c.endDay),prev=new Date(Date.UTC(y,m-2,1));
   const begin=cardDayV23(prev.getUTCFullYear(),prev.getUTCMonth()+1,c.startDay);
   if(begin<startMonth)continue;
   assertV22(begin<=end,'起始日不可晚於截止日');out.push({start:begin,end,year:y,month:m});
  }
 }
 out.sort((a,b)=>a.start.localeCompare(b.start));
 for(let i=1;i<out.length;i++)assertV22(out[i].start>out[i-1].end,'消費期間重疊，請修改日期設定');
 return out;
}
createCard=async function(e){e.preventDefault();const f=e.currentTarget,v=formData(f),frequency=v.frequency,endDay=Number(v.endDay),startDay=Number(v.startDay),offset=Number(v.offset),remindDays=Number(v.remindDays);if(!v.name.trim()||!validMoney(v.threshold)||![endDay,startDay,offset,remindDays].every(Number.isInteger)||endDay<1||endDay>28||startDay<1||startDay>28||offset<0||offset>2||remindDays<0||remindDays>365)return message('請檢查信用卡名稱、金額及日期設定');const c={id:uid(),name:v.name.trim(),frequency,endDay,startDay,offset,remindDays,thresholdCents:cents(v.threshold),archived:false,active:true,createdAt:new Date().toISOString()};let schedule;try{schedule=cardScheduleV23(c)}catch(err){return message(err.message)}await performV22(['cards','cardPeriods'],(d,ops)=>{ops.put('cards',c);for(const x of schedule)ops.put('cardPeriods',{id:uid(),cardId:c.id,cardName:c.name,mode:frequency,start:x.start,end:x.end,year:x.year,month:x.month,thresholdCents:c.thresholdCents,remindDays,createdAt:new Date().toISOString()})},`已建立信用卡及 ${schedule.length} 個消費期間`);f.reset()};
async function regenerateCardV23(id){const cards=await all('cards'),c=cards.find(x=>x.id===id);if(!c||!c.frequency)return message('這張信用卡是舊版手動期間，請先保留既有資料');let wanted;try{wanted=cardScheduleV23(c)}catch(e){return message(e.message)}const periods=(await all('cardPeriods')).filter(p=>p.cardId===id),txs=await all('cardTransactions'),refunds=await all('cardRefunds');const add=wanted.filter(x=>!periods.some(p=>p.start===x.start&&p.end===x.end)),obsolete=periods.filter(p=>!wanted.some(x=>x.start===p.start&&x.end===p.end)),blocked=obsolete.filter(p=>txs.some(t=>t.periodId===p.id)||refunds.some(r=>r.periodId===p.id)),remove=obsolete.filter(p=>!blocked.includes(p));const final=[...periods.filter(p=>!remove.includes(p)),...add].sort((a,b)=>a.start.localeCompare(b.start));for(let i=1;i<final.length;i++)if(final[i].start<=final[i-1].end)return message('既有交易期間與新設定重疊，已停止，原資料未變更');if(!confirm(`新增 ${add.length} 期，刪除 ${remove.length} 個完全無交易的舊期；保留 ${blocked.length} 個有交易期。確定？`))return;await performV22(['cardPeriods'],(d,ops)=>{for(const x of remove)ops.del('cardPeriods',x.id);for(const x of add)ops.put('cardPeriods',{id:uid(),cardId:c.id,cardName:c.name,mode:c.frequency,...x,thresholdCents:c.thresholdCents,remindDays:c.remindDays??7,createdAt:new Date().toISOString()})},'消費期已重新產生，既有交易與退款保留')}
async function archiveMasterV23(store,id,restore){if(!confirm(restore?'確定還原歸檔？':'確定歸檔這筆主檔？'))return;const names=store==='cards'?['cards','cardPeriods','cardTransactions','cardRefunds']:['taxTemplates','taxBills','taxPayments'];await performV22(names,(d,ops)=>{const rec=d[store].find(x=>x.id===id);assertV22(rec&&!!rec.archived===!!restore,'歸檔狀態已變更');if(!restore){if(store==='cards'){const ps=d.cardPeriods.filter(p=>p.cardId===id);assertV22(!ps.some(p=>d.cardTransactions.some(t=>t.periodId===p.id&&!isConfirmed(t))||d.cardRefunds.some(r=>r.periodId===p.id&&!isConfirmed(r))),'仍有待核對消費或退款')}else{const bills=d.taxBills.filter(b=>b.sourceTemplateId===id);assertV22(!bills.some(b=>d.taxPayments.some(t=>t.taxBillId===b.id&&!isConfirmed(t))),'仍有待核對稅務付款')}}rec.archived=!restore;ops.put(store,rec)},restore?'已還原歸檔，原資料不變':'已歸檔，資料保留')}
// Auto-create the current tax year when a new recurring tax master is saved.
createTaxTemplate=async function(e){e.preventDefault();const f=e.currentTarget,v=formData(f),month=Number(v.month),day=Number(v.day),year=Number(twDate().slice(0,4));if(!v.name.trim()||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return message('請檢查稅務名稱與日期');const t={id:uid(),name:v.name.trim(),month,day,active:true,archived:false,createdAt:new Date().toISOString()},bill={id:uid(),sourceTemplateId:t.id,year,name:t.name,due:templateDue(year,month,day),amountCents:null,paidCents:0,status:'amount-pending',createdAt:new Date().toISOString()};await performV22(['taxTemplates','taxBills'],(d,ops)=>{ops.put('taxTemplates',t);ops.put('taxBills',bill)},`稅務主檔已建立，並產生 ${year} 年度稅單`);f.reset()};
const oldRenderV23=render;
render=async function(){await oldRenderV23();const [plans,inst,ip,cards,periods,templates,bills]=await Promise.all(['installmentPlans','installments','installmentPayments','cards','cardPeriods','taxTemplates','taxBills'].map(all));const arch=$('archiveList');arch.replaceChildren();for(const p of plans.filter(x=>x.archived))rowV22(arch,['分期',p.name,`原始 ${money(p.totalCents/100)}`,`共 ${p.count} 期`],[btnV22('還原歸檔',()=>archiveV22(p.id,true))]);for(const c of cards.filter(x=>x.archived))rowV22(arch,['信用卡',c.name,`門檻 ${money(c.thresholdCents/100)}`,c.frequency==='monthly'?'每月':c.frequency==='odd'?'單月':'雙月'],[btnV22('還原歸檔',()=>archiveMasterV23('cards',c.id,true))]);for(const t of templates.filter(x=>x.archived))rowV22(arch,['舊版稅務主檔',t.name,'舊版歸檔狀態'],[btnV22('還原舊主檔',()=>restoreLegacyTaxV227(t.id))]);for(const b of bills.filter(x=>x.archived))rowV22(arch,['稅務',b.name,`${b.year} 年`,b.status==='exempt'?'已取消':`金額 ${b.amountCents===null?'待填':money(b.amountCents/100)}`],[btnV22('還原歸檔',()=>archiveTaxYearV227(b.id,true))]);if(!arch.children.length)rowV22(arch,['目前沒有已歸檔資料']);const root=$('cardList');root.replaceChildren();for(const c of cards.filter(x=>!x.archived)){const ps=periods.filter(p=>p.cardId===c.id).sort((a,b)=>a.start.localeCompare(b.start));rowV22(root,[c.name,`門檻 ${money(c.thresholdCents/100)}`,`已產生 ${ps.length} 期`],[btnV22('查看各期',()=>{const target=$('cardPeriodsDetailV23');target.hidden=false;target.replaceChildren();for(const p of ps)rowV22(target,[p.start+' ～ '+p.end,`最低消費 ${money(p.thresholdCents/100)}`]);target.scrollIntoView({block:'nearest'})}),...(c.frequency?[btnV22('修改主檔',()=>editCardSettingsV25(c.id)),btnV22('重新產生消費期',()=>regenerateCardV23(c.id))]:[]),btnV22('提醒設定',()=>editCardReminderV25(c.id)),btnV22('歸檔',()=>archiveMasterV23('cards',c.id,false))])}const troot=$('taxTemplateList');troot.replaceChildren();for(const t of templates.filter(x=>!x.archived))rowV22(troot,[t.name,`每年 ${t.month} 月 ${t.day} 日`],[btnV22(t.active===false?'啟用':'停用',()=>toggleTaxV227(t.id)),btnV22('刪除',()=>deleteTaxMasterV25(t.id))]);for(const b of [...$('taxDetails').children]){const year=b.textContent||'';if(templates.some(t=>t.archived&&bills.some(x=>x.sourceTemplateId===t.id&&year.includes(x.name))))b.hidden=true}
renderPlanBrowser(plans.filter(x=>!x.archived),inst,ip);
};

// TAX-A: one recurring master, current-year automatic creation, optional advanced operations.
let selectedTaxMasterV24=null;
async function ensureCurrentTaxYearV24(){
 const year=Number(twDate().slice(0,4));
 const templates=(await all('taxTemplates')).filter(t=>t.active!==false&&!t.archived);
 const bills=await all('taxBills');
 const missing=templates.filter(t=>!bills.some(b=>b.sourceTemplateId===t.id&&Number(b.year)===year));
 if(!missing.length)return 0;
 await txAtomicV22(['taxTemplates','taxBills'],(d,ops)=>{
  for(const t of missing){const current=d.taxTemplates.find(x=>x.id===t.id);
   if(!current||current.archived||current.active===false||d.taxBills.some(b=>b.sourceTemplateId===t.id&&Number(b.year)===year))continue;
   ops.put('taxBills',{id:uid(),sourceTemplateId:t.id,year,name:t.name,due:templateDue(year,t.month,t.day),amountCents:null,paidCents:0,status:'amount-pending',createdAt:new Date().toISOString()});
  }
 });
 return missing.length;
}
const previousTaxRenderV24=render;
render=async function(){
 await previousTaxRenderV24();
 const [masters,bills,payments]=await Promise.all(['taxTemplates','taxBills','taxPayments'].map(all));
 const browser=$('taxTemplateList'),years=$('taxYearList'),paymentForms=$('taxPaymentFormsV228');browser.replaceChildren();years.replaceChildren();paymentForms.replaceChildren();
 const visible=masters.filter(t=>!t.archived);
 for(const t of visible){
  rowV22(browser,[t.name,`每年 ${t.month} 月 ${t.day} 日`],[btnV22('查看年度',()=>{selectedTaxMasterV24=t.id;render()}),btnV22(t.active===false?'啟用':'停用',()=>toggleTaxV227(t.id)),btnV22('刪除',()=>deleteTaxMasterV25(t.id))]);
 }
 if(!visible.length)rowV22(browser,['尚未建立稅務主檔']);
 const selected=visible.find(t=>t.id===selectedTaxMasterV24);
 $('taxMasterBrowser').hidden=!!selected;$('taxTemplateForm').hidden=!!selected;
 $('taxYearPanel').hidden=!selected;
 if(!selected)return;
 $('taxYearTitle').textContent=`${selected.name}｜年度明細`;
 const related=bills.filter(b=>b.sourceTemplateId===selected.id&&!b.archived).sort((a,b)=>Number(b.year)-Number(a.year)||b.due.localeCompare(a.due));
 for(const bill of related){
  const paid=payments.filter(p=>p.taxBillId===bill.id&&isConfirmed(p)).reduce((n,p)=>n+p.amountCents,0);
  const remaining=bill.amountCents===null?null:Math.max(0,bill.amountCents-paid);
  const buttons=[];
  buttons.push(btnV22('歸檔年度',()=>archiveTaxYearV227(bill.id,false)));if(bill.amountCents===null)buttons.push(btnV22('填寫稅額',()=>setTaxAmount(bill.id)));
  if(bill.status!=='exempt'&&remaining!==null&&remaining>0){
   const reserved=payments.filter(p=>p.taxBillId===bill.id).reduce((n,p)=>n+p.amountCents,0);
   const available=Math.max(0,bill.amountCents-reserved);
   if(available>0){const section=document.createElement('section');section.className='tax-payment-entry';section.append(textNode('h4',`${bill.year} 年｜${bill.name}｜記錄付款`),actionForm('tax',bill.id,available));paymentForms.append(section)}
  }
  rowV22(years,[`${bill.year} 年`,bill.name,`截止 ${bill.due}`,remaining===null?'待填稅額':`剩餘 ${money(remaining/100)}`,bill.status==='exempt'?'免繳':remaining===0?'已結清':'待繳'],buttons);
  for(const p of payments.filter(p=>p.taxBillId===bill.id)){
   const actions=isConfirmed(p)?[]:[btnV22('核對',()=>reconcilePayment('tax',p.id)),btnV22('修改',()=>editPayment('tax',p.id)),btnV22('刪除',()=>deletePaymentV22('tax',p.id))];
   rowV22(years,['付款',p.paidAt,money(p.amountCents/100),isConfirmed(p)?'已核對':'待核對',p.note||''],actions);
  }
 }
 if(!related.length)rowV22(years,['目前沒有年度稅單']);
};
async function init(){try{db=await openDb();document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===b.dataset.tab));$('message').textContent=''}));$('planSearch').addEventListener('input',e=>{planView.search=e.target.value;planView.page=1;render()});$('planFilter').addEventListener('change',e=>{planView.filter=e.target.value;planView.page=1;render()});$('backToPlans').addEventListener('click',()=>{planView.selectedId=null;render();$('plans').scrollIntoView({block:'start'})});$('planForm').addEventListener('submit',createPlan);$('taxForm').addEventListener('submit',createTax);$('cardForm').addEventListener('submit',createCard);$('cardTransactionForm').addEventListener('submit',createCardTransaction);$('cardRefundForm').addEventListener('submit',createRefundV22);$('existingPeriodForm').addEventListener('submit',createExistingPeriodV22);$('taxTemplateForm').addEventListener('submit',createTaxTemplate);$('generateTaxBills').addEventListener('click',generateYearTaxes);$('generateTaxYear').value=new Date().getFullYear();$('historyCategory').addEventListener('change',()=>render());$('historySearch').addEventListener('input',()=>render());$('clearHistory').addEventListener('click',()=>{$('historyCategory').value='all';$('historySearch').value='';if($('historyArchiveV227'))$('historyArchiveV227').value='all';render()});$('historyCsv').addEventListener('click',exportHistoryCsv);$('historyPdf').addEventListener('click',printHistory);$('taxForm').elements.year.value=new Date().getFullYear();$('taxBack').addEventListener('click',()=>{selectedTaxMasterV24=null;render()});await ensureCurrentTaxYearV24();await render()}catch(err){message(`無法啟動資料庫：${err.message}`);document.querySelectorAll('form button').forEach(x=>x.disabled=true)}}init();

// V2.2.5: card settings and safe tax master deletion.
async function editCardReminderV25(id){const c=(await all('cards')).find(x=>x.id===id);if(!c||c.archived)return message('找不到可編輯的信用卡');const raw=prompt(`${c.name}：提前提醒天數（0～365）`,String(c.remindDays??7));if(raw===null)return;const n=Number(raw);if(!Number.isInteger(n)||n<0||n>365)return message('提醒天數必須介於 0～365');await performV22(['cards','cardPeriods'],(d,ops)=>{const x=d.cards.find(v=>v.id===id);assertV22(x&&!x.archived,'信用卡狀態已變更');x.remindDays=n;ops.put('cards',x);for(const p of d.cardPeriods.filter(v=>v.cardId===id)){p.remindDays=n;ops.put('cardPeriods',p)}},'提醒設定已儲存並立即生效')}
async function editCardSettingsV25(id){
 const c=(await all('cards')).find(x=>x.id===id);if(!c||c.archived||!c.frequency)return message('此信用卡不支援修改自動週期設定');
 const d=$('cardSettingsDialogV228'),f=$('cardSettingsFormV228');for(const k of ['frequency','startDay','endDay','offset'])f.elements[k].value=c[k];f.elements.threshold.value=Math.round(c.thresholdCents/100);$('cardSettingsNameV228').textContent=c.name;d.hidden=false;
 f.onsubmit=async e=>{e.preventDefault();const v=new FormData(f);const next={...c,frequency:String(v.get('frequency')),startDay:Number(v.get('startDay')),endDay:Number(v.get('endDay')),offset:Number(v.get('offset')),thresholdCents:cents(v.get('threshold'))};
 if(!['monthly','odd','even'].includes(next.frequency)||![next.startDay,next.endDay,next.offset].every(Number.isInteger)||next.startDay<1||next.startDay>28||next.endDay<1||next.endDay>28||next.offset<0||next.offset>2||!validMoney(v.get('threshold')))return message('主檔設定不正確');
 try{cardScheduleV23(next)}catch(err){return message('日期設定不正確：'+err.message)}
 if(!confirm('儲存新的信用卡主檔設定？現有消費期不會立即改動，請再按「重新產生消費期」預覽並確認。'))return;
 await performV22(['cards'],(data,ops)=>{const cur=data.cards.find(x=>x.id===id);assertV22(cur&&!cur.archived,'主檔狀態已變更');Object.assign(cur,{frequency:next.frequency,startDay:next.startDay,endDay:next.endDay,offset:next.offset,thresholdCents:next.thresholdCents});ops.put('cards',cur)},'主檔設定已儲存。請按「重新產生消費期」套用新設定');d.hidden=true;
 };
}

async function deleteTaxMasterV25(id){const [masters,bills,pays]=await Promise.all(['taxTemplates','taxBills','taxPayments'].map(all)),master=masters.find(t=>t.id===id);if(!master||master.archived)return message('請先還原歸檔');const related=bills.filter(b=>b.sourceTemplateId===id);if(related.some(b=>b.archived))return message('此稅務仍有已歸檔年度，請先還原年度稅單');if(related.some(b=>pays.some(p=>p.taxBillId===b.id)))return message('此稅務已有付款紀錄，無法刪除');if(!confirm(`確定刪除「${master.name}」及 ${related.length} 張年度稅單？此操作無法復原。`))return;await performV22(['taxTemplates','taxBills','taxPayments'],(d,ops)=>{const t=d.taxTemplates.find(x=>x.id===id);assertV22(t&&!t.archived,'稅務狀態已變更');const rs=d.taxBills.filter(x=>x.sourceTemplateId===id);assertV22(!rs.some(b=>b.archived),'請先還原所有年度歸檔');assertV22(!rs.some(b=>d.taxPayments.some(p=>p.taxBillId===b.id)),'已有付款紀錄，禁止刪除');for(const b of rs)ops.del('taxBills',b.id);ops.del('taxTemplates',id)},'稅務主檔與沒有付款的年度稅單已刪除')}

// Offline ZIP codec retained from payment-tax-test (V2.1).

const encoder=new TextEncoder(),decoder=new TextDecoder();function crc32(bytes){let c=-1;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1}return(c^-1)>>>0}function u16(d,o,n){d.setUint16(o,n,true)}function u32(d,o,n){d.setUint32(o,n>>>0,true)}function concat(parts){let n=parts.reduce((s,p)=>s+p.length,0),a=new Uint8Array(n),pos=0;for(const p of parts){a.set(p,pos);pos+=p.length}return a}function zipMake(files){const local=[],central=[];let offset=0;for(const f of files){const name=encoder.encode(f.name),body=f.bytes,crc=crc32(body),lh=new Uint8Array(30+name.length),v=new DataView(lh.buffer);u32(v,0,0x04034b50);u16(v,4,20);u16(v,8,0);u32(v,14,crc);u32(v,18,body.length);u32(v,22,body.length);u16(v,26,name.length);lh.set(name,30);local.push(lh,body);const ch=new Uint8Array(46+name.length),w=new DataView(ch.buffer);u32(w,0,0x02014b50);u16(w,4,20);u16(w,6,20);u32(w,16,crc);u32(w,20,body.length);u32(w,24,body.length);u16(w,28,name.length);u32(w,42,offset);ch.set(name,46);central.push(ch);offset+=lh.length+body.length}const cd=concat(central),end=new Uint8Array(22),v=new DataView(end.buffer);u32(v,0,0x06054b50);u16(v,8,files.length);u16(v,10,files.length);u32(v,12,cd.length);u32(v,16,offset);return new Blob([...local,cd,end],{type:'application/zip'})}function zipRead(buf){const b=new Uint8Array(buf),v=new DataView(buf),out=new Map();let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break}if(end<0)throw Error('找不到 ZIP 目錄');const count=v.getUint16(end+10,true);if(count>20000)throw Error('附件數量異常');let pos=v.getUint32(end+16,true);for(let i=0;i<count;i++){if(v.getUint32(pos,true)!==0x02014b50)throw Error('ZIP 目錄錯誤');const method=v.getUint16(pos+10,true),crc=v.getUint32(pos+16,true),size=v.getUint32(pos+20,true),n=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true),name=decoder.decode(b.slice(pos+46,pos+46+n));if(method!==0)throw Error('僅支援本 App 產生的 ZIP');if(v.getUint32(offset,true)!==0x04034b50)throw Error('ZIP 項目錯誤');const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true),bytes=b.slice(start,start+size);if(bytes.length!==size||crc32(bytes)!==crc)throw Error('檔案校驗失敗：'+name);if(out.has(name))throw Error('ZIP 重複檔名');out.set(name,bytes);pos+=46+n+extra+comment}return out}


// V2.2.5 offline complete backup and guarded restore.
// V2.2.9 isolated test: complete JSON/ZIP backups, format validation and atomic restore.
const BACKUP_FORMAT_V229='payment-tax-v229-complete', BACKUP_VERSION_V229=1;
let backupDownloadStartedV229=false;
function downloadBlobV25(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function csvEscapeV25(v){return '"'+String(v??'').replaceAll('"','""')+'"'}
function bytesToBase64V229(bytes){let chunks=[];for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));return btoa(chunks.join(''))}
function base64ToBytesV229(str){if(typeof str!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(str))throw Error('圖片 Base64 格式錯誤');const binary=atob(str),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes}
function resetBackupApprovalV229(){backupDownloadStartedV229=false;const checkbox=$('backupSavedV229');if(checkbox)checkbox.checked=false}
async function snapshotV25(){const snap={format:BACKUP_FORMAT_V229,version:BACKUP_VERSION_V229,createdAt:new Date().toISOString(),stores:{},attachments:[]};for(const store of STORES){if(store!=='attachments')snap.stores[store]=await all(store)}const files=[];for(const a of await all('attachments')){const {blob,...metadata}=a;if(!(blob instanceof Blob))throw Error('附件內容不正確：'+a.id);const bytes=new Uint8Array(await blob.arrayBuffer());files.push({name:'attachments/'+a.id,bytes});snap.attachments.push({...metadata,size:bytes.length,type:blob.type,crc32:crc32(bytes)})}return {snap,files}}
async function backupFullV25(format='zip'){try{const {snap,files}=await snapshotV25();let blob,ext;if(format==='json'){const content={...snap,attachments:snap.attachments.map((a,i)=>({...a,base64:bytesToBase64V229(files[i].bytes)}))};blob=new Blob([JSON.stringify(content)],{type:'application/json;charset=utf-8'});ext='json'}else{blob=zipMake([{name:'records.json',bytes:encoder.encode(JSON.stringify(snap))},...files]);ext='zip'}downloadBlobV25(blob,'payment-tax-v229-完整備份-'+twDate()+'.'+ext);backupDownloadStartedV229=true;$('lastFullBackup').textContent='最近啟動備份下載：'+new Date().toLocaleString('zh-TW');message('已啟動 '+ext.toUpperCase()+' 下載。還原前請確認檔案已成功保存，並勾選確認框。')}catch(e){message('備份失敗：'+e.message)}}
function validateRelationsV229(snap,attachments){const st=snap.stores,ids={};for(const store of STORES.filter(x=>x!=='attachments')){const rows=st?.[store];if(!Array.isArray(rows))throw Error('缺少資料表：'+store);ids[store]=new Set();for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id||ids[store].has(row.id))throw Error('資料 ID 重複或無效：'+store);ids[store].add(row.id)}}
 const relation=(store,field,parent,{optional=false}={})=>{for(const row of st[store]){const id=row[field];if(id==null||id===''){if(optional)continue;throw Error(store+' 缺少 '+field)}if(!ids[parent].has(id))throw Error(store+' 找不到關聯 '+parent+'：'+id)}};
 relation('installments','planId','installmentPlans');relation('installmentPayments','installmentId','installments');relation('taxBills','sourceTemplateId','taxTemplates',{optional:true});relation('taxPayments','taxBillId','taxBills');relation('cardPeriods','cardId','cards');relation('cardTransactions','periodId','cardPeriods');for(const refund of st.cardRefunds){const original=refund.transactionId||refund.cardTransactionId;if(!original||!ids.cardTransactions.has(original))throw Error('退款找不到原始消費：'+refund.id)}
 for(const row of st.cardRefunds){if(row.periodId&&ids.cardPeriods.has(row.periodId)){const transaction=st.cardTransactions.find(x=>x.id===(row.transactionId||row.cardTransactionId));if(transaction&&row.cardId&&transaction.cardId!==row.cardId)throw Error('退款與原交易的信用卡不一致')}}
 const attachmentIds=new Set();for(const a of attachments){if(typeof a.id!=='string'||!a.id||attachmentIds.has(a.id)||!(a.blob instanceof Blob))throw Error('附件 ID 或內容錯誤');attachmentIds.add(a.id);if(typeof a.transactionId!=='string'||!a.transactionId)throw Error('附件缺少交易關聯');const target=a.kind==='installment'?'installmentPayments':a.kind==='tax'?'taxPayments':(a.kind==='card'||a.kind==='purchase')?'cardTransactions':a.kind==='refund'?'cardRefunds':null;if(!target)throw Error('附件類別無法辨識：'+a.kind);if(!ids[target].has(a.transactionId))throw Error('附件找不到原交易：'+a.id)}
 // Audit/historyCleanup may intentionally refer to deleted or archived records; do not reject legitimate history.
 return true}
async function parseBackupV25(file){if(!file||file.size>500*1024*1024)throw Error('請選擇有效且不超過 500 MB 的 JSON 或 ZIP');const lower=file.name.toLowerCase();let snap,attachments=[];
 if(lower.endsWith('.json')){snap=JSON.parse(await file.text());if(snap?.format!==BACKUP_FORMAT_V229||snap.version!==BACKUP_VERSION_V229)throw Error('不支援舊版或不相容 JSON 備份');if(!Array.isArray(snap.attachments))throw Error('缺少附件清單');for(const a of snap.attachments){if(typeof a.id!=='string'||!Number.isSafeInteger(a.size)||a.size<0||!Number.isSafeInteger(a.crc32))throw Error('附件索引錯誤');const bytes=base64ToBytesV229(a.base64);if(bytes.length!==a.size||crc32(bytes)!==a.crc32)throw Error('附件校驗失敗：'+a.id);const {base64,...meta}=a;attachments.push({...meta,blob:new Blob([bytes],{type:a.type||'application/octet-stream'})})}}
 else if(lower.endsWith('.zip')){const files=zipRead(await file.arrayBuffer()),json=files.get('records.json');if(!json)throw Error('ZIP 缺少 records.json');snap=JSON.parse(decoder.decode(json));if(snap?.format!==BACKUP_FORMAT_V229||snap.version!==BACKUP_VERSION_V229)throw Error('不支援舊版或不相容 ZIP 備份');if(!Array.isArray(snap.attachments))throw Error('缺少附件清單');for(const a of snap.attachments){if(typeof a.id!=='string'||!Number.isSafeInteger(a.size)||a.size<0||!Number.isSafeInteger(a.crc32))throw Error('附件索引錯誤');const bytes=files.get('attachments/'+a.id);if(!bytes||bytes.length!==a.size||crc32(bytes)!==a.crc32)throw Error('附件校驗失敗：'+a.id);attachments.push({...a,blob:new Blob([bytes],{type:a.type||'application/octet-stream'})})}if(files.size!==snap.attachments.length+1)throw Error('ZIP 包含非預期檔案')}
 else throw Error('僅接受 JSON 或 ZIP 完整備份');
 validateRelationsV229(snap,attachments);return {snap,attachments}}
async function restoreFullV25(){const file=$('fullRestoreFile').files?.[0];try{if(!backupDownloadStartedV229||!$('backupSavedV229')?.checked)throw Error('請先下載目前資料的完整備份，確認檔案已保存並勾選確認');const {snap,attachments}=await parseBackupV25(file);if(!confirm('備份日期：'+snap.createdAt+'\n即將覆蓋 V2.2.9 獨立測試資料庫。確認繼續？'))return;if(!confirm('最後確認：已保存目前完整備份，確定覆蓋所有測試資料？'))return;await new Promise((resolve,reject)=>{const tx=db.transaction(STORES,'readwrite');for(const store of STORES)tx.objectStore(store).clear();for(const store of STORES.filter(x=>x!=='attachments'))for(const row of snap.stores[store])tx.objectStore(store).put(row);for(const row of attachments)tx.objectStore('attachments').put(row);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('寫入失敗'));tx.onabort=()=>reject(tx.error||Error('交易取消'))});resetBackupApprovalV229();await render();message('V2.2.9 測試資料完整還原成功，請逐項核對。')}catch(e){message('還原未執行或失敗：'+e.message)}}
async function exportAllCsvV25(){
 const rows=await reportTransactionsV226(),head=['日期','類別','名稱／期別','交易類型','金額（元）','核對狀態','備註'];
 const table=[head,...rows.map(r=>[r.date,r.category,r.name,r.type,(r.amount/100).toString(),r.status,r.note])];
 downloadBlobV25(new Blob(['\ufeff'+table.map(r=>r.map(csvEscapeV25).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'payment-tax-v229-付款與消費歷史-'+twDate()+'.csv');
}
async function printAllPdfV25(){
 const win=window.open('','_blank');if(!win)return message('請允許瀏覽器開啟報表視窗');
 const rows=await reportTransactionsV226();win.document.title='V2.2.9 付款與消費歷史';
 const style=win.document.createElement('style');style.textContent='body{font:14px sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:7px;text-align:left}';win.document.head.append(style);
 win.document.body.append(textNode('h2','付款與消費歷史'));const printedAt=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());win.document.body.append(textNode('p','報表產生時間：'+printedAt));const table=win.document.createElement('table'),tr=win.document.createElement('tr');
 for(const x of ['日期','類別','名稱／期別','交易類型','金額','核對狀態','備註'])tr.append(textNode('th',x));table.append(tr);
 for(const r of rows){const tr=win.document.createElement('tr');for(const v of [r.date,r.category,r.name,r.type,money(r.amount/100),r.status,r.note])tr.append(textNode('td',String(v)));table.append(tr)}win.document.body.append(table);win.print();
}
async function reportTransactionsV226(){
 const [plans,inst,bills,ip,tp,cards,periods,txs,refunds]=await Promise.all(['installmentPlans','installments','taxBills','installmentPayments','taxPayments','cards','cardPeriods','cardTransactions','cardRefunds'].map(all));
 const pm=new Map(plans.map(x=>[x.id,x])),im=new Map(inst.map(x=>[x.id,x])),bm=new Map(bills.map(x=>[x.id,x])),cm=new Map(cards.map(x=>[x.id,x])),per=new Map(periods.map(x=>[x.id,x]));const rows=[];
 for(const p of ip){const i=im.get(p.installmentId);rows.push({date:p.paidAt||'',category:'分期',name:`${pm.get(i?.planId)?.name||'分期'} 第 ${i?.number||'?'} 期`,type:'付款',amount:p.amountCents,status:isConfirmed(p)?'已核對':'待核對',note:p.note||''})}
 for(const p of tp){const b=bm.get(p.taxBillId);rows.push({date:p.paidAt||'',category:'稅務',name:`${b?.name||'稅務'} ${b?.year||''}`,type:'付款',amount:p.amountCents,status:isConfirmed(p)?'已核對':'待核對',note:p.note||''})}
 for(const t of txs)rows.push({date:cardDateV22(t),category:'信用卡',name:cm.get(t.cardId)?.name||per.get(t.periodId)?.cardName||'信用卡',type:'消費',amount:t.amountCents,status:isConfirmed(t)?'已核對':'待核對',note:t.note||''});
 for(const r of refunds){const t=refundOriginalV22(r,txs);rows.push({date:cardDateV22(r,true),category:'信用卡',name:cm.get(t?.cardId)?.name||per.get(r.periodId)?.cardName||'信用卡',type:'退款',amount:r.amountCents,status:isConfirmed(r)?'已核對':'待核對',note:r.note||''})}
 return rows.sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name,'zh-TW'));
}
async function archivePreviewV25(){const [plans,inst,ip,bills,tp,periods,txs,refunds]=await Promise.all(['installmentPlans','installments','installmentPayments','taxBills','taxPayments','cardPeriods','cardTransactions','cardRefunds'].map(all));const cutoff=shiftDay(twDate(),-730);const settled=plans.filter(p=>p.archived&&inst.filter(i=>i.planId===p.id).every(i=>i.status==='cancelled'||ip.filter(x=>x.installmentId===i.id&&isConfirmed(x)).reduce((s,x)=>s+x.amountCents,0)>=i.amountCents));const count=settled.length;$('historyArchivePreview').textContent=`初步檢查：已歸檔且結清分期 ${count} 筆。為保留完整交易關聯，本測試版只提供封存資料匯出，不開放刪除。保留年限約 2 年，界線 ${cutoff}。`;return count}
async function exportArchiveV25(){await archivePreviewV25();const {snap,files}=await snapshotV25();snap.archiveOnly=true;files.unshift({name:'records.json',bytes:encoder.encode(JSON.stringify(snap))});downloadBlobV25(zipMake(files),'payment-tax-v229-歷史封存安全副本-'+twDate()+'.zip');message('已匯出完整資料的封存安全副本；未清理任何歷史。此檔案不能當作可合併匯入的歷史封存檔。')}
async function inspectArchiveV25(){try{const file=$('archiveRestoreFile').files?.[0];const {snap}=await parseBackupV25(file);message(`ZIP 檢查通過（${snap.createdAt}），目前僅提供檢查，不執行歷史合併還原。`)}catch(e){message('封存 ZIP 檢查失敗：'+e.message)}}
document.addEventListener('DOMContentLoaded',()=>{for(const [id,fn] of [['fullBackupZip',()=>backupFullV25('zip')],['fullBackupJson',()=>backupFullV25('json')],['fullBackupCsv',exportAllCsvV25],['fullBackupPdf',printAllPdfV25],['fullRestoreZip',restoreFullV25],['archivePreviewBtn',archivePreviewV25],['archiveExportBtn',exportArchiveV25],['archiveRestoreBtn',inspectArchiveV25]])$(id)?.addEventListener('click',fn)});

// V2.2.6 附件：維持 V2.2.5 IndexedDB schema 與完整 ZIP 相容性。
async function compressImageV226(file){
 if(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))return file;
 try{
  const bitmap=await createImageBitmap(file),scale=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
  if(!blob)throw Error('無法壓縮圖片');
  if(blob.size>=file.size)return file;
  return new File([blob],file.name.replace(/\.[^.]+$/, '')+'.jpg',{type:'image/jpeg'});
 }catch(e){if(/heic|heif/i.test(file.type))throw Error('此裝置無法轉換 HEIC，請先轉成 JPG');throw Error('圖片壓縮失敗：'+e.message)}
}
let attachmentTargetV226=null;
async function openAttachmentsV226(kind,id){
 attachmentTargetV226={kind,id};const root=$('attachmentEntriesV226');root.replaceChildren();$('attachmentFileV226').value='';
 const list=(await all('attachments')).filter(a=>a.transactionId===id&&a.kind===kind);
 for(const a of list){const row=element('div',{class:'attachment-row'});row.append(textNode('span',`${a.name}（${(a.blob.size/1024).toFixed(0)} KB）`),btnV22('下載',()=>downloadBlobV25(a.blob,a.name)),btnV22('刪除',async()=>{if(!confirm('確定刪除此附件？'))return;await performV22(['attachments'],(d,ops)=>{assertV22(d.attachments.some(x=>x.id===a.id),'附件不存在');ops.del('attachments',a.id)},'附件已刪除');openAttachmentsV226(kind,id)}));root.append(row)}
 $('attachmentCountV226').textContent=`已儲存 ${list.length} / 5 個附件，每個不超過 10 MB。`;
 $('attachmentDialogV226').hidden=false;
}
async function saveAttachmentV226(){
 try{
  const target=attachmentTargetV226,file=$('attachmentFileV226').files?.[0];assertV22(target&&file,'請先選擇附件');
  const store={installment:'installmentPayments',tax:'taxPayments',purchase:'cardTransactions',refund:'cardRefunds'}[target.kind];assertV22(store,'交易類型不正確');
  const converted=await compressImageV226(file);assertV22(converted.size<=10*1024*1024,'附件儲存後不可超過 10 MB');
  if(!confirm(`原始 ${(file.size/1024).toFixed(0)} KB，儲存 ${(converted.size/1024).toFixed(0)} KB。確定儲存？`))return;
  await performV22(['attachments',store],(d,ops)=>{
   assertV22(d[store].some(x=>x.id===target.id),'原始交易已不存在');
   assertV22(d.attachments.filter(x=>x.kind===target.kind&&x.transactionId===target.id).length<5,'每筆交易最多 5 個附件');
   ops.put('attachments',{id:uid(),kind:target.kind,transactionId:target.id,name:converted.name,blob:converted,type:converted.type,createdAt:new Date().toISOString()});
  },'附件已儲存');await openAttachmentsV226(target.kind,target.id);
 }catch(e){message('附件儲存失敗：'+e.message)}
}
document.addEventListener('DOMContentLoaded',()=>{$('attachmentSaveV226')?.addEventListener('click',saveAttachmentV226);$('attachmentCloseV226')?.addEventListener('click',()=>{$('attachmentDialogV226').hidden=true})});
// 信用卡消費篩選僅影響下拉選單，保留全部期間資料。
async function filterCardPeriodsV226(){
 const [cards,periods]=await Promise.all(['cards','cardPeriods'].map(all)),card=$('cardFilterV226').value,month=$('cardMonthV226').value;
 const first=month+'-01',last=fmtDate(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)));
 const select=$('cardPeriodSelect'),previous=select.value;select.replaceChildren();
 for(const p of periods.filter(p=>(card==='all'||p.cardId===card)&&p.start<=last&&p.end>=first).sort((a,b)=>b.start.localeCompare(a.start)||a.cardName.localeCompare(b.cardName,'zh-TW'))){
  select.append(element('option',{value:p.id,text:`${p.cardName}｜${p.start}～${p.end}`}));
 }
 if([...select.options].some(o=>o.value===previous))select.value=previous;
}
const beforeCardRenderV226=render;
render=async function(){await beforeCardRenderV226();const cards=(await all('cards')).filter(c=>!c.archived),filter=$('cardFilterV226'),prior=filter.value;filter.replaceChildren(element('option',{value:'all',text:'全部信用卡'}));for(const c of cards)filter.append(element('option',{value:c.id,text:c.name}));filter.value=[...filter.options].some(x=>x.value===prior)?prior:'all';await filterCardPeriodsV226()};
document.addEventListener('DOMContentLoaded',()=>{$('cardMonthV226').value=twDate().slice(0,7);$('cardFilterV226').addEventListener('change',filterCardPeriodsV226);$('cardMonthV226').addEventListener('change',filterCardPeriodsV226)});


// V2.2.7: standalone changes. Do not modify the database schema or auto-migrate legacy archived masters.
async function toggleTaxV227(id){
 const masters=await all('taxTemplates'),t=masters.find(x=>x.id===id);
 if(!t||t.archived)return message('找不到可操作的稅務主檔');
 const enable=t.active===false;
 if(!confirm(`確定${enable?'啟用':'停用'}「${t.name}」？${enable?'只檢查今年，不補建過去年度。':'既有年度稅單仍可付款。'}`))return;
 await performV22(['taxTemplates','taxBills'],(d,ops)=>{
  const current=d.taxTemplates.find(x=>x.id===id);assertV22(current&&!current.archived,'主檔已變更');
  current.active=enable;ops.put('taxTemplates',current);
  const year=Number(twDate().slice(0,4));
  if(enable&&!d.taxBills.some(b=>b.sourceTemplateId===id&&Number(b.year)===year))
   ops.put('taxBills',{id:uid(),sourceTemplateId:id,year,name:current.name,due:templateDue(year,current.month,current.day),amountCents:null,paidCents:0,status:'amount-pending',archived:false,createdAt:new Date().toISOString()});
 },enable?'稅務已啟用，當年度稅單已檢查':'稅務已停用，既有稅單保留');
}
async function archiveTaxYearV227(id,restore){
 if(!confirm(restore?'還原這張年度稅單？':'歸檔這張年度稅單？'))return;
 await performV22(['taxBills','taxPayments'],(d,ops)=>{
  const b=d.taxBills.find(x=>x.id===id);assertV22(b&&!!b.archived===!!restore,'年度稅單狀態已改變');
  const ps=d.taxPayments.filter(p=>p.taxBillId===id);
  if(!restore){
   assertV22(!ps.some(p=>!isConfirmed(p)),'仍有待核對付款');
   if(b.status!=='exempt'){
    assertV22(b.amountCents!==null,'稅額待填，無法歸檔');
    const paid=ps.reduce((n,p)=>n+p.amountCents,0);
    assertV22(paid>=b.amountCents,'稅單尚未完全結清');
   }
  }
  b.archived=!restore;ops.put('taxBills',b);
 },restore?'年度稅單已還原':'年度稅單已歸檔，歷史紀錄仍可查詢');
}
async function restoreLegacyTaxV227(id){
 if(!confirm('將舊版已歸檔稅務主檔還原到稅務管理？不會更動年度稅單。'))return;
 await performV22(['taxTemplates'],(d,ops)=>{const t=d.taxTemplates.find(x=>x.id===id);assertV22(t&&t.archived,'主檔狀態已改變');t.archived=false;t.active=false;ops.put('taxTemplates',t)},'舊版稅務主檔已還原並保持停用，請自行確認是否啟用');
}
async function earlySettleV227(id){
 const [plans,inst,ip]=await Promise.all(['installmentPlans','installments','installmentPayments'].map(all));
 const plan=plans.find(p=>p.id===id),items=inst.filter(i=>i.planId===id&&i.status!=='cancelled').sort((a,b)=>a.number-b.number);
 if(!plan||plan.archived||!items.length)return message('這筆分期無法提前結清');
 if(ip.some(p=>items.some(i=>i.id===p.installmentId)&&!isConfirmed(p)))return message('此分期仍有待核對付款，請先核對或處理既有付款');
 const remain=items.map(i=>({i,left:Math.max(0,i.amountCents-ip.filter(p=>p.installmentId===i.id&&isConfirmed(p)).reduce((n,p)=>n+p.amountCents,0))})).filter(x=>x.left>0);
 const total=remain.reduce((n,x)=>n+x.left,0);if(total<=0)return message('此分期已結清');
 const date=prompt(`提前結清金額 ${money(total/100)}（固定不可修改）\n請輸入結清日期 YYYY-MM-DD`,twDate());
 if(date===null)return;if(!safeDate(date))return message('結清日期不正確');
 const note=prompt('提前結清備註（可留空）','');if(note===null)return;
 if(!confirm(`確認提前結清 ${money(total/100)}？將建立一筆結清事件，分配到 ${remain.length} 期，付款需核對後才結清。`))return;
 const group=uid();
 await performV22(['installmentPlans','installments','installmentPayments'],(d,ops)=>{
  const p=d.installmentPlans.find(x=>x.id===id);assertV22(p&&!p.archived,'分期已歸檔');
  const periods=d.installments.filter(x=>x.planId===id&&x.status!=='cancelled').sort((a,b)=>a.number-b.number);
  assertV22(!d.installmentPayments.some(x=>periods.some(i=>i.id===x.installmentId)&&!isConfirmed(x)),'仍有待核對付款');
  let sum=0;for(const i of periods){const pays=d.installmentPayments.filter(x=>x.installmentId===i.id);const left=Math.max(0,i.amountCents-pays.filter(isConfirmed).reduce((n,x)=>n+x.amountCents,0));if(!left)continue;sum+=left;
   ops.put('installmentPayments',{id:uid(),installmentId:i.id,amountCents:left,paidAt:date,note:note.trim(),reconciled:false,earlySettlementGroup:group,earlySettlementTotalCents:total,createdAt:new Date().toISOString()});
  }
  assertV22(sum===total,'剩餘金額已變更，請重新操作');
 },'提前結清付款已建立，請完成核對');
}
// Group settlement payments as one history event and reconcile/reverse atomically.
async function settleGroupV227(group,confirmState){
 if(!confirm(confirmState?'確定一次核對整筆提前結清付款？':'確定一次還原整筆提前結清付款核對？'))return;
 await performV22(['installmentPayments','installments','installmentPlans'],(d,ops)=>{
  const payments=d.installmentPayments.filter(p=>p.earlySettlementGroup===group);
  assertV22(payments.length>0&&payments.every(p=>isConfirmed(p)!==confirmState),'提前結清付款狀態已改變');
  const items=payments.map(p=>d.installments.find(i=>i.id===p.installmentId));
  assertV22(items.every(Boolean),'原始期數不存在');
  const plan=d.installmentPlans.find(p=>p.id===items[0].planId);assertV22(plan&&!plan.archived,'請先還原分期歸檔');
  for(const p of payments){p.reconciled=confirmState;if(confirmState)p.reconciledAt=new Date().toISOString();else delete p.reconciledAt;ops.put('installmentPayments',p)}
  for(const i of items)recalcParentV22('installment',i,d,ops.put);
 },confirmState?'提前結清已全部核對':'提前結清核對已全部還原');
}
// Keep the existing installment and history layout, add one master action and group handling.
const oldPlanRenderV227=renderPlanBrowser;
renderPlanBrowser=function(plans,inst,ip){
 oldPlanRenderV227(plans,inst,ip);
 const p=plans.find(x=>x.id===planView.selectedId);
 if(p&&!p.archived&&planDueV22(p,inst,ip)>0){$('planDetailHeader').append(btnV22('提前結清',()=>earlySettleV227(p.id)))}
 // Hide individual actions for grouped settlement payments; group actions appear below.
 if(!p)return;
 const groups=new Map();for(const pay of ip){const i=inst.find(x=>x.id===pay.installmentId);if(i?.planId===p.id&&pay.earlySettlementGroup){if(!groups.has(pay.earlySettlementGroup))groups.set(pay.earlySettlementGroup,[]);groups.get(pay.earlySettlementGroup).push(pay)}}
 for(const [group,ps] of groups){const confirmed=ps.every(isConfirmed);const mixed=ps.some(isConfirmed)&&!confirmed;
  const row=rowV22($('installmentDetails'),['提前結清',ps[0].paidAt,`總額 ${money(ps.reduce((n,x)=>n+x.amountCents,0)/100)}`,confirmed?'已核對':mixed?'部分核對':'待核對'],p.archived||mixed?[]:[btnV22(confirmed?'還原整筆核對':'核對整筆',()=>settleGroupV227(group,!confirmed)),...(!confirmed?[btnV22('取消提前結清',()=>cancelSettlementV227(group))]:[])]);row.classList.add('settlement-group-row');
 }
};
// Override existing per-payment buttons so grouped settlement always changes atomically.
const oldReconcileV227=reconcilePayment,oldReverseV227=reverseV22;
reconcilePayment=async function(kind,id){if(kind==='installment'){const p=(await all('installmentPayments')).find(x=>x.id===id);if(p?.earlySettlementGroup)return settleGroupV227(p.earlySettlementGroup,true)}return oldReconcileV227(kind,id)};
reverseV22=async function(kind,id){if(kind==='installment'){const p=(await all('installmentPayments')).find(x=>x.id===id);if(p?.earlySettlementGroup)return settleGroupV227(p.earlySettlementGroup,false)}return oldReverseV227(kind,id)};
const oldEditPaymentV227=editPayment,oldDeletePaymentV227=deletePaymentV22;
editPayment=async function(kind,id){if(kind==='installment'&&(await all('installmentPayments')).some(x=>x.id===id&&x.earlySettlementGroup))return message('提前結清金額固定，無法個別修改');return oldEditPaymentV227(kind,id)};
deletePaymentV22=async function(kind,id){if(kind==='installment'&&(await all('installmentPayments')).some(x=>x.id===id&&x.earlySettlementGroup))return message('提前結清付款不能逐期刪除，請先核對或還原整筆');return oldDeletePaymentV227(kind,id)};
const beforeV227Render=render;
render=async function(){await beforeV227Render();
 const [plans,inst,ip,bills,tp]=await Promise.all(['installmentPlans','installments','installmentPayments','taxBills','taxPayments'].map(all));
 // Rebuild archive list to ensure only archived items appear, retaining existing card entries.
 const archive=$('archiveList');for(const row of [...archive.children]){if(row.textContent?.includes('目前沒有已歸檔資料')&&archive.children.length>1)row.remove()}
 // Remove archived tax items from current dashboard, including amounts and reminders.
 const visible=bills.filter(b=>!b.archived),hidden=bills.filter(b=>b.archived);
 if(hidden.length){
  const confirmed=b=>tp.filter(p=>p.taxBillId===b.id&&isConfirmed(p)).reduce((n,p)=>n+p.amountCents,0);
  const taxDue=visible.filter(b=>b.amountCents!==null&&b.status!=='exempt').reduce((n,b)=>n+Math.max(0,b.amountCents-confirmed(b)),0);
  const instDue=plans.filter(p=>!p.archived).reduce((n,p)=>n+planDueV22(p,inst,ip),0);
  $('dueAmount').textContent=money((instDue+taxDue)/100);
 }
 // Status labels at the far right, all one line.
 for(const r of $('upcoming').children){if(!r.classList.contains('data-row'))continue;const last=r.lastElementChild;if(last&&['已逾期','即將到期'].includes(last.textContent))last.classList.add('status-pill',last.textContent==='已逾期'?'status-late':'status-soon')}
 for(const r of $('cardReminders').children){if(!r.classList.contains('data-row')||r.textContent.includes('目前沒有'))continue;const b=document.createElement('span');b.className='status-pill status-soon';b.textContent=r.textContent.includes('尚差')?'未達標':'退款待核對';r.append(b)}
};
document.addEventListener('DOMContentLoaded',()=>{$('historyArchiveV227')?.addEventListener('change',()=>render());});


async function cancelSettlementV227(group){
 if(!confirm('確定取消這筆尚未核對的提前結清付款？將一次刪除所有分配期數的付款，原有已核對紀錄不變。'))return;
 await performV22(['installmentPayments','installments','installmentPlans'],(d,ops)=>{
  const ps=d.installmentPayments.filter(p=>p.earlySettlementGroup===group);
  assertV22(ps.length>0&&ps.every(p=>!isConfirmed(p)),'已有付款核對，不能取消');
  const ids=new Set(ps.map(p=>p.installmentId));const items=d.installments.filter(i=>ids.has(i.id));
  assertV22(items.length===ids.size,'期數不存在');
  assertV22(items.every(i=>d.installmentPlans.some(x=>x.id===i.planId&&!x.archived)),'分期已歸檔');
  for(const p of ps)ops.del('installmentPayments',p.id);
 },'提前結清付款已取消');
}

document.addEventListener('DOMContentLoaded',()=>{$('cardSettingsCloseV228')?.addEventListener('click',()=>{$('cardSettingsDialogV228').hidden=true})});


// UI-only presentation pass: keep existing reminder selection, dates and accounting untouched.
const renderBeforeOverviewUiV228 = render;
render = async function(){
  await renderBeforeOverviewUiV228();
  const upcomingRoot = document.getElementById('upcoming');
  const taxReminderKeys = new Set((await all('taxBills')).filter(b=>!b.archived).map(b=>b.name+'\u0000'+b.due));
  for(const row of [...upcomingRoot.children]){
    if(!row.classList.contains('data-row')) continue;
    const cells=[...row.children];
    if(cells.length===1){row.classList.add('overview-empty');continue;}
    if(cells.length<4)continue;
    const [name,date,amount,status]=cells;
    const info=document.createElement('div');info.className='overview-info';
    name.className='overview-name';
    const meta=document.createElement('span');meta.className='overview-meta';
    // Preserve existing title and due date; category comes from the source record when available.
    const label=name.textContent||'';
    const category=taxReminderKeys.has(label+'\u0000'+date.textContent)?'稅務':'分期';
    meta.textContent=category+' · '+date.textContent;
    info.append(name,meta);
    row.replaceChildren(info,status);
    row.classList.add('overview-reminder');
  }
  const cards=document.getElementById('cardReminders');
  for(const row of [...cards.children]){
    if(row.classList.contains('data-row')&&row.textContent.includes('目前沒有'))row.classList.add('overview-empty');
  }
};
