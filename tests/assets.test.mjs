import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const readJson = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('catalog provides all ten original objects and forty vector variants', () => {
  const path = new URL('../assets/catalog.json', import.meta.url);
  assert.ok(existsSync(path), 'Extracted catalog has not been produced');
  const catalog = readJson('../assets/catalog.json');
  assert.equal(catalog.version, 1);
  assert.deepEqual(catalog.items.map(x => x.id).sort(), ['book','phone','puzzle','coin','headphones','lamp','flowers','wallet','folder','pen'].sort());
  for (const item of catalog.items) for (const size of ['S', 'L']) for (const role of ['main', 'background']) {
    const variant = item.variants[size][role];
    assert.ok(variant.width > 5 && variant.height > 5, `${item.id}/${size}/${role} invalid bounds`);
    assert.match(variant.svg, /<path\b/);
    assert.doesNotMatch(variant.svg, /<(?:image|text|foreignObject)\b|data:image|<script\b/i);
    assert.ok(variant.source.includes(size));
    assert.match(variant.svg, new RegExp(`viewBox="0 0 ${variant.width} ${variant.height}"`));
  }
});

test('every original SVG remains byte-identical to extraction hashes', () => {
  const catalog = readJson('../assets/catalog.json');
  assert.equal(Object.keys(catalog.sourceHashes).length, 11);
  for (const [path, expected] of Object.entries(catalog.sourceHashes)) {
    const original = new URL('../' + path, import.meta.url);
    const copy = new URL('../assets/source/' + path, import.meta.url);
    assert.equal(createHash('sha256').update(readFileSync(copy)).digest('hex'), expected, path + ' included copy');
    if (existsSync(original)) assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'), expected, path);
  }
});

test('object bounds exclude neighbouring objects and preserve source path commands', () => {
  const catalog = readJson('../assets/catalog.json');
  const provenance = readJson('../assets/provenance.json');
  const used = new Set();
  for (const record of provenance) {
    for (const index of record.sourceElementIndices) {
      const key = record.source + ':' + index;
      assert.ok(!used.has(key), 'Source element assigned to two objects: ' + key);
      used.add(key);
    }
    const variant = catalog.items.find(i => i.id === record.id).variants[record.size][record.role];
    assert.ok(variant.width < 1500 && variant.height < 1200, 'Contaminated object bounds: ' + record.id);
    const other = catalog.items.find(i => i.id === record.id).variants[record.size][record.role === 'main' ? 'background' : 'main'];
    // Source pen/L roles differ by 0.0497 units; preserve that original detail.
    assert.ok(Math.abs(variant.width - other.width) < 0.1 && Math.abs(variant.height - other.height) < 0.1, 'Unexpected role footprint difference: ' + record.id + '/' + record.size);
    const original = readFileSync(new URL('../assets/source/' + record.source, import.meta.url), 'utf8');
    const commands = [...variant.svg.matchAll(/\bd="([^"]*)"/g)].map(m => m[1]);
    assert.equal(commands.length, record.paths);
    for (const d of commands) assert.ok(original.includes('d="' + d + '"'), 'Path commands modified: ' + record.id);
  }
});

test('palette tokens match the three original schemes', () => {
  assert.deepEqual(readJson('../assets/palettes.json'), [
    {id:'violet',name:'Фиолетовая',background:['#D7CDF5','#AA9BF0','#7864D7'],objects:['#F9ECB0','#F9A3AA','#FFE3E1'],ink:'#181817',paper:'#FFFFFF'},
    {id:'peach',name:'Персиковая',background:['#FDD7B9','#FAC896','#D27532'],objects:['#F9ECB0','#80DADA','#BEEBEB'],ink:'#181817',paper:'#FFFFFF'},
    {id:'teal',name:'Бирюзовая',background:['#BEEBEB','#80DADA','#5ABEBE'],objects:['#FFD4F2','#6D7BFC','#B6C6FE'],ink:'#181817',paper:'#FFFFFF'},
  ]);
});

test('Git checkout with autocrlf=true preserves source SVG bytes', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'vector-composer-eol-'));
  const repository = path.join(temp, 'repository');
  const checkout = path.join(temp, 'checkout');
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0 0L1 1"/>\n</svg>\n', 'utf8');
  const gitArgs = ['-c', 'core.autocrlf=true', '-c', 'user.name=Regression Test', '-c', 'user.email=regression-test@localhost'];
  const git = (args, cwd) => execFileSync('git', [...gitArgs, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    mkdirSync(path.join(repository, 'assets/source'), { recursive: true });
    const attributesPath = new URL('../.gitattributes', import.meta.url);
    const attributes = existsSync(attributesPath) ? readFileSync(attributesPath) : Buffer.alloc(0);
    writeFileSync(path.join(repository, '.gitattributes'), attributes);
    writeFileSync(path.join(repository, 'assets/source/example.svg'), bytes);
    git(['init'], repository);
    git(['add', '.gitattributes', 'assets/source/example.svg'], repository);
    git(['commit', '-m', 'Source byte preservation regression'], repository);
    git(['clone', repository, checkout], temp);
    assert.deepEqual(readFileSync(path.join(checkout, 'assets/source/example.svg')), bytes, 'Autocrlf altered immutable source bytes during checkout');
  } finally {
    const base = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(temp).startsWith(base) && path.basename(temp).startsWith('vector-composer-eol-'));
    rmSync(temp, { recursive: true, force: true });
  }
});
