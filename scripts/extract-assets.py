"""Extract intact SVG elements from the supplied contact sheets.

Python 3.9+ and PyMuPDF are needed only to regenerate the catalog/QA previews.
The shipped plugin and its build do not require Python.
"""
from pathlib import Path
import copy
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
import shutil
import fitz

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets'
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)

ITEMS = [
 ('book','Книга',['книги','книгу','учебник','книжка','чтение'],['обучение','знания','образование','чтение']),
 ('phone','Смартфон',['телефон','смартфоны','телефона','телефоны','мобильник'],['связь','технологии','онлайн','цифровой']),
 ('puzzle','Пазл',['пазлы','пазла','головоломка','детали пазла'],['решение','части','сотрудничество','связь']),
 ('coin','Монета',['монеты','монету','деньги','монетка'],['финансы','экономия','оплата','ценность']),
 ('headphones','Наушники',['наушников','гарнитура','аудио'],['музыка','слушать','звук','подкаст']),
 ('lamp','Лампа',['лампу','лампы','светильник','настольная лампа'],['свет','идея','работа','внимание']),
 ('flowers','Цветы',['цветов','цветами','букет','ваза','тюльпаны'],['подарок','красота','рост','забота']),
 ('wallet','Кошелёк',['кошелек','кошелька','кошельки','портмоне'],['деньги','финансы','бюджет','сбережения']),
 ('folder','Папка',['папку','папки','документы','папка с документами'],['документы','порядок','работа','организация']),
 ('pen','Ручка',['ручку','ручки','карандаш','письменная ручка'],['письмо','творчество','запись','работа']),
]
PALETTES = [
 {'id':'violet','name':'Фиолетовая','background':['#D7CDF5','#AA9BF0','#7864D7'],'objects':['#F9ECB0','#F9A3AA','#FFE3E1'],'ink':'#181817','paper':'#FFFFFF'},
 {'id':'peach','name':'Персиковая','background':['#FDD7B9','#FAC896','#D27532'],'objects':['#F9ECB0','#80DADA','#BEEBEB'],'ink':'#181817','paper':'#FFFFFF'},
 {'id':'teal','name':'Бирюзовая','background':['#BEEBEB','#80DADA','#5ABEBE'],'objects':['#FFD4F2','#6D7BFC','#B6C6FE'],'ink':'#181817','paper':'#FFFFFF'},
]

# Disjoint visual regions, in original contact-sheet coordinates. Full source
# elements must fit inside a region: paths are never clipped or reconstructed.
# Several small details precede their large silhouette in XML order, so ranges
# alone are not a correct extraction boundary.
REGIONS = {
 'L': {
  'book':(300,3400,1900,4460),'phone':(1950,3600,2900,4300),
  'puzzle':(3000,3700,3750,4250),'coin':(3900,3850,4350,4200),
  'headphones':(400,4700,1450,5600),'lamp':(1750,4400,2820,5650),
  'flowers':(3000,4600,3750,5600),'wallet':(3800,5000,4600,5600),
  'folder':(300,5800,1650,6650),'pen':(1700,6000,2400,6500),
 },
 'S': {
  'book':(240,2000,1020,2600),'phone':(1250,2200,1750,2550),
  'puzzle':(1850,2200,2250,2500),'coin':(2400,2200,2800,2600),
  'headphones':(320,2850,900,3350),'lamp':(1150,2750,1700,3450),
  'flowers':(1850,2900,2300,3450),'wallet':(2350,3100,2780,3450),
  'folder':(220,3700,940,4150),'pen':(1250,3800,1600,4050),
 },
}


def source_path(relative):
    original=ROOT/relative
    return original if original.exists() else OUT/'source'/relative


def region_for(size,id,role):
    rect=fitz.Rect(REGIONS[size][id])
    if role=='background':
        if size=='S' and id=='flowers': return fitz.Rect(1820,6000,2300,6500)
        if size=='L' and id=='flowers': return fitz.Rect(3000,8700,3750,9650)
        offset=4024.2 if size=='L' else 3101.4
        rect=rect+(0,offset,0,offset)
    return rect


def element_bounds(element, document_root):
    shell = ET.Element(f'{{{NS}}}svg', dict(document_root.attrib))
    for child in document_root:
        if child.tag.rsplit('}', 1)[-1] == 'defs':
            shell.append(copy.deepcopy(child))
    shell.append(copy.deepcopy(element))
    document = fitz.open(stream=ET.tostring(shell), filetype='svg')
    bounds = None
    for drawing in document[0].get_drawings():
        rect = drawing['rect']
        if drawing.get('type') in ('s', 'fs'):
            rect = rect + (-drawing['width']/2, -drawing['width']/2, drawing['width']/2, drawing['width']/2)
        bounds = fitz.Rect(rect) if bounds is None else bounds | rect
    document.close()
    return tuple(bounds) if bounds else None


def inspect():
    OUT.mkdir(exist_ok=True)
    for size in ('S', 'L'):
        path = next((ROOT/'Библиотека компонентов').glob(f'* {size}.svg'))
        tree = ET.parse(path).getroot()
        records = []
        for i, child in enumerate(tree):
            if child.tag.rsplit('}', 1)[-1] == 'defs':
                continue
            bounds = element_bounds(child, tree)
            if bounds:
                records.append({'index':i,'tag':child.tag.rsplit('}',1)[-1],'bounds':bounds,'fill':child.get('fill'),'stroke':child.get('stroke')})
        (OUT/f'inspect-{size}.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
        print(size, 'elements', len(records))
        for item in records:
            x0,y0,x1,y1=item['bounds']
            if (x1-x0)>200 or (y1-y0)>300:
                print(item['index'], [round(v,1) for v in item['bounds']], item['fill'])


def number(value):
    return round(value, 4)


def render_svg(svg, destination, max_width=450, max_height=270):
    doc=fitz.open(stream=svg.encode('utf-8'), filetype='svg')
    page=doc[0]
    scale=min(max_width/page.rect.width, max_height/page.rect.height)
    page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).save(str(destination))
    doc.close()


