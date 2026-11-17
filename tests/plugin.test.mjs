import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';

// Explicit Plugin API fake: exercises the shipped entry and messages, not Desktop.
let sequence=0;
const copy=value=>JSON.parse(JSON.stringify(value));
class Node {
 constructor(type='FRAME'){this.id=String(++sequence);this.type=type;this.children=[];this.data={};this.width=100;this.height=100;this.x=0;this.y=0;this.rotation=0;this.opacity=1;this.visible=true;this.locked=false;this.fills=[];this.strokes=[];this.effects=[];this.relativeTransform=[[1,0,0],[0,1,0]];}
 setPluginData(key,value){this.data[key]=value;}
 getPluginData(key){return this.data[key]??'';}
 appendChild(node){this.insertChild(this.children.length,node);}
 insertChild(index,node){if(node.parent){node.parent.children.splice(node.parent.children.indexOf(node),1);}this.children.splice(index,0,node);node.parent=this;}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;this.removed=true;}
 resize(w,h){this.width=w;this.height=h;}
 rescale(factor){this.width*=factor;this.height*=factor;for(const c of this.children)c.rescale(factor);}
 clone(){const node=new Node(this.type);for(const key of ['data','width','height','x','y','rotation','opacity','visible','locked','fills','strokes','effects','relativeTransform'])node[key]=copy(this[key]);for(const child of this.children)node.appendChild(child.clone());if(this.parent)this.parent.appendChild(node);return node;}
 async exportAsync(settings){this.exportSettings=settings;this.exportSnapshot=this.children.map(n=>({id:n.id,x:n.x,y:n.y,rotation:n.rotation,name:n.name}));return new TextEncoder().encode('<svg data-native="true"><path d="M0 0L1 1"/></svg>');}
}
const code=buildSync({entryPoints:['src/plugin.mjs'],bundle:true,write:false,format:'iife',define:{__html__:'"<html></html>"'},logLevel:'silent'}).outputFiles[0].text;
function runtime(existing){
 const messages=[];const listeners={};const page=existing??new Node('PAGE');page.selection??=[];
 const figma={currentPage:page,ui:{postMessage:m=>messages.push(m)},viewport:{center:{x:900,y:600},scrollAndZoomIntoView(){}},showUI(){},on:(name,handler)=>{listeners[name]=handler;},createFrame(){const n=new Node();page.appendChild(n);return n;},createNodeFromSvg(svg){const n=new Node();const box=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);n.resize(Number(box?.[1]??100),Number(box?.[2]??100));n.source=svg;const colors=[...new Set(svg.match(/#[0-9a-f]{6}/gi)??[])];for(const hex of colors){const c=new Node('VECTOR');c.fills=[{type:'SOLID',color:{r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255},opacity:0.6}];n.appendChild(c);}page.appendChild(n);return n;}};
 vm.runInNewContext(code,{figma,TextEncoder,Uint8Array,console});
 return {figma,messages,listeners,page,async send(type,payload={}){const requestId=String(++sequence);await figma.ui.onmessage({requestId,type,payload});return messages.findLast(m=>m.requestId===requestId);}};
}
const options={size:'L',format:'landscape',layout:'compact',paletteId:'violet'};

test('mock Plugin API: all 120 catalogue states keep source SVGs, visible fills and palette roles through compose/recolor',async()=>{
 const catalog=JSON.parse(readFileSync(new URL('../assets/catalog.json',import.meta.url),'utf8'));
 const palettes=JSON.parse(readFileSync(new URL('../assets/palettes.json',import.meta.url),'utf8'));
 const toHex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase();
 const r=runtime();let checked=0;
 for(const palette of palettes)for(const item of catalog.items)for(const size of ['S','L'])for(const role of ['main','background']){
  const label=[palette.id,item.id,size,role].join('/');
  const composed=await r.send('compose',{selection:[{id:item.id,role}],options:{...options,size}});assert.equal(composed.ok,true,label);
  const scene=r.page.selection[0],node=scene.children[0];assert.equal(node.source,item.variants[size][role].svg,label+' imports the matching original');
  const recolored=await r.send('recolor',{paletteId:palette.id});assert.equal(recolored.ok,true,label);
  const paints=node.children.flatMap(n=>n.fills);assert.ok(paints.length>0,label+' has fills');assert.ok(paints.every(p=>p.opacity===0.6),label+' preserves paint opacity');
  const colors=paints.map(p=>toHex(p.color));
  if(role==='background')assert.ok(colors.every(c=>palette.background.includes(c)),label+' only uses the background palette');
  else for(const [i,color]of palettes[0].objects.entries())if(node.source.includes(color))assert.ok(colors.includes(palette.objects[i]),label+' retains its colored accent');
  assert.deepEqual(copy(recolored.data.activeScene.selection),[{id:item.id,role}]);checked++;
 }
 assert.equal(checked,120);
});

test('mock Plugin API: compose creates named native SVG groups and validated scene data; foreign/empty input does not mutate',async()=>{
 const r=runtime();const response=await r.send('compose',{selection:[{id:'book',role:'main'},{id:'phone',role:'background'}],options,query:'Учёба',apiKey:'forbidden-metadata-field'});
 assert.equal(response?.ok,true,'compose must acknowledge a native scene');
 const scene=r.page.selection[0];assert.equal(scene.type,'FRAME');assert.equal(scene.width,1200);assert.equal(scene.children.length,2);assert.match(scene.children[0].name,/Книга/);assert.equal(scene.children[0].children[0].type,'VECTOR');assert.ok(!JSON.stringify(scene.data).includes('forbidden-metadata-field'));
 const before=r.page.children.length;assert.equal((await r.send('compose',{selection:[],options})).ok,false);assert.equal(r.page.children.length,before);
 const foreign=new Node();r.page.appendChild(foreign);r.page.selection=[foreign];assert.equal((await r.send('recolor',{paletteId:'peach'})).ok,false);assert.equal(foreign.children.length,0);
});

test('mock Plugin API: recolor preserves native deletion, duplicate, position, layer order and custom fills; bad JSON is atomic',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'book',role:'main'},{id:'phone',role:'background'}],options});const scene=r.page.selection[0];const book=scene.children[0];scene.children[1].remove();const duplicate=book.clone();book.x=77;book.y=31;book.rotation=24;scene.insertChild(0,duplicate);
 const manual=book.children[0];manual.fills=[{type:'SOLID',color:{r:0.123,g:0.321,b:0.456}}];const before=JSON.stringify(manual.fills);const order=scene.children.map(n=>n.id);
 const result=await r.send('recolor',{paletteId:'teal'});assert.equal(result.ok,true,'recolor must operate on existing nodes');assert.equal(scene.children.length,2);assert.deepEqual(scene.children.map(n=>n.id),order);assert.deepEqual([book.x,book.y,book.rotation],[77,31,24]);assert.equal(JSON.stringify(manual.fills),before);
 const colors=duplicate.children.flatMap(n=>n.fills.map(p=>p.color));assert.ok(colors.some(c=>Math.round(c.r*255)===109&&Math.round(c.g*255)===123&&Math.round(c.b*255)===252),'book accent #F9A3AA maps to teal objects[1] #6D7BFC');
 const saved=JSON.stringify(scene.data);assert.equal((await r.send('recolor',{palette:{id:'bad',name:'bad'}})).ok,false);assert.equal(JSON.stringify(scene.data),saved);
 const reopened=runtime(r.page);r.page.selection=[book.children[1]];const restored=await reopened.send('init');assert.equal(restored.ok,true);assert.equal(restored.data.activeScene.options.paletteId,'teal');assert.equal(restored.data.activeScene.selection.length,2);assert.equal(restored.data.activeScene.selection[0].id,'book');
});

