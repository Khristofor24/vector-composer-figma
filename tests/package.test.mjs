import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPlugin } from '../scripts/build.mjs';
import { packagePlugin, collectSourceFiles } from '../scripts/package.mjs';

const sentinel = 'DEMO_TEST_SENTINEL_NOT_A_REAL_KEY_123456';
// Synthetic registration fixture only; never use this ID in a delivered manifest.
const testPluginId = '1234567890123456789';

test('Windows PowerShell parses the Russian demo helper without executing it', { skip: process.platform !== 'win32' }, () => {
  const helper = fileURLToPath(new URL('../scripts/configure-demo.ps1', import.meta.url));
  const command = '$parseTokens = $null; $parseErrors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:VECTOR_COMPOSER_PARSE_HELPER, [ref]$parseTokens, [ref]$parseErrors) | Out-Null; if ($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Output $_.Message }; exit 1 }; Write-Output "PARSE_OK"';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, VECTOR_COMPOSER_PARSE_HELPER: helper }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined, 'PowerShell parser process must launch');
  assert.equal(result.status, 0, 'PowerShell 5.1 syntax parsing failed: ' + result.stdout + result.stderr);
  assert.match(result.stdout, /PARSE_OK/);
});

async function fixture({ registered = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vector-composer-build-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/ui.html'), '<!doctype html><div id="app"></div><!--APP_SCRIPT-->');
  await writeFile(path.join(root, 'src/ui.mjs'), 'document.body.textContent = __DEMO_API_KEY__ + __DEFAULT_MODEL__;');
  await writeFile(path.join(root, 'src/plugin.mjs'), 'figma.showUI(__html__);');
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...(registered ? { id: testPluginId } : {}), name: 'Test', api: '1.0.0', main: 'dist/public/code.js', ui: 'dist/public/ui.html', editorType: ['figma'], documentAccess: 'dynamic-page', networkAccess: { allowedDomains: ['https://openrouter.ai'] } }));
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, '.gitattributes'), 'assets/source/** -text\n');
  await writeFile(path.join(root, '.env.example'), 'OPENROUTER_API_KEY=\nOPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free\n');
  return root;
}

