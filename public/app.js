'use strict';
const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const h=escapeHTML;
const owner=crypto.randomUUID();
let state={tasks:[],running:null}, selected=location.hash.slice(1), project='', view='work', filter=selected?'all':'open', tab='checklist', editing=null, busy=false, handedOff=false;
let connectionError=false, archivedProjectsOpen=false, draggingProject=null, projectDragEndedAt=-Infinity;
let draftItems=[], mutationVersion=0, pendingDelete=null, correctingTime=null;
const form=$('task-form');
const field=name=>form.elements.namedItem(name);
const date=value=>value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';
function clock(ms){const seconds=Math.floor(ms/1000);return Math.floor(seconds/3600).toString().padStart(2,'0')+':'+Math.floor(seconds%3600/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0');}
function duration(ms){if(ms===null)return 'Finding your pace';if(ms===0)return '0 min';if(ms<60000)return '<1 min';const minutes=Math.ceil(ms/60000);return minutes<60?minutes+' min':Math.floor(minutes/60)+'h '+minutes%60+'m';}
function notice(text,kind='info'){$('notice').textContent=text;$('notice').hidden=!text;$('notice').dataset.kind=kind;}
function syncControls(){
  $('detail').setAttribute('aria-busy',String(busy));
  document.querySelectorAll('#new-project,[data-project-action],[data-action],[data-edit],[data-delete],[data-correct-time],[data-template],#new-task,#import-task,#handoff').forEach(button=>{
    if(!button.hasAttribute('data-idle-disabled'))button.dataset.idleDisabled=String(button.disabled);
    button.disabled=busy||handedOff||button.dataset.idleDisabled==='true';
  });
}
async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error || 'Request failed.'),{status:response.status});return data;}
async function refresh(full=true){
  try{state=await api('/api/state');if(connectionError){notice('');connectionError=false;}$('connection').textContent='Saved to data folder';if(full)render();else renderTiming();}
  catch(error){connectionError=true;$('connection').textContent=error.status?'Storage needs attention':'Disconnected';notice(error.status?error.message:'Cannot reach Waypoint. Reopen the launcher to reconnect. The local server keeps timing until you pause; reopen Waypoint to check it.');}
}
async function action(type,itemId,text){
  if(busy)return;
  const timerHadFocus=document.activeElement?.hasAttribute('data-timer-toggle');
  const finishHadFocus=!!document.activeElement?.matches('.focus-actions [data-action=finish]');
  busy=true;mutationVersion++;
  const task=state.tasks.find(t=>t.id===selected);if(!task){busy=false;return;}
  syncControls();notice('Saving…');
  try{await api('/api/action',{type,itemId,text,taskId:task.id,revision:task.revision,owner:type==='pause'?undefined:owner});if(type==='finish'||type==='restore')filter='all';if(type==='archive')filter='archived';notice(({start:'Focus started.',pause:'Focus paused.',finish:'Step completed.',undo:'Step reopened.',archive:'Task archived. Use Restore task to bring it back.',restore:'Task restored.',note:'Note saved.'})[type]||'Saved.','success');}
  catch(error){notice(error.message,'error');}
  finally{await refresh();busy=false;syncControls();if(timerHadFocus){document.querySelector('[data-timer-toggle]')?.focus({preventScroll:true});}else if(finishHadFocus){document.querySelector('.focus-actions button')?.focus({preventScroll:true});}else if(itemId){const control=[...document.querySelectorAll('[data-item]')].find(button=>button.dataset.item===itemId&&!button.disabled);control?.focus({preventScroll:true});}}
}
function visibleTasks(){
  return state.tasks.filter(t=>(!project||project===t.project.kind+':'+t.project.name)&&
    (view==='history' ? true : filter==='all'?true:filter==='archived'?!!t.archivedAt:!t.archivedAt&&!t.completedAt)&&
    (t.title+' '+t.project.name+' '+t.activity).toLowerCase().includes($('search').value.toLowerCase()))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
function render(){
  const active=state.tasks.filter(t=>!t.completedAt&&!t.archivedAt).length,completed=state.tasks.filter(t=>t.completedAt).length;
  $('active-count').textContent=active;$('done-count').textContent=completed;
  $('nav-work').classList.toggle('selected',view==='work'&&!project);$('nav-history').classList.toggle('selected',view==='history'&&!project);
  $('heading').textContent=project?project.slice(project.indexOf(':')+1):view==='history'?'Your work leaves a trail.':'A little closer, every step.';
  $('subheading').textContent=project?(projectState(allProjects().find(p=>projectKey(p)===project)||{}).archivedAt?'Archived project · Your tasks and history are still available.':'Your tasks, one step at a time.'):view==='history'?'Every task, every session, and the steps that got you here.':'Read, revise, research. Pick a task and find your rhythm.';
  $('view-label').textContent=view==='history'?'History':'Focus';
  $('breadcrumb').textContent=project?project.slice(project.indexOf(':')+1):'Your workspace';
  $('toggle-projects').textContent=project?'Projects · '+project.slice(project.indexOf(':')+1):'Projects';
  const scope=state.tasks.filter(t=>!project||project===t.project.kind+':'+t.project.name);
  $('summary').innerHTML='<div><strong>'+scope.filter(t=>!t.completedAt&&!t.archivedAt).length+'</strong><span>Tasks in motion<br>Room for your next step</span></div><div><strong>'+scope.filter(t=>t.completedAt).length+'</strong><span>Tasks completed<br>A record of what you did</span></div><div><strong>'+duration(scope.reduce((n,t)=>n+t.stats.elapsedMs,0))+'</strong><span>Focused time<br>Across all your sessions</span></div>';
  const projects=allProjects().map(p=>[projectKey(p),p]);
  const activeProjects=projects.filter(([,p])=>!projectState(p).archivedAt), archivedProjects=projects.filter(([,p])=>projectState(p).archivedAt);
  const projectButton=([key,p])=>'<div class="project-row"><button class="project-button '+(project===key?'selected':'')+'" data-project="'+h(key)+'" draggable="true" title="Drag to '+(projectState(p).archivedAt?'Your projects to restore':'Archived projects')+'"><b>•</b><span>'+h(p.name)+'</span></button><details class="project-options"><summary aria-label="'+h('Options for '+p.name)+'" title="Project options">⋯</summary><button class="project-menu-action" data-project-action="'+(projectState(p).archivedAt?'restore':'archive')+'" data-project-key="'+h(key)+'">'+(projectState(p).archivedAt?'Restore project':'Archive project')+'</button></details></div>';
  const selectedProject=projects.find(([key])=>key===project)?.[1];
  if(selectedProject&&projectState(selectedProject).archivedAt)archivedProjectsOpen=true;
  $('projects').innerHTML='<div id="active-projects" data-project-drop="restore" title="Drop archived projects here to restore"><p class="sidebar-heading">YOUR PROJECTS</p><button class="new-project" id="new-project">+ New projects</button>'+activeProjects.map(projectButton).join('')+'</div>'+
    '<details id="archived-projects" class="archived-projects" data-project-drop="archive" '+(archivedProjectsOpen?'open':'')+'><summary title="Drop a project here to archive">Archived projects <span class="count">'+archivedProjects.length+'</span></summary><div>'+ (archivedProjects.length?archivedProjects.map(projectButton).join(''):'<p class="project-empty">Drag a project here to archive it.</p>')+'</div></details>';
  $('archived-projects').addEventListener('toggle',event=>{archivedProjectsOpen=event.target.open;});
  $('project-names').innerHTML=[...new Set(allProjects().map(p=>p.name))].map(name=>'<option value="'+h(name)+'"></option>').join('');
  $('filter-open').classList.toggle('selected',filter==='open');$('filter-all').classList.toggle('selected',filter==='all');$('filter-archived').classList.toggle('selected',filter==='archived');
  document.querySelector('.segmented').hidden=view==='history';
  const tasks=visibleTasks();
  if(!tasks.some(t=>t.id===selected))selected=tasks[0]?.id || '';
  $('task-count').textContent=tasks.length;
  $('list-title').textContent=view==='history'?'Task history':'Your tasks';
  $('task-list').innerHTML=tasks.length?tasks.map(t=>'<button class="task-card '+(t.id===selected?'selected':'')+'" data-task="'+h(t.id)+'"><span class="pill '+h(t.project.kind)+'">'+h(t.project.name)+'</span><h3>'+h(t.title)+'</h3><progress class="bar" max="'+t.stats.total+'" value="'+t.stats.done+'" aria-label="Items completed"></progress><div class="meta"><span>'+t.stats.done+' / '+t.stats.total+' '+h(t.unit)+(t.stats.total===1?'':'s')+'</span><span>'+ (t.archivedAt?'Archived':t.completedAt?'Completed ✓':t.startedAt?'In progress':'Ready to start')+'</span></div></button>').join(''):'<p class="list-empty">'+(scope.length?'No tasks match this view.':'No tasks in '+h(project?project.slice(project.indexOf(':')+1):'your workspace')+' yet.')+'</p>';
  renderDetail();
  syncControls();
  document.querySelectorAll('.nav-button,.project-button,.segmented button,.task-card').forEach(button=>button.setAttribute('aria-pressed',String(button.classList.contains('selected'))));
}
function currentItem(task){
  const runningItem=state.running?.taskId===task.id?state.running.itemId:null;
  const lastItem=task.sessions.at(-1)?.itemId;
  return task.items.find(item=>item.id===runningItem)||task.items.find(item=>item.id===lastItem&&!item.completedAt)||task.items.find(item=>!item.completedAt);
}
function renderDetail(){
  const task=state.tasks.find(t=>t.id===selected);
  if(!task){
    const hasTasks=state.tasks.some(t=>!project||projectKey(t.project)===project);
    $('detail').innerHTML='<div class="empty"><p class="eyebrow">'+(hasTasks?'ADJUST YOUR VIEW':'YOUR NEXT WAYPOINT')+'</p><h2>'+(hasTasks?'No matching tasks':project?'Give this project its first task':'Start with a task')+'</h2><p>'+(hasTasks?'Try another search or show all tasks in this view.':'Add the pages, slides, or steps you want to work through.')+'</p><button class="button primary" '+(hasTasks?'data-reset-view':'data-template="custom"')+'>'+(hasTasks?'Show all tasks':'+ New task')+'</button></div>';return;
  }
  const run=state.running?.taskId===task.id?state.running:null;
  const current=currentItem(task);
  const stats=task.stats;
  const timerLabel=current?(run?'Pause':current.elapsedMs||task.sessions.some(session=>session.itemId===current.id)?'Resume':'Start')+' timer for '+current.label:'';
  const timerIcon=run?'<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>':'<path d="M7 4v16l13-8z"/>';
  $('detail').innerHTML='<article class="focus-card"><div class="focus-head"><div><span class="pill '+h(task.project.kind)+'">'+h(task.project.name)+' / '+h(task.activity)+'</span><h2>'+h(task.title)+'</h2></div><div class="task-controls" role="group" aria-label="Task actions"><button class="button secondary compact" data-edit>Edit task</button><details class="task-more"><summary class="button secondary compact">More actions <span aria-hidden="true">⌄</span></summary><div class="task-menu"><button class="button secondary compact" data-correct-time>Correct recorded time…</button><button class="button secondary compact" data-action="'+(task.archivedAt?'restore':'archive')+'">'+(task.archivedAt?'Restore task':'Archive task')+'</button><button class="button danger-outline compact" data-delete>Delete task…</button></div></details></div></div>'+
    '<div class="focus-body"><p class="focus-kicker">'+(task.archivedAt?'ARCHIVED':task.completedAt?'TASK COMPLETE':run?'IN FOCUS NOW':'YOUR NEXT STEP')+'</p>'+
    '<div class="current-step"><h3 class="current-label">'+h(task.completedAt?'A waypoint reached.':current?.label || 'All done')+'</h3>'+(!task.archivedAt&&!task.completedAt&&current?'<button class="button secondary timer-toggle" data-timer-toggle data-action="'+(run?'pause':'start')+'" data-item="'+h(current.id)+'" aria-label="'+h(timerLabel)+'" title="'+h(timerLabel)+'"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'+timerIcon+'</svg></button>':'')+'</div>'+
    '<p class="focus-note">'+h(task.completedAt?'Finished '+date(task.completedAt)+'. Your progress and history are saved.':current?.notes || 'Make this step your only task for a moment.')+'</p>'+
    '<div class="focus-actions">'+(task.archivedAt?'<button class="button primary" data-action="restore">Restore task</button>':task.completedAt?'<button class="button primary" data-template="custom">Start another task →</button>':'<button class="button primary" data-action="finish" data-item="'+h(current.id)+'">Finished this '+h(task.unit)+' ✓</button>')+'</div>'+
    '<div class="progress-copy"><span>'+stats.done+' of '+stats.total+' steps complete</span><span>'+Math.round(stats.done/stats.total*100)+'%</span></div><progress class="bar" max="'+stats.total+'" value="'+stats.done+'" aria-label="Task progress"></progress>'+
    '<dl class="focus-time"><div><dt>Active time</dt><dd id="elapsed">'+clock(stats.elapsedMs)+'</dd></div><div><dt>Estimated remaining</dt><dd id="remaining">'+(task.completedAt?'Complete':duration(stats.remainingMs))+'</dd></div><div><dt>This '+h(task.unit)+'</dt><dd id="current-time">'+clock(current?.elapsedMs||0)+'</dd></div></dl><p class="estimate-note" id="estimate-note"></p><p class="muted">Timing continues while you use other apps or close this tab. Pause for breaks.</p></div>'+
    '<div class="detail-tabs"><button data-tab="checklist" class="'+(tab==='checklist'?'selected':'')+'">Checklist</button><button data-tab="materials" class="'+(tab==='materials'?'selected':'')+'">Materials & notes</button><button data-tab="history" class="'+(tab==='history'?'selected':'')+'">Activity log</button></div><div class="detail-content" id="detail-content"></div></article>';
  if(tab==='checklist'){
    $('detail-content').innerHTML=task.items.map(i=>'<div class="check-item '+(i.completedAt?'done':'')+'"><button class="check" data-action="'+(i.completedAt?'undo':'finish')+'" data-item="'+h(i.id)+'" aria-pressed="'+!!i.completedAt+'" aria-label="'+h((i.completedAt?'Reopen ':'Complete ')+i.label)+'" '+(task.archivedAt?'disabled':'')+'>'+(i.completedAt?'✓':'')+'</button><div><span class="item-label">'+h(i.label)+'</span><div class="item-time">'+clock(i.elapsedMs)+(i.completedAt?' · '+h(date(i.completedAt)):'')+'</div></div>'+(!i.completedAt&&!task.archivedAt?(run?.itemId===i.id?'<span class="focus-badge">In focus</span>':'<button class="button secondary compact step-focus" data-action="start" data-item="'+h(i.id)+'" aria-label="Focus on '+h(i.label)+'">Focus</button>'):'')+'</div>').join('');
  }else if(tab==='materials'){
    $('detail-content').innerHTML='<div class="task-meta">'+(task.notes?h(task.notes)+'<br><br>':'')+'<strong>Created</strong> '+h(date(task.createdAt))+'<br><strong>Started</strong> '+h(date(task.startedAt))+'<br><strong>Completed</strong> '+h(date(task.completedAt))+'<br><strong>Target date</strong> '+h(task.dueDate||'Not set')+'<br><strong>Task ID</strong> '+h(task.id)+'</div>'+
      (task.chatUrl?'<p><a class="text-button" href="'+h(task.chatUrl)+'" target="_blank" rel="noopener">Open task chat ↗</a></p>':'')+
      task.materials.map(m=>'<div class="material"><strong>'+h(m.label)+'</strong>'+(/^https?:\/\//i.test(m.location)?'<a href="'+h(m.location)+'" target="_blank" rel="noopener">'+h(m.location)+' ↗</a>':'<code>'+h(m.location)+'</code>')+'</div>').join('')+
      (!task.materials.length?'<p class="muted">Add source documents, papers, or local file paths with Edit task.</p>':'')+
      '<p class="muted">Local file paths can be selected and copied into your file explorer.</p>';
  }else{
    $('detail-content').innerHTML=(!task.archivedAt?'<form class="note-form" id="note-form"><input id="note-text" required maxlength="5000" placeholder="Leave a note for your next session" aria-label="History note"><button class="button secondary">Add note</button></form>':'')+
      [...task.events].reverse().map(e=>'<div class="history-row"><time>'+h(date(e.at))+'</time><strong>'+h(e.type.replaceAll('-',' '))+'</strong>'+(e.type==='time-corrected'?'<p>'+h(e.detail.label)+': '+clock(e.detail.previousMs)+' → '+clock(e.detail.elapsedMs)+(e.detail.reason?' · '+h(e.detail.reason):'')+'</p>':typeof e.detail==='string'&&e.detail?'<p>'+h(e.detail)+'</p>':'')+'</div>').join('');
    $('note-form')?.addEventListener('submit',e=>{e.preventDefault();action('note',null,$('note-text').value);});
  }
  renderTiming();
  document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
  syncControls();
}
function renderTiming(){
  const task=state.tasks.find(t=>t.id===selected);if(!task||!$('elapsed'))return;
  const current=currentItem(task);
  $('elapsed').textContent=clock(task.stats.elapsedMs);$('current-time').textContent=clock(current?.elapsedMs||0);
  $('remaining').textContent=task.completedAt?'Complete':duration(task.stats.remainingMs);
  $('estimate-note').textContent=task.completedAt?'Completed '+date(task.completedAt)+'.':task.stats.averageMs===null?'Finish a timed step to estimate your pace. Breaks are excluded.':(task.stats.done<3?'Early estimate':'Estimate')+' · '+duration(task.stats.averageMs)+' per '+task.unit+'. '+(task.stats.remainingMs===0?'This step is taking longer than your average.':state.running?.taskId===task.id?'Finish around '+new Date(state.serverTime+task.stats.remainingMs).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'.':'Based on completed steps; different kinds of work may take different amounts of time.');
}
function openForm(template='slides',task=null){
  editing=task;form.reset();$('form-error').textContent='';$('reload-edit').hidden=true;$('form-title').textContent=task?'Edit waypoint':'A new waypoint';
  field('activity').value=template==='reading'?'Read':template==='custom'?'Work':'Revise';
  field('unit').value=template==='reading'?'page':template==='custom'?'item':'slide';
  field('mode').value=template==='custom'?'list':'range';
  if(task){
    for(const key of ['title','activity','unit','dueDate','chatUrl','notes'])field(key).value=task[key]||'';
    field('projectName').value=task.project.name;field('projectKind').value=task.project.kind;
    field('mode').value='list';field('items').value=task.items.map(i=>i.label).join('\n');
    field('materials').value=task.materials.map(m=>m.label+' | '+m.location).join('\n');
  }else if(project){field('projectKind').value=project.split(':')[0];field('projectName').value=project.slice(project.indexOf(':')+1);}
  draftItems=task?task.items.map(item=>({...item,protected:!!item.completedAt||item.elapsedMs>0||task.sessions.some(session=>session.itemId===item.id)||task.events.some(event=>event.type==='time-corrected'&&event.detail.itemId===item.id)})):[];
  field('mode').disabled=!!task;renderEditor();updateMode();$('task-dialog').showModal();field('title').focus();
}
function updateMode(){
  const range=!editing&&field('mode').value==='range';
  $('range-fields').hidden=!range;
  field('start').disabled=field('end').disabled=!range;
  $('list-field').hidden=!!editing||range;
  field('items').disabled=!!editing||range;
  $('item-editor').hidden=!editing;
}
function renderEditor(){
  $('editor-rows').innerHTML=draftItems.map((item,index)=>'<div class="editor-row"><label>Step '+(index+1)+'<input data-item-label="'+h(item.id)+'" value="'+h(item.label)+'" required maxlength="500"></label><div class="editor-controls"><button type="button" data-move="-1" data-index="'+index+'" '+(!index?'disabled':'')+' aria-label="Move step '+(index+1)+' up">↑</button><button type="button" data-move="1" data-index="'+index+'" '+(index===draftItems.length-1?'disabled':'')+' aria-label="Move step '+(index+1)+' down">↓</button><button type="button" data-remove="'+index+'" '+(item.protected?'disabled title="This step has recorded progress"':'')+'>Remove</button></div></div>').join('');
}
$('editor-rows').addEventListener('input',event=>{
  const item=draftItems.find(item=>item.id===event.target.dataset.itemLabel);
  if(item)item.label=event.target.value;
});
$('editor-rows').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-remove')){const index=Number(button.dataset.remove);if(!draftItems[index].protected)draftItems.splice(index,1);}
  if(button.hasAttribute('data-move')){const index=Number(button.dataset.index),target=index+Number(button.dataset.move);if(target>=0&&target<draftItems.length)[draftItems[index],draftItems[target]]=[draftItems[target],draftItems[index]];}
  renderEditor();
});
$('add-step').onclick=()=>{draftItems.push({id:crypto.randomUUID(),label:'',notes:''});renderEditor();$('editor-rows').lastElementChild.querySelector('input').focus();};
$('reload-edit').onclick=async()=>{const id=editing?.id;await refresh();const task=state.tasks.find(task=>task.id===id);if(task){$('task-dialog').close();openForm('',task);}};
form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;busy=true;mutationVersion++;const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Saving…';form.setAttribute('aria-busy','true');$('cancel-form').disabled=$('close-form').disabled=true;syncControls();
  try{
    const config={title:field('title').value,project:{name:field('projectName').value,kind:field('projectKind').value},
      activity:field('activity').value,unit:field('unit').value,dueDate:field('dueDate').value,chatUrl:field('chatUrl').value,notes:field('notes').value,
      materials:field('materials').value.split('\n').filter(s=>s.trim()).map(line=>{const split=line.indexOf('|');return split<0?{label:line.trim(),location:line.trim()}:{label:line.slice(0,split).trim(),location:line.slice(split+1).trim()};})};
    if(editing)config.id=editing.id;
    if(editing)config.items=draftItems.map(({id,label,notes})=>({id,label,notes}));
    else if(field('mode').value==='range')config.range={start:Number(field('start').value),end:Number(field('end').value)};
    else config.items=field('items').value.split('\n').filter(s=>s.trim()).map((label,i)=>({id:editing?.items[i]?.id||'item-'+(i+1),label,notes:editing?.items[i]?.notes||''}));
    const task=await api('/api/configure',{config,revision:editing?.revision});
    selected=task.id;project=projectKey(task.project);view='work';filter='all';$('search').value='';tab='checklist';saveNavigation();
    $('task-dialog').close();notice('Task saved.','success');await refresh();
  }catch(error){$('form-error').textContent=error.message;$('reload-edit').hidden=error.status!==409;}finally{busy=false;button.disabled=false;button.textContent='Save task';form.removeAttribute('aria-busy');$('cancel-form').disabled=$('close-form').disabled=false;syncControls();if(!$('task-dialog').open)document.querySelector('[data-edit]')?.focus({preventScroll:true});}
});
$('task-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('task-dialog').addEventListener('close',()=>{(document.querySelector('[data-edit]')||$('new-task')).focus({preventScroll:true});});
$('item-mode').addEventListener('change',updateMode);
$('new-task').onclick=()=>openForm();
$('close-form').onclick=$('cancel-form').onclick=()=>$('task-dialog').close();
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
$('nav-work').onclick=()=>{project='';view='work';filter='open';$('search').value='';tab='checklist';selected='';saveNavigation();render();};
$('nav-history').onclick=()=>{project='';view='history';filter='all';$('search').value='';tab='history';selected='';saveNavigation();render();};
$('filter-open').onclick=()=>{filter='open';render();};$('filter-all').onclick=()=>{filter='all';render();};$('filter-archived').onclick=()=>{filter='archived';render();};
$('search').oninput=render;
document.addEventListener('click',e=>{
  const disclosure=document.querySelector('.task-more[open]');
  if(disclosure&&(!disclosure.contains(e.target)||e.target.closest('button')))disclosure.open=false;
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-project')&&performance.now()-projectDragEndedAt>300){project=button.dataset.project;view='work';tab='checklist';filter='all';selected='';$('search').value='';notice('');saveNavigation();render();[...document.querySelectorAll('[data-project]')].find(control=>control.dataset.project===project)?.focus({preventScroll:true});}
  if(button.dataset.projectAction)changeProject(button.dataset.projectAction,button.dataset.projectKey);
  if(button.dataset.task){selected=button.dataset.task;saveNavigation();render();document.querySelector('[data-task="'+CSS.escape(selected)+'"]')?.focus({preventScroll:true});if(matchMedia('(max-width:620px)').matches)$('detail').scrollIntoView({block:'start'});}
  if(button.id==='new-project')openProjectForm();
  if(button.hasAttribute('data-reset-view')){filter='all';$('search').value='';render();}
  if(button.dataset.tab){tab=button.dataset.tab;renderDetail();}
  if(button.dataset.template)openForm(button.dataset.template);
  if(button.hasAttribute('data-edit'))openForm('',state.tasks.find(t=>t.id===selected));
  if(button.hasAttribute('data-delete'))openDelete();
  if(button.hasAttribute('data-correct-time'))openTimeCorrection();
  if(button.dataset.action)action(button.dataset.action,button.dataset.item);
});
$('import-task').onclick=()=>$('import-file').click();
$('import-file').onchange=async()=>{
  mutationVersion++;
  try{
    const file=$('import-file').files[0];if(!file)return;if(file.size>2_000_000)throw Error('Choose a file smaller than 2 MB.');
    const input=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    const task=input.version===1&&Array.isArray(input.durations)?await api('/api/legacy',input):await api('/api/configure',{config:input,revision:input.expectedRevision});
    selected=task.id;filter='all';project=projectKey(task.project);view='work';$('search').value='';saveNavigation();notice('Imported '+task.title);await refresh();
  }catch(error){notice(error.message);}finally{$('import-file').value='';}
};
function saveNavigation(){
  const hash=selected?'#'+selected:project?'#project/'+encodeURIComponent(project):view==='history'?'#history/':'';
  history.pushState({waypoint:true,project,selected,view,filter},'',location.pathname+hash);
}
function readNavigation(){
  const saved=history.state,hash=location.hash.slice(1);
  project='';selected='';view='work';filter='all';
  if(saved?.waypoint){({project,selected,view,filter}=saved);}
  else if(hash.startsWith('project/')){try{project=decodeURIComponent(hash.slice(8));}catch{}}
  else if(hash==='history/')view='history';
  else{selected=hash;filter=hash?'all':'open';}
  tab=view==='history'?'history':'checklist';$('search').value='';
}
window.addEventListener('popstate',()=>{readNavigation();render();});
window.addEventListener('hashchange',()=>{readNavigation();render();});
readNavigation();
$('handoff').onclick=async()=>{
  if(busy||handedOff)return;busy=true;mutationVersion++;
  try{const result=await api('/api/handoff',{});handedOff=true;notice(result.message);$('connection').textContent='Saved · server stopped';document.querySelectorAll('button').forEach(button=>button.disabled=true);}
  catch(error){notice(error.message);}finally{busy=false;}
};
$('today').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'long',day:'numeric'});
let polling=false;
setInterval(async()=>{
  if(polling||busy||handedOff||draggingProject||($('task-dialog').open||$('delete-dialog').open||$('time-dialog').open||$('project-dialog').open))return;polling=true;
  try{
    const previous=JSON.stringify(state.tasks.map(t=>[t.id,t.revision,t.events.length]))+JSON.stringify(state.running&&[state.running.taskId,state.running.itemId])+JSON.stringify(state.projectStates||[]);
    const version=mutationVersion;
    const fresh=await api('/api/state');
    if(version!==mutationVersion||busy||draggingProject||$('task-dialog').open||$('delete-dialog').open||$('time-dialog').open||$('project-dialog').open)return;
    const changed=previous!==JSON.stringify(fresh.tasks.map(t=>[t.id,t.revision,t.events.length]))+JSON.stringify(fresh.running&&[fresh.running.taskId,fresh.running.itemId])+JSON.stringify(fresh.projectStates||[]);
    state=fresh;if(connectionError){notice('');connectionError=false;}$('connection').textContent='Saved to data folder';if(changed)render();else renderTiming();
  }catch{$('connection').textContent='Disconnected · check timer when reconnected';}finally{polling=false;}
},1000);
refresh();

