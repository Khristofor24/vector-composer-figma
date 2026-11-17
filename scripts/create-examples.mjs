import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { planComposition, getVariant, recolorSvg, validatePalette } from '../src/core.mjs';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('assets/catalog.json', root)));
const palettes = JSON.parse(await readFile(new URL('assets/palettes.json', root)));
const cases = [
 {name:'01-learning',options:{size:'L',format:'landscape',layout:'headline',paletteId:'violet'},selection:[{id:'book',role:'main'},{id:'pen',role:'main'},{id:'lamp',role:'background'}]},
 {name:'02-everyday',options:{size:'S',format:'square',layout:'compact',paletteId:'peach'},selection:[{id:'phone',role:'main'},{id:'wallet',role:'main'},{id:'coin',role:'main'}]},
 {name:'03-inspiration',options:{size:'L',format:'portrait',layout:'offset',paletteId:'teal'},selection:[{id:'flowers',role:'main'},{id:'headphones',role:'main'},{id:'puzzle',role:'background'}]},
];
const customPalette = {id:'custom-blue',name:'Синий пример',background:['#EDF5FF','#BDD8F5','#6D9AC5'],objects:['#F4C35B','#EF8467','#3974AD'],ink:'#18344D',paper:'#FFFFFF'};
const paths = svg => [...svg.matchAll(/\bd="([^"]*)"/g)].map(m=>m[1]);
function namespace(svg,prefix){
 const ids=[...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 for(const id of ids){
  const safe=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  svg=svg.replace(new RegExp(`id="${safe}"`,'g'),`id="${prefix}${id}"`).replace(new RegExp(`url\\(#${safe}\\)`,'g'),`url(#${prefix}${id})`).replace(new RegExp(`((?:xlink:)?href=")#${safe}"`,'g'),`$1#${prefix}${id}"`);
 }
 return svg;
}
function render(example){
 const palette=palettes.find(p=>p.id===example.options.paletteId);
 const plan=planComposition(example.selection,catalog,example.options);
 const parts=plan.placements.map((p,index)=>{
  const variant=getVariant(catalog.items.find(i=>i.id===p.id),p.size,p.role);
  const colored=namespace(recolorSvg(variant.svg,palettes[0],palette,p.role),`asset${index}_`);
  assert.deepEqual(paths(colored),paths(variant.svg),'Геометрия path должна остаться исходной');
  assert(p.x>=0 && p.y>=0 && p.x+p.width<=plan.width && p.y+p.height<=plan.height,'Предмет должен помещаться на холсте');
  return `<g data-asset="${p.id}" data-role="${p.role}" transform="translate(${p.x} ${p.y}) scale(${plan.scale})">${colored.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'')}</g>`;
 });
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}">\n${parts.join('\n')}\n</svg>\n`;
}
await mkdir(new URL('examples/',root),{recursive:true});
for(const example of cases){
 const expected=render(example),url=new URL(`examples/${example.name}.svg`,root);
 if(!process.argv.includes('--check')) await writeFile(url,expected);
 const actual=await readFile(url,'utf8');
 assert.equal(actual,expected,'Пример должен воспроизводиться из текущего каталога');
 const ids=[...actual.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,'SVG ID должны быть уникальны');
 for(const match of actual.matchAll(/url\(#([^)]*)\)|(?:xlink:)?href="#([^"]+)"/g))assert(ids.includes(match[1]??match[2]),'SVG ссылка должна разрешаться');
 assert.equal([...actual.matchAll(/data-asset=/g)].length,example.selection.length);
 assert(paths(actual).length>0,'Должны присутствовать реальные векторные контуры');
}
const paletteUrl=new URL('examples/palette.json',root);
if(!process.argv.includes('--check'))await writeFile(paletteUrl,JSON.stringify(customPalette,null,2)+'\n');
const validated=validatePalette(JSON.parse(await readFile(paletteUrl)));
assert.equal(validated.background.length,3);assert.equal(validated.objects.length,3);
assert.throws(()=>validatePalette({...validated,ink:'invalid'}));
console.log('Проверено: 3 воспроизводимых SVG, исходные path, границы, ссылки/ID, JSON палитры.');