test('public/demo defaults and local configuration instructions select the fixed free NVIDIA model', async () => {
  const expectedModel = 'nvidia/nemotron-3.5-super-vl:free';
  const root = await fixture();
  try {
    await writeFile(path.join(root, '.env.local'), `OPENROUTER_API_KEY=${sentinel}\n`);
    for (const mode of ['public', 'demo']) {
      const result = await buildPlugin({ root, mode });
      const html = await readFile(path.join(result.output, 'ui.html'), 'utf8');
      assert.ok(html.includes(expectedModel), `${mode} UI must receive the fixed default when no model is configured`);
    }
    const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
    assert.equal(example.match(/^OPENROUTER_MODEL=(.*)$/m)?.[1].trim(), expectedModel);
    assert.match(example, /^OPENROUTER_API_KEY=\r?$/m);
    if (process.platform === 'win32') {
      await mkdir(path.join(root, 'scripts'));
      const helper = path.join(root, 'scripts/configure-demo.ps1');
      const bytes = await readFile(new URL('../scripts/configure-demo.ps1', import.meta.url));
      await writeFile(helper, bytes);
      const command = 'function Read-Host { param($Prompt, [switch]$AsSecureString) $secure = [Security.SecureString]::new(); foreach ($character in $env:VECTOR_COMPOSER_TEST_KEY.ToCharArray()) { $secure.AppendChar($character) }; $secure }; & $env:VECTOR_COMPOSER_TEST_HELPER';
      const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        env: { ...process.env, VECTOR_COMPOSER_TEST_HELPER: helper, VECTOR_COMPOSER_TEST_KEY: sentinel }, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(run.error, undefined);
      assert.equal(run.status, 0, 'isolated demo configuration failed: ' + run.stdout + run.stderr);
      const configured = await readFile(path.join(root, '.env.local'), 'utf8');
      assert.equal(configured.match(/^OPENROUTER_MODEL=(.*)$/m)?.[1].trim(), expectedModel);
      assert.equal(configured.match(/^OPENROUTER_API_KEY=(.*)$/m)?.[1].trim(), sentinel);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('build rejects an unregistered manifest before output, then preserves its ID in public and demo packages', async () => {
  const root = await fixture({ registered: false });
  try {
    for (const mode of ['public', 'demo']) {
      await assert.rejects(buildPlugin({ root, mode }), /Figma.*ID.*New plugin/i);
      await assert.rejects(readFile(path.join(root, 'dist', mode, 'manifest.json')), { code: 'ENOENT' });
    }
    const registeredId = testPluginId;
    const sourcePath = path.join(root, 'manifest.json');
    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    await writeFile(sourcePath, JSON.stringify({ ...source, id: registeredId }));
    await writeFile(path.join(root, '.env.local'), `OPENROUTER_API_KEY=${sentinel}\n`);
    for (const mode of ['public', 'demo']) {
      const result = await packagePlugin({ root, mode });
      for (const manifestPath of [path.join(root, 'dist', mode, 'manifest.json'), path.join(root, 'release', mode, 'plugin', 'manifest.json'), sourcePath]) {
        assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).id, registeredId);
      }
      const zip = await readFile(result.pluginZip);
      assert.ok(zip.includes(Buffer.from(`"id": "${registeredId}"`)));
      if (mode === 'public') {
        assert.ok(!(await readFile(result.pluginZip)).includes(Buffer.from(sentinel)));
        assert.ok((await readFile(result.sourceZip)).includes(Buffer.from(registeredId)));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public build ignores private local config and creates a portable plugin manifest', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, '.env.local'), `OPENROUTER_API_KEY=${sentinel}\n`);
    const result = await buildPlugin({ root });
    for (const file of ['code.js', 'ui.html']) assert.ok(!(await readFile(path.join(result.output, file), 'utf8')).includes(sentinel));
    const manifest = JSON.parse(await readFile(path.join(result.output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.main, 'code.js'); assert.equal(manifest.ui, 'ui.html');
    assert.deepEqual(manifest.networkAccess.allowedDomains, ['https://openrouter.ai']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('demo build requires local key, injects only private output, and returns no credential', async () => {
  const root = await fixture();
  try {
    await assert.rejects(buildPlugin({ root, mode: 'demo' }), /OPENROUTER_API_KEY/);
    await writeFile(path.join(root, '.env.local'), `OPENROUTER_API_KEY=${sentinel}\n`);
    const result = await buildPlugin({ root, mode: 'demo' });
    assert.ok((await readFile(path.join(result.output, 'code.js'), 'utf8')).includes(sentinel));
    assert.ok(!JSON.stringify(result).includes(sentinel));
    await assert.rejects(buildPlugin({ root, mode: 'typo' }), /режим/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source archive allowlist excludes local secrets and all compiled/demo outputs', async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, 'assets/private'), { recursive: true });
    await mkdir(path.join(root, 'release/demo'), { recursive: true });
    await writeFile(path.join(root, '.env.local'), sentinel);
    await writeFile(path.join(root, 'assets/private/key.txt'), sentinel);
    await writeFile(path.join(root, 'src/secret.local'), sentinel);
    await writeFile(path.join(root, 'release/demo/code.js'), sentinel);
    const files = await collectSourceFiles(root);
    assert.ok(files.includes('src/plugin.mjs'));
    assert.ok(files.includes('.env.example'));
    assert.ok(files.includes('.gitattributes'));
    assert.ok(!files.some(x => /private|demo|\.local|release|dist/.test(x)));
    const result = await packagePlugin({ root, mode: 'public' });
    const bytes = await readFile(result.sourceZip);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.ok(!bytes.includes(Buffer.from(sentinel)));
    assert.ok(bytes.includes(Buffer.from('src/plugin.mjs')));
    assert.ok(bytes.includes(Buffer.from('.gitattributes')));
    const plugin = await readFile(result.pluginZip);
    assert.ok(plugin.includes(Buffer.from('manifest.json')));
    assert.ok(plugin.includes(Buffer.from('code.js')));
    assert.ok(plugin.includes(Buffer.from('ui.html')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