test('mock Plugin API: add keeps existing transforms; S/L uses real variants; explicit relayout uses surviving native inventory',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'book',role:'main'},{id:'phone',role:'background'}],options});const scene=r.page.selection[0];const old=scene.children[0];old.x=19;old.y=25;old.rotation=33;old.relativeTransform=[[0.8,-0.6,19],[0.6,0.8,25]];scene.children[1].remove();
 assert.equal((await r.send('add',{selection:[{id:'lamp',role:'background'}]})).ok,true,'add must import into the active scene');assert.equal(scene.children.length,2);assert.equal(scene.children[0],old);assert.deepEqual([old.x,old.y,old.rotation],[19,25,33]);
 const transform=copy(old.relativeTransform);assert.equal((await r.send('switch-size',{size:'S'})).ok,true);assert.equal(scene.children.length,2);assert.notEqual(scene.children[0],old);assert.match(scene.children[0].name,/S$/);assert.deepEqual(copy(scene.children[0].relativeTransform),transform);assert.ok(scene.children[0].source.length>100);
 const result=await r.send('relayout',{options:{...options,size:'S',format:'square',layout:'headline'}});assert.equal(result.ok,true);assert.equal(scene.width,1080);assert.equal(scene.height,1080);assert.equal(scene.children.length,2);assert.ok(scene.children.every(n=>n.x>=1080*0.4));assert.equal(result.data.activeScene.selection[1].id,'lamp');
});