function openDelete(){
  if(busy)return;
  const task=state.tasks.find(task=>task.id===selected);if(!task)return;
  pendingDelete={id:task.id,revision:task.revision,title:task.title};
  $('delete-task-name').textContent=task.title;
  $('delete-error').textContent='';$('confirm-delete').disabled=false;
  $('delete-dialog').showModal();$('cancel-delete').focus();
}
$('cancel-delete').onclick=()=>{if(!busy)$('delete-dialog').close();};
$('delete-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('delete-dialog').addEventListener('close',()=>{pendingDelete=null;document.querySelector('.task-more summary')?.focus({preventScroll:true});});
$('delete-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!pendingDelete)return;
  const target=pendingDelete;busy=true;mutationVersion++;
  $('confirm-delete').disabled=true;$('cancel-delete').disabled=true;$('confirm-delete').textContent='Deleting…';
  try{
    await api('/api/action',{type:'delete',taskId:target.id,revision:target.revision,confirmDelete:true});
    $('delete-dialog').close();selected='';
    await refresh();history.replaceState(null,'',selected?'#'+selected:location.pathname);
    notice('Deleted “'+target.title+'” and its history.','success');
  }catch(error){
    $('delete-error').textContent=error.status===409?'This task changed since you opened this confirmation. Cancel, review the updated task, and choose Delete task again.':error.message;
    if(error.status!==409&&error.status!==404)$('confirm-delete').disabled=false;
    await refresh();
  }finally{busy=false;$('cancel-delete').disabled=false;$('confirm-delete').textContent='Delete task and history';syncControls();}
});

