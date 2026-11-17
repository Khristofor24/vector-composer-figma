import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultModel = 'nvidia/nemotron-3.5-super-vl:free';

function parseLocalConfig(text) {
  const config = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(OPENROUTER_API_KEY|OPENROUTER_MODEL)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) config[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return config;
}

export async function buildPlugin({ mode = 'public', root = projectRoot, outDir } = {}) {
  if (!['public', 'demo'].includes(mode)) throw new Error('Неизвестный режим сборки.');
  const sourceManifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (typeof sourceManifest.id !== 'string' || !/^[1-9]\d*$/.test(sourceManifest.id)) {
    throw new Error('Нужен выданный Figma ID в manifest.json: Plugins → Development → New plugin → Figma Design → Custom UI. Перенесите только id из созданного manifest.json; не выдумывайте ID.');
  }
  let demoKey = '';
  let model = defaultModel;
  if (mode === 'demo') {
    let config;
    try { config = parseLocalConfig(await readFile(path.join(root, '.env.local'), 'utf8')); }
    catch { throw new Error('Для demo внесите OPENROUTER_API_KEY в локальный .env.local. Значение в чат не отправляйте.'); }
    demoKey = config.OPENROUTER_API_KEY || '';
    model = config.OPENROUTER_MODEL || defaultModel;
    if (!demoKey || /[\r\n]/.test(demoKey)) throw new Error('Локальный OPENROUTER_API_KEY не задан или имеет неверный формат.');
  }
  const output = outDir || path.join(root, 'dist', mode);
  const ui = await build({
    entryPoints: [path.join(root, 'src/ui.mjs')], bundle: true, write: false,
    platform: 'browser', format: 'iife', target: 'es2019', logLevel: 'silent',
    define: { __DEMO_API_KEY__: JSON.stringify(demoKey), __DEFAULT_MODEL__: JSON.stringify(model) },
  });
  let html = await readFile(path.join(root, 'src/ui.html'), 'utf8');
  if (!html.includes('<!--APP_SCRIPT-->')) throw new Error('В UI отсутствует точка подключения APP_SCRIPT.');
  const script = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  html = html.replace('<!--APP_SCRIPT-->', '<script>' + script + '</script>');
  const main = await build({
    entryPoints: [path.join(root, 'src/plugin.mjs')], bundle: true, write: false,
    platform: 'browser', format: 'iife', target: 'es2017', logLevel: 'silent',
    define: { __html__: JSON.stringify(html) },
  });
  const manifest = { ...sourceManifest, main: 'code.js', ui: 'ui.html' };
  if (mode === 'demo') manifest.name = 'Vector Composer — Demo';
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'code.js'), main.outputFiles[0].text),
    writeFile(path.join(output, 'ui.html'), html),
    writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'),
  ]);
  // Never return credentials: callers only need the output path and mode.
  return { mode, output, files: ['manifest.json', 'code.js', 'ui.html'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildPlugin({ mode: process.argv.includes('--demo') ? 'demo' : 'public' });
    console.log(`Сборка ${result.mode} готова: ${path.relative(projectRoot, result.output)} (manifest.json).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
