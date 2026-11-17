/** Pure catalogue, layout and palette operations. No document or network state. */
export const FORMATS = Object.freeze({
 landscape:Object.freeze({width:1200,height:630}),
 square:Object.freeze({width:1080,height:1080}),
 portrait:Object.freeze({width:1080,height:1350}),
});
const ROLES=new Set(['main','background']);
const SIZES=new Set(['S','L']);
const LAYOUTS=new Set(['compact','offset','headline']);
const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const itemsOf=catalog=>{
 const items=Array.isArray(catalog)?catalog:catalog?.items;
 if(!Array.isArray(items)||!items.length)throw new Error('Библиотека предметов не загружена.');
 return items;
};
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function resolveNames(text,items){
 if(typeof text!=='string')throw new Error('Введите названия предметов текстом.');
 const input=normalize(text);
 if(!input)return {items:[],unknown:[]};
 const catalogue=itemsOf(items);
 const aliases=[];
 for(const item of catalogue){
  for(const alias of [item.name,item.id,...(item.aliases||[])]){
   if(typeof alias==='string'&&alias.trim())aliases.push({phrase:normalize(alias),id:item.id});
  }
 }
 aliases.sort((a,b)=>b.phrase.length-a.phrase.length);
 const taken=new Uint8Array(input.length);const found=[];
 for(const {phrase,id} of aliases){
  const regex=new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`,'gu');
  for(const match of input.matchAll(regex)){
   const start=match.index,end=start+match[0].length;
   if(taken.slice(start,end).some(Boolean))continue;
   taken.fill(1,start,end);found.push({id,start});
  }
 }
 found.sort((a,b)=>a.start-b.start);
 const seen=new Set();const selected=found.filter(({id})=>!seen.has(id)&&seen.add(id)).map(({id})=>({id,role:'main'}));
 // RegExp.index и маска используют UTF-16 offsets, включая пары surrogate у emoji.
 const rest=input.split('').map((char,index)=>taken[index]?' ':char).join('');
 const unknown=rest.split(/[,;\n|+]+|\s+и\s+/u).map(part=>part.replace(/(^|\s)(?:и|добавь|добавить|пожалуйста|нужны|нужен|нужна)(?=\s|$)/gu,' ').replace(/^[\s.:-]+|[\s.:-]+$/g,'').replace(/\s+/g,' ').trim()).filter(Boolean);
 return {items:selected,unknown};
}

function hexColor(value){
 if(typeof value!=='string'||!/^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(value))throw new Error('Цвет должен быть в формате #RRGGBB или #RGB.');
 const color=value.toUpperCase();
 return color.length===4?'#'+[...color.slice(1)].map(x=>x+x).join(''):color;
}

export function validatePalette(value){
 if(!isRecord(value))throw new Error('Палитра должна быть JSON-объектом.');
 if(typeof value.id!=='string'||!value.id.trim()||value.id.length>80||typeof value.name!=='string'||!value.name.trim()||value.name.length>120)throw new Error('Укажите id и название палитры.');
 const colors=key=>{
  if(!Array.isArray(value[key])||value[key].length!==3)throw new Error(`Палитра должна содержать три цвета ${key}.`);
  return value[key].map(hexColor);
 };
 return {id:value.id.trim(),name:value.name.trim(),background:colors('background'),objects:colors('objects'),ink:hexColor(value.ink),paper:hexColor(value.paper)};
}

export function getVariant(item,size,role){
 if(!SIZES.has(size)||!ROLES.has(role))throw new Error('Неизвестный размер или состояние предмета.');
 const variant=item?.variants?.[size]?.[role];
 if(!variant||typeof variant.svg!=='string'||!Number.isFinite(variant.width)||!Number.isFinite(variant.height)||variant.width<=0||variant.height<=0)throw new Error('Исходная версия предмета отсутствует или повреждена.');
 return variant;
}

function optionsOf(value={}){
 if(!isRecord(value))throw new Error('Параметры композиции повреждены.');
 const result={size:value.size??'L',format:value.format??'landscape',layout:value.layout??'compact',paletteId:value.paletteId??'violet'};
 if(!SIZES.has(result.size)||!Object.hasOwn(FORMATS,result.format)||!LAYOUTS.has(result.layout)||typeof result.paletteId!=='string'||!result.paletteId.trim()||result.paletteId.length>80)throw new Error('Проверьте размер, формат, раскладку и палитру.');
 return result;
}

function selectionOf(value,catalog,{allowEmpty=false}={}){
 if(!Array.isArray(value)||(!allowEmpty&&!value.length))throw new Error('Выберите хотя бы один предмет из библиотеки.');
 const map=new Map(itemsOf(catalog).map(item=>[item.id,item]));
 return value.map(entry=>{
  if(!isRecord(entry)||typeof entry.id!=='string'||!map.has(entry.id)||!ROLES.has(entry.role))throw new Error('В композиции обнаружен неизвестный предмет или роль.');
  return {id:entry.id,role:entry.role};
 });
}

function packRows(entries,columns,layout){
 const offset=layout==='offset';
 const base=Math.max(...entries.map(e=>Math.min(e.width,e.height)));
 const gap=base*(offset?0.14:0.025);
 const rows=[];
 for(let i=0;i<entries.length;i+=columns)rows.push(entries.slice(i,i+columns));
 let y=0;const points=[];
 rows.forEach((row,rowIndex)=>{
  let x=offset&&rowIndex%2?base*0.28:0;
  const height=Math.max(...row.map(e=>e.height));
  row.forEach((entry,index)=>{
   const dy=offset?(index%2)*height*0.12:(height-entry.height)*0.58;
   points.push({...entry,x,y:y+dy});
   const next=row[index+1];
   x+=entry.width+gap-(next&&!offset?Math.min(entry.width,next.width)*0.11:0);
  });
  y+=height+(offset?gap+height*0.12:gap-height*0.08);
 });
 const width=Math.max(...points.map(p=>p.x+p.width));
 const height=Math.max(...points.map(p=>p.y+p.height));
 return {points,width,height};
}

export function planComposition(selection,catalog,options={}){
 const selected=selectionOf(selection,catalog);const settings=optionsOf(options);
 const {width,height}=FORMATS[settings.format];
 const map=new Map(itemsOf(catalog).map(item=>[item.id,item]));
 const entries=selected.map((entry,index)=>({index,...entry,...getVariant(map.get(entry.id),settings.size,entry.role)}));
 // Large silhouettes anchor the cluster. Returned order remains the user's layer order.
 const sorted=[...entries].sort((a,b)=>b.width*b.height-a.width*a.height||a.index-b.index);
 const margin=Math.min(width,height)*0.045;
 const left=settings.layout==='headline'?width*0.45:margin;
 const availableWidth=width-margin-left,availableHeight=height-margin*2;
 let chosen;
 for(let columns=1;columns<=Math.min(entries.length,6);columns++){
  const packed=packRows(sorted,columns,settings.layout);
  const scale=Math.min(availableWidth/packed.width,availableHeight/packed.height)*0.96;
  if(!chosen||scale>chosen.scale)chosen={...packed,scale};
 }
 const originX=left+(availableWidth-chosen.width*chosen.scale)/2;
 const originY=margin+(availableHeight-chosen.height*chosen.scale)/2;
 const placements=chosen.points.sort((a,b)=>a.index-b.index).map(p=>({id:p.id,role:p.role,size:settings.size,x:originX+p.x*chosen.scale,y:originY+p.y*chosen.scale,rotation:0,width:p.width*chosen.scale,height:p.height*chosen.scale}));
 return {width,height,scale:chosen.scale,placements};
}

export function recolorSvg(svg,sourcePalette,targetPalette,role){
 if(typeof svg!=='string'||!ROLES.has(role))throw new Error('Не удалось перекрасить исходный SVG.');
 const source=validatePalette(sourcePalette),target=validatePalette(targetPalette),map=new Map();
 source.background.forEach((color,index)=>map.set(color,target.background[index]));
 if(role==='main')source.objects.forEach((color,index)=>map.set(color,target.objects[index]));
 const ink=role==='background'?target.background[2]:target.ink;
 const paper=role==='background'?target.background[0]:target.paper;
 map.set(source.ink,ink);map.set(source.paper,paper);map.set('#000000',ink);map.set('#FFFFFF',paper);
 const translate=color=>{
  const normalized=color.trim().toUpperCase();
  if(normalized==='BLACK')return ink;if(normalized==='WHITE')return paper;
  const canonical=/^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(normalized)?hexColor(normalized):normalized;
  return map.get(canonical)??color;
 };
 let result=svg.replace(/\b(fill|stroke|color|stop-color)\s*=\s*(["'])([^"']*)\2/gi,(_all,attribute,quote,color)=>`${attribute}=${quote}${translate(color)}${quote}`);
 result=result.replace(/\bstyle\s*=\s*(["'])([^"']*)\1/gi,(_all,quote,style)=>`style=${quote}${style.replace(/(^|;)(\s*(?:fill|stroke|color|stop-color)\s*:\s*)([^;]+)/gi,(_s,separator,prefix,color)=>separator+prefix+translate(color))}${quote}`);
 return result;
}

export function validateSceneData(value,catalog){
 if(!isRecord(value)||value.version!==1)throw new Error('Версия данных композиции не поддерживается.');
 const metadata={version:1,options:optionsOf(value.options),selection:selectionOf(value.selection,catalog,{allowEmpty:true})};
 for(const key of ['query','model','explanation']){
  if(value[key]!==undefined){
   if(typeof value[key]!=='string'||value[key].length>10000)throw new Error('Текстовые данные композиции повреждены.');
   metadata[key]=value[key];
  }
 }
 return metadata;
}

export function createCacheKey(query,model,catalogVersion){
 if(typeof query!=='string'||typeof model!=='string'||!['string','number'].includes(typeof catalogVersion))throw new Error('Параметры кэша повреждены.');
 return JSON.stringify([String(catalogVersion),model.trim(),normalize(query)]);
}
