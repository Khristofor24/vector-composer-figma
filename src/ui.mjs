import {resolveNames,validatePalette} from './core.mjs';
import {selectByMetaphor,checkConnection} from './openrouter.mjs';

// No clientStorage, localStorage, document metadata or logs receive these values.
export function createCredentialSession(demoKey=''){
 let ownKey='';let demoEnabled=Boolean(demoKey);
 return {
  setOwn(value){ownKey=String(value).trim();if(!ownKey)demoEnabled=false;},
  clear(){ownKey='';demoEnabled=false;},
  useDemo(value){demoEnabled=Boolean(value)&&Boolean(demoKey);},
  key(){return ownKey||(demoEnabled?demoKey:'');},
  mode(){return ownKey?'personal':demoEnabled?'demo':'none';},
  demoEnabled(){return demoEnabled;},
  hasDemo(){return Boolean(demoKey);},
  containsKey(text){return [ownKey,demoKey].some(key=>key&&String(text).includes(key));},
  mask(text){let safe=String(text);for(const key of [ownKey,demoKey])if(key)safe=safe.split(key).join('[ключ скрыт]');return safe;},
 };
}

export function mountUI(){
 const $=id=>document.getElementById(id);
 const credentials=createCredentialSession(__DEMO_API_KEY__);
 const state={catalog:null,palettes:[],paletteId:'violet',selected:new Map(),scene:null,mode:'names',busy:false,controller:null,requestNumber:0};
 const pending=new Map();
 $('model').value=__DEFAULT_MODEL__;
 function status(text,kind=''){const element=$('status');element.textContent=credentials.mask(text);element.dataset.kind=kind;}
 function request(type,payload={}){
  const requestId=String(++state.requestNumber);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Figma не ответила. Перезапустите плагин и повторите действие.'));},60000);
   pending.set(requestId,{resolve,reject,timer});
   parent.postMessage({pluginMessage:{requestId,type,payload}},'*');
  });
 }
 function updateDisabled(){
  document.querySelectorAll('button,input,select,textarea').forEach(element=>{element.disabled=state.busy;});
  document.querySelectorAll('[data-scene-action],.plus').forEach(element=>{element.disabled=state.busy||!state.scene;});
  $('demo').disabled=state.busy||!credentials.hasDemo();
  $('cancel').disabled=false;$('cancel').hidden=!state.controller;
  $('compose').textContent=state.busy?'Выполняется…':state.mode==='metaphor'?'Подобрать и создать · AI':'Создать композицию';
 }
 function updateCredentialStatus(){
  $('demo').checked=credentials.demoEnabled();
  const mode=credentials.mode();
  $('connection-badge').textContent=mode==='demo'?' · demo':mode==='personal'?' · личный ключ':' · без ключа';
  $('credential-status').textContent=mode==='personal'?'Личный ключ активен · до закрытия плагина':mode==='demo'?'Встроенный временный demo-ключ активен':credentials.hasDemo()?'Ключ очищен. Demo можно включить только явно.':'Public-сборка без встроенного ключа.';
  updateDisabled();
 }
 async function run(task,network=false){
  if(state.busy)return;
  state.busy=true;if(network)state.controller=new AbortController();
  updateDisabled();
  try{await task(state.controller?.signal);}catch(error){status(error?.message??'Не удалось выполнить действие. Повторите попытку.','error');}
  finally{state.busy=false;state.controller=null;updateDisabled();}
 }
 function selection(){return [...state.selected].map(([id,role])=>({id,role}));}
 function palette(){return state.palettes.find(p=>p.id===state.paletteId);}
 function options(){return {size:$('size').value,format:$('format').value,layout:$('layout').value,paletteId:state.paletteId};}
 function updateCatalogSelection(){
  for(const item of state.catalog?.items??[]){const element=$('asset-'+item.id);if(!element)continue;const selected=state.selected.has(item.id);element.classList.toggle('selected',selected);element.querySelector('.asset-choose').setAttribute('aria-pressed',String(selected));element.querySelector('select').value=state.selected.get(item.id)??'';}
  $('selected-count').textContent=state.selected.size?'Выбрано: '+state.selected.size:'Выберите предметы';
 }
 function renderCatalog(){
  $('catalog').replaceChildren();
  for(const item of state.catalog.items){
   const article=document.createElement('article');article.className='asset';article.id='asset-'+item.id;
   const choose=document.createElement('button');choose.className='asset-choose';choose.type='button';choose.setAttribute('aria-pressed','false');choose.title='Выбрать: '+item.name;
   const image=document.createElement('img');image.alt='';image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(item.preview);choose.append(image,document.createTextNode(item.name));
   choose.onclick=()=>{if(state.selected.has(item.id))state.selected.delete(item.id);else state.selected.set(item.id,'main');updateCatalogSelection();};
   const tools=document.createElement('div');tools.className='asset-tools';
   const role=document.createElement('select');role.setAttribute('aria-label','Роль: '+item.name);
   for(const [value,label]of [['','Не выбран'],['main','Главный'],['background','Фоновый']]){const option=document.createElement('option');option.value=value;option.textContent=label;role.append(option);}
   role.onchange=()=>{if(role.value)state.selected.set(item.id,role.value);else state.selected.delete(item.id);updateCatalogSelection();};
   const add=document.createElement('button');add.className='plus';add.type='button';add.textContent='+';add.setAttribute('aria-label','Добавить в сцену: '+item.name);add.title='Добавить один предмет в текущую сцену';
   add.onclick=()=>run(async()=>{const data=await request('add',{selection:[{id:item.id,role:state.selected.get(item.id)??'main'}]});applyScene(data.activeScene);status(item.name+' — добавлено в сцену.','success');});
   tools.append(role,add);article.append(choose,tools);$('catalog').append(article);
  }updateCatalogSelection();updateDisabled();
 }
 function renderPalettes(){
  $('palettes').replaceChildren();
  for(const value of state.palettes){const button=document.createElement('button');button.className='palette';button.type='button';button.setAttribute('aria-pressed',String(value.id===state.paletteId));const swatches=document.createElement('span');swatches.className='swatches';swatches.setAttribute('aria-hidden','true');for(const color of [...value.background,...value.objects]){const swatch=document.createElement('i');swatch.style.backgroundColor=color;swatches.append(swatch);}button.append(swatches,document.createTextNode(value.name));button.onclick=()=>{state.paletteId=value.id;renderPalettes();updateDisabled();};$('palettes').append(button);}
 }
 function applyScene(scene,{restore=true}={}){
  const sceneChanged=scene&&state.scene?.id!==scene.id;
  state.scene=scene??null;
  $('scene').dataset.active=String(Boolean(scene));
  $('scene-name').textContent=scene?.name??'Новая композиция';
  $('scene-detail').textContent=scene?scene.width+' × '+scene.height+' · предметов: '+scene.selection.length:'Создайте сцену или выделите готовую на холсте';
  if(scene&&restore){
   if(sceneChanged)setMode(scene.model?'metaphor':scene.query?'names':'catalog');
   for(const field of ['size','format','layout'])$(field).value=scene.options[field];
   if(scene.palette&&!state.palettes.some(p=>p.id===scene.palette.id))state.palettes.push(scene.palette);else if(scene.palette)state.palettes=state.palettes.map(p=>p.id===scene.palette.id?scene.palette:p);
   state.paletteId=scene.options.paletteId;
   state.selected=new Map(scene.selection.map(({id,role})=>[id,role]));
   if(scene.query!==undefined)$('query').value=scene.query;
   if(scene.model)$('model').value=scene.model;
   if(scene.explanation){$('ai-result').hidden=false;$('ai-result').textContent='Сохранённый подбор'+(scene.model?' · '+scene.model:'')+'\n'+scene.explanation;}
   else{$('ai-result').hidden=true;$('ai-result').textContent='';}
   renderPalettes();updateCatalogSelection();
  }
  updateDisabled();
 }
 function setMode(mode){
  state.mode=mode;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
  $('query-panel').hidden=mode==='catalog';
  $('query-label').textContent=mode==='metaphor'?'Заголовок или метафора':'Названия предметов';
  $('query').placeholder=mode==='metaphor'?'Например: Обучение онлайн':'Книга, телефон, наушники';
  $('query-help').textContent=mode==='metaphor'?'Подбор через OpenRouter · только предметы этой библиотеки':'Синонимы распознаются без интернета';
  $('ai-background-option').hidden=mode!=='metaphor';
  updateDisabled();
 }
 async function compose(signal){
  if(!state.catalog)throw new Error('Библиотека ещё загружается.');
  let selected=selection();let query=$('query').value.trim();let provenance={};let source='';
  if(credentials.containsKey(query))throw new Error('Текст содержит ключ подключения. Уберите его из запроса.');
  if(state.mode==='names'){
   const resolved=resolveNames(query,state.catalog.items);
   if(resolved.unknown.length)throw new Error('Нет в библиотеке: '+resolved.unknown.join(', ')+'. Уберите эти слова или выберите предметы вручную.');
   selected=resolved.items;source='Названия распознаны без сети.';
  }else if(state.mode==='metaphor'){
   status('OpenRouter подбирает предметы…');
   const model=$('model').value.trim();
   const result=await selectByMetaphor({query,catalog:state.catalog,apiKey:credentials.key(),model,signal});
   const allowBackground=$('ai-background').checked;
   selected=result.items.map(item=>({...item,role:allowBackground?item.role:'main'}));
   const styleNote=!allowBackground&&result.items.some(item=>item.role==='background')?'\nВсе предметы показаны цветными: фоновые состояния выключены.':'';
   provenance={model,explanation:result.explanation+styleNote};
   source=result.cached?'AI · сохранённый ответ из кэша этой сессии. Новый запрос не отправлялся.':'AI · получен ответ OpenRouter.';
   $('ai-result').hidden=false;$('ai-result').textContent=source+'\n'+result.explanation;
   if(!selected.length)throw new Error('В библиотеке нет подходящих предметов. '+result.explanation);
  }else{query='';source='Предметы выбраны из библиотеки.';}
  if(!selected.length)throw new Error('Выберите хотя бы один предмет или введите его название.');
  status('Создаём редактируемые векторы в Figma…');
  const data=await request('compose',{selection:selected,options:options(),palette:palette(),query,...provenance});
  applyScene(data.activeScene);
  if(provenance.explanation){$('ai-result').hidden=false;$('ai-result').textContent=source+'\n'+provenance.explanation;}
  status(source+' Композиция создана.','success');
 }
 window.onmessage=event=>{
  const message=event.data?.pluginMessage;if(!message)return;
  if(message.type==='refresh'){applyScene(message.data?.activeScene);if(message.error)status(message.error,'error');return;}
  const item=pending.get(message.requestId);if(!item)return;
  clearTimeout(item.timer);pending.delete(message.requestId);if(message.ok)item.resolve(message.data);else item.reject(new Error(message.error??'Не удалось выполнить действие.'));
 };
 document.querySelectorAll('[data-mode]').forEach(button=>{button.onclick=()=>setMode(button.dataset.mode);});
 $('compose').onclick=()=>run(compose,state.mode==='metaphor');
 $('query').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run(compose,state.mode==='metaphor');}});
 $('add').onclick=()=>run(async()=>{const data=await request('add',{selection:selection()});applyScene(data.activeScene);status('Выбранные предметы добавлены. Позиции остальных сохранены.','success');});
 $('relayout').onclick=()=>run(async()=>{const data=await request('relayout',{options:options(),palette:palette()});applyScene(data.activeScene);status('Раскладка обновлена по текущим предметам на холсте. AI не вызывался.','success');});
 $('switch-size').onclick=()=>run(async()=>{const data=await request('switch-size',{size:$('size').value});applyScene(data.activeScene);status('Исходная версия S / L заменена. Позиции и порядок слоёв сохранены.','success');});
 $('recolor').onclick=()=>run(async()=>{const data=await request('recolor',{palette:palette()});applyScene(data.activeScene);status('Палитра применена. Ручные позиции, повороты и слои сохранены.','success');});
 $('make-color').onclick=()=>run(async()=>{const data=await request('set-role',{role:'main'});applyScene(data.activeScene);status('Фоновые предметы заменены цветными исходниками. Положение и повороты сохранены. AI не вызывался.','success');});
 $('export').onclick=()=>run(async()=>{
  status('Экспортируем актуальный фрейм…');const data=await request('export');applyScene(data.activeScene,{restore:false});
  const url=URL.createObjectURL(new Blob([new Uint8Array(data.bytes)],{type:'image/svg+xml'}));const link=document.createElement('a');link.href=url;link.download=data.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status('SVG подготовлен из текущего фрейма.','success');
 });
 $('refresh').onclick=()=>run(async()=>{const data=await request('read-selection');applyScene(data.activeScene);status(data.activeScene?'Текущее состояние сцены прочитано.':'Выделите фрейм Vector Composer или создайте новую композицию.');});
 $('palette-file').onchange=()=>{const file=$('palette-file').files?.[0];if(!file)return;run(async()=>{
  if(file.size>100000)throw new Error('JSON палитры слишком большой. Выберите файл до 100 КБ.');let value;try{value=JSON.parse(await file.text());}catch{throw new Error('Не удалось прочитать JSON палитры. Проверьте синтаксис файла.');}
  const custom=validatePalette(value);if(credentials.containsKey(JSON.stringify(custom)))throw new Error('Палитра содержит ключ подключения. Уберите его из файла.');
  if(state.scene){const data=await request('recolor',{palette:custom});applyScene(data.activeScene);}else{state.palettes=state.palettes.filter(p=>p.id!==custom.id);state.palettes.push(custom);state.paletteId=custom.id;renderPalettes();}
  status(state.scene?'JSON загружен, активная сцена перекрашена.':'JSON загружен. Палитра выбрана для новой композиции.','success');
 }).finally(()=>{$('palette-file').value='';});};
 $('api-key').oninput=()=>{credentials.setOwn($('api-key').value);updateCredentialStatus();};
 $('clear-key').onclick=()=>{credentials.clear();$('api-key').value='';updateCredentialStatus();status('Личный ключ очищен. Demo не включается автоматически.');};
 $('demo').onchange=()=>{credentials.useDemo($('demo').checked);updateCredentialStatus();};
 $('check').onclick=()=>run(async signal=>{status('Проверяем модель настоящим запросом…');const result=await checkConnection({apiKey:credentials.key(),model:$('model').value.trim(),signal});status('OpenRouter доступен · '+result.model+' · модель ответила.','success');},true);
 $('cancel').onclick=()=>state.controller?.abort();
 window.addEventListener('pagehide',()=>{credentials.clear();$('api-key').value='';});
 updateCredentialStatus();
 run(async()=>{const data=await request('init');state.catalog=data.catalog;state.palettes=data.palettes;renderCatalog();renderPalettes();applyScene(data.activeScene);status(data.selectionError??(data.activeScene?'Композиция восстановлена. Можно продолжать работу.':'Выберите предметы, введите названия или метафору.'),data.selectionError?'error':'');});
}

if(typeof document!=='undefined'&&typeof document.querySelector==='function')mountUI();