test('mock Plugin API: SVG exports actual edited scene, serializes one request and rejects corrupt metadata',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'book',role:'main'},{id:'phone',role:'background'}],options});const scene=r.page.selection[0];scene.children[1].remove();const duplicate=scene.children[0].clone();duplicate.x=414;duplicate.rotation=15;r.page.selection=[duplicate.children[0]];
 const result=await r.send('export');assert.equal(result.ok,true,'SVG export must use exportAsync of the current scene');assert.equal(new TextDecoder().decode(new Uint8Array(result.data.bytes)),'<svg data-native="true"><path d="M0 0L1 1"/></svg>');assert.equal(scene.exportSettings.format,'SVG');assert.equal(scene.exportSnapshot.length,2);assert.equal(scene.exportSnapshot[1].x,414);assert.equal(scene.exportSnapshot[1].rotation,15);
 let unblock;scene.exportAsync=()=>new Promise(resolve=>{unblock=resolve;});const pending=r.send('export');const competing=await r.send('recolor',{paletteId:'peach'});assert.equal(competing.ok,false);assert.match(competing.error,/Дождитесь/);unblock(new Uint8Array([60,62]));await pending;
 scene.setPluginData('vector-composer:scene','{"version":999}');assert.equal((await r.send('export')).ok,false);assert.equal((await r.send('read-selection')).ok,false);
});

test('UI credential session: personal key has priority, clear disables implicit demo, re-enable is explicit, secrets are masked',()=>{
 const compiled=buildSync({entryPoints:['src/ui.mjs'],bundle:true,write:false,format:'cjs',define:{__DEMO_API_KEY__:'""',__DEFAULT_MODEL__:'"google/gemma-4-31b-it:free"'},logLevel:'silent'}).outputFiles[0].text;
 const module={exports:{}};const element={dataset:{}};vm.runInNewContext(compiled,{module,exports:module.exports,document:{body:element,getElementById:()=>element},window:{}});
 assert.equal(typeof module.exports.createCredentialSession,'function','UI must expose a RAM-only credential session');
 const state=module.exports.createCredentialSession('mock-demo-credential');assert.equal(state.mode(),'demo');state.setOwn('mock-personal-credential');assert.equal(state.key(),'mock-personal-credential');assert.equal(state.mode(),'personal');state.setOwn('');assert.equal(state.key(),'','deleting the personal field must not restore demo');state.useDemo(true);state.setOwn('mock-personal-credential');state.clear();assert.equal(state.key(),'');assert.equal(state.mode(),'none');state.useDemo(true);assert.equal(state.key(),'mock-demo-credential');assert.equal(state.mask('mock-demo-credential'),'[ключ скрыт]');state.useDemo(false);assert.equal(state.key(),'');
});

