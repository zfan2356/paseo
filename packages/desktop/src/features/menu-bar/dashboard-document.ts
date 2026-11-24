// This isolated Electron surface uses the app's zinc palette and spacing scale,
// without loading the full Expo app or opening another set of host connections.
export function dashboardDocument(nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paseo · 任务看板</title>
<style>
:root{color-scheme:light dark;--fg:#18181b;--muted:#71717a;--surface:rgba(250,250,250,.58);--raised:rgba(255,255,255,.35);--line:rgba(113,113,122,.16);--hover:rgba(113,113,122,.10);--blue:#2563eb;--green:#15803d;--red:#dc2626;--amber:#b45309}
@media(prefers-color-scheme:dark){:root{--fg:#fafafa;--muted:#a1a1aa;--surface:rgba(24,24,27,.60);--raised:rgba(255,255,255,.04);--line:rgba(161,161,170,.18);--hover:rgba(161,161,170,.12);--blue:#60a5fa;--green:#4ade80;--red:#fca5a5;--amber:#fbbf24}}
@media(prefers-reduced-transparency:reduce){:root{--surface:#fafafa}@media(prefers-color-scheme:dark){:root{--surface:#18181b}}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent}body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--fg);user-select:none}
.board{height:100%;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface);display:flex;flex-direction:column}
header{padding:20px 20px 14px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:10px}.mark{width:30px;height:30px;border-radius:9px;background:var(--fg);color:var(--surface);display:grid;place-items:center;font-size:18px;font-weight:600}
h1{font-size:15px;letter-spacing:-.3px;margin:0;font-weight:650}.subtitle{font-size:11px;color:var(--muted);margin-top:1px}
button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;border-radius:8px}button:hover{background:var(--hover)}button:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}button:disabled{cursor:wait;opacity:.55}
.close{font-size:22px;color:var(--muted);width:28px;height:28px;line-height:1}
.stats{margin:0 20px 12px;display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:12px;background:var(--raised);overflow:hidden}
.stat{border-radius:0;text-align:left;padding:10px 14px}.stat+.stat{border-left:1px solid var(--line)}.stat small{color:var(--muted);font-size:11px;display:block}.stat strong{font-size:24px;font-weight:550;line-height:1.3;font-variant-numeric:tabular-nums}
.running{color:var(--blue)}.finished{color:var(--green)}.failed{color:var(--red)}
.notice{margin:0 20px 10px;color:var(--amber);font-size:11px}.notice:empty{display:none}
main{flex:1;min-height:0;overflow-y:auto;padding:0 12px 12px;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
section{padding:4px 0 8px}h2{font-size:11px;margin:8px 8px 6px;font-weight:600;display:flex;justify-content:space-between;align-items:center}h2 span{color:var(--muted);font-weight:400}
.task{width:100%;text-align:left;padding:8px;display:block}.row{display:flex;align-items:center;gap:8px}.title{color:var(--fg);font-size:13px;font-weight:550;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}.badge{color:var(--amber);font-size:10px;flex:none}.summary{margin:4px 0 0 14px;color:var(--muted);font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.meta{display:flex;justify-content:space-between;gap:12px;margin:5px 0 0 14px;font-size:10px;color:var(--muted)}.host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{margin:0;padding:10px 8px 12px;color:var(--muted);font-size:12px}.more{font-size:11px;color:var(--blue);margin:2px 4px;padding:6px}
.error{margin:0 20px 10px;color:var(--red);font-size:12px}.error:empty{display:none}
.quota{margin:0 8px;border-bottom:1px solid var(--line);padding:9px 0}.quota:last-child{border-bottom:0}.quota-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.quota-name{font-size:12px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.quota-value{font-size:11px;white-space:nowrap;color:var(--blue)}.quota-value.low{color:var(--red)}.quota-detail{font-size:10px;color:var(--muted);overflow-wrap:anywhere;margin-top:3px}.quota progress{display:block;appearance:none;width:100%;height:4px;margin:7px 0;border:0;border-radius:4px;overflow:hidden;background:var(--line)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:var(--blue)}.quota.low progress::-webkit-progress-value{background:var(--red)}
.quota summary{font-size:10px;color:var(--muted);cursor:pointer;margin-top:5px}.quota details{margin-top:4px}
.controls{padding:10px 8px;border-top:1px solid var(--line);margin-top:8px}.controls select{width:100%;font:inherit;color:var(--fg);background:var(--raised);border:1px solid var(--line);border-radius:7px;padding:7px;margin:4px 0 8px}.sources{display:flex;gap:4px;margin:4px 0 10px}.sources button{flex:1;border:1px solid var(--line);padding:6px 3px;font-size:11px}.sources button[aria-pressed=true]{color:var(--blue);background:var(--hover);border-color:var(--blue)}.control-help{color:var(--muted);font-size:10px;line-height:1.6;margin:5px 0}.control-top{display:flex;align-items:center;justify-content:space-between}.control-top button{font-size:11px;color:var(--blue);padding:4px}.ultra{display:flex;gap:7px;align-items:center;font-size:12px}.success{font-size:11px;color:var(--green);margin:0 20px 8px}.success:empty{display:none}
.quick-nav{display:flex;gap:8px;padding:0 20px 10px}.quick-nav button{color:var(--blue);font-size:11px;padding:4px 6px;border:1px solid var(--line)}
button[aria-busy="true"]{opacity:.55}.task[aria-busy="true"] .summary:before{content:"正在打开… "}
footer{border-top:1px solid var(--line);padding:12px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:11px;color:var(--muted)}footer button{font-size:12px;font-weight:550;color:var(--fg);padding:5px 8px}
</style></head><body><div class="board">
<header><div class="brand"><div class="mark" aria-hidden="true">P</div><div><h1>Paseo <span style="font-weight:400">任务看板</span></h1><div class="subtitle">本地与远程任务</div></div></div><button class="close" aria-label="关闭看板">×</button></header>
<div class="stats" aria-label="任务统计">
<button class="stat" data-section="running"><small>运行中</small><strong class="running" id="count-running">—</strong></button>
<button class="stat" data-section="finished"><small>已完成</small><strong class="finished" id="count-finished">—</strong></button>
<button class="stat" data-section="failed"><small>报错</small><strong class="failed" id="count-failed">—</strong></button>
</div><div class="notice" role="status"></div><main aria-label="任务列表"></main><div class="error" role="alert"></div><div class="success" role="status"></div>
<footer><span id="connection">正在同步状态…</span><button id="open-app">打开 Paseo ↗</button></footer>
</div><script nonce="${nonce}">
const api=window.paseoBoard;
const main=document.querySelector('main');
let latest=null, pending=false, deferred=false;
const expandedQuotas=new Set();
const names={running:'运行中',finished:'已完成',failed:'报错'};
function element(tag,className,text){const node=document.createElement(tag);node.className=className;node.textContent=text;return node;}
function age(timestamp){if(!timestamp)return '';const minutes=Math.max(0,Math.floor((Date.now()-timestamp)/60000));if(minutes<1)return '刚刚';if(minutes<60)return minutes+' 分钟前';if(minutes<1440)return Math.floor(minutes/60)+' 小时前';return Math.floor(minutes/1440)+' 天前';}
async function act(action,button){
 if(pending)return;
 pending=true;button.disabled=true;button.setAttribute('aria-busy','true');
 document.querySelector('.error').textContent='';
 document.querySelector('.success').textContent='';
 try{await api.act(action);if(['refresh','source','ultra'].includes(action.kind))document.querySelector('.success').textContent=action.kind==='refresh'?'额度已刷新':'设置已保存，后续经 Magpie 的请求生效。';}
 catch(error){document.querySelector('.error').textContent=['refresh','source','ultra','magpie'].includes(action.kind)?String(error.message||'操作失败，请重试。'):'打开失败，请检查主机连接后重试。';}
 finally{pending=false;button.disabled=false;button.removeAttribute('aria-busy');deferred=false;render(latest);}
}
function renderQuotaRefresh(section,reports){
 for(const report of reports){
   if(report.state==='not-configured'||report.state==='loading')continue;
   const block=element('div','quota-refresh','');
   const top=element('div','control-top','');top.append(element('strong','','数据源 · '+report.hostLabel));
   const refresh=element('button','','刷新额度');refresh.addEventListener('click',()=>act({kind:'refresh',hostId:report.hostId},refresh));top.append(refresh);block.append(top);
   if(report.state==='unavailable')block.append(element('p','control-help','额度暂不可用，请检查主机上的 Magpie 服务后刷新。'));
   if(report.issue)block.append(element('p','control-help',report.issue));
   section.append(block);
 }
}
function render(snapshot){
 latest=snapshot;if(pending){deferred=true;return;}
 const counts=snapshot?{running:snapshot.running+snapshot.waiting,finished:snapshot.finished,failed:snapshot.failed}:null;
 const notice=document.querySelector('.notice');
 const unavailable=snapshot?snapshot.hosts.filter(h=>h.status!=='ready'):[];
 notice.textContent=!snapshot?'状态暂不可用，请打开 Paseo 检查连接。':unavailable.map(h=>h.label+' · '+(h.status==='offline'?'离线':'同步中')).join('，');
 document.querySelector('#connection').textContent=snapshot?(snapshot.hosts.length-unavailable.length)+' / '+snapshot.hosts.length+' 台主机在线':'等待状态更新';
 const active=document.activeElement;
 const focusedKey=active&&active.dataset?active.dataset.key:null;
 const scroll=main.scrollTop;main.replaceChildren();
 const quotaSection=element('section','','');quotaSection.id='section-quotas';
 const quotaHeading=element('h2','','账号额度');quotaHeading.append(element('span','','Magpie · 每分钟同步'));quotaSection.append(quotaHeading);
 const quotaItems=snapshot?snapshot.quotaItems||[]:[];
 for(const [index,item] of quotaItems.entries()){
   const low=item.remaining!==null&&item.remaining<=20;
   const card=element('div',low?'quota low':'quota','');
   const top=element('div','quota-top','');top.append(element('span','quota-name',item.title),element('span',low?'quota-value low':'quota-value',item.summary));card.append(top);
   if(item.remaining!==null){const bar=document.createElement('progress');bar.max=100;bar.value=item.remaining;bar.setAttribute('aria-label',item.title+' 剩余额度');card.append(bar);}
   if(item.details.length){
     const details=document.createElement('details');const key=item.title+'-'+index;
     details.open=expandedQuotas.has(key);details.append(element('summary','','查看各窗口与重置时间'));
     details.addEventListener('toggle',()=>{if(details.open)expandedQuotas.add(key);else expandedQuotas.delete(key);});
     for(const line of item.details)details.append(element('div','quota-detail',line));
     card.append(details);
   }
   quotaSection.append(card);
 }
 if(!quotaItems.length)quotaSection.append(element('p','empty',snapshot?'暂无可用账号额度。':'等待额度数据…'));
 renderQuotaRefresh(quotaSection,snapshot?snapshot.quotaReports||[]:[]);
 for(const kind of ['running','finished','failed']){
   document.querySelector('#count-'+kind).textContent=counts?String(counts[kind]):'—';
   const section=element('section',kind,'');section.id='section-'+kind;
   const heading=element('h2','',names[kind]);heading.append(element('span','',kind==='finished'?'待查看的完成记录':''));
   section.append(heading);
   const tasks=snapshot?snapshot.tasks.filter(t=>kind==='running'?(t.status==='running'||t.status==='waiting'):t.status===kind):[];
   for(const task of tasks){
     const button=element('button','task','');button.dataset.key=JSON.stringify([task.serverId,task.agentId]);button.setAttribute('aria-label','打开任务：'+task.title);
     const row=element('div','row','');row.append(element('span','dot',''),element('span','title',task.title));
     if(task.status==='waiting')row.append(element('span','badge','待审批'));
     button.append(row,element('div','summary',task.summary||({waiting:'等待你的审批后继续执行',running:'正在执行任务',finished:'本轮任务已结束，点击查看结果',failed:'执行出错，点击查看详情'})[task.status]));
     const host=snapshot.hosts.find(h=>h.serverId===task.serverId);
     const meta=element('div','meta','');meta.append(element('span','host',host?host.label:task.serverId),element('span','time',age(task.updatedAt)));button.append(meta);
     button.addEventListener('click',()=>act({kind:'task',serverId:task.serverId,agentId:task.agentId},button));section.append(button);
   }
   if(!tasks.length)section.append(element('p','empty',!snapshot?'等待同步…':({running:'暂无运行中的任务',finished:'暂无待查看的完成记录',failed:'暂无报错任务'})[kind]));
   if(counts&&counts[kind]>tasks.length){const more=element('button','more','还有 '+(counts[kind]-tasks.length)+' 项 · 在 Paseo 中查看');more.addEventListener('click',()=>act({kind:'show'},more));section.append(more);}
   main.append(section);
 }
 main.append(quotaSection);
 if(focusedKey){for(const button of main.querySelectorAll('button')){if(button.dataset.key===focusedKey)button.focus({preventScroll:true});}}
 main.scrollTop=scroll;
}
document.querySelector('.close').addEventListener('click',()=>api.act({kind:'hide'}));
document.addEventListener('keydown',event=>{if(event.key==='Escape')void api.act({kind:'hide'});});
document.querySelector('#open-app').addEventListener('click',event=>act({kind:'show'},event.currentTarget));
for(const button of document.querySelectorAll('[data-section]'))button.addEventListener('click',()=>document.querySelector('#section-'+button.dataset.section).scrollIntoView({block:'start'}));
api.subscribe(render);
</script></body></html>`;
}
