import catalog from '../assets/catalog.json';
import palettes from '../assets/palettes.json';
import {getVariant,planComposition,validatePalette,validateSceneData} from './core.mjs';

// Plugin data contains only document state, never credentials.
const SCENE='vector-composer:scene';
const ASSET='vector-composer:asset';
const COLORS='vector-composer:colors';
const PALETTE='vector-composer:palette';
const clone=value=>JSON.parse(JSON.stringify(value));
const rgb=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
const hex=color=>color&&'#'+[color.r,color.g,color.b].map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const walk=(node,fn)=>{fn(node);for(const child of node.children??[])walk(child,fn);};
function parse(node,key){try{return JSON.parse(node.getPluginData(key)||'null');}catch{throw new Error('Данные композиции повреждены. Выберите другую сцену или создайте новую.');}}

export function createPluginAdapter(api){
 let active=null;
 let busy=false;
 const items=new Map(catalog.items.map(item=>[item.id,item]));
 const paletteById=new Map(palettes.map(p=>[p.id,p]));
 function assetData(node){const value=parse(node,ASSET);if(!value)return null;if(!items.has(value.id)||!['S','L'].includes(value.size)||!['main','background'].includes(value.role))throw new Error('Данные предмета повреждены.');return {id:value.id,size:value.size,role:value.role};}
 function sceneData(frame){return validateSceneData(parse(frame,SCENE),catalog);}
 function findScene(){
  const selection=api.currentPage.selection;
  if(selection.length){
   const scenes=selection.map(selected=>{let n=selected;while(n&&n.type!=='PAGE'){if(n.type==='FRAME'&&n.getPluginData(SCENE))return n;n=n.parent;}return null;});
   if(scenes.some(n=>!n)||scenes.some(n=>n!==scenes[0]))return null;
   active=scenes[0];return active;
  }
  if(active&&!active.removed&&active.parent)return active;
  return null;
 }
 function requireScene(){const scene=findScene();if(!scene)throw new Error('Выделите фрейм Vector Composer или предмет внутри него.');sceneData(scene);return scene;}
 function assetNodes(scene){const result=[];function visit(node){for(const child of node.children??[]){if(assetData(child))result.push(child);else visit(child);}}visit(scene);return result;}
 function currentPalette(scene){const stored=parse(scene,PALETTE);return stored?validatePalette(stored):paletteById.get(sceneData(scene).options.paletteId)??palettes[0];}
 function save(scene,data,palette){scene.setPluginData(SCENE,JSON.stringify(validateSceneData(data,catalog)));if(palette)scene.setPluginData(PALETTE,JSON.stringify(validatePalette(palette)));}
 function paletteFrom(payload,scene){if(payload.palette)return validatePalette(payload.palette);const id=payload.paletteId??payload.options?.paletteId??(scene&&sceneData(scene).options.paletteId)??'violet';const palette=paletteById.get(id);if(palette)return palette;if(scene&&currentPalette(scene).id===id)return currentPalette(scene);throw new Error('Палитра не найдена. Загрузите корректный JSON.');}
 function snapshot(scene=findScene()){
  if(!scene)return null;
  const metadata=sceneData(scene);const nodes=assetNodes(scene);
  return {id:scene.id,name:scene.name,...metadata,selection:nodes.map(n=>{const {id,role}=assetData(n);return {id,role};}),palette:currentPalette(scene),width:scene.width,height:scene.height};
 }
 function initialSelection(){
  try{return {activeScene:snapshot()};}
  catch(error){return {activeScene:null,selectionError:error instanceof Error?error.message:'Не удалось прочитать выбранную композицию. Выберите другую сцену или создайте новую.'};}
 }
 function refresh(){try{api.ui.postMessage({type:'refresh',data:{activeScene:snapshot()}});}catch(error){api.ui.postMessage({type:'refresh',data:{activeScene:null},error:error.message});}}
 function roleMap(role){
  const map=new Map();const source=palettes[0];
  source.background.forEach((c,i)=>map.set(c,'background:'+i));
  if(role==='main')source.objects.forEach((c,i)=>map.set(c,'objects:'+i));
  map.set(source.ink,role==='background'?'background:2':'ink');map.set('#000000',role==='background'?'background:2':'ink');
  map.set(source.paper,role==='background'?'background:0':'paper');map.set('#FFFFFF',role==='background'?'background:0':'paper');return map;
 }
 function captureColors(root,role){
  const map=roleMap(role);
  walk(root,node=>{const bindings=[];for(const property of ['fills','strokes','effects']){const values=node[property];if(!Array.isArray(values))continue;values.forEach((paint,index)=>{
   if(paint.color){const value=hex(paint.color);if(map.has(value))bindings.push({property,index,role:map.get(value),value});}
   paint.gradientStops?.forEach((stop,stopIndex)=>{const value=hex(stop.color);if(map.has(value))bindings.push({property,index,stopIndex,role:map.get(value),value});});
  });}if(bindings.length)node.setPluginData(COLORS,JSON.stringify(bindings));});
 }
 function colorFor(palette,role){const [key,index]=role.split(':');return index===undefined?palette[key]:palette[key]?.[Number(index)];}
 function paintColors(root,palette){
  walk(root,node=>{const bindings=parse(node,COLORS);if(!Array.isArray(bindings))return;const updates={};for(const binding of bindings){const {property,index,stopIndex,role,value}=binding;if(!['fills','strokes','effects'].includes(property)||!Number.isInteger(index))continue;
   const values=updates[property]??(Array.isArray(node[property])?clone(node[property]):null);if(!values)continue;const paint=values[index];const color=stopIndex===undefined?paint?.color:paint?.gradientStops?.[stopIndex]?.color;
   // Preserve native custom colors while known role colors follow the palette.
   if(!color||hex(color)!==value)continue;
   const next=colorFor(palette,role);if(typeof next!=='string')continue;
   const replacement={...color,...rgb(next)};if(stopIndex===undefined)paint.color=replacement;else paint.gradientStops[stopIndex].color=replacement;
   binding.value=next;updates[property]=values;
  }for(const [property,values]of Object.entries(updates))node[property]=values;node.setPluginData(COLORS,JSON.stringify(bindings));});
 }
 function importAsset(entry,size,palette,scale){
  const item=items.get(entry.id);const variant=getVariant(item,size,entry.role);let node;
  try{node=api.createNodeFromSvg(variant.svg);node.name=item.name+' · '+(entry.role==='main'?'Главный':'Фоновый')+' · '+size;node.setPluginData(ASSET,JSON.stringify({id:entry.id,size,role:entry.role}));captureColors(node,entry.role);paintColors(node,palette);node.rescale(scale);return node;}catch(error){if(node&&!node.removed)node.remove();throw error;}
 }
 function place(node,p){node.rotation=p.rotation;node.x=p.x;node.y=p.y;}
 function compose(payload){
  const metadata=validateSceneData({version:1,options:payload.options,selection:payload.selection,query:payload.query,model:payload.model,explanation:payload.explanation},catalog);
  const plan=planComposition(metadata.selection,catalog,metadata.options);const palette=paletteFrom(payload);let frame;
  try{frame=api.createFrame();frame.name='Vector Composer'+(metadata.query?' · '+metadata.query.slice(0,70):' · Композиция');frame.resize(plan.width,plan.height);frame.clipsContent=false;frame.fills=[{type:'SOLID',color:rgb(palette.background[0])}];
   for(const p of plan.placements){const node=importAsset(p,metadata.options.size,palette,plan.scale);frame.appendChild(node);place(node,p);}
   metadata.options.paletteId=palette.id;save(frame,metadata,palette);frame.x=Math.round(api.viewport.center.x-plan.width/2);frame.y=Math.round(api.viewport.center.y-plan.height/2);active=frame;api.currentPage.selection=[frame];api.viewport.scrollAndZoomIntoView([frame]);return {activeScene:snapshot(frame)};
  }catch(error){if(frame&&!frame.removed)frame.remove();throw error;}
 }
 function recolor(payload){
  const scene=requireScene();const data=sceneData(scene);const palette=paletteFrom(payload,scene);const nodes=assetNodes(scene);
  // Validate stored roles before making any document changes.
  for(const node of nodes)walk(node,n=>parse(n,COLORS));
  for(const node of nodes)paintColors(node,palette);
  const old=currentPalette(scene);const fills=Array.isArray(scene.fills)?clone(scene.fills):[];
  for(const fill of fills)if(fill.type==='SOLID'&&hex(fill.color)===old.background[0])fill.color=rgb(palette.background[0]);
  scene.fills=fills;data.options.paletteId=palette.id;data.selection=nodes.map(n=>{const {id,role}=assetData(n);return {id,role};});save(scene,data,palette);return {activeScene:snapshot(scene)};
 }
 function inventory(nodes){return nodes.map(node=>{const {id,role}=assetData(node);return {id,role};});}
 function add(payload){
  const scene=requireScene();const data=sceneData(scene);const existing=assetNodes(scene);const selection=validateSceneData({version:1,options:data.options,selection:payload.selection},catalog).selection;
  if(!selection.length)throw new Error('Выберите предметы для добавления в библиотеке.');
  const combined=[...inventory(existing),...selection];const plan=planComposition(combined,catalog,data.options);const palette=currentPalette(scene);const created=[];const placements=[];
  // Retain the scene's scale when native edits have moved existing objects.
  const first=existing[0];const scale=first?first.width/getVariant(items.get(assetData(first).id),assetData(first).size,assetData(first).role).width:plan.scale;
  const margin=Math.min(scene.width,scene.height)*0.045;
  const left=data.options.layout==='headline'?scene.width*0.45:margin;
  try{for(const [index,entry]of selection.entries()){
   const node=importAsset(entry,data.options.size,palette,scale);created.push(node);
   if(!Number.isFinite(node.width)||!Number.isFinite(node.height)||node.width>scene.width-margin-left||node.height>scene.height-margin*2)throw new Error('Предмет «'+items.get(entry.id).name+'» не помещается в текущий фрейм с сохранённым масштабом. Перекомпонуйте композицию отдельным действием.');
   const preferred=plan.placements[existing.length+index];
   // Correct only the new node's position using its imported, retained-scale bounds.
   placements.push({...preferred,x:Math.max(left,Math.min(preferred.x,scene.width-margin-node.width)),y:Math.max(margin,Math.min(preferred.y,scene.height-margin-node.height))});
  }
   created.forEach((node,index)=>{scene.appendChild(node);place(node,placements[index]);});
  }
  catch(error){for(const node of created)if(!node.removed)node.remove();throw error;}
  data.selection=combined;save(scene,data,palette);return {activeScene:snapshot(scene)};
 }
 function multiply(a,b){return [[a[0][0]*b[0][0]+a[0][1]*b[1][0],a[0][0]*b[0][1]+a[0][1]*b[1][1],a[0][0]*b[0][2]+a[0][1]*b[1][2]+a[0][2]],[a[1][0]*b[0][0]+a[1][1]*b[1][0],a[1][0]*b[0][1]+a[1][1]*b[1][1],a[1][0]*b[0][2]+a[1][1]*b[1][2]+a[1][2]]];}
 function inverse(a){const d=a[0][0]*a[1][1]-a[0][1]*a[1][0];if(!d)throw new Error('Не удалось преобразовать координаты группы.');return [[a[1][1]/d,-a[0][1]/d,(a[0][1]*a[1][2]-a[1][1]*a[0][2])/d],[-a[1][0]/d,a[0][0]/d,(a[1][0]*a[0][2]-a[0][0]*a[1][2])/d]];}
 function setRole(payload){
  if(!['main','background'].includes(payload.role))throw new Error('Выберите главное или фоновое состояние.');
  const scene=requireScene();const data=sceneData(scene);const palette=currentPalette(scene);const replacements=[];
  try{for(const old of assetNodes(scene)){
   const entry=assetData(old);if(entry.role===payload.role)continue;
   const variant=getVariant(items.get(entry.id),entry.size,entry.role);
   const node=importAsset({...entry,role:payload.role},entry.size,palette,old.width/variant.width);
   replacements.push({old,node,parent:old.parent,index:old.parent.children.indexOf(old),transform:clone(old.relativeTransform),absolute:old.absoluteTransform?clone(old.absoluteTransform):null});
  }}catch(error){for(const {node}of replacements)if(!node.removed)node.remove();throw error;}
  for(const {old,node,parent,index,transform,absolute}of replacements){
   parent.insertChild(index,node);node.relativeTransform=transform;node.opacity=old.opacity;node.visible=old.visible;node.locked=old.locked;old.remove();if(absolute&&parent.absoluteTransform)node.relativeTransform=multiply(inverse(parent.absoluteTransform),absolute);
  }
  data.selection=inventory(assetNodes(scene));save(scene,data,palette);api.currentPage.selection=[scene];return {activeScene:snapshot(scene)};
 }
 function switchSize(payload){
  const scene=requireScene();const data=sceneData(scene);const size=payload.size;
  if(!['S','L'].includes(size))throw new Error('Выберите размер S или L.');
  const palette=currentPalette(scene);const nodes=assetNodes(scene);const replacements=[];
  try{for(const old of nodes){const entry=assetData(old);if(entry.size===size)continue;const variant=getVariant(items.get(entry.id),entry.size,entry.role);const node=importAsset(entry,size,palette,old.width/variant.width);replacements.push({old,node,parent:old.parent,index:old.parent.children.indexOf(old),transform:clone(old.relativeTransform),absolute:old.absoluteTransform?clone(old.absoluteTransform):null});}}
  catch(error){for(const {node}of replacements)if(!node.removed)node.remove();throw error;}
  for(const {old,node,parent,index,transform,absolute}of replacements){parent.insertChild(index,node);node.relativeTransform=transform;node.opacity=old.opacity;node.visible=old.visible;node.locked=old.locked;old.remove();if(absolute&&parent.absoluteTransform)node.relativeTransform=multiply(inverse(parent.absoluteTransform),absolute);else node.relativeTransform=transform;}
  data.options.size=size;data.selection=inventory(assetNodes(scene));save(scene,data,palette);api.currentPage.selection=[scene];return {activeScene:snapshot(scene)};
 }
 function relayout(payload){
  const scene=requireScene();let data=sceneData(scene);let nodes=assetNodes(scene);const selection=inventory(nodes);
  const next=validateSceneData({...data,selection,options:{...data.options,...payload.options}},catalog);const palette=paletteFrom({paletteId:next.options.paletteId,palette:payload.palette},scene);const plan=planComposition(selection,catalog,next.options);
  if(nodes.some(n=>assetData(n).size!==next.options.size)){switchSize({size:next.options.size});nodes=assetNodes(scene);}
  scene.resize(plan.width,plan.height);
  nodes.forEach((node,index)=>{const placement=plan.placements[index];const variant=getVariant(items.get(placement.id),placement.size,placement.role);node.rescale(variant.width*plan.scale/node.width);
   if(node.parent===scene)place(node,placement);else if(node.parent.absoluteTransform&&scene.absoluteTransform)node.relativeTransform=multiply(inverse(node.parent.absoluteTransform),multiply(scene.absoluteTransform,[[1,0,placement.x],[0,1,placement.y]]));else place(node,placement);
  });
  save(scene,next,currentPalette(scene));recolor({palette});return {activeScene:snapshot(scene)};
 }
 async function exportScene(){const scene=requireScene();const bytes=await scene.exportAsync({format:'SVG',svgIdAttribute:true,svgOutlineText:true});return {bytes:Array.from(bytes),name:'vector-composer-'+scene.id.replace(/[^a-z\d-]/gi,'-')+'.svg',activeScene:snapshot(scene)};}
 const actions={compose,recolor,add,relayout,export:exportScene,'switch-size':switchSize,'set-role':setRole,'read-selection':()=>({activeScene:snapshot()}),init:()=>({catalog:{version:catalog.version,items:catalog.items.map(({id,name,aliases,tags,variants})=>({id,name,aliases,tags,preview:variants.S.main.svg}))},palettes,...initialSelection()})};
 api.ui.onmessage=async message=>{
  if(!message||typeof message.requestId!=='string'||typeof message.type!=='string')return;
  if(busy){api.ui.postMessage({requestId:message.requestId,ok:false,error:'Дождитесь завершения текущего действия.'});return;}
  busy=true;
  try{const action=actions[message.type];if(!action)throw new Error('Неизвестное действие плагина.');const data=await action(message.payload??{});api.ui.postMessage({requestId:message.requestId,ok:true,data});}
  catch(error){api.ui.postMessage({requestId:message.requestId,ok:false,error:error instanceof Error?error.message:'Не удалось выполнить действие. Повторите попытку.'});}
  finally{busy=false;}
 };
 api.on('selectionchange',refresh);
 return {refresh};
}

if(typeof figma!=='undefined'){figma.showUI(__html__,{width:460,height:760,themeColors:true});createPluginAdapter(figma);}