test('mock Plugin API: corrupted selected metadata leaves the library available for a new composition',async()=>{
 const r=runtime();const broken=new Node();broken.setPluginData('vector-composer:scene','{not json');r.page.appendChild(broken);r.page.selection=[broken];
 const result=await r.send('init');assert.equal(result.ok,true,'init must keep the library usable when selected metadata is corrupt');assert.equal(result.data.catalog.items.length,10);assert.equal(result.data.activeScene,null);assert.match(result.data.selectionError,/повреждены/);assert.equal(broken.getPluginData('vector-composer:scene'),'{not json');
});

test('mock Plugin API: make-color replaces background originals, preserving native placement, main edits and reload',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'book',role:'main'},{id:'lamp',role:'background'},{id:'phone',role:'background'}],options:{...options,paletteId:'peach'}});
 const scene=r.page.selection[0];const [book,lamp,phone]=scene.children;
 book.children[0].fills=[{type:'SOLID',color:{r:0.123,g:0.321,b:0.456}}];const bookFill=copy(book.children[0].fills);
 const group=new Node('GROUP');scene.insertChild(1,group);group.appendChild(lamp);
 lamp.relativeTransform=[[0.8,-0.6,71],[0.6,0.8,93]];lamp.opacity=0.7;lamp.visible=false;lamp.locked=true;
 const oldTransform=copy(lamp.relativeTransform);
 r.page.selection=[phone.children[0]];
 const result=await r.send('set-role',{role:'main'});assert.equal(result.ok,true);
 const colored=group.children[0];assert.notEqual(colored,lamp);assert.equal(lamp.removed,true);assert.match(colored.name,/Главный/);assert.match(colored.source,/#F9A3AA/,'the actual colored SVG, not the monochrome original, is imported');
 assert.deepEqual(copy(colored.relativeTransform),oldTransform);assert.deepEqual([colored.opacity,colored.visible,colored.locked],[0.7,false,true]);
 assert.equal(scene.children[0],book);assert.deepEqual(copy(book.children[0].fills),bookFill,'existing main objects and their custom colors stay untouched');assert.equal(scene.children[1],group);assert.equal(scene.children.length,3);
 assert.ok(colored.children.some(n=>n.fills.some(p=>Math.round(p.color.r*255)===128&&Math.round(p.color.g*255)===218&&Math.round(p.color.b*255)===218)),'main accent follows the active Peach palette');
 assert.ok(Math.abs(colored.width/lamp.width-1)<0.001,'state replacement retains the source scale');
 assert.ok(result.data.activeScene.selection.every(item=>item.role==='main'));
 const reopened=runtime(r.page);const restored=await reopened.send('init');assert.ok(restored.data.activeScene.selection.every(item=>item.role==='main'));
 const before=[...scene.children];await reopened.send('set-role',{role:'main'});assert.deepEqual(scene.children,before,'already colored objects are not replaced again');
});

test('mock Plugin API: failed state conversion rolls back all staged imports and keeps the original scene',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'lamp',role:'background'},{id:'phone',role:'background'}],options});
 const scene=r.page.selection[0];const before={children:[...scene.children],page:[...r.page.children],data:copy(scene.data)};
 const importSvg=r.figma.createNodeFromSvg;let imports=0;r.figma.createNodeFromSvg=svg=>{if(++imports===2)throw new Error('mock import failure');return importSvg(svg);};
 const result=await r.send('set-role',{role:'main'});assert.equal(result.ok,false);assert.match(result.error,/Не удалось выполнить действие/,'errors from outside the Plugin API realm use the safe generic message');
 assert.deepEqual(scene.children,before.children);assert.deepEqual(r.page.children,before.page);assert.deepEqual(copy(scene.data),before.data);
 assert.equal((await r.send('set-role',{role:'invalid'})).ok,false);assert.deepEqual(scene.children,before.children);
});


