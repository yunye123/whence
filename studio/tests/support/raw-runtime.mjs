// Unfiltered window errors/rejections, installed before navigation. No suppressions.
// Node-side transport preserves observations across reloads and frame replacement.
const contexts=new WeakMap(),pages=new WeakMap();
export function rawVerdict(rows){return {status:rows.length?'failed':'passed',count:rows.length,errors:rows.filter(row=>row.type==='error').length,rejections:rows.filter(row=>row.type==='unhandledrejection').length,filterApplied:false};}
export function applyRawGate(entry,rows){entry.rawRuntime=rows;entry.rawRuntimeVerdict=rawVerdict(rows);entry.rawRuntimeClean=entry.rawRuntimeVerdict.status==='passed'&&!entry.rawObservationFailure;entry.checks??={};entry.checks.rawRuntime=entry.rawRuntimeClean;if(!entry.rawRuntimeClean){entry.status='failed';if('runtime' in entry)entry.runtime=false;}return entry;}
export function rawForContext(context){return (contexts.get(context)||[]).flatMap(observer=>observer.rows);}
export async function flushRawContext(context){for(const observer of contexts.get(context)||[])await observer.flush();return rawForContext(context);}
function pageObserver(){
  if(window.__deskRawRuntimeInstalled)return;
  window.__deskRawRuntimeInstalled=true;
  const rows=window.__deskRawRuntime=[],pending=new Set(),failures=[];
  const serialize=(value,seen=new Set())=>{
    if(value===undefined)return {type:'undefined'};
    if(value===null||['string','boolean'].includes(typeof value))return value;
    if(typeof value==='number')return Number.isFinite(value)?value:{type:'number',text:String(value)};
    if(typeof value!=='object')return {type:typeof value,text:String(value)};
    if(seen.has(value))return {type:'circular-reference'};seen.add(value);
    const result={type:Object.prototype.toString.call(value),properties:{}};
    for(const key of Reflect.ownKeys(value)){const name=typeof key==='symbol'?String(key):key;try{result.properties[name]=serialize(value[key],seen);}catch(error){result.properties[name]={type:'property-read-error',text:String(error)};}}
    seen.delete(value);return result;
  };
  const emit=(type,event)=>{
    const now=Date.now(),target=event.target;
    const row={type,message:type==='error'?event.message??null:null,reasonText:type==='unhandledrejection'?String(event.reason):null,error:type==='error'?serialize(event.error):null,reason:type==='unhandledrejection'?serialize(event.reason):null,filename:event.filename??null,lineno:event.lineno??null,colno:event.colno??null,isTrusted:event.isTrusted,eventTimeStamp:event.timeStamp,performanceNow:performance.now(),timeOrigin:performance.timeOrigin,epochMs:now,at:new Date(now).toISOString(),documentUrl:location.href,documentReadyState:document.readyState,target:target instanceof Element?{tag:target.tagName,src:target.getAttribute('src'),href:target.getAttribute('href'),html:target.outerHTML}:target===window?{type:'window'}:{type:Object.prototype.toString.call(target)}};
    rows.push(row);
    const work=window.__deskRawRuntimeEmit(row).catch(error=>failures.push(String(error)));
    pending.add(work);void work.finally(()=>pending.delete(work));
  };
  window.addEventListener('error',event=>emit('error',event),true);
  window.addEventListener('unhandledrejection',event=>emit('unhandledrejection',event),true);
  window.__deskRawRuntimeFlush=async()=>{await Promise.all([...pending]);if(failures.length)throw new Error('Raw observer transport failed: '+JSON.stringify(failures));return rows.length;};
}
export async function observeRaw(page,metadata={}){
  if(pages.has(page))return pages.get(page);
  const rows=[],observer={rows,async flush(){if(page.isClosed())return;for(const frame of page.frames())await frame.evaluate(async()=>{if(!window.__deskRawRuntimeInstalled)throw new Error('Mandatory raw observer absent');await window.__deskRawRuntimeFlush();});},verdict:()=>rawVerdict(rows)};
  const existing=contexts.get(page.context())||[];existing.push(observer);contexts.set(page.context(),existing);pages.set(page,observer);
  await page.exposeBinding('__deskRawRuntimeEmit',({frame},row)=>{rows.push({...row,scope:metadata,frameUrl:frame.url(),receivedAt:new Date().toISOString()});});
  await page.addInitScript(pageObserver);await page.evaluate(pageObserver);
  return observer;
}