document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const disclosure=document.querySelector('.task-more[open]');
  if(disclosure){disclosure.open=false;disclosure.querySelector('summary').focus();}
});

function openTimeCorrection(){
  if(busy||handedOff)return;
  const task=state.tasks.find(task=>task.id===selected);if(!task)return;
  mutationVersion++;
  correctingTime=structuredClone(task);
  $('time-form').reset();$('time-error').textContent='';$('save-time').disabled=false;
  $('time-task-name').textContent=task.title;
  $('time-item').innerHTML=task.items.map(item=>'<option value="'+h(item.id)+'">'+h(item.label)+'</option>').join('');
  $('time-item').value=(currentItem(task)||task.items[0]).id;
  loadTimeItem();$('time-dialog').showModal();$('time-item').focus();
}
function loadTimeItem(){
  const item=correctingTime.items.find(item=>item.id===$('time-item').value);
  const seconds=Math.floor(item.elapsedMs/1000);
  $('time-original').textContent='Recorded when opened: '+clock(item.elapsedMs);
  $('time-hours').value=Math.floor(seconds/3600);
  $('time-minutes').value=Math.floor(seconds%3600/60);
  $('time-seconds').value=seconds%60;
}
$('time-item').onchange=loadTimeItem;
$('cancel-time').onclick=()=>{if(!busy)$('time-dialog').close();};
$('time-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('time-dialog').addEventListener('close',()=>{correctingTime=null;document.querySelector('.task-more summary')?.focus({preventScroll:true});});
$('time-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!correctingTime)return;
  const task=correctingTime;
  const elapsedMs=(Number($('time-hours').value)*3600+Number($('time-minutes').value)*60+Number($('time-seconds').value))*1000;
  const payload={type:'correct-time',taskId:task.id,revision:task.revision,itemId:$('time-item').value,elapsedMs,reason:$('time-reason').value};
  busy=true;mutationVersion++;syncControls();
  const controls=[...$('time-form').elements];controls.forEach(control=>control.disabled=true);
  $('save-time').textContent='Saving…';$('time-form').setAttribute('aria-busy','true');
  let conflict=false;
  try{
    await api('/api/action',payload);
    $('time-dialog').close();await refresh();
    notice('Recorded time corrected. Totals and estimates updated.','success');
  }catch(error){
    conflict=error.status===409||error.status===404;
    $('time-error').textContent=error.status===409?'This task changed. Cancel, review the latest task, and reopen Correct recorded time.':error.message;
    await refresh();
  }finally{
    busy=false;controls.forEach(control=>control.disabled=false);$('save-time').disabled=conflict;
    $('save-time').textContent='Save correction';$('time-form').removeAttribute('aria-busy');syncControls();
    if(!$('time-dialog').open)document.querySelector('.task-more summary')?.focus({preventScroll:true});
  }
});