test('mock Plugin API: book→lamp at retained L scale refuses an oversized import atomically',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'book',role:'main'}],options});const scene=r.page.selection[0];const book=scene.children[0];book.x=77;book.rotation=24;book.children[0].fills=[{type:'SOLID',color:{r:0.123,g:0.321,b:0.456}}];
 // Real source dimensions: book L is 1448.09×988.6699; lamp L is 947.5098×1132.1104.
 const retainedScale=book.width/1448.09;assert.ok(1132.1104*retainedScale>630,'the actual lamp is taller than this frame before any placement');
 const before={data:copy(scene.data),children:[...scene.children],page:[...r.page.children],book:copy({x:book.x,y:book.y,rotation:book.rotation,width:book.width,height:book.height,fills:book.children[0].fills})};
 const result=await r.send('add',{selection:[{id:'lamp',role:'main'}]});assert.equal(result.ok,false,'book→lamp must reject actual bounds that cannot fit at the retained scale');assert.match(result.error,/не помещается.*Перекомпонуйте/);
 const batch=await r.send('add',{selection:[{id:'coin',role:'main'},{id:'lamp',role:'main'}]});assert.equal(batch.ok,false,'a later oversized item must also roll back earlier staged imports');assert.match(batch.error,/не помещается/);
 assert.deepEqual(scene.children,before.children);assert.deepEqual(r.page.children,before.page);assert.deepEqual(copy(scene.data),before.data);assert.deepEqual(copy({x:book.x,y:book.y,rotation:book.rotation,width:book.width,height:book.height,fills:book.children[0].fills}),before.book);assert.equal(scene.width,1200);assert.equal(scene.height,630);
});

test('mock Plugin API: add fits actual retained-scale bounds in a resized frame without relaying out native edits',async()=>{
 const r=runtime();await r.send('compose',{selection:[{id:'book',role:'main'},{id:'phone',role:'background'}],options});const scene=r.page.selection[0];const book=scene.children[0];scene.children[1].remove();scene.resize(900,630);book.x=19;book.y=25;book.rotation=33;book.relativeTransform=[[0.8,-0.6,19],[0.6,0.8,25]];book.children[0].fills=[{type:'SOLID',color:{r:0.123,g:0.321,b:0.456}}];
 const native=new Node('VECTOR');scene.insertChild(0,native);const order=[...scene.children];const before=copy({width:book.width,height:book.height,x:book.x,y:book.y,rotation:book.rotation,transform:book.relativeTransform,fills:book.children[0].fills});
 const result=await r.send('add',{selection:[{id:'lamp',role:'background'}]});assert.equal(result.ok,true);const lamp=scene.children.at(-1);const margin=630*0.045;
 assert.ok(lamp.x>=margin&&lamp.y>=margin&&lamp.x+lamp.width<=900-margin&&lamp.y+lamp.height<=630-margin,'the actual imported lamp bounds must fit the current frame, including safe margins');assert.ok(Math.abs(lamp.width/947.5098-book.width/1448.09)<1e-12,'the new object keeps the original common scale');
 assert.deepEqual(scene.children.slice(0,2),order);assert.deepEqual(copy({width:book.width,height:book.height,x:book.x,y:book.y,rotation:book.rotation,transform:book.relativeTransform,fills:book.children[0].fills}),before);assert.deepEqual([scene.width,scene.height],[900,630]);assert.equal(scene.children.length,3);assert.deepEqual(copy(result.data.activeScene.selection),[{id:'book',role:'main'},{id:'lamp',role:'background'}]);
});
