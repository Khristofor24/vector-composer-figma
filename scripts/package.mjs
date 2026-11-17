import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin, projectRoot } from './build.mjs';

const directories = ['src', 'scripts', 'tests', 'assets', 'docs', 'examples'];
const rootFiles = ['package.json', 'package-lock.json', 'manifest.json', '.env.example', '.gitignore', '.gitattributes', 'README.md', 'AGENTS.md', 'CLAUDE.md'];
const allowedExtensions = new Set(['.mjs', '.json', '.html', '.md', '.py', '.ps1', '.svg', '.png']);
const excludedSegments = new Set(['node_modules', '.git', '.autopilot', 'dist', 'release', 'private', 'demo', '__pycache__']);

export async function collectSourceFiles(root = projectRoot) {
  const files = [];
  async function visit(relative) {
    let entries;
    try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const name = entry.name;
      if (excludedSegments.has(name) || name.startsWith('.env') || name.endsWith('.local') || entry.isSymbolicLink()) continue;
      const child = path.posix.join(relative, name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && allowedExtensions.has(path.extname(name))) files.push(child);
    }
  }
  for (const directory of directories) await visit(directory);
  for (const file of rootFiles) {
    try { await readFile(path.join(root, file)); files.push(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files.sort();
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Portable uncompressed ZIP, UTF-8 names, stable timestamp and no external tool.
export function zipFiles(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    if (/^\/|(^|\/)\.\.(\/|$)|\\/.test(name)) throw new Error('Недопустимый путь в архиве.');
    const filename = Buffer.from(name, 'utf8');
    const body = Buffer.from(bytes);
    const crc = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + body.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}

export async function packagePlugin({ mode = 'public', root = projectRoot } = {}) {
  const result = await buildPlugin({ root, mode });
  const output = path.join(root, 'release', mode);
  const pluginFolder = path.join(output, 'plugin');
  await mkdir(pluginFolder, { recursive: true });
  const entries = [];
  for (const file of result.files) {
    const bytes = await readFile(path.join(result.output, file));
    await copyFile(path.join(result.output, file), path.join(pluginFolder, file));
    entries.push({ name: file, bytes });
  }
  const pluginZip = path.join(output, `Vector-Composer-${mode}.zip`);
  await writeFile(pluginZip, zipFiles(entries));
  let sourceZip;
  if (mode === 'public') {
    const sourceEntries = [];
    for (const name of await collectSourceFiles(root)) {
      const bytes = await readFile(path.join(root, name));
      if (name === '.env.example' && /^[ \t]*OPENROUTER_API_KEY[ \t]*=[ \t]*[^\r\n\s]+/m.test(bytes.toString('utf8'))) {
        throw new Error('.env.example должен содержать пустой OPENROUTER_API_KEY.');
      }
      if (/sk-or-v1-[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8'))) throw new Error('Публичный исходный пакет содержит возможный ключ OpenRouter.');
      sourceEntries.push({ name, bytes });
    }
    sourceZip = path.join(output, 'Vector-Composer-source.zip');
    await writeFile(sourceZip, zipFiles(sourceEntries));
  }
  return { mode, pluginFolder, pluginZip, sourceZip };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await packagePlugin({ mode: process.argv.includes('--demo') ? 'demo' : 'public' });
    console.log(`Пакет ${result.mode}: ${path.relative(projectRoot, result.pluginZip)}; установка: ${path.relative(projectRoot, result.pluginFolder)}/manifest.json`);
    if (result.sourceZip) console.log(`Исходники: ${path.relative(projectRoot, result.sourceZip)}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
