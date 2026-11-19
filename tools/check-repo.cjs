#!/usr/bin/env node
'use strict';

/*
 * Repository self-check.
 *
 * This repository has no build step and no dependencies: the add-on is loaded by
 * Thunderbird straight from source and the gateway runs on plain Node. What is left
 * to get wrong is therefore not compilation but CONSISTENCY — a version that drifts,
 * a header name registered in one file and forgotten in another, a CRLF that breaks
 * the LF contract, a `require()` smuggled into code that runs inside a MailExtension
 * sandbox (where it does not exist and would throw at runtime, not at review time).
 *
 * Each check below exists because that failure is silent otherwise. Run with:
 *
 *   node tools/check-repo.cjs        (or: npm run check)
 *
 * Exit code 0 = every check passed. Exit code 1 = at least one failed, and the
 * failing check is named on its own line.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'thunderbird-extension');
const GATEWAY = path.join(ROOT, 'psemp-gateway');

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (err) {
    results.push({ name, ok: false, detail: err && err.message ? err.message : String(err) });
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'reports']);

/** Extensions whose bytes are text and must therefore be LF-only. */
const TEXT_EXT = new Set([
  '.js', '.cjs', '.mjs', '.json', '.md', '.txt', '.html', '.htm', '.css',
  '.yml', '.yaml', '.ps1', '.sh', '.ots', '.asc', '.eml', '.cff'
]);
const TEXT_NAMES = new Set(['.gitignore', '.gitattributes', '.editorconfig']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const manifest = readJson(path.join(EXT, 'manifest.json'));
const pkg = readJson(path.join(ROOT, 'package.json'));

check('all text files are LF-only', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);
    if (!TEXT_EXT.has(ext) && !TEXT_NAMES.has(base)) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0x0d)) offenders.push(path.relative(ROOT, file));
  }
  assert(offenders.length === 0, `CRLF found in: ${offenders.slice(0, 5).join(', ')}`);
  return 'no carriage returns anywhere in the tree';
});

check('repository JSON parses', () => {
  const files = [
    'package.json',
    'thunderbird-extension/manifest.json',
    'psemp-gateway/package.json',
    'psemp-gateway/settings.default.json',
    'thunderbird-extension/_locales/en/messages.json',
    'thunderbird-extension/_locales/bg/messages.json',
    'thunderbird-extension/_locales/de/messages.json'
  ];
  for (const rel of files) {
    assert(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
    readJson(path.join(ROOT, rel));
  }
  return `${files.length} files parse`;
});

check('package.json version matches the add-on manifest', () => {
  const majorMinor = pkg.version.split('.').slice(0, 2).join('.');
  assert(
    majorMinor === manifest.version,
    `package.json says ${pkg.version} (-> ${majorMinor}), manifest.json says ${manifest.version}`
  );
  return `both ${manifest.version}`;
});

check('manifest satisfies the MailExtension contract', () => {
  assert(manifest.manifest_version === 2, 'manifest_version must be 2 for Thunderbird 115');
  const gecko = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko;
  assert(gecko && gecko.id, 'browser_specific_settings.gecko.id is required');
  assert(gecko.strict_min_version === '115.0', 'strict_min_version must be 115.0 (Thunderbird ESR)');
  for (const perm of ['compose', 'storage']) {
    assert((manifest.permissions || []).includes(perm), `missing permission: ${perm}`);
  }
  assert(
    manifest.background && (manifest.background.scripts || []).includes('background.js'),
    'background.scripts must load background.js'
  );
  assert(manifest.options_ui && manifest.options_ui.page === 'options.html', 'options_ui must point at options.html');
  return `${gecko.id}, min ${gecko.strict_min_version}, ${manifest.permissions.length} permissions`;
});

check('every declared icon exists and is a real PNG', () => {
  // Gecko accepts a manifest that points at a missing file and then paints an empty
  // button, so "the archive carries icons" is only true if the files are checked.
  const declared = new Map();
  const add = (spec) => {
    if (!spec || typeof spec !== 'object') return;
    for (const [size, rel] of Object.entries(spec)) {
      declared.set(`${size}:${rel}`, { size: Number(size), rel });
    }
  };
  add(manifest.icons);
  add(manifest.browser_action && manifest.browser_action.default_icon);
  assert(declared.size > 0, 'the manifest declares no icons');
  for (const { size, rel } of declared.values()) {
    const file = path.join(EXT, rel);
    assert(fs.existsSync(file), `declared icon ${rel} is missing (run tools/make-icons.cjs)`);
    const png = fs.readFileSync(file);
    assert(png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${rel} is not a PNG`);
    assert(png.toString('ascii', 12, 16) === 'IHDR', `${rel} has no IHDR chunk`);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert(width === size && height === size, `${rel} is ${width}x${height}, declared as ${size}`);
  }
  return `${declared.size} declared icons, all real PNGs`;
});

check('every header name is registered in user.js', () => {
  const api = require(path.join(GATEWAY, 'api.js'));
  const names = Object.values(api.HEADER_NAMES);
  assert(names.length === 27, `expected 27 header names, found ${names.length}`);
  const userJs = fs.readFileSync(path.join(EXT, 'user.js'), 'utf8');
  const missing = names.filter((name) => !userJs.includes(name));
  assert(missing.length === 0, `not registered in user.js: ${missing.join(', ')}`);
  return '27 names, all present in the preference template';
});

check('the add-on carries no Node.js code', () => {
  // Comments are stripped first: several of them say "no require(), no Node modules",
  // and a check that cannot tell prose from code reports the documentation as a bug.
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const files = fs
    .readdirSync(EXT)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(EXT, f));
  for (const file of files) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(ROOT, file);
    assert(!/\brequire\s*\(/.test(source), `${rel} calls require(), which does not exist in a MailExtension`);
    assert(!/\bmodule\.exports\b/.test(source), `${rel} uses module.exports`);
    assert(!/\bprocess\.(env|argv|exit)\b/.test(source), `${rel} touches process.*`);
    assert(!/from\s+['"]node:/.test(source), `${rel} imports a node: builtin`);
  }
  return `${files.length} add-on scripts, WebExtension APIs only`;
});

check('the three locales define the same messages', () => {
  const load = (lang) => Object.keys(readJson(path.join(EXT, '_locales', lang, 'messages.json'))).sort();
  const en = load('en');
  for (const lang of ['bg', 'de']) {
    const other = load(lang);
    const missing = en.filter((k) => !other.includes(k));
    assert(missing.length === 0, `${lang} is missing: ${missing.join(', ')}`);
  }
  return `${en.length} messages in en, bg and de`;
});

check('the gateway declares no runtime dependencies', () => {
  const gw = readJson(path.join(GATEWAY, 'package.json'));
  const deps = Object.keys(gw.dependencies || {});
  assert(deps.length === 0, `dependencies declared: ${deps.join(', ')}`);
  return 'vendored packages only, nothing to install';
});

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`PASS  ${r.name} - ${r.detail}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${r.name} - ${r.detail}`);
  }
}
console.log('');
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