function allProjects(){return [...new Map([...state.tasks.map(t=>t.project),...(state.projectStates||[])].map(p=>[projectKey(p),p])).values()];}
function projectKey(value){return value.kind+':'+value.name;}
function projectState(value){return (state.projectStates||[]).find(p=>projectKey(p)===projectKey(value))||{revision:0,archivedAt:null};}
async function changeProject(type,key=project,expectedRevision){
  if(busy||handedOff)return;
  const target=allProjects().find(p=>projectKey(p)===key);if(!target)return;
  const revision=expectedRevision??projectState(target).revision;
  busy=true;mutationVersion++;syncControls();notice('Saving project…');
  try{
    await api('/api/project',{type,project:target,revision});
    if(type==='archive')archivedProjectsOpen=true;
    notice(type==='archive'?'Moved “'+target.name+'” to Archived projects.':'Restored “'+target.name+'” to Your projects.','success');
  }catch(error){notice(error.message,'error');}
  finally{await refresh();busy=false;syncControls();[...document.querySelectorAll('[data-project]')].find(button=>button.dataset.project===key)?.focus({preventScroll:true});}
}

function clearProjectDrag(){
  draggingProject=null;projectDragEndedAt=performance.now();
  $('projects').classList.remove('is-dragging');
  document.querySelectorAll('.project-drop-target,.project-drag-source').forEach(element=>element.classList.remove('project-drop-target','project-drag-source'));
}
function projectDropTarget(event){
  const zone=event.target.closest('[data-project-drop]');
  return draggingProject&&zone&&zone.dataset.projectDrop===(draggingProject.archived?'restore':'archive')?zone:null;
}
$('projects').addEventListener('dragstart',event=>{
  const button=event.target.closest('[data-project]');
  const target=allProjects().find(p=>projectKey(p)===button?.dataset.project);
  if(!target||busy||handedOff){event.preventDefault();return;}
  const saved=projectState(target);draggingProject={key:projectKey(target),revision:saved.revision,archived:!!saved.archivedAt};
  mutationVersion++;
  document.querySelectorAll('.project-options[open]').forEach(menu=>menu.open=false);
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggingProject.key);
  button.classList.add('project-drag-source');$('projects').classList.add('is-dragging');
});
function highlightProjectDrop(event){
  const zone=projectDropTarget(event);
  document.querySelectorAll('.project-drop-target').forEach(element=>{if(element!==zone)element.classList.remove('project-drop-target');});
  if(zone){event.preventDefault();event.dataTransfer.dropEffect='move';zone.classList.add('project-drop-target');}
}
$('projects').addEventListener('dragenter',highlightProjectDrop);
$('projects').addEventListener('dragover',highlightProjectDrop);
$('projects').addEventListener('dragleave',event=>{
  const zone=event.target.closest('[data-project-drop]');
  if(zone&&!zone.contains(event.relatedTarget))zone.classList.remove('project-drop-target');
});
$('projects').addEventListener('drop',event=>{
  const zone=projectDropTarget(event);if(!zone)return;
  event.preventDefault();const target=draggingProject,type=zone.dataset.projectDrop;clearProjectDrag();
  changeProject(type,target.key,target.revision);
});
$('projects').addEventListener('dragend',clearProjectDrag);
document.addEventListener('click',event=>{
  document.querySelectorAll('.project-options[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('button'))menu.open=false;});
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')document.querySelectorAll('.project-options[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});
});