def extract():
    OUT.mkdir(exist_ok=True)
    (OUT/'svg').mkdir(exist_ok=True)
    (OUT/'qa').mkdir(exist_ok=True)
    catalog={'version':1,'sourceHashes':{},'items':[]}
    originals=list(ROOT.glob('*.svg'))
    for folder in ('Библиотека компонентов','Примеры композиций'):
        originals.extend((ROOT/folder).glob('*.svg'))
    if not originals:
        originals=list((OUT/'source').rglob('*.svg'))
    for path in sorted(originals):
        relative=path.relative_to(OUT/'source') if path.is_relative_to(OUT/'source') else path.relative_to(ROOT)
        catalog['sourceHashes'][relative.as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
        destination=OUT/'source'/relative
        destination.parent.mkdir(parents=True,exist_ok=True)
        if path!=destination: shutil.copyfile(path,destination)
    provenance=[]
    roots={size:ET.parse(source_path(f'Библиотека компонентов/Размер {size}.svg')).getroot() for size in ('S','L')}
    source_documents={size:fitz.open(str(source_path(f'Библиотека компонентов/Размер {size}.svg'))) for size in ('S','L')}
    all_bounds={}
    for size,root in roots.items():
        all_bounds[size]={}
        for index,child in enumerate(root):
            if child.tag.rsplit('}',1)[-1]=='defs': continue
            all_bounds[size][index]=element_bounds(child,root)
    for id,name,aliases,tags in ITEMS:
        item={'id':id,'name':name,'aliases':aliases,'tags':tags,'variants':{}}
        for size in ('S','L'):
            item['variants'][size]={}
            root=roots[size]
            for role in ('main','background'):
                region=region_for(size,id,role)
                indices=[index for index,box in all_bounds[size].items() if box and region.contains(fitz.Rect(box))]
                if not indices: raise ValueError(f'Empty region {id}/{size}/{role}')
                selected=[root[index] for index in indices]
                if any(el.tag.rsplit('}',1)[-1] not in ('path','rect','g','line','ellipse','circle','polygon','polyline') for el in selected):
                    raise ValueError(f'Unexpected element in {id}/{size}/{role}')
                bounds=None
                for index in indices:
                    box=all_bounds[size][index]
                    if box:
                        bounds=fitz.Rect(box) if bounds is None else bounds | fitz.Rect(box)
                # A small exact, documented padding protects stroke anti-aliasing.
                x0,y0,x1,y1=bounds
                x0=number(x0-0.5);y0=number(y0-0.5)
                width=number(x1-x0+0.5);height=number(y1-y0+0.5)
                svg=ET.Element(f'{{{NS}}}svg',{'width':str(width),'height':str(height),'viewBox':f'0 0 {width} {height}','fill':'none'})
                for child in root:
                    if child.tag.rsplit('}',1)[-1]=='defs': svg.append(copy.deepcopy(child))
                group=ET.SubElement(svg,f'{{{NS}}}g',{'transform':f'translate({number(-x0)} {number(-y0)})'})
                for child in selected: group.append(copy.deepcopy(child))
                text=ET.tostring(svg,encoding='unicode')
                file=f'{id}-{size}-{role}.svg'
                (OUT/'svg'/file).write_text(text,encoding='utf-8')
                source=f'Библиотека компонентов/Размер {size}.svg'
                item['variants'][size][role]={'svg':text,'width':width,'height':height,'source':source}
                provenance.append({'id':id,'size':size,'role':role,'source':source,'sourceElementIndices':indices,'selectionRegion':list(region),'sourceBounds':[x0,y0,number(x1+0.5),number(y1+0.5)],'elements':len(selected),'paths':sum(el.tag.endswith('}path') for el in selected)})
                render_svg(text,OUT/'qa'/file.replace('.svg','.png'))
                crop=fitz.Rect(x0,y0,x0+width,y0+height)
                scale=min(450/width,270/height)
                source_documents[size][0].get_pixmap(matrix=fitz.Matrix(scale,scale),clip=crop,alpha=False).save(str(OUT/'qa'/('source-'+file.replace('.svg','.png'))))
                print(id,size,role, len(selected),width,height)
        catalog['items'].append(item)
    (OUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (OUT/'palettes.json').write_text(json.dumps(PALETTES,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (OUT/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for doc in source_documents.values(): doc.close()
    # Contact sheet shows every extracted object without rescaling its paths.
    for size in ('S','L'):
        sheet=fitz.open();page=sheet.new_page(width=1200,height=10*280)
        for row,(id,name,*_) in enumerate(ITEMS):
            page.insert_text((10,row*280+18),f'{id} / {size}',fontsize=14)
            for col,role in enumerate(('main','background')):
                img=OUT/'qa'/f'{id}-{size}-{role}.png'
                page.insert_image(fitz.Rect(100+col*550,row*280+28,620+col*550,row*280+270),filename=str(img),keep_proportion=True)
        page.get_pixmap().save(str(OUT/'qa'/f'contact-{size}.png'))
        sheet.close()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    inspect() if '--inspect' in sys.argv else extract()
