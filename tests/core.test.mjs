import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FORMATS,resolveNames,validatePalette,getVariant,planComposition,recolorSvg,validateSceneData,createCacheKey} from '../src/core.mjs';

const catalog=JSON.parse(await readFile(new URL('../assets/catalog.json',import.meta.url),'utf8'));
const palettes=JSON.parse(await readFile(new URL('../assets/palettes.json',import.meta.url),'utf8'));

test('direct names resolve Russian names, multiword aliases and duplicates without hiding unknown words',()=>{
 assert.deepEqual(resolveNames('КНИГУ, телефон и настольная лампа; кошелек, книга, дракон',catalog.items),{items:[{id:'book',role:'main'},{id:'phone',role:'main'},{id:'lamp',role:'main'},{id:'wallet',role:'main'}],unknown:['дракон']});
 assert.deepEqual(resolveNames('книга телефон наушники',catalog.items).items.map(x=>x.id),['book','phone','headphones']);
 assert.deepEqual(resolveNames('папка с документами, детали пазла',catalog.items).items.map(x=>x.id),['folder','puzzle']);
 assert.deepEqual(resolveNames('телефония',catalog.items),{items:[],unknown:['телефония']});
 assert.deepEqual(resolveNames('📚 книга, телефон 🤖',catalog.items),{items:[{id:'book',role:'main'},{id:'phone',role:'main'}],unknown:['📚','🤖']});
 assert.deepEqual(resolveNames('',catalog.items),{items:[],unknown:[]});
});

test('palette validation normalizes colors and rejects incomplete or unsafe input',()=>{
 const value={...palettes[0],id:'custom',name:'Моя схема',background:['#abc','#123456','#778899']};
 const result=validatePalette(value);
 assert.deepEqual(result.background,['#AABBCC','#123456','#778899']);
 assert.notEqual(result,value);
 for(const invalid of [null,{}, {...value,objects:['#ffffff']},{...value,ink:'url(https://example.test)'},{...value,background:['red','#000000','#ffffff']}])assert.throws(()=>validatePalette(invalid));
});

test('variant selection uses actual size/state originals and rejects unknown versions',()=>{
 const phone=catalog.items.find(x=>x.id==='phone');
 assert.equal(getVariant(phone,'S','main').svg,phone.variants.S.main.svg);
 assert.notEqual(getVariant(phone,'S','main').svg,getVariant(phone,'L','main').svg);
 assert.throws(()=>getVariant(phone,'XL','main'));
 assert.throws(()=>getVariant(phone,'S','unknown'));
});

test('all formats/layouts/sizes preserve one scale and keep 1,3,10 objects within bounds',()=>{
 for(const size of ['S','L'])for(const format of Object.keys(FORMATS))for(const layout of ['compact','offset','headline'])for(const count of [1,3,10]){
  const selection=catalog.items.slice(0,count).map((x,i)=>({id:x.id,role:i%3===2?'background':'main'}));
  const options={size,format,layout,paletteId:'violet'};
  const actual=planComposition(selection,catalog,options);
  assert.deepEqual(actual,planComposition(selection,catalog,options),'deterministic result');
  assert.deepEqual([actual.width,actual.height],[FORMATS[format].width,FORMATS[format].height]);
  assert.equal(actual.placements.length,count);assert.ok(actual.scale>0&&Number.isFinite(actual.scale));
  actual.placements.forEach((p,i)=>{
   const v=getVariant(catalog.items.find(x=>x.id===p.id),size,p.role);
   assert.equal(p.id,selection[i].id);assert.ok(Math.abs(p.width/v.width-actual.scale)<1e-8);assert.ok(Math.abs(p.height/v.height-actual.scale)<1e-8);
   assert.ok(p.x>=0&&p.y>=0&&p.x+p.width<=actual.width+0.001&&p.y+p.height<=actual.height+0.001,`${size}/${format}/${layout}/${p.id}`);
   if(layout==='headline')assert.ok(p.x>=actual.width*0.4);
  });
 }
});

test('three layouts have different placements and invalid selections fail before mutation',()=>{
 const selection=['book','lamp','coin'].map(id=>({id,role:'main'}));
 const plans=['compact','offset','headline'].map(layout=>planComposition(selection,catalog,{size:'L',format:'landscape',layout,paletteId:'violet'}));
 assert.notDeepEqual(plans[0].placements,plans[1].placements);
 assert.notDeepEqual(plans[0].placements,plans[2].placements);
 for(const args of [[],[{id:'dragon',role:'main'}],[{id:'book',role:'invalid'}]])assert.throws(()=>planComposition(args,catalog,{}));
 assert.throws(()=>planComposition(selection,catalog,{size:'XL'}));
});

test('recoloring changes only color attributes, preserves paths and supports all original palettes',()=>{
 for(const item of catalog.items)for(const size of ['S','L'])for(const role of ['main','background']){
  const svg=getVariant(item,size,role).svg;
  for(const target of palettes){
   const next=recolorSvg(svg,palettes[0],target,role);
   assert.deepEqual([...next.matchAll(/\bd="([^"]*)"/g)].map(x=>x[1]),[...svg.matchAll(/\bd="([^"]*)"/g)].map(x=>x[1]));
   const colors=[...next.matchAll(/(?:fill|stroke)="(#[a-f\d]{6}|white|black)"/gi)].map(x=>x[1].toUpperCase());
   if(role==='background')assert.ok(colors.every(c=>[...target.background,'#FFFFFF','WHITE'].includes(c)),`${item.id}/${size} remains monochrome`);
   if(target.id!=='violet')assert.notEqual(next,svg);
  }
 }
 const svg='<svg><path d="M0 0L2 3" fill="#F9A3AA" stroke="black"/><path style="fill: white; stroke:#7864D7"/></svg>';
 const next=recolorSvg(svg,palettes[0],palettes[2],'main');
 assert.match(next,/fill="#6D7BFC"/);assert.match(next,/stroke="#181817"/);assert.match(next,/d="M0 0L2 3"/);assert.match(next,/fill: #FFFFFF/);
});

test('scene metadata is validated, reconstructed without credentials, and independent from input',()=>{
 const input={version:1,options:{size:'S',format:'portrait',layout:'headline',paletteId:'violet'},selection:[{id:'book',role:'main'}],query:'Обучение',model:'google/gemma-4-31b-it:free',explanation:'Книга — знания',apiKey:'TEST_ONLY_NOT_A_REAL_CREDENTIAL'};
 const result=validateSceneData(input,catalog);
 assert.equal(result.apiKey,undefined);assert.equal(result.query,'Обучение');assert.notEqual(result.selection,input.selection);
 assert.throws(()=>validateSceneData({...input,version:2},catalog));
 assert.throws(()=>validateSceneData({...input,selection:[{id:'dragon',role:'main'}]},catalog));
 assert.throws(()=>validateSceneData({...input,options:{...input.options,layout:'missing'}},catalog));
});

test('cache keys normalize input but distinguish model and catalogue version',()=>{
 assert.equal(createCacheKey('  Учёба   онлайн ','model/a',1),createCacheKey('учеба онлайн','model/a',1));
 assert.notEqual(createCacheKey('учеба','model/a',1),createCacheKey('учеба','model/b',1));
 assert.notEqual(createCacheKey('учеба','model/a',1),createCacheKey('учеба','model/a',2));
});