function openProjectForm(){
  if(busy||handedOff)return;
  $('project-form').reset();$('project-error').textContent='';$('project-dialog').showModal();
}
$('cancel-project').onclick=()=>$('project-dialog').close();
$('project-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('project-dialog').addEventListener('close',()=>$('new-project')?.focus({preventScroll:true}));
$('project-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||handedOff)return;
  busy=true;mutationVersion++;syncControls();
  const controls=[...$('project-form').elements];controls.forEach(control=>control.disabled=true);
  $('save-project').textContent='Creating…';$('project-form').setAttribute('aria-busy','true');
  try{
    const created=await api('/api/project',{type:'create',project:{name:$('project-name').value,kind:$('project-kind').value},revision:0});
    project=projectKey(created);selected='';view='work';filter='all';tab='checklist';$('search').value='';saveNavigation();
    $('project-dialog').close();notice('Project created. Add your first task when you’re ready.','success');await refresh();
  }catch(error){$('project-error').textContent=error.message;}
  finally{busy=false;controls.forEach(control=>control.disabled=false);$('save-project').textContent='Create project';$('project-form').removeAttribute('aria-busy');syncControls();if(!$('project-dialog').open)document.querySelector('#detail [data-template]')?.focus({preventScroll:true});else $('project-name').focus();}
});
field('projectName').addEventListener('change',()=>{
  const matches=allProjects().filter(p=>p.name===field('projectName').value.trim());
  if(matches.length===1)field('projectKind').value=matches[0].kind;
});

$('toggle-projects').onclick=()=>{const expanded=$('toggle-projects').getAttribute('aria-expanded')!=='true';$('toggle-projects').setAttribute('aria-expanded',String(expanded));$('projects').classList.toggle('projects-expanded',expanded);};
