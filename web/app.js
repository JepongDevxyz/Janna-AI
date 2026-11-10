'use strict';
const $=id=>document.getElementById(id);
const state={busySessions:[],lunaMember:'luna',token:'',remote:false,projects:[],sessions:[],session:null,project:null,models:[],modelCatalog:[],pro:null,model:'',mode:'auto',effort:'balanced',speed:'standard',reasoning:'default',nativeLevels:['default'],modelVision:false,pending:[],busy:false,events:[],stream:'',view:'chats',settings:{},gpu:null,stopRequested:false,runId:null,tailFollow:true,codeWorkspace:null, voiceRecognizer:null,voiceListening:false};
const icon=(name,size=18)=>`<svg width="${size}" height="${size}"><use href="#i-${name}"></use></svg>`;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=(message,delay=6000)=>{const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,delay)};
const friendly=s=>(s||'').replaceAll('\\','/').split('/').filter(Boolean).at(-1)||'Project';

// Voice is deliberately opt-in. Browser speech recognition can depend on OS or
// external browser services; Janna never promises it is offline or always-on.
function voiceSpeak(text){
  if(state.settings.voice_output!==true||!('speechSynthesis' in window))return;
  const cleaned=String(text||'').replace(/```[\s\S]*?```/g,' [code block omitted] ').replace(/[<>{}*_#]/g,'').slice(0,1700);
  if(!cleaned.trim())return;
  try{window.speechSynthesis.cancel();const utter=new SpeechSynthesisUtterance(cleaned);utter.lang=speechTag(cleaned);utter.rate=1.07;window.speechSynthesis.speak(utter)}catch{}
}
function voiceDictate(){
  const Rec=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Rec)return toast('Microphone dictation is not available in this Windows/WebView version. You can still type.');
  if(state.voiceListening){try{state.voiceRecognizer?.stop()}catch{};return}
  const recognition=new Rec();state.voiceRecognizer=recognition;
  recognition.lang=speechTag();
  recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=1;
  const previous=$('prompt').value;let transcript='';
  recognition.onresult=e=>{transcript=Array.from(e.results).map(r=>r[0].transcript).join(' ');$('prompt').value=(previous+' '+transcript).trim()};
  recognition.onerror=e=>toast('Voice transcription: '+String(e.error||'unavailable')+'. Some browsers require network access.');
  recognition.onend=()=>{state.voiceListening=false;$('composer').classList.remove('is-dictating');syncSendState();$('voiceMic').classList.remove('listening');$('voiceMic').setAttribute('aria-pressed','false');$('prompt').focus()};
  try{recognition.start();state.voiceListening=true;$('composer').classList.add('is-dictating');$('voiceMic').classList.add('listening');$('voiceMic').setAttribute('aria-pressed','true')}
  catch(e){toast('Microphone could not start: '+e.message)}
}

function selectedProject(){return state.projects.find(x=>x.id===state.project)||null}
function saveLocalToken(){if(state.remote&&state.token)localStorage.setItem('janna-pair-token',state.token)}
async function api(path,data=null){const headers={'X-Janna-Token':state.token};const opt={headers};if(data!==null){opt.method='POST';headers['Content-Type']='application/json';opt.body=JSON.stringify(data)}if(data===null)opt.signal=AbortSignal.timeout(path==='/api/host/readiness'?90000:15000);const r=await fetch(path,opt);let result={};try{result=await r.json()}catch{}if(!r.ok){const error=new Error(result.error||`Request failed (${r.status})`);error.status=r.status;throw error;}return result}
// Markdown remains dependency-free and offline. Code fences are parsed from the
// *raw* model text before escaping; this preserves quotes, indentation, and HTML.
const codeByBody = new WeakMap();
function formatMarkdown(value){
  const source=String(value||'').replace(/\r\n/g,'\n');
  const rows=source.split('\n'),blocks=[],lines=[];
  const languageLabel=x=>({'js':'JavaScript','ts':'TypeScript','jsx':'React JSX','tsx':'React TSX','html':'HTML','css':'CSS','py':'Python','cs':'C#','cpp':'C++','c':'C','rs':'Rust','json':'JSON','sh':'Shell'}[x]||x.toUpperCase()||'Code');
  for(let i=0;i<rows.length;i++){
    const m=rows[i].match(/^ {0,3}(`{3,}|~{3,})\s*([^\n]*)$/);
    if(!m){lines.push(escapeHTML(rows[i]));continue}
    const delimiter=m[1],language=String(m[2]||'').trim().split(/\s+/)[0].replace(/[^a-z0-9#+._-]/gi,'').toLowerCase();
    const body=[];let closed=false;
    while(++i<rows.length){
      const line=rows[i],end=line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if(end&&end[1][0]===delimiter[0]&&end[1].length>=delimiter.length){closed=true;break}
      body.push(line);
    }
    const code=body.join('\n').replace(/\n+$/,'');const index=blocks.length;
    blocks.push({language,code,closed});
    lines.push(`\uE000${index}\uE001`);
  }
  if(!blocks.length&&/^\s*(?:<!doctype html\b|<html\b)/i.test(source)){
    blocks.push({language:'html',code:source.trim(),closed:true});lines.length=0;lines.push('\uE0000\uE001');
  }
  const inline=s=>{
    const saved=[];
    const protect=html=>{const id=saved.length;saved.push(html);return `\uE010${id}\uE011`};
    const styled=s.replace(/`([^`]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"()]+)\)/g,(_,code,label,url)=>
      protect(code!==undefined?`<code>${code}</code>`:`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
    return styled.replace(/\uE010(\d+)\uE011/g,(_,id)=>saved[Number(id)]||'');
  };
  const out=[],paragraph=[],items=[];
  function flush(){if(paragraph.length){out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph.length=0}if(items.length){out.push('<ul>'+items.map(v=>'<li>'+inline(v)+'</li>').join('')+'</ul>');items.length=0}}
  // Markdown tables: a header row containing | followed by a --- separator row.
  const tables=[];
  const splitCells=r=>{let s=r.trim();if(s.startsWith('|'))s=s.slice(1);if(s.endsWith('|'))s=s.slice(0,-1);return s.split('|').map(c=>c.trim())};
  const isSep=r=>{if(!r.includes('-'))return false;const cells=splitCells(r);return cells.length>0&&cells.every(c=>/^:?-{1,}:?$/.test(c))};
  for(let li=0;li<lines.length;li++){
    const row=lines[li];
    if(row.includes('|')&&li+1<lines.length&&isSep(lines[li+1])){
      const head=splitCells(row);const bodyRows=[];
      let lj=li+2;
      while(lj<lines.length&&lines[lj].includes('|')&&lines[lj].trim()){bodyRows.push(splitCells(lines[lj]));lj++}
      const th=head.map(c=>`<th>${inline(c)}</th>`).join('');
      const tb=bodyRows.map(r=>'<tr>'+head.map((_,ci)=>`<td>${inline(r[ci]||'')}</td>`).join('')+'</tr>').join('');
      tables.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      lines.splice(li,lj-li,`\uE002${tables.length-1}\uE003`);
    }
  }
  for(const row of lines){
    if(!row.trim()){flush();continue}
    if(/^\uE000\d+\uE001$/.test(row)){flush();out.push(row);continue}
    if(/^\uE002\d+\uE003$/.test(row)){flush();out.push(row);continue}
    const heading=row.match(/^(#{1,3})\s+(.+)$/);
    if(heading){flush();const level=Math.min(3,heading[1].length+1);out.push(`<h${level}>${inline(heading[2])}</h${level}>`);continue}
    const item=row.match(/^\s*[-*]\s+(.+)$/);
    if(item){if(paragraph.length)flush();items.push(item[1]);continue}
    if(items.length)flush();paragraph.push(row);
  }
  flush();
  const html=out.join('').replace(/\uE000(\d+)\uE001/g,(_,id)=>{
    const block=blocks[Number(id)];if(!block)return '';
    const label=languageLabel(block.language);const status=block.closed?'':'<span class="code-draft">Writing…</span>';
    return `<section class="code-block" data-code-index="${id}"><div class="code-block-header"><span class="code-language">${escapeHTML(label)}</span>${status}<span class="code-block-actions"><button type="button" class="code-action" data-code-action="copy" data-code-index="${id}" title="Copy this code">Copy</button><button type="button" class="code-action" data-code-action="open" data-code-index="${id}" title="Open the code panel">Open code</button></span></div><pre tabindex="0"><code>${escapeHTML(block.code)}</code></pre></section>`;
  }).replace(/\uE002(\d+)\uE003/g,(_,id)=>tables[Number(id)]||'');
  return {html,blocks};
}
function markdown(value){return formatMarkdown(value).html}
function renderMarkdown(body,value){const result=formatMarkdown(value);body.innerHTML=result.html;codeByBody.set(body,result.blocks);return result}

async function copyCodeText(value){
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value);return true}}catch{}
  const text=document.createElement('textarea');text.value=value;text.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';document.body.append(text);text.focus();text.select();
  try{return !!document.execCommand('copy')}finally{text.remove()}
}
function codeFileName(language){
  const extension=({html:'html',htm:'html',js:'js',mjs:'mjs',jsx:'jsx',ts:'ts',tsx:'tsx',css:'css',json:'json',py:'py',python:'py',cs:'cs',cpp:'cpp',c:'c',rs:'rs',go:'go',sh:'sh'}[language]||'txt');
  return 'janna-code.'+extension;
}
function setCodeStatus(report,complete=true,index=null){
  const status=$('codeWorkspaceStatus');if(!status)return;
  if(!complete){status.textContent='Still generating · copy or inspect the draft';status.dataset.state='draft';return}
  if(!report||!report.blocks){status.textContent='Not tested · save and run the code to verify it';status.dataset.state='unknown';return}
  const check=index===null?null:report.results?.find(r=>r.block===index+1);
  if(check){status.textContent=check.status==='passed'?'Syntax passed · build and runtime unverified':check.status==='failed'?'Syntax check failed · review compiler diagnostics':'Unverified · '+(check.reason||'No check available');status.dataset.state=check.status==='passed'?'good':check.status==='failed'?'warning':'unknown';const issues=$('codeWorkspaceIssues');if(issues){issues.replaceChildren();if(check.diagnostic)issues.append(el('pre','code-issue',check.diagnostic));}return}
  if(report.errors?.length){status.textContent=`${report.errors.length} syntax / structure issue${report.errors.length===1?'':'s'} detected · review before running`;status.dataset.state='warning';return}
  if(report.warnings?.length){status.textContent=report.warnings.join(' · ');status.dataset.state='unknown';return}
  if(report.checked){status.textContent='Structural checks passed · runtime behavior not verified';status.dataset.state='good';return}
  status.textContent='No supported syntax checks · runtime behavior not verified';status.dataset.state='unknown';
}
function updateCodeWorkspace(body,index,show=false){
  const block=codeByBody.get(body)?.[index];if(!block)return false;
  state.codeWorkspace={body,index,language:block.language,code:block.code,closed:block.closed};
  $('codeWorkspaceName').textContent=codeFileName(block.language);
  $('codeWorkspaceLanguage').textContent=block.language.toUpperCase()||'CODE';
  $('codeWorkspaceCode').textContent=block.code;
  $('codeWorkspaceEditor').value=block.code;
  const canPreview=['html','htm'].includes(block.language);
  $('codePreviewButton').hidden=!canPreview;
  $('codeInteractiveButton').hidden=!canPreview;
  setCodeStatus(body._codeValidation,block.closed,index);
  if(show){$('codeWorkspace').hidden=false;document.body.classList.add('code-open');$('codeWorkspaceSource').hidden=false;$('codeWorkspaceEditor').hidden=true;$('codeWorkspacePreview').hidden=true;$('codePreviewButton').textContent='Preview';}
  return true;
}
function openCodeFromBody(body,index=0){return updateCodeWorkspace(body,index,true)}
function closeCodeWorkspace(){$('codeWorkspace').hidden=true;document.body.classList.remove('code-open');state.codeWorkspace=null}
function codeToPreview(){
  const current=state.codeWorkspace;if(!current)return;
  const code=current.code;
  const interactive=$('codeInteractiveButton').getAttribute('aria-pressed')==='true';
  const csp=`default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; script-src ${interactive?"'unsafe-inline'":"'none'"}; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
  // A sandboxed srcdoc document has an opaque origin: no access to Janna APIs or local files.
  const injected='<meta http-equiv="Content-Security-Policy" content="'+escapeHTML(csp)+'">';
  const html=/<head\b[^>]*>/i.test(code)?code.replace(/<head\b[^>]*>/i,x=>x+injected):injected+code;
  const iframe=$('codeWorkspacePreview');iframe.setAttribute('sandbox',interactive?'allow-scripts':'');iframe.srcdoc=html;
  $('codeWorkspaceSource').hidden=true;$('codeWorkspaceEditor').hidden=true;iframe.hidden=false;
  $('codePreviewButton').textContent='Source';
}
function activeCode(){return state.codeWorkspace?.code||''}
function bindCodeWorkspace(){
  $('codeWorkspaceClose').onclick=closeCodeWorkspace;
  $('codeWorkspaceCopy').onclick=async()=>toast(await copyCodeText(activeCode())?'Code copied':'Copy blocked by this device');
  $('codeWorkspaceSave').onclick=()=>{if(!state.codeWorkspace)return;const name=codeFileName(state.codeWorkspace.language);const url=URL.createObjectURL(new Blob([activeCode()],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)};
  $('codeWorkspaceEdit').onclick=()=>{if(!state.codeWorkspace)return;const editor=$('codeWorkspaceEditor'),isEditing=editor.hidden;
    if(isEditing){editor.value=activeCode();$('codeWorkspaceSource').hidden=true;$('codeWorkspacePreview').hidden=true;editor.hidden=false;editor.focus();$('codeWorkspaceEdit').textContent='Apply edits';}
    else{state.codeWorkspace.code=editor.value;$('codeWorkspaceCode').textContent=editor.value;editor.hidden=true;$('codeWorkspaceSource').hidden=false;$('codeWorkspaceEdit').textContent='Edit';setCodeStatus(null,true);}
  };
  $('codePreviewButton').onclick=()=>{if($('codeWorkspacePreview').hidden){codeToPreview()}else{$('codeWorkspacePreview').hidden=true;$('codeWorkspaceSource').hidden=false;$('codePreviewButton').textContent='Preview'}};
  $('codeInteractiveButton').onclick=()=>{const b=$('codeInteractiveButton'),active=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',String(!active));b.textContent=active?'Scripts off':'Scripts on';if(!$('codeWorkspacePreview').hidden)codeToPreview()};
  $('codeWorkspaceValidate').onclick=async()=>{if(!state.codeWorkspace)return;const block=state.codeWorkspace;try{const report=await api('/api/code/validate',{code:block.code,language:block.language});setCodeStatus(report,true);
      const list=$('codeWorkspaceIssues');list.replaceChildren();for(const issue of [...report.errors,...report.warnings])list.append(el('p','code-issue',issue));if(!report.errors?.length&&!report.warnings?.length)list.append(el('p','code-issue','Static checks found no errors. Test the running page separately.'));
    }catch(e){toast(e.message)}};
  document.addEventListener('click',async e=>{const btn=e.target.closest('[data-code-action]');if(!btn)return;const body=btn.closest('.message-body'),index=Number(btn.dataset.codeIndex);const block=codeByBody.get(body)?.[index];if(!body||!block)return;
    if(btn.dataset.codeAction==='copy'){toast(await copyCodeText(block.code)?'Code copied':'Copy blocked by this device')}
    else if(btn.dataset.codeAction==='open')openCodeFromBody(body,index);
  });
}

function showView(view){state.view=view;document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));const chat=['chats','luna'].includes(view);$('chatView').hidden=!chat;$('contentView').hidden=chat;if(!chat)renderContent();closeMobile()}
function modelRecord(id){return state.modelCatalog.find(m=>m.id===id)||{id,label:id,note:'Installed on this PC',model_class:'Installed local model'}}
function modelLabel(id){return modelRecord(id).label||id}
function rememberModelChoice(){try{if(state.model)localStorage.setItem('janna-selected-model',state.model)}catch{}}
function closeModelMenu(){const menu=$('modelMenu'),list=$('modelMenuList');if(!menu||!list)return;menu.setAttribute('aria-expanded','false');list.hidden=true}
function syncModelMenu(){
  const label=$('modelMenuLabel'),list=$('modelMenuList'),sel=$('model');if(!label||!sel)return;
  const id=sel.value||'';
  label.textContent=id?modelLabel(id):(state.models.length?'Choose a model':'Set up a model');
  if($('modelMenu'))$('modelMenu').setAttribute('aria-label',id?('Model: '+label.textContent):'Model');
  if(!list)return;
  for(const item of list.querySelectorAll('[role=option]'))item.setAttribute('aria-selected',String(item.dataset.value===id));
}
function chooseModel(id){
  const sel=$('model');if(!sel||sel.disabled||!id)return;
  state.model=id;sel.value=id;rememberModelChoice();syncModelMenu();closeModelMenu();refreshNativeLevels();
}
function openModelMenu(){
  const menu=$('modelMenu'),list=$('modelMenuList');if(!menu||!list||menu.disabled)return;
  if(!state.models.length){showView('models');return}
  menu.setAttribute('aria-expanded','true');list.hidden=false;
  const selected=list.querySelector('[aria-selected=true]')||list.querySelector('[role=option]');
  selected?.focus();
}
function renderModelOptions(models){
  state.models=models||[];const sel=$('model');const list=$('modelMenuList');
  const current=state.model||(()=>{try{return localStorage.getItem('janna-selected-model')||''}catch{return ''}})();
  sel.replaceChildren();if(list)list.replaceChildren();
  const ordered=[];const seen=new Set();
  for(const row of state.modelCatalog){if(models.includes(row.id)&&!seen.has(row.id)){ordered.push(row);seen.add(row.id)}}
  for(const id of models){if(!seen.has(id)){ordered.push(modelRecord(id));seen.add(id)}}
  if(!ordered.length){sel.add(new Option('Set up a model',''));state.model='';syncModelMenu();return}
  let group='';
  for(const row of ordered){
    sel.add(new Option(row.label,row.id));
    if(!list)continue;
    const heading=row.model_class==='Janna engineering profile'?'Janna profiles':(row.cloud?'Cloud models':'Other models on this PC');
    if(heading!==group){group=heading;list.append(el('div','model-menu-group',heading))}
    const item=el('button','model-menu-item');item.type='button';item.setAttribute('role','option');item.dataset.value=row.id;
    item.append(el('strong','',row.label));const noteText=row.note||(row.cloud?'':'Installed on this PC');if(noteText)item.append(el('small','',noteText));
    item.onclick=()=>chooseModel(row.id);
    list.append(item);
  }
  if(list){
    const add=el('button','model-menu-item');add.type='button';
    add.append(el('strong','','Add a model'),el('small','','Qwen, other local models, and Cline'));
    add.onclick=()=>{closeModelMenu();showView('models')};
    list.append(add);
  }
  state.model=models.includes(current)?current:(models.find(m=>/^janna-pro-1\.0(?::latest)?$/.test(m))||models.find(m=>/^janna-lite-1\.0(?::latest)?$/.test(m))||models.find(m=>/^janna-lite-1\.0(?::latest)?$/.test(m))||models[0]);
  sel.value=state.model;syncModelMenu();refreshNativeLevels();
}
async function refreshNativeLevels(){const selected=state.reasoning;state.nativeLevels=['default'];state.modelVision=false;if(!state.model){state.reasoning='default';return}try{const r=await api('/api/reasoning/'+encodeURIComponent(state.model));state.modelVision=r.vision===true;if(r.verified)state.nativeLevels=r.levels||['default']}catch{}state.reasoning=state.nativeLevels.includes(selected)?selected:'default';if(typeof renderPending==='function')renderPending()}
function syncDesktopChrome(){
  window.syncPhoneChrome?.();
  try{window.chrome?.webview?.postMessage(JSON.stringify({type:'janna.theme',theme:document.body.dataset.theme||'rose'}))}
  catch{/* PWA and ordinary browser sessions have no native title bar */}
}
function refreshResearchSwitch(){
  const control=$('researchToggle');if(!control)return;
  const mode=state.settings.research_mode||'auto';
  const labels={auto:'Web · Auto',always:'Web · On',off:'Web · Off'};
  const stateEl=$('researchState');if(stateEl)stateEl.textContent={auto:'Auto',always:'On',off:'Off'}[mode]||'Auto';else control.textContent=labels[mode]||labels.auto;
  control.dataset.mode=mode;
  control.setAttribute('aria-label','Web research: '+(mode==='off'?'disabled':mode==='always'?'every question':'automatic'));
  control.setAttribute('aria-pressed',String(mode!=='off'));
  control.title=mode==='off'?'Research is disabled for this session':
    mode==='always'?'Search public sources for each question':'Search public sources when current evidence is useful';
}
async function cycleResearchSwitch(){
  if(state.busy)return toast('Finish or stop the active response before changing research mode');
  const modes=['auto','always','off'];
  const current=state.settings.research_mode||'auto';
  const next=modes[(modes.indexOf(current)+1)%modes.length];
  try{const result=await api('/api/settings',{research_mode:next});state.settings=result.settings;refreshResearchSwitch();
    toast(next==='off'?'Web research disabled':next==='always'?'Web research enabled for every question':'Automatic research enabled')}
  catch(e){toast(e.message)}
}
function statusBadge(health){if(Array.isArray(health.busy))state.busySessions=health.busy;const ok=health.ollama??!!state.models.length;$('sidebarDot').classList.toggle('offline',!ok);$('headerDot').classList.toggle('offline',!ok);$('sidebarState').textContent=ok?(state.busy?'Working locally':state.busySessions.length?'Working in another chat':(window.__JANNA_WEB__?'Cloud · Ready':'Local model · Ready')):(window.__JANNA_WEB__?'Cloud · Offline':'Local model · Offline');$('headerMode').textContent=window.__JANNA_WEB__?'Web edition':(state.remote?'Private connection':'Local mode');const gpu=health.gpu||state.gpu;state.gpu=gpu;$('gpuState').textContent=gpu?.available?`${gpu.utilization_percent}% GPU`:'GPU'}
let showArchivedChats=false;
async function doDeleteSession(s){
  if(state.busy)return toast('Stop the current task before deleting chats');
  try{
    await api('/api/sessions/delete',{session_id:s.id});
    state.sessions=state.sessions.filter(x=>x.id!==s.id);
    if(state.session===s.id){state.session=null;await newSession(state.project)}
    else renderRecents();
    toast('Conversation deleted');
  }catch(e){toast(e.message)}
}
async function updateSessionMeta(s,patch){
  try{
    const r=await api('/api/sessions/update',Object.assign({session_id:s.id},patch));
    Object.assign(s,r);renderRecents();
  }catch(e){toast(e.message)}
}
function closeChatMenu(){const m=$('chatMenu');if(m)m.hidden=true}
function openChatMenu(s,anchor){
  let m=$('chatMenu');
  if(!m){m=el('div','chat-menu');m.id='chatMenu';document.body.appendChild(m);
    document.addEventListener('pointerdown',e=>{if(!m.hidden&&!e.target.closest('#chatMenu')&&!e.target.closest('.recent-menu-btn'))m.hidden=true});
  }
  m.replaceChildren();
  const item=(label,fn,danger)=>{const b=el('button','chat-menu-item'+(danger?' danger':''),label);b.type='button';b.onclick=()=>{m.hidden=true;fn()};m.append(b);return b};
  item('Rename',()=>startRename(s));
  item(s.pinned?'Unpin':'Pin chat',()=>updateSessionMeta(s,{pinned:!s.pinned}));
  item('Share',()=>shareSession(s));
  item(s.archived?'Unarchive':'Archive',()=>updateSessionMeta(s,{archived:!s.archived}));
  const del=item('Delete',()=>{},true);
  del.onclick=()=>{if(!del.dataset.armed){del.dataset.armed='1';del.textContent='Tap again to delete';setTimeout(()=>{if(del.isConnected){delete del.dataset.armed;del.textContent='Delete'}},2600);return}m.hidden=true;doDeleteSession(s)};
  const r=anchor.getBoundingClientRect();m.hidden=false;
  m.style.left=Math.max(8,Math.min(r.left,window.innerWidth-216))+'px';
  m.style.top=(r.bottom+196>window.innerHeight?Math.max(8,r.top-196):r.bottom+4)+'px';
}
async function shareSession(s){
  try{
    const full=await api('/api/session/'+encodeURIComponent(s.id));
    const text=(full.messages||[]).map(mm=>((mm.role==='user'?'You: ':'Janna: ')+(mm.content||''))).join('\n\n')||(s.title||'New chat');
    if(navigator.share){try{await navigator.share({title:s.title||'Janna chat',text})}catch{}}
    else toast(await copyCodeText(text)?'Chat copied to share':'Copy failed');
  }catch(e){toast(e.message)}
}
function startRename(s){
  const row=document.querySelector('.recent-row[data-sid="'+CSS.escape(s.id)+'"]');
  if(!row)return;const titleBtn=row.querySelector('.recent-item');if(!titleBtn)return;
  const input=document.createElement('input');input.className='recent-rename';input.value=s.title||'New chat';input.setAttribute('aria-label','Rename conversation');
  titleBtn.replaceWith(input);input.focus();input.select();
  let done=false;
  const commit=async save=>{if(done)return;done=true;const v=input.value.trim();if(save&&v&&v!==s.title){await updateSessionMeta(s,{title:v})}else renderRecents()};
  input.addEventListener('keydown',e=>{if(e.key==='Enter')commit(true);if(e.key==='Escape')commit(false);e.stopPropagation()});
  input.addEventListener('blur',()=>commit(true));
}
function renderRecents(){
  const box=$('sessionList');box.replaceChildren();
  const sorted=state.sessions.slice().sort((a,b)=>((b.pinned?1:0)-(a.pinned?1:0))||(b.updated-a.updated));
  const main=sorted.filter(x=>!x.archived),arch=sorted.filter(x=>x.archived);
  if(!main.length&&!arch.length){box.append(el('div','empty-recents','Start a conversation'))}
  const addRow=s=>{
    const row=el('div','recent-row');row.dataset.sid=s.id;
    const b=el('button','recent-item'+(s.id===state.session?' active':''),s.title||'New chat');
    b.title=s.title||'New chat';b.onclick=()=>openSession(s.id);
    row.append(b);
    if(s.pinned){const pin=el('span','pin-mark');pin.innerHTML='<svg><use href="#i-pin"/></svg>';pin.title='Pinned';row.append(pin)}
    const menu=el('button','recent-menu-btn','\u22ef');menu.type='button';menu.title='Chat actions';menu.setAttribute('aria-label','Actions for '+(s.title||'conversation'));
    menu.onclick=e=>{e.stopPropagation();const m=$('chatMenu');if(m&&!m.hidden){closeChatMenu()}else openChatMenu(s,menu)};
    row.append(menu);box.append(row);
  };
  main.slice(0,25).forEach(addRow);
  if(arch.length){
    const t=el('button','archived-toggle',(showArchivedChats?'\u25be ':'\u25b8 ')+'Archived ('+arch.length+')');
    t.type='button';t.onclick=()=>{showArchivedChats=!showArchivedChats;renderRecents()};
    box.append(t);
    if(showArchivedChats)arch.forEach(addRow);
  }
}

async function newSession(projectId=state.project){if(state.busy)return toast('Stop the active run first.');try{const s=await api('/api/sessions',{project_id:projectId||null});state.session=s.id;state.sessions.unshift({id:s.id,title:s.title,project_id:s.project_id,updated:s.updated,pinned:false,archived:false});state.events=[];$('conversationLabel').textContent='New chat';renderRecents();renderConversation(s);showView('chats');$('prompt').focus()}catch(e){toast(e.message)}}
async function openSession(id){if(state.busy)return toast('Stop the active run before switching conversations.');try{const s=await api('/api/session/'+encodeURIComponent(id));state.session=id;state.project=s.project_id||null;state.events=s.events||[];$('conversationLabel').textContent=s.title||'New chat';$('workspaceLabel').textContent=selectedProject()?.name||'Workspace';renderRecents();renderConversation(s);showView(s.purpose==='luna'?'luna':'chats');showRunRecovery(s)}catch(e){toast(e.message)}}
function completionPanel(report){
  const panel=el('details','source-evidence');panel.append(el('summary','','Completion checks · '+report.status),el('p','muted',report.message||''));
  for(const check of report.checks||[]){const item=el('div','evidence-item');item.append(el('strong','',check.name+' · '+check.status+' · exit '+String(check.exit_code??'unavailable')),el('pre','raw-panel',check.tail||'No output'));panel.append(item)}
  return panel;
}
function evidencePanel(report){
  const panel=el('details','source-evidence'),summary=el('summary','','Evidence · '+report.total+' statements');
  const filter=el('select','inline-input');filter.setAttribute('aria-label','Filter evidence');
  const labels={all:'All statements',source_located:'Source located · behavior unverified',inferred:'Inferred · untested',analogy:'Analogy',unverified:'Unverified'};
  for(const [value,label] of Object.entries(labels))filter.add(new Option(label,value));
  const list=el('div','evidence-list');
  function draw(){list.replaceChildren();for(const claim of report.claims.filter(c=>filter.value==='all'||c.category===filter.value)){
    const row=el('div','evidence-item');row.append(el('small','pill',labels[claim.category]||'Unverified'),el('p','',claim.text));
    for(const ref of claim.citations||[]){const detail=el('details'),title=el('summary','',ref.path+':'+ref.first_line+' · '+(ref.status==='source_located'?'source matched':'unverified'));detail.append(title);
      if(ref.excerpt)detail.append(el('pre','raw-panel',ref.excerpt));
      detail.append(el('small','muted',ref.reason||('Working-copy SHA-256 '+ref.sha256+' · commit '+(ref.commit||'uncommitted'))));row.append(detail)}list.append(row)
  }}
  filter.onchange=draw;panel.append(summary,el('p','muted',report.scope),filter,list);if(report.truncated)panel.append(el('p','muted','Showing the first 100 statements.'));draw();return panel;
}
function makeMessage(m){const wrapper=document.createElement('article');wrapper.className='message '+(m.role==='user'?'user':'assistant');if(m.role==='user'){const bubble=document.createElement('div');bubble.className='user-bubble';bubble.textContent=m.content||'';wrapper.appendChild(bubble);if(Array.isArray(m.attached)&&m.attached.length)wrapper.append(el('div','attachment-note',m.attached.map(item=>item.name+' · '+(item.kind==='image'?'image':'log')).join(' · ')));const uact=el('div','message-actions user-actions');const ucopy=el('button','message-action');ucopy.title='Copy';ucopy.setAttribute('aria-label','Copy');ucopy.innerHTML='<svg><use href="#i-copy"/></svg>';ucopy.onclick=async()=>{toast(await copyCodeText(m.content||'')?'Copied':'Copy failed')};uact.append(ucopy);wrapper.appendChild(uact);return wrapper}const header=document.createElement('div');header.className='assistant-head';const img=document.createElement('img');img.className='small-mark';img.src='/mark-clean.png';img.alt='';header.append(img,document.createTextNode('Janna'));wrapper.appendChild(header);const content=document.createElement('div');content.className='message-body';content._codeValidation=m.code_validation||null;renderMarkdown(content,m.content||'');wrapper.appendChild(content);
  const actions=el('div','message-actions');const copyBtn=el('button','message-action');copyBtn.title='Copy response';copyBtn.setAttribute('aria-label','Copy response');copyBtn.innerHTML='<svg><use href="#i-copy"/></svg>';copyBtn.onclick=async()=>{toast(await copyCodeText(m.content||'')?'Copied':'Copy failed')};const shareBtn=el('button','message-action');shareBtn.title='Share';shareBtn.setAttribute('aria-label','Share');shareBtn.innerHTML='<svg><use href="#i-share"/></svg>';shareBtn.onclick=async()=>{const text=m.content||'';if(navigator.share){try{await navigator.share({text})}catch{}}else toast(await copyCodeText(text)?'Copied to share':'Copy failed')};actions.append(copyBtn,shareBtn);wrapper.appendChild(actions);
  if(m.activity&&Array.isArray(m.activity.steps)&&m.activity.steps.length){const chain=document.createElement('details');chain.className='activity-chain';const sum=document.createElement('summary');sum.textContent='Thought for '+fmtDur(m.activity.seconds||1);const ol=document.createElement('ol');ol.className='activity-steps';for(const label of m.activity.steps){const li=document.createElement('li');li.textContent=finishedStep(label);ol.append(li)}chain.append(sum,ol);wrapper.insertBefore(chain,content);}
  if(m.evidence?.claims?.length)wrapper.append(evidencePanel(m.evidence));
  if(m.completion_verification)wrapper.append(completionPanel(m.completion_verification));
  if(m.code_repaired)wrapper.append(el('small','muted','Syntax errors corrected in one checked pass. Original draft retained below; runtime behavior remains unverified.'));
  if(m.model_used && m.model_used!==state.model)wrapper.append(el('span','pill','Recovered with '+modelLabel(m.model_used)));
  if(m.research_note)wrapper.append(el('p','research-integrity-note',m.research_note));
  if(m.sources?.length && state.settings.show_citations!==false){
    const refs=el('details','source-references'),sum=el('summary','','References · '+m.sources.length);
    const freshness=m.research_freshness||'unknown';
    if(freshness==='stale_cache')sum.textContent+=' (offline cache, may be outdated)';
    if(freshness==='local_only')sum.textContent+=' (local source only)';
    refs.append(sum);
    for(const src of m.sources.slice(0,12)){
      const row=el('div','reference-row'),url=String(src.url||'');
      if(/^https?:\/\//.test(url)){
        const a=el('a','reference-link',(src.title||url)+(src.stale?' · STALE':''));
        a.href=url;a.target='_blank';a.rel='noopener noreferrer';row.append(a);
      }else row.append(el('span','',src.title||'Local source'));
      if(src.snippet)row.append(el('small','',src.snippet));refs.append(row)
    }
    wrapper.append(refs)
  }
  if(m.original&&m.original!==m.content||m.status||m.refusal_origin||m.metrics?.tokens_per_second){const foot=document.createElement('div');foot.className='message-metadata';if(m.status){const status=document.createElement('span');status.textContent='Work · '+String(m.status).toLowerCase()+(m.status_origin?' ('+m.status_origin+')':'');foot.append(status)}if(m.refusal_origin){foot.append(el('span','', 'Model response · shown unedited'))}if(m.metrics?.time_to_first_token_ms!=null){foot.append(el('span','',`First response ${Math.round(m.metrics.time_to_first_token_ms)} ms`))}if(m.metrics?.tokens_per_second){foot.append(el('span','',`${m.metrics.tokens_per_second} tokens/sec · measured`))}if(m.original&&m.original!==m.content){const toggle=document.createElement('button');toggle.className='raw-toggle';toggle.textContent='Show original';const raw=document.createElement('pre');raw.hidden=true;raw.className='raw-panel';raw.textContent=m.original;toggle.onclick=()=>{raw.hidden=!raw.hidden;toggle.textContent=raw.hidden?'Show original':'Hide original'};foot.append(toggle);wrapper.append(foot,raw)}else wrapper.appendChild(foot)}if(m.run_id)wrapper.append(savedActivity(m.run_id));if(m.cancelled)wrapper.append(el('small','muted','Queued instruction cancelled'));return wrapper}
function renderConversation(s){closeCodeWorkspace();const msgs=$('messages');msgs.replaceChildren();const has=!!s.messages?.length;$('welcome').hidden=has;msgs.hidden=!has;$('chatView').classList.toggle('has-messages',has);const target=has?$('composerDock'):$('welcomeComposerSlot');target.appendChild($('composer'));$('composerDock').hidden=!has;if(has){for(const m of s.messages)msgs.appendChild(makeMessage(m));renderQueuedInputs(s.inputs||[]);scrollThread();const last=msgs.lastElementChild?.querySelector('.message-body');if(last&&codeByBody.get(last)?.length&&window.innerWidth>=1150)openCodeFromBody(last,0)}else{$('thread').scrollTop=0}window.updatePhoneLayout?.()}
function scrollThread(){if(!state.tailFollow||!window.getSelection()?.isCollapsed)return;const el=$('thread');requestAnimationFrame(()=>{if(state.tailFollow)el.scrollTop=el.scrollHeight})}
async function openLunaChat(){
  if(state.busy)return toast('Finish or stop the current run before opening Luna chat.');
  try{const session=await api('/api/luna/chat',{project_id:state.project||null});await refreshBootstrap();await openSession(session.id);}
  catch(error){toast(error.message)}
}
function savedActivity(runId){
  const details=el('details','saved-activity'),summary=el('summary','','Saved run activity'),content=el('div');
  details.append(summary,content);let loaded=false;
  details.ontoggle=async()=>{if(!details.open||loaded)return;try{
    const result=await api('/api/runs/'+encodeURIComponent(runId)+'/activity');
    content.replaceChildren(el('p','muted','Run status: '+result.state));
    for(const event of result.events){const p=event.payload,a=p.activity||{},row=el('div','saved-activity-row');if(p.type==='specialization')continue;const labels={diagnostic:'Technical diagnostic',error:'Run failed',accepted:'Run accepted',start:'Run started',first_token:'First answer received',metrics:'Generation measurements',model_used:'Model used',stop_requested:'Stop requested',stopped:'Stopped',cancelled:'Provider cancelled'};
      row.append(el('strong','',a.title||p.message||p.stage||labels[p.type]||'Activity update'));
      if(p.type==='metrics')row.append(el('small','muted',p.tokens_per_second?`${p.tokens_per_second} tokens/sec · measured`:'No generation timing available'));if(p.type==='first_token')row.append(el('small','muted',`${Math.round(p.milliseconds)} ms`));if(a.detail||a.output||p.type==='diagnostic'&&p.text)row.append(el('pre','', [a.detail,a.output,p.type==='diagnostic'?p.text:''].filter(Boolean).join('\n')));
      content.append(row);
    }loaded=true;
  }catch(error){content.textContent=error.message}};
  return details;
}
function renderQueuedInputs(inputs){
  $('queuedInputs')?.remove();const pending=inputs.filter(x=>x.state==='queued');if(!pending.length)return;
  const root=el('section','queued-inputs');root.id='queuedInputs';root.setAttribute('aria-label','Queued instructions');
  root.append(el('strong','','Queued for the next step'));
  for(const item of pending){const row=el('div','queued-input'),input=el('textarea');input.value=item.text;input.setAttribute('aria-label','Pending instruction');
    const change=async(text)=>{try{await api('/api/run/input/edit',{session_id:state.session,input_id:item.id,text});renderQueuedInputs((await api('/api/session/'+state.session)).inputs||[])}catch(error){toast(error.message)}};
    row.append(input,button('Save edit',()=>change(input.value)),button('Remove',()=>change(null)));root.append(row);
  }$('messages').append(root);
}
function showRunRecovery(session){
  for(const goal of (session.goals||[]).slice(0,1)){
    const panel=el('div','run-recovery');panel.append(el('strong','','Goal · '+goal.state),
      el('p','',goal.prompt),el('small','muted','Original deadline: '+new Date(goal.deadline*1000).toLocaleString()+'. Waiting and restarts count.'));
    if(!['running','completed','budget_exhausted'].includes(goal.state)&&goal.deadline*1000>Date.now())
      panel.append(button('Resume after inspecting saved work',()=>{$('prompt').value='/goal resume';send()}));
    $('messages').append(panel);
  }
  const runs=session.runs||[],latest=runs[0];if(!latest)return;
  const active=!['completed','failed','stopped','blocked','outcome_unknown'].includes(latest.state);
  if(active){send(latest);return}
  if(latest.state==='outcome_unknown'){
    const notice=el('div','run-recovery','Previous run outcome unknown after backend restart. Inspect saved progress and project changes before continuing.');
    notice.append(button('Inspect saved progress',()=>send(latest)));$('messages').append(notice);
  }
}

function syncSendState(){const c=$('composer');if(c)c.classList.toggle('is-empty',!$('prompt').value.trim())}
function updateBusy(){const busy=state.busy;$('composer').classList.toggle('is-busy',busy);$('send').hidden=false;$('send').title=busy?'Queue instructions for the next step':'Send';$('stop').hidden=!busy;$('stop').disabled=state.stopRequested;$('stop').title=state.stopRequested?'Stopping; waiting for confirmation':'Stop this run';$('prompt').disabled=false;$('prompt').placeholder=busy?'Queue instructions for the next step…':(state.mode==='agent'?'Describe what you want built or repaired…':'Ask Janna anything…');$('mode').disabled=busy;$('model').disabled=busy;if($('modelMenu'))$('modelMenu').disabled=busy;if(busy)closeModelMenu();statusBadge({ollama:!!state.model});$('sidebarState').textContent=busy?'Working locally':$('sidebarState').textContent}
function setMode(mode){state.mode=mode;$('mode').value=mode;if(mode==='agent'&&!state.project){toast('Choose a project for coding work.');openProjectDialog()}$('prompt').placeholder=mode==='agent'?'Describe what you want built or repaired…':'Ask Janna anything…';}
function renderPending(){
  const tray=$('attachmentTray');if(!tray)return;
  tray.replaceChildren();
  tray.hidden=!state.pending.length;
  for(const item of state.pending){
    const chip=el('span','attachment-chip');
    if(item.kind==='image'&&item.file){const img=document.createElement('img');img.alt='';img.src=URL.createObjectURL(item.file);chip.append(img)}
    chip.append(document.createTextNode(item.name+' · '+(item.kind==='image'?(state.modelVision?'image':'image, pixels not sent'):'log')));
    chip.append(button('Remove',()=>{state.pending=state.pending.filter(row=>row!==item);renderPending()}));
    tray.append(chip);
  }
}
function downscaleImageFile(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{try{const scale=Math.min(1,1568/Math.max(img.naturalWidth||1,img.naturalHeight||1));const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));const cv=document.createElement('canvas');cv.width=w;cv.height=h;const cx=cv.getContext('2d');cx.fillStyle='#ffffff';cx.fillRect(0,0,w,h);cx.drawImage(img,0,0,w,h);URL.revokeObjectURL(url);cv.toBlob(blob=>{if(!blob){reject(new Error('Could not shrink the image'));return}resolve(new File([blob],(file.name||'photo').replace(/\.[a-z0-9]+$/i,'')+'.jpg',{type:'image/jpeg'}))},'image/jpeg',0.85)}catch(err){URL.revokeObjectURL(url);reject(err)}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read the image'))};img.src=url})}
function fileBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(reader.error||new Error('Could not read the file'));reader.readAsDataURL(file)})}
async function send(resumeRun=null){
  if(!resumeRun?.id)resumeRun=null;
  const attached=resumeRun?[]:(state.pending||[]).slice();
  const prompt=$('prompt').value.trim()||(attached.length?'Look at the attached evidence.':'');
  if(!prompt&&!resumeRun)return;
  if(!resumeRun&&!state.busy&&state.busySessions.length)return toast('Another local task is running. Open Luna to inspect or stop it; your message stays here.');
  if(state.busy){
    if(!state.session)return;
    try{
      const queued=await api('/api/run/update',{session_id:state.session,run_id:state.runId,prompt});
      $('prompt').value='';syncSendState();
      $('messages').append(makeMessage({role:'user',content:prompt}));
      scrollThread();
      toast(`Queued for the next step · ${queued.queued} pending`);renderQueuedInputs((await api('/api/session/'+state.session)).inputs||[]);
    }catch(e){toast(e.message)}
    return;
  }
  if(!resumeRun&&!state.model){showView('models');return toast('Install Janna Pro 1.1 or Janna Lite 1.1 from the Models page.')}
  if(!resumeRun){
    try{
      const check=await api('/api/project/preflight',{prompt,mode:state.mode,project_id:state.project||null});
      if(check.needs_project){state.projectDraft=prompt;openProjectDialog();toast('Choose the folder you want edited. Your request is saved.');return}
    }catch(e){toast(e.message);return}
  }
  if(!state.session){await newSession();if(!state.session)return}
  const sid=state.session;
  state.busy=true;state.runId=resumeRun?.id||null;state.stopRequested=false;state.stream='';state.events=[];state.tailFollow=true;
  updateBusy();$('prompt').value='';syncSendState();if(!resumeRun){state.pending=[];renderPending()}
  $('welcome').hidden=true;$('messages').hidden=false;
  $('chatView').classList.add('has-messages');
  $('composerDock').appendChild($('composer'));$('composerDock').hidden=false;
  const user=makeMessage({role:'user',content:prompt,attached:attached.map(item=>({name:item.name,kind:item.kind}))});
  if(!resumeRun&&attached.some(item=>item.kind==='image'&&item.file)){
    const previews=document.createElement('div');previews.className='attachment-previews';
    for(const item of attached.filter(row=>row.kind==='image'&&row.file)){const img=document.createElement('img');img.className='attachment-preview';img.alt=item.name;img.src=URL.createObjectURL(item.file);previews.append(img)}
    user.append(previews);
  }
  const response=makeMessage({role:'assistant',content:''});
  if(!resumeRun)$('messages').append(user);$('messages').append(response);
  const body=response.querySelector('.message-body');
  const live=document.createElement('section');
  live.className='work-stream';live.setAttribute('aria-label','Live task activity');if(state.mode!=='agent')live.classList.add('chat-stream');
  live.innerHTML=`<button class="work-stream-heading" type="button" aria-expanded="true"><span class="work-stream-indicator"></span><b class="work-stream-title">Thinking</b><span class="work-stream-clock">0s</span><span class="work-stream-chevron">⌄</span></button><div class="work-stream-body"><ol class="work-stream-list"></ol></div>`;
  response.append(live);
  live.hidden=state.settings.show_progress===false;
  const title=live.querySelector('.work-stream-title');title.setAttribute('role','status');title.setAttribute('aria-live','polite');const setTitle=value=>{if(title.textContent!==value)title.textContent=value};
  const list=live.querySelector('.work-stream-list');
  const clock=live.querySelector('.work-stream-clock');
  const wrap=live.querySelector('.work-stream-body');
  const timeline=[];let droppedFrom='';
  let sources=[],began=performance.now()-(resumeRun?.created?Math.max(0,Date.now()-resumeRun.created*1000):0),done=false,recovered=false,codeReport=null;
  live.querySelector('.work-stream-heading').onclick=()=>{wrap.hidden=!wrap.hidden;live.querySelector('.work-stream-heading').setAttribute('aria-expanded',String(!wrap.hidden))};
  const elapsed=setInterval(()=>{if(!done)clock.textContent=Math.max(0,Math.round((performance.now()-began)/1000))+'s'},1000);
  function add(stage,label,info='',url=''){
    if(!label)return;
    const prev=timeline[timeline.length-1];
    if(prev&&prev.label===label&&prev.detail===info)return;
    const row={stage,label,detail:info,url};timeline.push(row);
    if(timeline.length>48)timeline.shift();
    const lastDone=list.lastElementChild?.querySelector('strong');if(lastDone)lastDone.textContent=finishedStep(lastDone.textContent);
    const li=el('li','work-stream-step'),dot=el('span','work-step-mark'),details=el('div','work-step-content');
    // Details stay one tap away. Anything the person must act on stays visible.
    if(stage==='recovery'||stage==='connection'||label==='Run failed')li.classList.add('open');
    if(info||url)li.onclick=event=>{if(event.target.tagName!=='A')li.classList.toggle('open')};
    details.append(el('strong','',label));
    if(info)details.append(el('small','',info));
    if(url&&/^https?:\/\//i.test(url)){const a=el('a','work-step-link','Source');a.href=url;a.target='_blank';a.rel='noopener noreferrer';details.append(a)}
    li.append(dot,details);list.append(li);
    while(list.children.length>12)list.firstElementChild.remove();
    [...list.children].forEach((node,i)=>node.classList.toggle('is-current',i===list.children.length-1&&!done));
    clock.textContent=Math.round((performance.now()-began)/1000)+'s';
  }
  scrollThread();
  let nextFrame=0,dirty=false, metrics=null,painted=0;
  const render=()=>{dirty=false;body.style.whiteSpace='pre-wrap';if(state.stream.length>painted)body.append(document.createTextNode(state.stream.slice(painted)));painted=state.stream.length;if(state.codeWorkspace?.body===body&&$('codeWorkspaceEditor').hidden&&$('codeWorkspacePreview').hidden){updateCodeWorkspace(body,state.codeWorkspace.index)}scrollThread()};
  try{
    const options={session_id:sid,prompt,mode:state.mode,model:state.model,reasoning:state.reasoning,
      effort:state.effort,speed:state.speed,autocontinue:true,
      polish:state.settings.refine_reports===true,passes:state.settings.autonomy_passes||8,luna_member:state.lunaMember||'luna',
      attachments:attached.map(({kind,name,text,data})=>({kind,name,text,data}))};
    for await(const ev of JannaRuns.subscribe(options,state.token,(connection,runId,detail)=>{
      if(runId)state.runId=runId;
      if(connection==='reconnecting'&&!droppedFrom){droppedFrom=title.textContent;setTitle('Reconnecting to your PC')}
      else if(connection==='connected'&&droppedFrom){setTitle(droppedFrom);droppedFrom=''}
    },resumeRun?.id)){
        state.runId=ev.run_id;
        switch(ev.type){
          case 'start':window.lunaSetState?.(ev.mode==='agent'?'coding':'thinking');setTitle(ev.mode==='agent'?'Working':'Thinking');break;
          case 'progress':
            window.lunaSetState?.(ev.stage==='research'?'researching':ev.stage==='verification'?'checking':'thinking');
            setTitle(ev.message||'Working');
            if(ev.message)add(ev.stage,ev.message);break;
          case 'specialization':
            // Expertise is already provided to the model. Do not clutter chat with internal plumbing.
            break;
          case 'reasoning':{
            // ChatGPT-style: reasoning shows as an activity status in the chain,
            // never as raw model text.
            setTitle('Thinking');add('analysis','Thinking through the problem');break}
          case 'reasoning_activity':
            setTitle('Thinking');add('analysis','Thinking through the problem');break;
          case 'sources':
            window.lunaSetState?.('researching');sources=ev.sources||[];
            {
              const descriptors={live_leads:'Live source leads; content still needs verification',stale_cache:'Live search unavailable — old cached references, NOT current',local_only:'Local source matches only; external sources unavailable',unavailable:'No research leads available; answer from known material only'};
              const freshness=ev.freshness||'unavailable';
              // One line, like every other finished action. The answer carries the source links.
              const names=sources.slice(0,6).map(src=>`${src.stale?'Old: ':''}${src.title}`).join(' · ');
              add('research',sources.length?`Checked ${sources.length} ${sources.length===1?'source':'sources'}`:'Found no sources',[descriptors[freshness]||'',names].filter(Boolean).join(' — '));
            }
            break;
          case 'delta':window.lunaSetState?.('writing');state.stream+=ev.text||'';dirty=true;setTitle('Writing');break;
          case 'cycle':setTitle(ev.goal?`Goal step ${ev.index}`:'Working');if(ev.goal)add('implementation',title.textContent,'Working within the original goal deadline');else if(ev.index>1)add('implementation','Started another pass on the work',`Pass ${ev.index} of at most ${ev.total}`);break;
          case 'activity':
            window.lunaSetState?.('coding');state.events.push(ev.activity);if(state.events.length>300)state.events.shift();
            add(ev.activity.kind==='error'?'verification':'implementation',ev.activity.title||'Tool activity',ev.activity.detail||ev.activity.status||'');break;
          case 'diagnostic':state.events.push({title:'Technical report',detail:ev.text,status:'notice'});add('verification','Technical diagnostic',ev.text);break;
          case 'first_token':break;
          case 'metrics':metrics=ev;break;
          case 'notice':add('overview',ev.message||'Notice');break;
          case 'model_used':if(ev.fallback)add('overview','Model recovery',`Continued with installed model ${modelLabel(ev.model)}`);break;
          case 'code_validation':codeReport=ev.report;if(ev.report?.errors?.length)add('verification','Code review',ev.report.errors.length+' issues to inspect');else if(ev.report?.warnings?.length)add('verification','Partially verified',ev.report.warnings.join(' · '));else if(ev.report?.checked)add('verification','Syntax check','Syntax checks passed; build and runtime unverified');break;
          case 'completion_verification':add('verification','Completion checks · '+ev.report.status,ev.report.message||'Inspect the recorded task results');break;
          case 'polishing':setTitle('Improving the final explanation');add('verification','Refining the report','Original technical evidence is preserved');break;
          case 'input_accepted':case 'input_queued':add('input',ev.message);api('/api/session/'+sid).then(s=>renderQueuedInputs(s.inputs||[])).catch(()=>{});break;
          case 'stop_requested':state.stopRequested=true;updateBusy();setTitle('Stopping…');break;
          case 'recovery':done=true;recovered=true;if(dirty)render();setTitle('Outcome unknown');add('recovery','Recovery required',ev.message);toast(ev.message,12000);break;
          case 'error':done=true;setTitle('Run failed');add('verification','Run failed',ev.message);toast(ev.message||'Task failed');break;
          case 'cancelled':case 'stopped':state.stopRequested=true;setTitle('Stopped');break;
          case 'done':
            done=true;state.stream=ev.text||state.stream;sources=ev.sources||sources;voiceSpeak(state.stream);
            {
              const selection=window.getSelection();
              const preserveSelection=selection&&!selection.isCollapsed&&response.contains(selection.anchorNode);
              const isChatRun=options.mode!=='agent';
              const secs=Math.max(1,Math.round((performance.now()-began)/1000));
              const activity=isChatRun&&timeline.length?{steps:timeline.map(t=>t.label),seconds:secs}:null;
              const finished=makeMessage({role:'assistant',content:state.stream,original:ev.original,status:ev.status,status_origin:ev.status_origin,refusal_origin:ev.refusal_origin,polished:ev.polished,metrics:ev.metrics,code_validation:ev.code_validation||codeReport,code_repaired:ev.code_repaired,evidence:ev.evidence,completion_verification:ev.completion_verification,sources,research_freshness:ev.research_freshness,research_note:ev.research_note,model_used:ev.model_used,activity});
              if(timeline.length){setTitle(ev.run_state==='stopped'?'Stopped':ev.run_state==='blocked'?'Work blocked':isChatRun?`Thought for ${fmtDur(secs)}`:'Activity');clock.textContent=timeline.length+' steps';live.classList.add('is-done');[...list.children].forEach(n=>n.classList.remove('is-current'));wrap.hidden=true;if(!preserveSelection&&!activity)finished.append(live);}
              if(preserveSelection){if(dirty)render();}
              else {response.replaceWith(finished);const code=finished.querySelector('.message-body');if(codeByBody.get(code)?.length&&window.innerWidth>=1150)openCodeFromBody(code,0);}
            }
            break;
        }
        if(dirty&&performance.now()-nextFrame>55&&!done){nextFrame=performance.now();render()}
    }
    if(dirty&&!done)render();
    if(!done)throw new Error('Connection lost; the run outcome is unknown. Reopen this conversation to reconcile.');
  }catch(e){toast(e.message);if(dirty)render();setTitle('Connection lost · outcome unknown');add('connection','Outcome unknown',e.message);live.append(button('Reconnect to saved run',()=>{state.busy=false;send({id:state.runId})}));}
  finally{
    window.lunaSetState?.(done&&!recovered&&!state.stopRequested?'done':'idle');
    clearInterval(elapsed);state.busy=false;updateBusy();
    try{await refreshBootstrap()}catch{}
    if(done&&!recovered&&state.session===sid&&window.getSelection()?.isCollapsed){try{const s=await api('/api/session/'+encodeURIComponent(sid));state.events=s.events||state.events;renderConversation(s);$('conversationLabel').textContent=s.title||'New chat'}catch{}}
    scrollThread();
  }
}
async function stop(){
  if(!state.session||state.stopRequested)return;
  if(!state.runId)return toast('Waiting for the server to identify this run. Stop will be available once accepted.');
  state.stopRequested=true;updateBusy();
  try{const receipt=await api('/api/stop',{session_id:state.session,run_id:state.runId});toast(receipt.message);if(!receipt.stop_requested){state.stopRequested=false;updateBusy()}}
  catch(e){state.stopRequested=false;updateBusy();toast('Stop request failed: '+e.message+'. You can retry.');}
}
function renderContent(){
  const view=state.view,heading=$('contentHeading'),body=$('contentBody');
  const titles={
    projects:['Projects','Choose a real checkout to investigate, edit, build and verify.'],
    models:['Models','Janna Pro 1.1, Janna Lite 1.1, and other installed models.'],
    knowledge:['Knowledge','Janna Pro’s engineering playbooks, reference sources, and reviewed lessons.'],
    research:['Research','Find live source references, implementation examples, and local code matches.'],
    plugins:['Plugins','Connect tools to your workspace. Changes and deployments require explicit project scope.']
  };
  const [name,lead]=titles[view]||['Workspace',''];
  heading.innerHTML=`<h1>${escapeHTML(name)}</h1><p class="content-lead">${escapeHTML(lead)}</p>`;
  body.replaceChildren();
  if(view==='projects')renderProjectsPanel(body);
  else if(view==='models')renderModelsPanel(body);
  else if(view==='knowledge')renderKnowledgePanel(body);
  else if(view==='research')renderResearchPanel(body);
  else if(view==='plugins')renderPluginsPanel(body);
}

function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function button(text,click,kind='text-btn'){const b=el('button',kind,text);b.type='button';b.onclick=click;return b}
function section(parent,title){const h=el('h3','section-title',title);h.style.margin='30px 0 12px';parent.append(h)}
function renderProjectsPanel(root){const add=button('Add project',openProjectDialog,'action-btn');root.append(add);if(!state.projects.length){const p=el('p','muted','No projects selected yet. Add the exact folder containing your current source checkout.');root.append(p)}const grid=el('div','cards');grid.style.marginTop='20px';for(const p of state.projects){const card=el('div','card'),title=el('h3','',p.name),desc=el('p','',p.path),row=el('div','form-row');row.append(button('Open project',()=>{state.project=p.id;$('workspaceLabel').textContent=p.name;newSession(p.id)}),button('Inspect project',()=>showProjectDetail(p.id)));card.append(title,desc,row);if(state.project===p.id)card.append(el('span','pill','Current project'));grid.append(card)}root.append(grid);section(root,'Connected services');const con=el('div','cards');con.id='services';con.innerHTML='<div class="card"><h3>GitHub</h3><p>Checking authorization…</p></div><div class="card"><h3>Figma</h3><p>Checking configuration…</p></div>';root.append(con);api('/api/connections').then(r=>{con.replaceChildren();for(const [key,label] of [['github','GitHub'],['figma','Figma']]){const data=r[key]||{};const card=el('div','card');card.append(el('h3','',label),el('p','',data.connected?'Connected':(data.status||'Not connected')));if(data.repository)card.append(el('p','code-inline',data.repository));if(data.pull_requests?.length)for(const pr of data.pull_requests)card.append(el('p','',`#${pr.number} · ${pr.title}`));con.append(card)}}).catch(()=>{});section(root,'Computer and emulator controls');const row=el('div','card');row.append(el('h3','','Project applications'),el('p','','Launch an application from your selected project and stop only that process. Nothing outside the project can be launched.'));const input=el('input','inline-input');input.placeholder='relative/path/to/Emulator.exe';input.id='exeRelative';input.style.width='100%';row.append(input);row.append(button('Launch application',async()=>{if(!state.project)return toast('Select a project');try{await api('/api/process/start',{project_id:state.project,path:input.value});toast('Application started.');showProjectDetail(state.project)}catch(e){toast(e.message)}},'action-btn'));row.append(button('Show running applications',()=>openDrawer('processes')));root.append(row);section(root,'Verification');const testBox=el('div','card');testBox.append(el('h3','','Build and test'),el('p','','Janna can run the build and regression suite for your selected checkout. It records actual output and does not treat a successful compile as proof of gameplay.'));testBox.append(button('Run project tests',()=>{setMode('agent');$('prompt').value='Inspect the current repository, identify its documented regression test command, execute it, and report the exact results. Do not modify unrelated code.';showView('chats');$('prompt').focus()},'action-btn'));root.append(testBox)}
async function showProjectDetail(id){state.project=id;const p=selectedProject();if(!p)return;openDrawer('project');let target=$('drawerBody');target.replaceChildren();target.append(el('p','',p.path));try{const snap=await api('/api/project/status/'+id);for(const [key,label] of [['branch','Branch'],['head','Commit'],['modified_count','Modified files']])target.append(el('p','',`${label}: ${snap[key]??'Not available'}`));const procs=await api('/api/processes');for(const item of procs.processes||[]){if(item.project_id!==id)continue;const row=el('div','list-row');row.append(el('strong','',`${item.name} · PID ${item.pid}`),button('Stop',async()=>{try{await api('/api/process/stop',{process_id:item.id});toast('Process stopped.');showProjectDetail(id)}catch(e){toast(e.message)}}));target.append(row)}}catch(e){target.append(el('p','muted',e.message))}}
function renderModelsPanel(root){
  const ready=!!state.pro?.installed, lite=!!(state.pro?.installed_lite||state.pro?.installed_lite);
  const lightweightSelected=lite&&(!ready||/^janna-lite-1\.0|^janna-lite-1\.0/.test(state.model));
  const feature=el('div','card pro-hero');feature.append(el('span','eyebrow','JANNA INTELLIGENCE'),el('h2','',lightweightSelected?'Janna Lite 1.1':'Janna Pro 1.1'));
  feature.append(el('p','',lightweightSelected?'A lighter local engineering model for 8 GB GPUs, with smaller context and memory budgets.':'Your local engineering model for emulator design, graphics, JITs, decompilation, and tested coding workflows.'));
  feature.append(el('span','pill',ready?'Ready on this PC':lite?'Janna Lite 1.1 ready':'Setup required'));
  if(!ready && !lite){
    if(window.__JANNA_WEB__){
      feature.append(el('p','muted','This web version uses cloud models — no installation needed. Pick a model on the chat screen and start asking. Local Janna Pro 1.1 / Janna Lite 1.1 setup belongs to the desktop app.'));
    }else{
    feature.append(el('p','muted',state.pro?.base_installed?
      'The model weights are already present. Finish setting up Janna Pro below.':
      'No model installed yet. Janna can install the official local runtime, model weights and coding tools on this Windows PC—no paid API required.'));
    if(state.remote){feature.append(el('p','muted','Model installation is available only from the Windows desktop. Open Janna on your PC to complete setup.'));}
    else{
      const actions=el('div','form-row');
      const install=button('Set up Janna Pro 1.1',async()=>{
        if(!confirm('Set up Janna Pro 1.1 on this Windows PC? The first run downloads roughly 8.3 GB of model weights plus official local tools. This uses disk space and internet data, but no paid model API.'))return;
        install.disabled=true;
        try{await api('/api/setup/start',{lightweight:false,skip_coding_agent:false});toast('Setting up Janna Pro. You can follow the progress below.');watchSetup(progress,install)}
        catch(e){install.disabled=false;toast(e.message,12000)}
      },'action-btn');
      const small=button('Use a lighter model',async()=>{
        if(!confirm('Install the smaller Janna Lite 1.1 profile instead? It uses a smaller 9B base and will not have the same capability as the recommended Janna Pro 1.1.'))return;
        small.disabled=true;
        try{await api('/api/setup/start',{lightweight:true,skip_coding_agent:false});watchSetup(progress,small)}
        catch(e){small.disabled=false;toast(e.message,12000)}
      });
      actions.append(install,small);feature.append(actions);
      const progress=el('pre','setup-progress','Checking setup status…');feature.append(progress);
      watchSetup(progress);
    }
    }
  }else{
    const name=ready?'janna-pro-1.0':(state.pro?.installed_lite?'janna-lite-1.0':'janna-lite-1.0');
    feature.append(button('Use '+(ready?'Janna Pro 1.1':'Janna Lite 1.1'),()=>{
      chooseModel(state.models.find(m=>m===name||m.startsWith(name+':'))||state.model);showView('chats');
    },'action-btn'));
  }
  root.append(feature);
  section(root,'Installed models');
  root.append(button('Refresh model status',async()=>{await refreshBootstrap();renderContent()}));
  const grid=el('div','cards');
  for(const id of state.models){
    const row=modelRecord(id);const card=el('div','card');card.append(el('h3','',row.label),el('p','',row.note||'Installed on this PC.'));
    if(id===state.model)card.append(el('span','pill','Selected'));
    else card.append(button('Select',()=>{chooseModel(id);showView('chats')}));grid.append(card)
  }
  root.append(grid);
  if(!state.models.length)root.append(el('p','muted','No local model is ready. Complete setup above; model downloads can be resumed if interrupted.'));
  section(root,'Add a local model');
  root.append(el('p','muted','One click downloads a model from the local registry onto this PC. Janna Pro 1.1 and Janna Lite 1.1 stay the Janna profiles. Cline can use the same installed model when it is pointed at Ollama on this computer.'));
  const library=el('div','cards');
  for(const item of state.library||[]){
    const card=el('div','card');
    card.append(el('h3','',item.label),el('p','',item.note),el('p','',item.fit));
    if(item.installed)card.append(el('span','pill','Installed'));
    else card.append(button('Install',()=>installLibraryModel(item),'action-btn'));
    library.append(card);
  }
  root.append(library);
  section(root,'Cline');
  const cline=el('div','card');
  cline.append(el('h3','','Cline command'),el('p','','Cline is a separate coding app. Installing it does not replace OpenCode, and Janna Work mode still uses OpenCode with Janna Pro or Janna Lite.'));
  if(state.clineInstalled)cline.append(el('span','pill','Installed'),el('p','muted','Run cline auth and choose Ollama at http://127.0.0.1:11434 to use a model installed here.'));
  else cline.append(button('Install Cline',installCline,'action-btn'),el('p','muted','Requires Node.js npm. After install, run cline auth and choose Ollama. No API key is stored by this button.'));
  root.append(cline);
  const progress=el('pre','setup-progress','');progress.id='libraryProgress';progress.hidden=true;root.append(progress);
  const info=el('p','muted','Janna Pro 1.1 is an engineering-specialized profile derived from separately downloaded upstream weights, not independently trained weights. Source attribution is available in the release documentation.');
  info.style.marginTop='24px';root.append(info);
}
async function installLibraryModel(item){
  if(!confirm(`Download ${item.label} (${item.id})?\n\n${item.fit}. ${item.note}\n\nThis uses disk space and internet data. It does not replace Janna Pro 1.1 or Janna Lite 1.1. Cline can select it if Cline uses Ollama on this PC.`))return;
  const progress=$('libraryProgress');if(progress){progress.hidden=false;progress.textContent='Starting download…'}
  try{await api('/api/models/install',{tag:item.id});if(progress)watchSetup(progress)}
  catch(e){toast(e.message,12000)}
}
async function installCline(){
  if(!confirm('Install the Cline command from the official npm package?\n\nCline is separate from Janna. Work mode still uses OpenCode. After install, run cline auth and choose Ollama at http://127.0.0.1:11434. This button does not save an API key.'))return;
  const progress=$('libraryProgress');if(progress){progress.hidden=false;progress.textContent='Starting Cline install…'}
  try{await api('/api/tools/cline/install',{});if(progress)watchSetup(progress)}
  catch(e){toast(e.message,12000)}
}
async function watchSetup(target,buttonNode){
  const alive=()=>document.body.contains(target);
  let status;
  try{status=await api('/api/setup/status')}catch(err){if(alive())target.textContent='Setup status unavailable: '+err.message;return}
  if(!alive())return;
  const latest=status.messages||[];
  target.textContent=(status.running?'Installing…':status.state==='ready'?'Install finished.':status.state==='failed'?'Setup needs attention.':'')+'\n'+latest.slice(-13).join('\n');
  target.scrollTop=target.scrollHeight;
  if(status.running){setTimeout(()=>watchSetup(target,buttonNode),1500);return}
  if(buttonNode)buttonNode.disabled=false;
  if(status.state==='ready'){await refreshBootstrap();if(state.view==='models')renderContent()}
}

async function renderKnowledgePanel(root){
  const summary=el('div','card');summary.append(el('span','eyebrow','JANNA PRO 1.0 / ENGINEERING LIBRARY'),el('h2','','Emulator & decomp knowledge'));
  root.append(summary);
  try{
    const pack=await api('/api/expertise');
    summary.append(el('p','',`${pack.counts.platforms} console/platform families · ${pack.counts.playbooks} engineering methods · ${pack.counts.sources} primary-source reference leads`));
    summary.append(el('p','muted','These are versioned engineering references retrieved for relevant tasks, not model-weight training. Source facts must be checked against current code.'));
    const search=el('input','inline-input');search.placeholder='Try: PS3 SPU DMA, Switch 2 GPU barriers, N64 decomp…';search.style.width='100%';
    const found=el('div','knowledge-retrieval');
    async function lookup(){
      if(!search.value.trim())return;
      try{const res=await api('/api/expertise/search',{query:search.value});found.replaceChildren();
        if(!res.relevant){found.append(el('p','muted','Enter a specific emulator, GPU, CPU, or binary question.'));return}
        found.append(el('h3','','Selected references'));
        for(const p of [...res.platforms,...res.playbooks])found.append(el('span','pill',p.title));
        for(const source of res.sources.slice(0,7)){const a=el('a','reference-link',source.title);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';found.append(a,el('span','muted',' — '+source.focus),el('div'))}
      }catch(e){toast(e.message)}
    }
    summary.append(search,button('Find engineering methods',lookup,'action-btn'),found);
    search.onkeydown=e=>{if(e.key==='Enter')lookup()};
  }catch(e){summary.append(el('p','muted','Engineering catalog unavailable: '+e.message))}
  section(root,'Personal knowledge');
  const textarea=el('textarea','inline-input');textarea.rows=3;textarea.placeholder='Remember a preferred coding style, project convention, or workflow…';textarea.style.width='100%';
  root.append(textarea,button('Save note',async()=>{try{await api('/api/memory',{text:textarea.value,project_id:state.project||null});toast('Note saved locally');renderContent()}catch(e){toast(e.message)}},'action-btn'));
  const container=el('div','knowledge-items');container.style.marginTop='22px';root.append(container);
  try{const r=await api('/api/memory');for(const m of r.items){const row=el('div','list-row'),info=el('div');info.append(el('strong','',m.text),el('p','',m.project_id?'Project-specific':'All projects'));row.append(info,button('Remove',async()=>{await api('/api/memory/delete',{id:m.id});renderContent()}));container.append(row)}if(!r.items.length)container.append(el('p','muted','No personal notes yet.'))}catch(e){container.append(el('p','muted',e.message))}
  section(root,'Reviewed engineering lessons');
  const lesson=el('textarea','inline-input');lesson.rows=2;lesson.placeholder='What did a real emulator test or investigation establish?';lesson.style.width='100%';
  const evidence=el('input','inline-input');evidence.placeholder='Evidence: commit, test result, issue, or local report';evidence.style.width='100%';
  root.append(lesson,evidence,button('Save verified lesson',async()=>{
    if(!confirm('Save this as a user-reviewed engineering lesson? It may need re-verification later.'))return;
    try{await api('/api/expertise/lessons/add',{text:lesson.value,evidence:evidence.value,project_id:state.project||null,reviewed:true});toast('Reviewed lesson saved');renderContent()}catch(e){toast(e.message)}
  },'action-btn'));
  try{const r=await api('/api/expertise/lessons');for(const x of r.lessons.slice(-12).reverse()){
    const row=el('div','list-row'),info=el('div');info.append(el('strong','',x.text),el('p','muted',x.evidence));row.append(info,button('Delete',async()=>{await api('/api/expertise/lessons/delete',{id:x.id});renderContent()}));root.append(row)
  }}catch(e){root.append(el('p','muted',e.message))}
}

function focusPrompt(text=''){
  closeDrawer();showView('chats');
  if(text){$('prompt').value=text;syncSendState()}
  $('prompt').focus();
}
async function drawTools(){
  const root=$('drawerBody');root.replaceChildren();
  root.append(button('Verified build',()=>openDrawer('vibe'),'action-btn'),button('Janna Pro trainer',()=>openDrawer('training'),'action-btn'),button('Connect iPhone',()=>openDrawer('remote'),'action-btn'));
  root.append(el('p','muted','Research, source exploration and coding tools are available from the same conversation. Select a project for file edits and tests.'));
  section(root,'Active project');
  const project=selectedProject();
  const projectCard=el('div','card tools-card');
  projectCard.append(el('strong','',project?.name||'No project selected'),el('p','muted',project?'Your current source checkout is available to Work mode.':'Chat works without a project. Choose one when you want Janna to edit or test actual code.'));
  projectCard.append(button(project?'Change project':'Choose project',openProjectDialog,'action-btn'));
  projectCard.append(button('Edit project files',()=>{setMode('agent');closeDrawer();$('prompt').focus()}));
  if(project)projectCard.append(button('Add changes to GitHub',reviewGitHubPush));
  root.append(projectCard);
  root.append(el('p','muted','To add a GitHub repository link to your website, choose the website folder and describe where it belongs. Janna edits that project. Add changes to GitHub pushes an already committed feature branch through your existing Git login.'));
  section(root,'Research & code');
  const input=el('input','inline-input');input.placeholder='What should Janna investigate?';input.style.width='100%';
  const go=button('Research in chat',()=>{if(!input.value.trim())return toast('Enter a research question');focusPrompt('Research and cite current sources: '+input.value.trim())},'action-btn');
  root.append(input,go,el('p','muted','Janna researches automatically when useful. External search providers receive a short, scrubbed query—not your project files.'));
  section(root,'Connections');
  root.append(button('Engineering workbench',()=>openDrawer('engineering'),'text-btn'),button('GitHub and Figma',()=>openDrawer('connections'),'text-btn'),button('PC controls',()=>openDrawer('host'),'action-btn'),button('Build and test harness',()=>openDrawer('harness'),'text-btn'),button('Manage Discord bot',()=>openDrawer('bots'),'text-btn'),button('iPhone access',()=>openDrawer('remote'),'text-btn'));
  section(root,'Free research options');
  const status=el('div','card');root.append(status);
  try{const keys=await api('/api/research/providers');status.append(el('p','',keys.tavily?'Free web search key connected':'No dedicated search key yet · public fallbacks are active'));
    const tav=el('input','inline-input');tav.type='password';tav.placeholder='Tavily free API key';tav.autocomplete='off';tav.style.width='100%';
    status.append(tav,button('Save free search key',async()=>{if(!tav.value.trim())return toast('Paste a key from your Tavily dashboard');try{await api('/api/research/providers',{provider:'tavily',key:tav.value.trim()});tav.value='';toast('Search connection saved on this PC');drawTools()}catch(e){toast(e.message)}},'action-btn'));
    const link=el('a','reference-link','Get free search credits');link.href='https://app.tavily.com/';link.target='_blank';link.rel='noopener noreferrer';status.append(link);
    status.append(el('p','muted','Google-grounded search is also supported as an explicit opt-in integration. It uses a hosted model and may have billing or privacy implications.'));
    const gem=el('input','inline-input');gem.type='password';gem.placeholder='Optional Gemini API key';gem.autocomplete='off';gem.style.width='100%';
    const opt=el('label','toggle-setting'),ck=el('input');ck.type='checkbox';ck.checked=keys.google_enabled===true;opt.append(ck,el('span','','Allow Google-grounded source lookups (sends public search queries to Google)'));
    status.append(gem,opt,button('Save Google search preference',async()=>{try{await api('/api/research/providers',{provider:'google',key:gem.value.trim(),google_enabled:ck.checked});gem.value='';toast('Research preference updated');drawTools()}catch(e){toast(e.message)}},'text-btn'));
  }catch(e){status.append(el('p','muted','Research connections: '+e.message))}
}
async function drawProfile(){
  const root=$('drawerBody');root.replaceChildren();
  const heading=el('div','profile-hero');
  const mark=el('img','profile-mark');mark.src='/mark-clean.png';mark.alt='Janna logo';
  heading.append(mark,el('div','','Choose how you use Janna'));
  heading.lastChild.textContent='Choose how you use Janna';
  const web=!!window.__JANNA_WEB__;
  root.append(heading,el('p','muted',web?'Your chats and preferences stay in this browser on the web edition. Export a backup file any time, and import it here or on another device.':'Profiles identify your local workspace. Imported chats and preferences remain on this PC. Discord sign-in verifies an identity but does not upload or sync local projects.'));
  const current=el('div','profile-current');root.append(current);
  const reload=async()=>{const r=await api('/api/profile');current.textContent='Current: '+r.profile.label+' · '+r.profile.kind;state.profile=r.profile;$('profileName').textContent=r.profile.label;return r};
  try{await reload()}catch(e){current.textContent=e.message}
  section(root,'Continue');
  const guest=button('Use as guest',async()=>{try{await api('/api/profile/select',{kind:'guest'});await reload();toast('Guest profile selected')}catch(e){toast(e.message)}},'profile-choice');
  const win=button('Use this Windows profile',async()=>{try{await api('/api/profile/select',{kind:'windows'});await reload();toast('Windows profile selected')}catch(e){toast(e.message)}},'profile-choice');
  const discord=button('Continue with Discord',async()=>{try{const r=await api('/api/profile/discord/start',{});if(!r.available){toast(r.message,11000);const p=el('p','muted',`Register the redirect URI in your Discord developer application: ${r.redirect_uri}`);root.append(p);return}window.open(r.url,'_blank','noopener,noreferrer');toast('Finish Discord authorization in the browser, then refresh this panel.',10000)}catch(e){toast(e.message)}},'profile-choice discord-choice');
  if(web){root.append(guest)}else{root.append(guest,win,discord)}
  section(root,web?'Back up or move your chats':'Transfer an existing setup');
  root.append(el('p','muted',web?'Export saves your chats and preferences in this browser as one JSON file. Import merges it without deleting anything already here.':'Export your chats and preferences from another Janna Windows installation, then import the JSON file here. API keys, device pairing and absolute project paths are excluded.'));
  const upload=el('input','profile-upload');upload.type='file';upload.accept='.json,application/json';upload.hidden=true;
  upload.onchange=async()=>{const file=upload.files?.[0];if(!file)return;if(file.size>999999)return toast('Profile must be under 1 MB');if(!web&&!window.confirm('Import conversations and preferences from this selected file? Current conversations will be preserved.'))return;
    try{const payload=JSON.parse(await file.text());const r=await api('/api/profile/import',payload);toast(`Imported ${r.imported.conversations} conversations and ${r.imported.notes} notes`);await refreshBootstrap();await reload()}catch(e){toast(e.message,11000)}finally{upload.value=''}};
  root.append(button(web?'Import profile':'Import Windows profile',()=>upload.click(),'action-btn'),upload);
  root.append(button('Export this profile',async()=>{try{const data=await api('/api/profile/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='janna_profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}catch(e){toast(e.message)}},'text-btn'));
}
function openDrawer(kind){const box=$('drawer');box.hidden=false;box.dataset.kind=kind;const title={tools:'Tools & connections',profile:'Your profile',harness:'Test harness',host:'PC controls',settings:'Settings',companion:'Your companion',activity:'Activity',connections:'Connections',project:'Project details',processes:'Running applications',bots:'Discord bot',remote:'iPhone access',training:'Janna Pro trainer',vibe:'Verified build',engineering:'Engineering tools'};const k={tools:'WORKSPACE',profile:'JANNA ACCOUNT',harness:'VERIFICATION',host:'WINDOWS HOST',settings:'JANNA',companion:'COMPANION',activity:'WORKSPACE',connections:'INTEGRATIONS',project:'LOCAL PROJECT',processes:'WINDOWS',bots:'AUTOMATION',remote:'PRIVATE ACCESS',vibe:'JANNA PRO',engineering:'EVIDENCE WORKBENCH'};$('drawerTitle').textContent=title[kind]||'Workspace';$('drawerKicker').textContent=k[kind]||'JANNA';$('drawerBody').replaceChildren();switch(kind){case 'training':return drawTraining();case 'vibe':return window.drawVibe();case 'engineering':return drawEngineering();case 'tools':return drawTools();case 'profile':return drawProfile();case 'harness':return drawHarness();case 'host':return drawHostControls();case 'settings':return drawSettings();case 'companion':return drawCompanion();case 'activity':return drawActivity();case 'connections':return drawConnections();case 'processes':return drawProcesses();case 'bots':return drawBots();case 'remote':return drawRemote();case 'project':return;}}
function closeDrawer(){$('drawer').hidden=true}
function legacyDrawSettings(){const root=$('drawerBody');root.append(el('p','','The appearance and personality are yours to customize. Model infrastructure remains behind the scenes.'));section(root,'Appearance');const grid=el('div','theme-grid');const samples={rose:['#fce9f2','#fff8fb'],velvet:['#1d1119','#241722'],porcelain:['#f1f0ec','#fbfaf8'],pro:['#181d21','#1f2326'],sakura:['#f6ecee','#fffaf8'],matcha:['#eaf0e4','#f8f9f2'],indigo:['#eaeaf3','#f8f8fc'],midnight:['#121722','#161a24']};for(const [name,palette] of Object.entries(samples)){const b=button(name[0].toUpperCase()+name.slice(1),async()=>{await persistSettings({theme:name});drawSettings()},'theme-option'+((state.settings.theme||'rose')===name?' selected':''));const swatch=el('span','theme-swatch');swatch.style.setProperty('--sample-side',palette[0]);swatch.style.setProperty('--sample-main',palette[1]);b.prepend(swatch);grid.append(b)}root.append(grid);section(root,'Personality');const select=el('select','inline-input');for(const name of ['precise','friendly','technical','concise'])select.add(new Option(name[0].toUpperCase()+name.slice(1),name));select.value=state.settings.personality||'precise';select.onchange=()=>persistSettings({personality:select.value});root.append(select);section(root,'Responses');const refine=el('label','toggle-setting');const check=el('input');check.type='checkbox';check.checked=state.settings.refine_reports!==false;check.onchange=async()=>{await persistSettings({refine_reports:check.checked});toast(check.checked?'Final coding reports are refined locally in Standard speed.':'Extra local rewriting is disabled.')};refine.append(check,el('span','','Refine final coding reports with a second local pass'));root.append(refine,el('p','muted','Improves clarity without claiming unverified results. Boost skips the extra pass to protect response speed.'));section(root,'Reasoning');root.append(el('p','',`Active workflow depth: ${state.effort}. Adjust it in the message composer.`));const native=el('select','inline-input');for(const level of state.nativeLevels){native.add(new Option(level==='default'?'Automatic native reasoning':String(level).toUpperCase(),String(level)))}native.value=String(state.reasoning);native.onchange=()=>{state.reasoning=native.value;toast('Native reasoning preference updated')};root.append(native);root.append(el('p','',`These native thinking controls apply to Chat. Coding tasks use the model's verified provider defaults, plus the selected work depth and regression checks.`));section(root,'Integrations & devices');root.append(button('Private iPhone access',()=>openDrawer('remote')),button('GitHub and Figma',()=>openDrawer('connections')),button('Discord bot',()=>openDrawer('bots')));section(root,'Autonomous coding');root.append(el('p','', 'Janna works across successive verified passes until the objective is complete, blocked, stopped, or reaches your safety limit.'));const loops=el('select','inline-input');for(const n of [4,8,12])loops.add(new Option(`${n} passes maximum`,String(n)));loops.value=String(state.settings.autonomy_passes||8);loops.onchange=()=>persistSettings({autonomy_passes:Number(loops.value)});root.append(loops);section(root,'Advanced');root.append(el('p','',`Autonomous work uses explicit project boundaries and a Stop control. Protect your source with commits and backups before large changes.`));}
async function persistSettings(partial){try{const r=await api('/api/settings',partial);state.settings=r.settings;document.body.dataset.theme=state.settings.theme||'rose';localStorage.setItem('janna-theme',document.body.dataset.theme);syncDesktopChrome();refreshResearchSwitch()}catch(e){toast(e.message)}}
async function drawCompanion(){if(window.drawLuna)return window.drawLuna();const root=$('drawerBody');const badge=el('div','card');badge.append(el('h3','','Janna is here'),el('p','','Your companion watches registered projects for changes without consuming GPU inference while idle. It can keep project notes and report activity when you return.'));root.append(badge);section(root,'Project activity');try{const r=await api('/api/companion');for(const a of (r.events||[]).slice(0,18)){const row=el('div','list-row');row.append(el('strong','',a.text),el('small','muted',new Date(a.time*1000).toLocaleString()));root.append(row)}if(!r.events?.length)root.append(el('p','muted','Everything is quiet. Add a project to begin watching changes.'))}catch(e){root.append(el('p','muted',e.message))}section(root,'Automations');root.append(button('Manage Discord bot',()=>openDrawer('bots')),button('View agent activity',()=>openDrawer('activity')))}
window.noteEngineering=function(event){if(!event?.name)return;const key=event.name+'|'+event.title+'|'+(event.time||'');if(window.noteEngineering.seen?.has(key))return;(window.noteEngineering.seen||=new Set()).add(key);state.events.push({title:event.title,status:event.name,detail:event.detail||''});if(state.events.length>300)state.events.shift();const msgs=$('messages');if(!msgs||msgs.hidden)return;const row=el('div','saved-activity-row');row.append(el('strong','',event.title),el('small','muted',event.name));msgs.append(row);scrollThread()};
function drawActivity(){const root=$('drawerBody');root.append(el('p','',state.busy?'Janna is actively working. Tool results appear as the coding agent reports them.':'Recent execution evidence from this conversation.'));const list=el('ol','drawer-events');for(const ev of state.events.slice(-80).reverse()){const li=el('li');li.append(el('b','',ev.title||'Activity'),el('small','',`${ev.status||'Recorded'}${ev.tool?' · '+ev.tool:''}`));if(ev.detail||ev.output){const det=el('details'),sum=el('summary','', 'Technical evidence'),pre=el('pre','',[ev.detail,ev.output].filter(Boolean).join('\n\n'));det.append(sum,pre);li.append(det)}list.append(li)}if(!state.events.length)root.append(el('p','muted','No agent actions in this conversation yet.'));root.append(list)}
async function drawConnections(){const root=$('drawerBody');root.append(el('p','','Janna uses the GitHub and Figma accounts already authenticated on this computer. It does not copy credentials into your chats.'));try{const c=await api('/api/connections');for(const [key,name] of [['github','GitHub'],['figma','Figma']]){const x=c[key]||{};const card=el('div','card');card.style.marginBottom='12px';card.append(el('h3','',name),el('p','',x.connected?'Connected':(x.status||'Not connected')));if(x.repository)card.append(el('span','code-inline',x.repository));root.append(card)}}catch(e){root.append(el('p','',e.message))}root.append(button('Sign in to GitHub',async()=>{try{const r=await api('/api/connections/sign-in',{provider:'github'});toast(r.message||'Continue sign-in in the new Windows window.')}catch(e){toast(e.message)}},'action-btn'));root.append(button('Sign in to Figma',async()=>{try{await persistSettings({figma_enabled:true});const r=await api('/api/connections/sign-in',{provider:'figma',model:state.model});toast(r.message||'Complete Figma sign-in in the Windows sign-in window.')}catch(e){toast(e.message)}},'action-btn'));root.append(button('Enable Figma for coding tasks',async()=>{try{await persistSettings({figma_enabled:true});toast('Figma integration enabled for new agent runs. Complete your Figma sign-in when prompted.')}catch(e){toast(e.message)}},'action-btn'));root.append(el('p','','Figma access requires an authenticated MCP connection. GitHub access uses your existing GitHub authorization.'))}
async function drawProcesses(){const root=$('drawerBody');root.append(el('p','','Only applications explicitly launched by Janna can be stopped here.'));try{const result=await api('/api/processes');for(const p of result.processes||[]){const row=el('div','list-row');row.append(el('strong','',`${p.name} · PID ${p.pid}`));row.append(button('Stop',async()=>{await api('/api/process/stop',{process_id:p.id});drawProcesses()}));root.append(row)}if(!result.processes?.length)root.append(el('p','muted','No Janna-managed applications are running.'))}catch(e){root.append(el('p','muted',e.message))}}
async function drawBots(){const root=$('drawerBody');if(!state.project){root.append(el('p','', 'Choose the project containing your Discord bot first.'));root.append(button('Choose project',openProjectDialog));return}root.append(el('p','',`Current project: ${selectedProject()?.name||'Project'}. Bot credentials must remain in your own environment variables, never in Janna's configuration.`));const input=el('input','inline-input');input.placeholder='bot.py or src/bot.js';input.id='botEntry';root.append(input);const checks=el('div','form-row');const startOn=el('input');startOn.type='checkbox';startOn.id='botAuto';const label=el('label','', 'Start when Janna starts');label.prepend(startOn);checks.append(label);root.append(checks);root.append(button('Save bot setup',async()=>{try{await api('/api/bots/configure',{project_id:state.project,script:input.value,autostart:startOn.checked,autorestart:true});toast('Bot configuration saved');drawBots()}catch(e){toast(e.message)}},'action-btn'));root.append(button('Start bot',async()=>{try{await api('/api/bots/start',{project_id:state.project});toast('Bot started');drawBots()}catch(e){toast(e.message)}}),button('Stop bot',async()=>{try{await api('/api/bots/stop',{project_id:state.project});toast('Bot stopped');drawBots()}catch(e){toast(e.message)}}));try{const r=await api('/api/bots');for(const b of r.bots||[]){if(b.project_id!==state.project)continue;root.append(el('p','code-inline',`${b.script} · ${b.running?'Running':'Stopped'}`));root.append(button('View bot log',async()=>{try{const log=await api('/api/bots/log/'+encodeURIComponent(state.project));const pre=el('pre','raw-panel',log.text||'No output');root.append(pre)}catch(e){toast(e.message)}}))}}catch(e){root.append(el('p','muted',e.message))}}
async function drawRemote(){
 const root=$('drawerBody');root.replaceChildren();
 root.append(el('h3','','Connect your iPhone'),el('p','','Pair once. Janna remembers your phone and reconnects when Safari returns or the network changes. Keep this PC awake and signed in, with Tailscale connected on both devices.'));
 if(state.remote){root.append(el('p','','You are using the private phone connection. Manage pairing and setup on your PC.'));return;}
 const check=el('div','card');root.append(check);
 try{const status=await api('/api/remote/status');check.append(el('p','',status.message));
  if(status.url){const link=el('a','code-inline',status.url);link.href=status.url;link.target='_blank';link.rel='noopener';check.append(link,button('Copy phone address',()=>navigator.clipboard.writeText(status.url).then(()=>toast('Phone address copied.')).catch(()=>toast('Select and copy the displayed address.'))));}
 }catch(error){check.textContent=error.message;}
 root.append(el('p','','1. Install Tailscale on your iPhone and sign in to the same account as this PC.'),button('Set up private phone access',async()=>{try{const r=await api('/api/remote/setup',{});toast(r.message,12000)}catch(e){toast(e.message)}},'action-btn'),button('Check connection again',drawRemote),el('p','','2. Open the private address in Safari. Create a code here and enter it on your phone.'),button('Create pairing code',async()=>{try{const r=await api('/api/remote/pair-code',{});code.textContent=r.code+' · valid for 5 minutes';}catch(e){toast(e.message)}},'action-btn'));
 const code=el('p','code-inline','');root.append(code,el('p','','3. In Safari, tap Share → Add to Home Screen. Open Janna from that icon. If it asks again, pair that Home Screen app once.'));
 root.append(el('p','muted','Private access prevents automatic PC sleep while its background service runs; the display can turn off. Work stays on your PC when the phone locks. Reopening Janna reconnects to saved progress. Manual sleep, shutdown, signing out or network loss makes it temporarily unavailable.'));
 try{const r=await api('/api/pairing/devices');for(const device of r.devices){const row=el('div','list-row');row.append(el('strong','',device.label),button('Revoke',async()=>{await api('/api/remote/revoke',{id:device.id});drawRemote()}));root.append(row)}}catch(e){root.append(el('p','muted',e.message))}
}
async function drawTraining(){
 const root=$('drawerBody');root.replaceChildren();
 root.append(el('h3','','Janna Pro trainer'),el('p','','Experimental training tools for your exact Janna Pro 27B model. Parameter updates and saved-adapter reload are verified; engineering improvements and deployment are not yet qualified. Your current Janna Pro profile is not replaced.'));
 if(state.remote){root.append(el('p','','Start and stop training from the PC.'));return;}
 const summary=el('div','card'),log=el('pre','');root.append(summary);
 let current=null;const saved=el('select','inline-input');saved.setAttribute('aria-label','Saved adapter');
 const refresh=async()=>{try{const r=await api('/api/training');current=r;const selection=saved.value;saved.replaceChildren();for(const item of r.checkpoints||[]){const option=el('option','',`${item.steps} steps · ${item.id.slice(0,8)}`);option.value=item.id;saved.append(option)}if([...saved.options].some(o=>o.value===selection))saved.value=selection;summary.replaceChildren(el('p','',r.configured?'Training environment configured.':'Configure the local training environment below.'));if(r.job){summary.append(el('p','',`${r.job.mode}: ${r.job.status}`),el('p','',`Saved optimizer steps: ${r.job.progress?.optimizer_steps??r.job.result?.optimizer_steps??0}`));if(r.job.error)summary.append(el('p','',r.job.error));log.textContent=r.job.log||'Checking model identity…';}return r;}catch(e){summary.textContent=e.message;}};
 const initial=await refresh();if(!initial)return;
 const start=async(mode,steps=2)=>{try{await api('/api/training/start',{mode,steps,checkpoint_id:saved.value});await refresh()}catch(e){toast(e.message)}};
 const actions=el('div','form-row');actions.append(button('Check model',()=>start('forward'),'action-btn'),button('Check learning · 64 steps',()=>start('smoke',64),'action-btn'),button('Coding pilot · 64 steps',()=>start('pilot',64),'action-btn'),button('Specialist pilot · 64 steps',()=>start('specialist',64),'action-btn'),button('Coding tasks · 64 steps',()=>start('vibe',64),'action-btn'),button('Continue saved run · 32 steps',()=>start('continue',32),'action-btn'),button('Verify saved adapter',()=>start('reload')),button('Stop training',async()=>{try{await api('/api/training/stop',{});await refresh()}catch(e){toast(e.message)}}));root.append(actions,saved,el('p','muted','Training reserves the GPU and unloads idle inference models. It requires 12 GiB free RAM to start and stops below 2 GiB. The learning check uses two artificial associations. The coding pilot uses eight verified examples and compares four held-out tasks. Both save experimental adapters without changing your active model. The specialist pilot adds address, instruction and binary-layout kernels: 16 training examples and six separate evaluation tasks. Each pilot is limited to 30 minutes; no adapter is activated automatically.'),log);
 const settings=el('details',''),heading=el('summary','','Training environment');settings.append(heading);const inputs={};
 for(const [key,label] of [['python','WSL training Python'],['gguf','Exact Janna Pro weight file'],['gguf_python','GGUF reader folder'],['tokenizer','Exact tokenizer folder']]){const input=el('input','inline-input');input.value=initial.config?.[key]||'';input.style.width='100%';input.setAttribute('aria-label',label);settings.append(el('label','',label),input);inputs[key]=input;}
 settings.append(button('Save environment',async()=>{try{await api('/api/training/configure',Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value])));await refresh();toast('Training environment saved.')}catch(e){toast(e.message)}}));root.append(settings);
 const poll=setInterval(()=>{if($('drawer').hidden||$('drawer').dataset.kind!=='training'){clearInterval(poll);return;}refresh()},2000);
}

async function useSelectedProject(project){
  const draft=state.projectDraft??$('prompt').value;
  state.project=project.id;$('projectDialog').close();
  await refreshBootstrap();await newSession(project.id);
  $('prompt').value=draft;syncSendState();delete state.projectDraft;$('prompt').focus();
}
async function reviewGitHubPush(){
  if(!state.project){openProjectDialog();return}
  try{
    const r=await api('/api/plugins/prepare',{plugin:'github',action:'push',project_id:state.project,arguments:{}});
    if(confirm(r.title+'\n\n'+r.command_preview+'\n\nPush these committed changes?')){
      const done=await api('/api/plugins/execute',{approval_id:r.approval_id});
      toast(done.ok?'Branch pushed successfully':'Push failed: '+(done.output||done.error));
    }
  }catch(e){toast(e.message)}
}
function openProjectDialog(){if(!$('projectDialog').open){$('projectDialog').showModal();$('projectPath').focus()}}
function openMobile(){$('sidebar').classList.add('mobile-open');$('mobileScrim').classList.add('visible');$('mobileScrim').hidden=false}
function closeMobile(){$('sidebar').classList.remove('mobile-open');$('mobileScrim').classList.remove('visible');$('mobileScrim').hidden=true}

function renderResearchPanel(root){
  const form=el('div','card research-console');
  form.append(el('h3','','Evidence search'),el('p','','Search the public web and GitHub. When live services fail, Janna can fall back to previously found references or code in the selected project. Cached results are always labelled.'));
  const input=el('input','inline-input');input.placeholder='Search for GPU barrier implementation, a repository, or an unfamiliar tool';
  input.style.width='100%';input.maxLength=500;form.append(input);
  const advanced=el('div','form-row'),codeLabel=el('label','setting-check'),code=el('input');code.type='checkbox';code.checked=true;codeLabel.append(code,document.createTextNode('Search code and selected project'));advanced.append(codeLabel);
  const go=button('Research',search,'action-btn');advanced.append(go);form.append(advanced);root.append(form);
  const results=el('div','research-results');results.style.marginTop='20px';root.append(results);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')search()});
  async function search(){
    if(!input.value.trim())return toast('Enter a research query');
    go.disabled=true;results.replaceChildren();results.append(el('p','muted','Checking independent research sources…'));
    try{
      const response=await api('/api/research',{query:input.value,code:code.checked,project_id:state.project||''});
      results.replaceChildren();
      const statuses={live_leads:'Live reference leads (not independently verified)',stale_cache:'Offline fallback · cached references may be outdated',local_only:'Local source matches only',unavailable:'No references available — try a narrower query or reconnect'};
      const headline=el('div','research-status');headline.append(el('strong','',statuses[response.freshness]||'Research results'));
      if(response.cache_age_seconds!=null)headline.append(el('small','',`Last retrieved about ${Math.ceil(response.cache_age_seconds/3600)} hours ago`));
      results.append(headline);
      const list=el('div','research-source-list');
      for(const item of response.results||[]){
        const card=el('div','card research-source'),url=String(item.url||''),heading=el('strong','research-result-title',item.title||'Reference');
        if(/^https?:\/\//i.test(url)){
          const a=el('a','reference-link',item.title||url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';heading.replaceWith(a);card.append(a)
        }else card.append(heading);
        if(item.snippet)card.append(el('p','',item.snippet));
        const note=el('small','',`${item.stale?'Outdated · ':''}${item.source==='local-code'?'Local project':item.source?.startsWith('github')?'GitHub reference':'Public search'}${item.license?' · License: '+item.license:''}`);card.append(note);list.append(card)
      }
      if(!response.results?.length)list.append(el('p','muted','All sources failed or returned no matches. Janna will not invent references.'));
      results.append(list);
      const info=el('details','provider-details');info.append(el('summary','','Source availability'));
      for(const prov of response.providers||[])info.append(el('p','',`${prov.name}: ${prov.status}`));results.append(info);
    }catch(e){results.replaceChildren();results.append(el('p','muted','Research could not complete: '+e.message))}
    finally{go.disabled=false}
  }
  section(root,'GitHub source explorer');
  const explore=el('div','card source-explorer');
  explore.append(el('h3','','Read actual implementations'),el('p','', 'Inspect public repository structure and bounded source excerpts. Check licenses before copying code or applying patches.'));
  const repo=el('input','inline-input'),terms=el('input','inline-input'),file=el('input','inline-input');
  repo.placeholder='Repository · owner/name';terms.placeholder='Find relevant subsystem · GPU barriers, SPU DMA…';file.placeholder='Optional source path · src/video/renderer.cpp';
  explore.append(repo,terms,file);
  const resultsBox=el('div','repository-results');
  async function inspect(action){
    resultsBox.replaceChildren();resultsBox.append(el('p','muted','Checking GitHub source…'));
    try{
      const v=await api('/api/source/inspect',{action,repository:repo.value,query:terms.value,path:file.value,ref:'HEAD'});
      resultsBox.replaceChildren();
      if(action==='map'){
        resultsBox.append(el('p','',`${v.repo} · ${v.branch} · Reported license: ${v.license}`));
        resultsBox.append(el('p','muted',v.notice));
        if(v.tree_truncated)resultsBox.append(el('p','muted','The upstream tree was truncated, so file discovery is incomplete.'));
        for(const item of v.files){const r=el('div','reference-row');const link=el('a','reference-link',item.path);link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';r.append(link);
          r.append(button('Inspect',()=>{file.value=item.path;inspect('file')}));resultsBox.append(r)
        }
      }else{
        const link=el('a','reference-link',v.path);link.href=v.url;link.target='_blank';link.rel='noopener noreferrer';
        resultsBox.append(link,el('p','muted',v.notice));const pre=el('pre','raw-panel');pre.textContent=v.excerpt;resultsBox.append(pre)
      }
    }catch(e){resultsBox.replaceChildren();resultsBox.append(el('p','muted',e.message))}
  }
  const actions=el('div','form-row');actions.append(button('Map repository',()=>inspect('map'),'action-btn'),button('Read source file',()=>inspect('file')));
  explore.append(actions,resultsBox);root.append(explore);
}
async function renderPluginsPanel(root){
  root.append(el('p','muted','Plugins use existing installed tools and credentials. Publishing actions require an explicit one-time confirmation from your PC.'));
  const grid=el('div','cards');root.append(grid);
  try{
    const data=await api('/api/plugins');
    for(const item of data.plugins||[]){
      const card=el('div','card plugin-card');
      card.append(el('h3','',item.name),el('p','',item.description));
      const badge=el('span','pill',item.connected?'Ready':item.installed?'Setup needed':'Not installed');card.append(badge);
      if(item.id==='research')card.append(button('Search sources',()=>showView('research')));
      if(item.id==='browser'){
        badge.textContent=item.enabled?'Enabled':item.installed?'Available':'Setup needed';
        card.append(el('p','',item.installed?'Uses its own temporary browser session. Your personal tabs stay separate.':'On the PC, run scripts/Install-Browser-Tools.ps1 from your Janna installation.'));
        if(item.installed)card.append(button(item.enabled?'Disable browser':'Enable browser',async()=>{
          try{await persistSettings({browser_enabled:!item.enabled});showView('plugins')}catch(e){toast(e.message)}
        }));
      }
      if(item.id==='github'){
        card.append(button('Connect account',()=>openDrawer('connections')));
        if(state.project)card.append(button('Prepare branch push',async()=>{
          try{
            const r=await api('/api/plugins/prepare',{plugin:'github',action:'push',project_id:state.project,arguments:{}});
            if(confirm(r.title+'\n\n'+r.command_preview+'\n\nProceed?')){
              const done=await api('/api/plugins/execute',{approval_id:r.approval_id});toast(done.ok?'Branch pushed successfully':'Push failed: '+(done.output||done.error));
            }
          }catch(e){toast(e.message)}
        }))
      }
      if(item.id==='figma')card.append(button('Figma connection',()=>openDrawer('connections')));
      if(item.id==='cloudflare'){
        card.append(button('Prepare Pages deployment',()=>{
          if(!state.project)return toast('Select a project first');
          const fields=el('div','deploy-fields');
          const projectName=el('input','inline-input'),folder=el('input','inline-input'),branch=el('input','inline-input');
          projectName.placeholder='Cloudflare Pages project';folder.placeholder='Build output (e.g. dist)';branch.placeholder='Preview branch';
          folder.value='dist';branch.value='preview';fields.append(projectName,folder,branch);
          fields.append(button('Review deployment',async()=>{
            try{
              const draft=await api('/api/plugins/prepare',{plugin:'cloudflare',action:'pages_deploy',project_id:state.project,
                arguments:{name:projectName.value,directory:folder.value,branch:branch.value}});
              if(confirm(draft.title+'\n\n'+draft.command_preview+'\n\nDeploy from this PC?')){
                const result=await api('/api/plugins/execute',{approval_id:draft.approval_id});toast(result.ok?'Pages deployment completed':'Deployment failed: '+(result.output||result.error),12000)
              }
            }catch(e){toast(e.message,10000)}
          },'action-btn'));card.append(fields)
        }))
      }
      if(item.id==='harness')card.append(button('Project test tasks',()=>openDrawer('harness')));
      if(item.id==='discord')card.append(button('Manage bot',()=>openDrawer('bots')));
      grid.append(card)
    }
  }catch(e){grid.append(el('p','muted','Plugin status is unavailable: '+e.message))}
}
async function drawHostControls(){
  const root=$('drawerBody');root.replaceChildren();
  root.append(el('p','muted','Run fixed, read-only checks on the Windows PC hosting Janna. Your iPhone never executes Windows commands. These checks do not alter your running app, Git branches, or releases.'));
  const results=el('div','card');results.append(el('p','muted','No PC diagnostics have been run from this device.'));root.append(results);
  const check=button('Check PowerShell & GitHub on my PC',async()=>{
    check.disabled=true;results.replaceChildren(el('p','','Checking your connected PC…'));
    try{
      const response=await api('/api/host/readiness');
      results.replaceChildren(el('h3','',response.host+' · '+response.executed_on));
      for(const [name,row] of Object.entries(response.checks||{})){
        const label=name.replaceAll('_',' ');
        const entry=el('div','list-row');
        entry.append(el('strong','',label+' · '+row.status),el('pre','raw-panel',row.detail||('Exit '+String(row.exit_code??'unavailable'))));
        results.append(entry);
      }
      if(response.github_release_published)results.append(el('p','', 'Release was published.'));
      else results.append(el('p','muted','No GitHub release was published and your running Janna was not replaced.'));
    }catch(error){results.replaceChildren(el('p','muted','PC diagnostic unavailable: '+error.message))}
    finally{check.disabled=false}
  },'action-btn');
  root.insertBefore(check,results);
  root.append(button('Build and test project',()=>openDrawer('harness')));
  root.append(button('Use local coding agent (Work)',()=>{
    if(!state.project){openProjectDialog();toast('Select a registered project first.');return;}
    setMode('agent');closeDrawer();showView('chats');
    $('prompt').value='Diagnose Windows PowerShell and GitHub tools on this PC, then inspect this project. Report actual command outputs. Do not push, publish, stop or replace my running Janna.';
    $('prompt').focus();
  }));
  root.append(el('p','muted','Building and GitHub pushes require an existing registered project. Public releases and native installation still require independent validation and explicit approval.'));
}

async function drawHarness(){
  const root=$('drawerBody');root.append(el('p','','Tasks must be declared in janna.tasks.json inside your project. Janna records real output and never labels a failed test as passing.'));
  if(!state.project){root.append(button('Choose project',openProjectDialog));return}
  try{
    const tasks=await api('/api/harness/tasks/'+encodeURIComponent(state.project));
    for(const t of tasks.tasks||[]){
      const row=el('div','list-row');row.append(el('div','',t.name+' · '+(t.description||t.id)));
      row.append(button('Run',async()=>{try{const r=await api('/api/harness/run',{project_id:state.project,task_id:t.id});toast('Test task started · '+r.run.id);drawHarness()}catch(e){toast(e.message)}}));root.append(row)
    }
    if(!tasks.tasks?.length)root.append(el('p','muted','No project tasks are declared. Add janna.tasks.json with explicit build or test command arrays.'));
    const runs=await api('/api/harness');section(root,'Recent runs');
    for(const run of (runs.runs||[]).slice(-8).reverse()){
      const card=el('div','card');card.append(el('h3','',run.name+' · '+run.status),el('pre','raw-panel',run.tail||'No output yet'));
      if(run.status==='running')card.append(button('Stop',async()=>{await api('/api/harness/stop',{run_id:run.id});drawHarness()}));root.append(card)
    }
  }catch(e){root.append(el('p','muted',e.message))}
}

async function drawEngineering(){
  const root=$('drawerBody');root.replaceChildren();
  root.append(el('p','muted','Read-only inspection and reproducible tools for emulator, shader, binary and matching-decomp work. All paths stay inside your selected checkout. No ROM or firmware is uploaded.'));
  const project=selectedProject();if(!project){root.append(button('Choose project',openProjectDialog,'action-btn'));return}
  const wrap=el('div','card');wrap.append(el('h3','','Engineering workbench'));
  const query=el('input','inline-input');query.placeholder='Search symbol, opcode, register, error…';query.style.width='100%';
  const relative=el('input','inline-input');relative.placeholder='Project-relative binary or .spv path';relative.style.width='100%';
  const report=el('pre','raw-panel','Select a tool to inspect actual evidence.');report.style.whiteSpace='pre-wrap';
  async function run(action,payload){report.textContent='Checking…';try{const result=await api('/api/engineering/'+action,{project_id:project.id,...payload});report.textContent=JSON.stringify(result,null,2)}catch(e){report.textContent='Analysis unavailable: '+e.message}}
  const target=el('input','inline-input');target.placeholder='Trace destination, e.g. gpu_submit';target.setAttribute('aria-label','Trace destination');
  wrap.append(query,button('Find exact symbols',()=>run('index',{query:query.value}),'action-btn'),
    button('Find call sites',()=>run('index',{query:query.value,kind:'calls'})),
    button('Search text',()=>run('symbols',{query:query.value})),target,
    button('Trace static call path',()=>run('index',{action:'trace',query:query.value,end:target.value})),relative,
    button('Inspect binary',()=>run('binary',{path:relative.value})),button('Validate SPIR-V',()=>run('spirv',{path:relative.value})),
    button('Disassemble SPIR-V',()=>run('disassemble',{path:relative.value})),
    button('Analyze with installed Ghidra',()=>{if(confirm('Analyze this local binary with installed Ghidra? This executes Ghidra on the selected file with a 2 GB heap and 220-second limit.'))run('ghidra',{path:relative.value,confirmed:true})}),report);root.append(wrap);
  section(root,'Saved binary layouts');
  const formatName=el('input','inline-input');formatName.placeholder='Format name';formatName.setAttribute('aria-label','Saved format name');
  const schema=el('textarea','inline-input');schema.rows=9;schema.setAttribute('aria-label','Versioned binary layout JSON');schema.placeholder='{"name":"Packet","revision":1,"endian":"little","fields":[{"name":"magic","type":"u32","offset":0}]}';
  root.append(el('p','muted','Keep explicit offsets, endian, alignment, padding and version gates. Saved layouts are hypotheses; decoding bytes does not prove their meaning.'),formatName,
    button('List saved revisions',()=>run('formats',{action:'list'})),schema,
    button('Save new revision',()=>{try{run('formats',{action:'save',schema:JSON.parse(schema.value)})}catch(e){toast('Enter valid layout JSON: '+e.message)}}),
    button('Decode selected binary',()=>run('formats',{action:'inspect',path:relative.value,name:formatName.value})));
  section(root,'Available analysis tools');
  try{const result=await api('/api/engineering/tools');
    const gpu=el('p','muted',result.gpu_scheduler?.gpu_reserved?'GPU reserved for a graphics test':'GPU is available for Janna inference');root.append(gpu);
    for(const tool of result.tools||[]){const line=el('div','list-row');line.append(el('strong','',tool.purpose),el('small','muted',tool.installed?'Installed · '+tool.id:'Not installed · '+tool.id));root.append(line)}
  }catch(e){root.append(el('p','muted',e.message))}
  root.append(el('p','muted','To execute external analyzers, declare an explicit project task in janna.tasks.json. Graphics performance tasks can request gpu_exclusive to prevent competing model inference.'));
}
async function drawUpdates(){
  const root=$('drawerBody');root.replaceChildren();root.append(el('h3','','Janna updates'),el('p','muted','Check the official Janna GitHub release feed. An update is downloaded and SHA-256 verified before any installation. Existing projects and local model weights are never included in app updates.'));
  const status=el('div','card');root.append(status);status.textContent='Checking release feed…';
  try{const result=await api('/api/update/check');status.replaceChildren();
    if(!result.available){status.append(el('p','',result.published?'Janna is up to date.':(result.reason||'No update available.')));return}
    status.append(el('h3','','Version '+result.version),el('p','',result.notes||'Verified source release'));
    const prepare=button('Download verified update',async()=>{prepare.disabled=true;try{const r=await api('/api/update/prepare',{});toast(r.message,10000);const apply=button('Install when I close Janna',async()=>{if(!confirm('Install verified Janna '+result.version+' after closing the app?'))return;try{const done=await api('/api/update/apply',{confirmed:true});toast(done.message,12000)}catch(e){toast(e.message)}},'action-btn');status.append(apply)}catch(e){toast(e.message,12000)}finally{prepare.disabled=false}},'action-btn');status.append(prepare);
  }catch(e){status.textContent='Release check failed: '+e.message}
}
// A step reads as work in progress while it runs and as a finished action afterwards.
const FINISHED_WORDS={Analyzing:'Analyzed',Thinking:'Thought',Working:'Worked',Comparing:'Compared',Weighing:'Weighed',Organizing:'Organized',Breaking:'Broke',Inspecting:'Inspected',Checking:'Checked',Reading:'Read',Running:'Ran',Writing:'Wrote',Building:'Built',Finding:'Found',Searching:'Searched',Editing:'Edited',Testing:'Tested',Reviewing:'Reviewed',Fetching:'Fetched',Verifying:'Verified',Looking:'Looked',Planning:'Planned',Refining:'Refined',Repairing:'Repaired',Correcting:'Corrected',Diagnosing:'Diagnosed',Preparing:'Prepared',Starting:'Started',Trying:'Tried',Loading:'Loaded',Applying:'Applied'};
const fmtDur=s=>{s=Math.max(1,Math.round(Number(s)||0));return s>=60?Math.floor(s/60)+'m '+(s%60)+'s':s+'s'};
function finishedStep(text){const value=String(text||'');const first=value.split(' ',1)[0];return FINISHED_WORDS[first]?FINISHED_WORDS[first]+value.slice(first.length):value}
const JANNA_THEMES={sage:['#d8e2d3','#eef2e9'],rose:['#fce9f2','#fff8fb'],velvet:['#1d1119','#241722'],porcelain:['#f1f0ec','#fbfaf8'],pro:['#181d21','#1f2326'],sakura:['#f6ecee','#fffaf8'],matcha:['#eaf0e4','#f8f9f2'],indigo:['#eaeaf3','#f8f8fc'],midnight:['#121722','#161a24'],washi:['#f3eee4','#fffdf7'],kintsugi:['#1b2529','#243038'],ume:['#f1e1e5','#fff7f8'],yoru:['#131c29','#182235'],kyoto:['#ede4d7','#faf4e9'],moss:['#26382f','#324537'],sora:['#d9eaf0','#f3faff'],akane:['#f3dfd4','#fff8f0'],zen:['#e8e6df','#f8f7f3'],beni:['#24171c','#2e1d24'],shinku:['#1d1517','#251a1d'],shu:['#f4e1da','#fff9f5'],botan:['#eee1ed','#fcf7fc'],tsuki:['#181c22','#232830'],ruri:['#152238','#1e2e47'],asagi:['#d5ebe8','#f4fbfa'],fuji:['#efe6f4','#fbf7fd'],momiji:['#f8e6d8','#fff8f2'],yuzu:['#f7f3d8','#fffdf3'],take:['#e3edd9','#f6faf3'],mizu:['#dceaf5','#f5f9fd'],kinari:['#f3ecdf','#fbf8f2'],kohaku:['#f8ead0','#fffaf1'],murasaki:['#ece4f6','#faf7fd'],toki:['#f8e4e6','#fff7f8'],moegi:['#e7f0c8','#f8fbea'],gin:['#e6e8ea','#f7f8f8'],chawan:['#f0e6d4','#fbf6ee'],yanagi:['#e4eee4','#f5faf5'],wakatake:['#e8f0dc','#f7fbf3'],usuzumi:['#e8e6e4','#f7f6f4'],ao:['#d9e6f6','#f4f8fd'],enji:['#f6e0dc','#fff6f4'],suzu:['#e4e7e4','#f6f7f6'],kakishibu:['#f6e3d4','#fff7f1'],hanada:['#d7e8f2','#f3f9fc'],kujaku:['#d7efe6','#f2fbf7'],komugi:['#f4ead4','#fdf8ee'],shirayuki:['#f4f6f8','#fbfcfd'],nuri:['#1a1412','#241c18'],tetsu:['#1c2024','#262b30'],kurocha:['#241c16','#2e241c'],nezumi:['#232528','#2c3034'],fukamidori:['#14241c','#1c3026'],konpeki:['#101c30','#17263c'],budou:['#241828','#301e36'],akatsuki:['#2a1820','#361f2a'],roiro:['#141414','#1c1c1c'],kachi:['#141828','#1c2236'],miru:['#142420','#1c302a'],susutake:['#26241c','#322e24'],namari:['#1e2226','#282e34'],enkai:['#0e1c24','#142830'],karasuba:['#16141a','#201c24'],sumizome:['#16181c','#1e2228'],benibana:['#2a1214','#38181c'],yamabuki:['#2a2414','#362e18'],rikyunezu:['#1c221c','#262e26'],soba:['#2a241c','#342c22'],ember:['#ffe3c2','#fff6ea'],dusk:['#15162a','#1c1d36'],slate:['#1e2326','#262c30'],crimson:['#141013','#1c1619'],leaf:['#dcebd2','#f5faf0'],lilac:['#e9e5f5','#faf8fe'],blaze:['#ffe1c7','#fff5ea'],harbor:['#fbe0d9','#fff7ee'],violet:['#1b1430','#231a3d'],forest:['#dfe6dc','#f5f7f0'],tide:['#121c19','#18241f'],blossom:['#fbe3ec','#fff6f9'],azure:['#10192a','#162236'],moon:['#fde6ef','#fff8fb']};
const COLOR_THEMES={ember:'Ember',dusk:'Dusk',slate:'Slate',crimson:'Crimson',leaf:'Leaf',lilac:'Lilac',blaze:'Blaze',harbor:'Harbor',violet:'Violet',forest:'Forest',tide:'Tide',blossom:'Blossom',azure:'Azure',moon:'Moon'};
const themeLabel=name=>COLOR_THEMES[name]||(name==='sage'?'Sage Green':name[0].toUpperCase()+name.slice(1));
let activeSettingsTab='appearance';
let settingsActiveTab='general';
function drawSettings(){
  const root=$('drawerBody');root.replaceChildren();
  const shell=el('div','settings-shell');
  const searchInput=el('input','settings-search-input');searchInput.placeholder='Search settings';searchInput.setAttribute('aria-label','Search settings');
  const searchWrap=el('div','settings-search');searchWrap.append(searchInput);
  const rail=el('nav','settings-rail');rail.setAttribute('aria-label','Settings sections');
  const panes=el('div','settings-panes');
  const mainRow=el('div','settings-main');mainRow.append(rail,panes);
  shell.append(searchWrap,mainRow);root.append(shell);
  const TABLABELS={general:'General',appearance:'Appearance',personalization:'Personalization',usage:'Usage',data:'Data controls',effort:'How hard Janna works',checking:'Checking answers',research:'Web research',tools:'Tools and connections',device:'On-device control'};
  const TABGROUPS=[['Personal',['general','appearance','personalization','usage','data']],['Janna',['effort','checking','research','tools','device']]];
  const paneMap={},tabBtns={};
  const activate=id=>{if(!paneMap[id])id='general';settingsActiveTab=id;for(const k in paneMap)paneMap[k].hidden=k!==id;for(const k in tabBtns)tabBtns[k].classList.toggle('active',k===id)};
  for(const [group,ids] of TABGROUPS){rail.append(el('div','settings-group',group));for(const id of ids){const b=el('button','settings-tab',TABLABELS[id]);b.type='button';b.onclick=()=>activate(id);tabBtns[id]=b;rail.append(b)}}
  searchInput.addEventListener('input',()=>{const q=searchInput.value.trim().toLowerCase();for(const id in tabBtns)tabBtns[id].hidden=!!q&&!TABLABELS[id].toLowerCase().includes(q);if(tabBtns[settingsActiveTab]&&tabBtns[settingsActiveTab].hidden){const fv=Object.keys(tabBtns).find(k=>!tabBtns[k].hidden);if(fv)activate(fv)}});
  let content=null;
  const paneFor=id=>{if(!paneMap[id]){const pane=el('div','settings-content settings-pane');pane.hidden=id!==settingsActiveTab;paneMap[id]=pane;panes.append(pane)}content=paneMap[id];return content};
  const row=(title,description,child)=>{const node=el('div','settings-row'),texts=el('div','settings-row-description');texts.append(el('strong','',title),el('p','',description));node.append(texts);if(child)node.append(child);content.append(node);return node};
  const toggle=(name,key,description)=>{const box=el('input');box.type='checkbox';box.setAttribute('aria-label',name);box.checked=state.settings[key]===true;box.onchange=()=>persistSettings({[key]:box.checked});row(name,description,box)};
  const select=(name,key,description,values,wide=false)=>{const s=el('select','inline-input'+(wide?' settings-wide':''));for(const [label,value] of values)s.add(new Option(label,value));s.value=String(state.settings[key]??values[0][1]);s.onchange=async()=>{await persistSettings({[key]:s.value});if(key==='speed'){$('speed').value=s.value;state.speed=s.value}if(key==='effort'){$('effort').value=s.value;state.effort=s.value}if(key==='language')applyLocale()};row(name,description,s)};
  const dangerBtn=(label,action)=>{const b=button(label,async()=>{if(b.dataset.armed){b.disabled=true;try{await action()}finally{b.disabled=false}}else{b.dataset.armed='1';b.textContent='Tap again to confirm';b.classList.add('armed');setTimeout(()=>{if(b.isConnected){delete b.dataset.armed;b.textContent=label;b.classList.remove('armed')}},3500)}},'text-btn danger-btn');return b};
  {
    paneFor('general');
    content.append(el('h3','','General'));
    const languageChoices=(state.languages&&state.languages.length?state.languages:[{id:'auto',name:'Automatic'},{id:'en',name:'English'},{id:'it',name:'Italiano'}]).map(item=>[item.name,item.id]);
    const chosen=(state.languages||[]).find(item=>item.id===(state.settings.language||'auto'));
    const note=chosen?.chrome==='full'?'Replies and menus are in English.':chosen?.chrome==='partial'?'Replies use this language. A few labels are translated; most menus stay in English.':'Replies use this language. Menus stay in English.';
    select('Language','language',(state.settings.language||'auto')==='auto'?'Auto-detect: replies follow the language of your latest message. Menus stay in English.':note+' Code, paths, and technical names are never changed.',languageChoices,true);
  }{
    paneFor('appearance');
    const appearance=el('select','inline-input');
    for(const [label,value] of [['System','system'],['Light','light'],['Dark','dark']])appearance.add(new Option(label,value));
    appearance.value=state.settings.appearance_mode||((state.settings.theme||'rose')==='velvet'?'dark':'light');
    appearance.onchange=async()=>{const mode=appearance.value;const dark=mode==='dark'||(mode==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);await persistSettings({appearance_mode:mode,theme:dark?'velvet':'rose'});drawSettings()};
    row('Appearance','System follows your device. Light is the Rose theme; Dark is Velvet. The color themes are right below.',appearance);
    const current=state.settings.theme||'rose';
    const grid=names=>{const box=el('div','theme-grid');for(const name of names){const palette=JANNA_THEMES[name];const choice=button(themeLabel(name),async()=>{await persistSettings({theme:name});drawSettings()},'theme-option'+(current===name?' selected':''));choice.setAttribute('aria-pressed',String(current===name));const swatch=el('span','theme-swatch');swatch.style.setProperty('--sample-side',palette[0]);swatch.style.setProperty('--sample-main',palette[1]);choice.prepend(swatch);box.append(choice)}return box};
    const names=Object.keys(JANNA_THEMES);
    content.append(el('h3','','Appearance'));
    content.append(el('h3','','Color themes'),grid(names.filter(name=>COLOR_THEMES[name])));
    content.append(el('h3','','Japanese-inspired themes'),grid(names.filter(name=>!COLOR_THEMES[name])));
    content.append(el('p','muted','The original Janna wave crest stays unchanged; dark themes place it on a clean ivory surface.'));
  }{
    paneFor('personalization');
    content.append(el('h3','','Personalization'));
    select('Writing style','personality','Choose the tone of replies without changing evidence or technical rigor.',[['Precise','precise'],['Friendly','friendly'],['Technical','technical'],['Concise','concise'],['Craftsman','craftsman']]);
    toggle('Enter to send','send_on_enter','Use Enter to send; Shift+Enter inserts a line break.');
    toggle('Live work updates','show_progress','Show chronological source lookups, tool actions, and checks directly in chat.');
    toggle('Citations','show_citations','Display source links with answers when searches found supporting leads.');
    toggle('Read replies aloud','voice_output','Use available system voices after generation. Dictation is opt-in and may use a browser service.');
    row('Chat history','Manage conversations from the sidebar: open a chat\u2019s \u22ef menu to rename, pin, share, archive, or delete it.');
    content.append(button('Manage memory',()=>{closeDrawer();showView('knowledge')},'text-btn'),button('Profile and import',()=>openDrawer('profile'),'text-btn'),button('Check for software updates',()=>{drawUpdates();$('drawerBody').prepend(button('← Back to settings',drawSettings,'text-btn'))},'text-btn'));
    if(window.__JANNA_WEB__){
      content.append(el('h3','','Memory'));
      const memBox=el('input');memBox.type='checkbox';memBox.setAttribute('aria-label','Enable memory');memBox.checked=state.settings.memory_enabled!==false;memBox.onchange=()=>persistSettings({memory_enabled:memBox.checked});
      row('Enable memory','Let Janna remember facts across chats in this browser. Say "tandaan mo..." in any chat to save one.',memBox);
      row('Saved memories','Facts Janna has saved about you. Ask her what she remembers about you in any chat.',dangerBtn('Clear memory',async()=>{try{await api('/api/memory/clear',{});toast('Memory cleared')}catch(e){toast(e.message)}}));
    }
  }{
    paneFor('effort');
    content.append(el('h3','','How hard Janna works'));
    row('Model identity','Janna Pro 1.1 is the full profile; Janna Lite 1.1 is optimized for lower-memory computers. Provenance is documented in the release notes.');
    select('Reasoning effort','effort','Changes tool and verification budgets, not the underlying model intelligence.',[['Quick','quick'],['Balanced','balanced'],['High','high'],['Maximum','maximum']]);
    const native=el('select','inline-input');for(const val of state.nativeLevels||['default'])native.add(new Option(val==='default'?'Automatic':String(val),String(val)));
    native.value=String(state.reasoning);native.onchange=()=>state.reasoning=native.value;
    row('Native model thinking','Only levels advertised by the installed model are shown.',native);
    select('Speed profile','speed','Boost lowers generation and context budgets. It does not guarantee 1.5× tokens per second.',[['Standard','standard'],['1.5× Boost','boost']]);
    paneFor('checking');
    content.append(el('h3','','Checking answers'));
    toggle('Check generated code','verify_generated_code','Check supported code blocks with the installed syntax tools.');
    toggle('Correct generated code','repair_generated_code','Try one checked correction for generated engineering code. The original draft is kept; Boost skips the extra model call.');
    toggle('Correct generated web pages','repair_generated_html','Try one correction when a generated HTML page fails its checks.');
    toggle('Refine technical reports','refine_reports','Optional extra local editing pass improves clarity but adds latency.');
    toggle('Automatic model recovery','model_failover','Retry temporary failures. If another local model is installed, Janna can switch to it and will label the change.');
  }{
    paneFor('research');
    content.append(el('h3','','Web research'));
    select('Live research','research_mode','Automatic searches when current information is useful. Every question sends a scrubbed search query each time. Offline never searches. Local source files are never uploaded.',[['Automatic','auto'],['Every question','always'],['Offline','off']]);
    toggle('Find source implementations','github_research','Search GitHub implementation references when a coding question benefits from current code.');
    row('When search is unavailable','Janna falls back to independent public sources, your GitHub sign-in, local project search, and clearly labelled saved references. No source result is presented as verified code.');
    content.append(button('Open Research',()=>{closeDrawer();showView('research')},'text-btn'),button('Connect free search providers',()=>openDrawer('tools'),'text-btn'));
    if(!window.__JANNA_WEB__)content.append(dangerBtn('Delete cached research',async()=>{try{await api('/api/research/cache/clear',{});toast('Research cache cleared')}catch(e){toast(e.message)}}));
  }{
    paneFor('tools');
    content.append(el('h3','','Tools and connections'));
    row('Plugins','Figma, Forge, and browser tools are turned on and off here, and only reach the model when enabled.');
    content.append(button('Manage plugins',()=>{closeDrawer();showView('plugins')},'text-btn'),button('Project tools and connections',()=>openDrawer('tools'),'text-btn'),button('Test harness',()=>openDrawer('harness'),'text-btn'),button('Connect iPhone',()=>openDrawer('remote'),'text-btn'),button('Discord bot',()=>openDrawer('bots'),'text-btn'),button('Janna Pro trainer',()=>openDrawer('training'),'text-btn'));
  }{
    paneFor('device');
    content.append(el('h3','','On-device control'));
    row('Local model','Your chat model runs on your PC. Opt-in research requests connect to public search providers, so set research to Offline for confidential questions.');
    row('Project access','Run development tools in the selected project. Publishing requires a one-time local approval.');
    content.append(button('Manage paired phones',()=>openDrawer('remote'),'text-btn'));
  }
  {
    paneFor('usage');
    content.append(el('h3','','Usage'));
    row('Plan',window.__JANNA_WEB__?'Free plan \u2014 no account and no paid tiers. Everything is stored in your browser.':'Local \u2014 Janna runs on your own hardware.');
    row('Conversations','Chats not in the archive.',el('strong','',String(state.sessions.filter(x=>!x.archived).length)));
    row('Messages','Across all your conversations.',el('strong','',window.__JANNA_WEB__?String(state.sessions.reduce((n,x)=>n+(x.msgs||0),0)):'\u2014'));
  }
  if(window.__JANNA_WEB__){
    paneFor('data');
    content.append(el('h3','','Data controls'));
    row('Your data in this browser','On the web edition, chats and settings are stored only in this browser. Janna does not train on your chats or upload them; only the message you send reaches the model.');
    row('Export data','Download your chats and preferences as one JSON file.',button('Export',async()=>{try{const data=await api('/api/profile/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='janna_profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Profile exported')}catch(e){toast(e.message)}},'text-btn'));
    row('Import data','Bring chats and preferences from an exported Janna profile file.',button('Import',()=>openDrawer('profile'),'text-btn'));
    row('Clear all chats','Delete every conversation stored in this browser. This cannot be undone.',dangerBtn('Clear all chats',async()=>{try{await api('/api/sessions/clear',{});state.sessions=[];closeDrawer();await newSession(state.project);await refreshBootstrap();toast('All chats cleared')}catch(e){toast(e.message)}}));
  }
  if(!window.__JANNA_WEB__&&tabBtns.data)tabBtns.data.hidden=true;
  activate(settingsActiveTab);
}
function speechTag(sample=''){
  const code=state.settings.language||'auto';
  const row=(state.languages||[]).find(item=>item.id===code);
  if(row&&row.speech)return row.speech;
  if(code==='auto')return /\b(?:il|la|questo|sono|posso|grazie)\b/i.test(sample||$('prompt')?.value||'')?'it-IT':(navigator.language||'en-US');
  return code==='it'?'it-IT':'en-US';
}
function applyLocale(){
  const it=state.settings.language==='it';
  const chosen=(state.languages||[]).find(item=>item.id===state.settings.language);
  document.documentElement.lang=state.settings.language&&state.settings.language!=='auto'?state.settings.language:'en';
  document.documentElement.dir=chosen?.dir||'ltr';
  const nav=$('navChats');if(nav)nav.lastChild.textContent=it?'Conversazioni':'Conversations';
  const newLabel=$('newChat')?.querySelector('span');if(newLabel)newLabel.textContent=it?'Nuova chat':'New chat';
  const welcome=$('welcome')?.querySelector('h1');if(welcome)welcome.textContent=it?'Da dove cominciamo?':'Where should we begin?';
  const hint=$('welcome')?.querySelector('.welcome-hint span > span')?.parentNode;
  if(hint)hint.lastChild.textContent=window.__JANNA_WEB__?'Cloud session · Chats stay in this browser':(it?'Sessione locale · File sul tuo computer':'Local session · Files stay on your machine');
  if(!state.busy){$('prompt').placeholder=it?'Chiedi qualcosa a Janna…':'Ask Janna anything…'}
}
async function refreshBootstrap(){const b=await api('/api/bootstrap');state.token=b.token||state.token;saveLocalToken();state.projects=b.projects||[];state.sessions=b.sessions||[];state.modelCatalog=b.model_catalog||[];state.library=b.library||[];state.clineInstalled=!!b.cline_installed;state.languages=b.languages||[];state.pro=b.pro||null;state.project=b.active_project||state.project;state.settings=b.settings||state.settings;applyLocale();refreshResearchSwitch();document.body.dataset.theme=state.settings.appearance_mode==='system'?(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'velvet':'rose'):(state.settings.theme||'rose');syncDesktopChrome();state.speed=state.settings.speed||state.speed;state.effort=state.settings.effort||state.effort;$('speed').value=state.speed;$('effort').value=state.effort;renderModelOptions(b.models||[]);statusBadge({ollama:!!b.models?.length});renderRecents();$('workspaceLabel').textContent=selectedProject()?.name||'Workspace';$('projectQuickLabel').textContent=selectedProject()?.name||'Choose project';$('profileName').textContent=b.profile?.label||'Guest workspace';$('profilePlan').textContent=window.__JANNA_WEB__?'Free plan':'';return b}
async function initialConnection(){const r=await fetch('/api/remote-info',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Janna is not reachable from this device');const info=await r.json();state.remote=!!info.remote;if(state.remote){state.token=localStorage.getItem('janna-pair-token')||'';if(!state.token){$('pairDialog').showModal();return false}try{await refreshBootstrap()}catch(error){if(error.status!==403&&error.status!==401)throw error;$('pairDialog').showModal();return false}return true}await refreshBootstrap();return true}
async function pairDevice(e){e.preventDefault();$('pairError').textContent='';try{const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('pairCode').value,label:'iPhone / Janna PWA'})});const o=await r.json();if(!r.ok)throw new Error(o.error||'Pairing failed');state.token=o.token;saveLocalToken();$('pairDialog').close();await initializeWorkspace();workspaceReady=true}catch(err){$('pairError').textContent=err.message}}
async function initializeWorkspace(){await refreshBootstrap();if(state.sessions.length)await openSession(state.sessions[0].id);else await newSession(state.project)}
function bind(){bindCodeWorkspace();
 const jump=button('Jump to latest',()=>{state.tailFollow=true;scrollThread();jump.hidden=true},'jump-latest');jump.hidden=true;$('chatView').append(jump);
 $('thread').addEventListener('scroll',()=>{const t=$('thread');state.tailFollow=t.scrollHeight-t.scrollTop-t.clientHeight<70;jump.hidden=state.tailFollow},{passive:true});
for(const nav of document.querySelectorAll('[data-view]'))nav.onclick=()=>nav.dataset.view==='luna'?openLunaChat():showView(nav.dataset.view);$('newChat').onclick=()=>newSession();$('sidebarSettings').onclick=()=>{if(window.innerWidth<701)closeMobile();openDrawer('settings')};$('navSettings').onclick=()=>{if(window.innerWidth<701)closeMobile();openDrawer('settings')};$('settingsButton').onclick=()=>openDrawer('settings');$('drawerClose').onclick=closeDrawer;$('companionButton').onclick=()=>openDrawer('companion');$('connectionButton').onclick=()=>openDrawer('tools');$('researchToggle').onclick=cycleResearchSwitch;$('profileOpen').onclick=e=>{e.stopPropagation();const m=$('profileMenu');m.hidden=!m.hidden;if(!m.hidden){$('pmName').textContent=$('profileName').textContent;$('pmPlan').textContent=$('profilePlan').textContent||'Free plan'}};
document.addEventListener('pointerdown',e=>{const m=$('profileMenu');if(m&&!m.hidden&&!e.target.closest('#profileMenu')&&!e.target.closest('#profileOpen'))m.hidden=true});
$('pmPersonalization').onclick=()=>{$('profileMenu').hidden=true;if(window.innerWidth<701)closeMobile();settingsActiveTab='personalization';openDrawer('settings')};
$('pmProfile').onclick=()=>{$('profileMenu').hidden=true;if(window.innerWidth<701)closeMobile();openDrawer('profile')};
$('pmSettings').onclick=()=>{$('profileMenu').hidden=true;if(window.innerWidth<701)closeMobile();openDrawer('settings')};
$('sidebarSearch').onclick=()=>openSearch();
$('searchClose').onclick=()=>$('searchDialog').close();
$('searchForm').addEventListener('submit',e=>e.preventDefault());
let searchTimer=null;
$('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,220)});
function renderSearchResults(list){const box=$('searchResults');box.replaceChildren();if(!list.length){box.append(el('p','muted','No chats found.'));return}for(const r of list){const b=el('button','search-result',r.title||'New chat');b.type='button';b.onclick=()=>{$('searchDialog').close();openSession(r.id)};box.append(b)}}
function openSearch(){$('searchInput').value='';renderSearchResults(state.sessions.filter(x=>!x.archived).slice(0,8));$('searchDialog').showModal();setTimeout(()=>$('searchInput').focus(),60)}
async function runSearch(){const q=$('searchInput').value.trim();if(!q){renderSearchResults(state.sessions.filter(x=>!x.archived).slice(0,8));return}try{const r=await api('/api/sessions/search?q='+encodeURIComponent(q));renderSearchResults(r.results||[])}catch(e){toast(e.message)}}$('projectQuick').onclick=openProjectDialog;$('workspaceAction').onclick=openProjectDialog;$('mobileMenu').onclick=()=>{if(window.innerWidth>=701&&$('sidebar').style.display==='none'){$('sidebar').style.display='';document.body.classList.remove('sidebar-collapsed')}else openMobile()};$('mobileScrim').onclick=closeMobile;$('sidebarCollapse').onclick=()=>{if(window.innerWidth<701)closeMobile();else{const sb=$('sidebar');sb.style.display=sb.style.display==='none'?'':'none';document.body.classList.toggle('sidebar-collapsed',sb.style.display==='none')}};$('send').onclick=send;const syncSendState=()=>$('composer').classList.toggle('is-empty',!$('prompt').value.trim());$('prompt').addEventListener('input',syncSendState);syncSendState();for(const chip of document.querySelectorAll('.suggest-chip'))chip.onclick=()=>{if(state.sending)return;$('prompt').value=chip.dataset.prompt||'';send()};$('stop').onclick=stop;$('mode').onchange=()=>setMode($('mode').value);$('model').onchange=()=>{state.model=$('model').value;rememberModelChoice();syncModelMenu();refreshNativeLevels()};$('modelMenu').onclick=()=>{if($('modelMenu').getAttribute('aria-expanded')==='true')closeModelMenu();else openModelMenu()};document.addEventListener('pointerdown',e=>{if(!e.target.closest('.model-top-select'))closeModelMenu()});$('speed').onchange=()=>{state.speed=$('speed').value;persistSettings({speed:state.speed});toast(state.speed==='boost'?'Boost reduces unnecessary context and output. Actual speed varies.':'Standard speed restored.')};$('effort').onchange=()=>{state.effort=$('effort').value;persistSettings({effort:state.effort})};$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&state.settings.send_on_enter!==false){e.preventDefault();send()}});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();newSession()}if(e.key==='Escape'){closeModelMenu();closeDrawer()}});$('projectForm').onsubmit=async e=>{e.preventDefault();try{const result=await api('/api/projects',{path:$('projectPath').value});await useSelectedProject(result.project)}catch(err){toast(err.message)}};$('cancelProject').onclick=()=>$('projectDialog').close();$('nativePick').onclick=async()=>{try{const r=await api('/api/projects/pick',{});await useSelectedProject(r.project)}catch(e){toast(e.message)}};$('pairForm').onsubmit=pairDevice;$('voiceMic').onclick=voiceDictate;$('attachmentButton').onclick=e=>{e.stopPropagation();const m=$('composerMenu');const open=m.hidden;m.hidden=!open;$('attachmentButton').setAttribute('aria-expanded',String(open))};$('menuAttach').onclick=()=>{$('composerMenu').hidden=true;$('attachment').click()};$('prompt').addEventListener('focus',()=>{$('composerMenu').hidden=true});$('prompt').addEventListener('pointerdown',()=>{$('composerMenu').hidden=true});document.addEventListener('pointerdown',e=>{const m=$('composerMenu');if(m&&!m.hidden&&!e.target.closest('#composer')){m.hidden=true;$('attachmentButton').setAttribute('aria-expanded','false')}});$('attachment').onchange=async e=>{
  const files=[...(e.target.files||[])];e.target.value='';
  for(const file of files){
    if(state.pending.length>=4){toast('Attach at most 4 files.');break}
    const name=file.name||'attachment';
    const image=/\.(png|jpe?g|webp)$/i.test(name)||['image/png','image/jpeg','image/webp'].includes(file.type);
    try{
      if(image){
        if(/\.(svg|gif)$/i.test(name)){toast(name+' is not a PNG, JPEG, or WebP.');continue}
        let useFile=file,useName=name;
        if(file.size>1200000){
          if(window.__JANNA_WEB__){const small=await downscaleImageFile(file).catch(()=>null);if(!small){toast(name+' could not be shrunk to fit.');continue}useFile=small;useName=small.name}
          else{toast(name+' is over 1.2 MB.');continue}
        }
        if(state.pending.filter(item=>item.kind==='image').length>=2){toast('Attach at most 2 images.');continue}
        const data=await fileBase64(useFile);
        state.pending.push({kind:'image',name:useName,data,file:useFile});
        if(!state.modelVision)toast(name+' stays on this PC. This model has not advertised vision, so its pixels will not be sent.');
      }else{
        if(file.size>180000){toast(name+' is over 180,000 characters. Put it in the project instead.');continue}
        const text=await file.text();
        if(text.includes('\u0000')){toast(name+' is not a text log.');continue}
        state.pending.push({kind:'log',name,text});
      }
    }catch(err){toast(err.message||'Could not read '+name)}
  }
  renderPending();
};
 document.body.classList.add('ready');window.addEventListener('online',recoverConnection);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recoverConnection()});}
let workspaceReady=false,connectionCheck=false;
async function recoverConnection(){
 if(connectionCheck||state.busy)return;
 connectionCheck=true;
 try{
  if(!workspaceReady){if(!await initialConnection())return;await initializeWorkspace();workspaceReady=true;}
  else{const result=await api('/api/status');statusBadge(result);}
 }catch(error){if(error.status===401||error.status===403){workspaceReady=false;if(state.remote)$('pairDialog').showModal();}$('sidebarState').textContent='PC unreachable · reconnecting';$('headerMode').textContent='Waiting for your PC';$('sidebarDot').classList.add('offline');$('headerDot').classList.add('offline');}
 finally{connectionCheck=false;}
}
async function init(){bind();window.refreshLuna?.();try{document.body.dataset.theme=localStorage.getItem('janna-theme')||'rose';syncDesktopChrome()}catch{}await recoverConnection();setInterval(recoverConnection,10000);if('serviceWorker' in navigator&&location.protocol==='https:'){navigator.serviceWorker.register('/sw.js').catch(()=>{})}}
init();

// ---- Voice conversation mode (ChatGPT-style talk loop) ----
// Tap the waveform button: Janna listens, answers in the chat, and speaks the
// answer back, then listens again. Mic + speech are the browser's own engines.
const voiceTalk = { active: false, phase: 'idle', muted: false, recog: null, watch: null, restart: null, quiet: 0 };
function voiceOverlay() {
  let ov = document.getElementById('voiceOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'voice-overlay'; ov.id = 'voiceOverlay'; ov.dataset.phase = 'idle';
  ov.innerHTML = '<button class="voice-orb" id="voiceOrb" type="button" aria-label="Voice orb"><i></i><i></i><i></i><i></i><i></i></button><div class="voice-caption" id="voiceCaption">Nakikinig ako…</div><div class="voice-sub">Kausapin mo lang si Janna — sasagot siya nang pasalita.</div><div class="voice-controls"><button class="voice-ctl" id="voiceMuteBtn" type="button" title="Mute microphone" aria-label="Mute microphone"><svg><use href="#i-mic"/></svg></button><button class="voice-ctl close" id="voiceCloseBtn" type="button" title="End voice chat" aria-label="End voice chat"><svg><use href="#i-close"/></svg></button></div>';
  document.body.appendChild(ov);
  ov.querySelector('#voiceCloseBtn').onclick = () => voiceClose();
  ov.querySelector('#voiceMuteBtn').onclick = () => voiceToggleMute();
  ov.querySelector('#voiceOrb').onclick = () => voiceOrbTap();
  return ov;
}
function voiceSetPhase(phase, caption) {
  voiceTalk.phase = phase;
  const ov = document.getElementById('voiceOverlay'); if (!ov) return;
  ov.dataset.phase = phase;
  if (caption != null) ov.querySelector('#voiceCaption').textContent = caption;
}
function voiceClean(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' [code block omitted] ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[<>{}*_#~`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1700);
}
function voiceTalkSpeak(text) {
  const clean = voiceClean(text);
  if (!clean || !('speechSynthesis' in window)) { voiceSetPhase('idle', 'Nasa chat ang sagot ko — hindi available ang boses dito.'); return; }
  try { window.speechSynthesis.cancel(); } catch {}
  // Speak in sentence-sized chunks: one long utterance can silently never
  // start (or never end) in Chrome/Android TTS, which used to hang the whole
  // conversation in the 'speaking' phase. Each chunk has a watchdog that
  // force-advances if neither onend nor onerror ever fires.
  const chunks = [];
  for (const part of clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean]) { const t = part.trim(); if (t) chunks.push(t); }
  const queue = [];
  for (const c of chunks) { if (c.length <= 180) queue.push(c); else for (let i = 0; i < c.length; i += 180) queue.push(c.slice(i, i + 180)); }
  if (!queue.length) queue.push(clean);
  voiceSetPhase('speaking', clean.length > 220 ? clean.slice(0, 220) + '…' : clean);
  let idx = 0;
  const step = () => {
    clearTimeout(voiceTalk.chunkTimer);
    if (!voiceTalk.active || voiceTalk.muted) return;
    if (idx >= queue.length) { voiceListen(); return; }
    const piece = queue[idx++];
    const utter = new SpeechSynthesisUtterance(piece);
    utter.lang = speechTag(piece); utter.rate = 1.05;
    let advanced = false;
    const advance = () => { if (advanced) return; advanced = true; step(); };
    utter.onend = advance; utter.onerror = advance;
    voiceTalk.chunkTimer = setTimeout(advance, Math.max(5000, piece.length * 110 + 3000));
    try { window.speechSynthesis.speak(utter); } catch { advance(); }
  };
  step();
}
function voiceExtract(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.activity-chain,.message-actions,.work-stream,pre,button,details').forEach(n => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}
function voiceWatchReply(beforeCount) {
  const started = Date.now();
  clearInterval(voiceTalk.watch);
  voiceTalk.watch = setInterval(() => {
    if (!voiceTalk.active) { clearInterval(voiceTalk.watch); return; }
    if (state.busy) return;
    clearInterval(voiceTalk.watch);
    const els = document.querySelectorAll('.message.assistant');
    const el = els[els.length - 1];
    if (el && els.length > beforeCount) voiceTalkSpeak(voiceExtract(el));
    else voiceTalkSpeak('Tapos na — nasa chat ang sagot ko.');
  }, 700);
  setTimeout(() => { clearInterval(voiceTalk.watch); }, 125000);
}
function voiceSubmit(text) {
  const before = document.querySelectorAll('.message.assistant').length;
  voiceSetPhase('thinking', '“' + text + '”');
  $('prompt').value = text; syncSendState();
  send();
  voiceWatchReply(before);
}
function voiceListen() {
  if (!voiceTalk.active || voiceTalk.muted) return;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { voiceSetPhase('idle', 'Hindi suportado ng browser na ito ang pakikinig. Mag-type na lang o isara ito.'); return; }
  try { voiceTalk.recog?.stop(); } catch {}
  const recog = new Rec(); voiceTalk.recog = recog;
  recog.lang = speechTag(); recog.interimResults = true; recog.continuous = false; recog.maxAlternatives = 1;
  voiceSetPhase('listening', 'Nakikinig ako… magsalita ka lang.');
  recog.onresult = e => {
    let interim = '', finalText = '';
    for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
    if (interim) voiceSetPhase('listening', interim);
    if (finalText.trim()) { voiceTalk.quiet = 0; voiceTalk.errStrikes = 0; try { recog.stop(); } catch {} voiceSubmit(finalText.trim()); }
  };
  recog.onerror = e => {
    const err = String(e.error || '');
    if (err === 'not-allowed' || err === 'service-not-allowed') { voiceSetPhase('idle', 'Hindi ako makarinig — i-allow ang microphone para kay Janna, tapos subukan ulit.'); voiceTalk.recog = null; voiceTalk.errStrikes = 0; }
    else if (err === 'no-speech') { voiceTalk.quiet++; }
    else if (err) { voiceTalk.errStrikes = (voiceTalk.errStrikes || 0) + 1; voiceTalk.errKind = err; }
  };
  recog.onend = () => {
    if (voiceTalk.recog !== recog) return;
    if (!voiceTalk.active || voiceTalk.muted || voiceTalk.phase !== 'listening') return;
    clearTimeout(voiceTalk.restart);
    if ((voiceTalk.errStrikes || 0) >= 2) { const k = voiceTalk.errKind || ''; voiceTalk.errStrikes = 0; voiceTalk.stopped = true; voiceSetPhase('idle', k === 'network' ? 'Hindi maabot ng pandinig ko ang speech service — mahina o walang internet na abot nito. I-tap ang bilog para subukan ulit, o mag-type na lang.' : 'May problema sa pakikinig ko (' + k + ') — i-tap ang bilog para subukan ulit.'); return; }
    if (voiceTalk.quiet >= 3) { voiceTalk.stopped = true; voiceSetPhase('idle', 'Wala akong marinig — i-tap ang bilog para subukan ulit.'); return; }
    voiceTalk.restart = setTimeout(() => { if (!voiceTalk.stopped) voiceListen(); }, 350);
  };
  try { recog.start(); } catch {}
}
function voiceOrbTap() {
  if (voiceTalk.phase === 'speaking') { clearTimeout(voiceTalk.chunkTimer); try { window.speechSynthesis.cancel(); } catch {} voiceListen(); }
  else if (voiceTalk.phase === 'listening') { try { voiceTalk.recog?.stop(); } catch {} voiceSetPhase('idle', 'Na-pause — i-tap ang bilog para magpatuloy.'); }
  else if (voiceTalk.phase === 'idle' && !voiceTalk.muted) { voiceTalk.stopped = false; voiceListen(); }
}
function voiceToggleMute() {
  voiceTalk.muted = !voiceTalk.muted;
  const btn = document.getElementById('voiceMuteBtn'); if (btn) btn.classList.toggle('muted', voiceTalk.muted);
  if (voiceTalk.muted) { clearTimeout(voiceTalk.chunkTimer); try { voiceTalk.recog?.stop(); } catch {} try { window.speechSynthesis.cancel(); } catch {} voiceSetPhase('idle', 'Naka-mute ang mic — i-tap ang mic para magsalita ulit.'); }
  else { voiceTalk.stopped = false; voiceListen(); }
}
function voiceOpen() {
  voiceOverlay();
  voiceTalk.active = true; voiceTalk.muted = false; voiceTalk.quiet = 0; voiceTalk.errStrikes = 0; voiceTalk.stopped = false;
  // Prime text-to-speech inside this tap: Android Chrome can silently drop
  // speak() calls that were never unlocked by a user gesture.
  try { const synth = window.speechSynthesis; if (synth) { synth.getVoices(); const prime = new SpeechSynthesisUtterance(' '); prime.volume = 0; synth.speak(prime); } } catch {}
  document.body.classList.add('voice-open');
  const btn = document.getElementById('voiceMuteBtn'); if (btn) btn.classList.remove('muted');
  voiceListen();
}
function voiceClose() {
  voiceTalk.active = false;
  clearInterval(voiceTalk.watch); clearTimeout(voiceTalk.restart);
  try { voiceTalk.recog?.stop(); } catch {}
  try { window.speechSynthesis.cancel(); } catch {}
  document.body.classList.remove('voice-open');
  document.getElementById('voiceOverlay')?.remove();
}
document.getElementById('voiceModeBtn')?.addEventListener('click', voiceOpen);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && voiceTalk.active) voiceClose(); });
