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

check('install.ps1 keeps the receipt reporting honest', () => {
  /*
   * Every assertion here pins a claim that was, at some point, false in shipped code,
   * and each of those failures was SILENT: the script printed a reassuring line and
   * the profile disagreed. A receipt that never arrives has two common causes and both
   * of them live in this file:
   *
   *   1. the message was junk-marked, and Thunderbird never reads the request
   *      (msgHdrView.js:4396). No pref changes that, so the script must report the
   *      junk configuration rather than pretend a setting fixes it.
   *   2. the receipt left through a relay that rewrites the envelope. The first
   *      version of that diagnostic read `mail.smtp.<name>.hostname`, a prefix
   *      Thunderbird does not use, so the table was always empty and the warning
   *      never printed once.
   */
  const source = fs.readFileSync(path.join(EXT, 'tools', 'install.ps1'), 'utf8');

  // (a) The spam block is written through Set-PrefLine, which keeps the last-occurrence
  // dedupe meaningful. A raw string append would grow user.js on every run.
  for (const key of ['mail.spam.manualMark', 'mail.spam.manualMarkMode', 'mail.spam.logging.enabled']) {
    assert(
      source.includes(`Set-PrefLine $text '${key}'`),
      `${key} is no longer written through Set-PrefLine`
    );
  }

  // (b) `useServerFilter` is NOT written. It imports an upstream verdict, is inert
  // without `serverFilterName` (MsgIncomingServer.sys.mjs:1162), and can only raise
  // the junk score. Writing it looked like a fix and was a no-op.
  assert(
    !/Set-PrefLine[^\n]*useServerFilter/.test(source),
    'install.ps1 writes mail.server.<name>.useServerFilter again'
  );

  // (b2) ...but not writing it is not enough. The script edits user.js in place, so the
  // lines an EARLIER version wrote are still there: on the machine this was found on,
  // 10 override lines survived while prefs.js held the pref for only 2 servers. The
  // script therefore has to retire its own leftover output, and say how many lines it
  // removed. A silent cleanup would be the same lie in a quieter voice.
  assert(
    /staleFilterPattern[^\n]*useServerFilter/.test(source) ||
      /useServerFilter[\s\S]{0,200}staleFilterPattern/.test(source),
    'install.ps1 no longer retires the useServerFilter lines an earlier version wrote into user.js'
  );
  assert(
    /staleFilterCount/.test(source) && /leftover\s/.test(source),
    'install.ps1 retires leftover useServerFilter lines without reporting the count'
  );

  // (b3) ...and the count has to be true. The first version of the retirement missed one
  // line out of ten: a pref rewritten earlier in the script had its value pattern run
  // past `);` into a glued following pref and delete it silently, so the leftover was
  // already gone by the time the retirement counted what it had removed. Two guards:
  // `Set-PrefLine` must not be able to cross into a second pref, and lines that hold two
  // prefs must be split before any line-anchored pattern sees them.
  assert(
    /\(\?:\(\?!user_pref\)/.test(source),
    'Set-PrefLine can match across a `);` into a following pref and delete it'
  );
  assert(
    source.includes("'user_pref\\(')") &&
      source.indexOf("'user_pref\\(')") < source.indexOf('function Set-PrefLine'),
    'install.ps1 no longer splits a line that holds two prefs before rewriting prefs'
  );

  // (c) `spamLevel` is reported, never decided. Turning the operator's spam filter off
  // is their call, not the installer's.
  assert(
    !/Set-PrefLine[^\n]*spamLevel/.test(source),
    'install.ps1 writes spamLevel, which would silently disable junk detection'
  );

  // (d) The outgoing server is read from `mail.smtpserver.<name>.` — the real prefix.
  assert(
    source.includes('mail\\.smtpserver\\.'),
    'the SMTP hostname is no longer read from mail.smtpserver.<name>., the egress table will be empty'
  );
  assert(
    !source.includes('mail\\.smtp\\.'),
    'install.ps1 reads mail.smtp.<name>., which Thunderbird never writes'
  );

  // (e) The junk gate cannot be overridden, and the file must not imply otherwise.
  assert(
    source.includes('msgHdrView.js:4396'),
    'the junk block no longer names the gate it cannot override (msgHdrView.js:4396)'
  );

  // (f) The document that tells a reader how many names to expect must agree with
  // HEADER_NAMES. This is the one place a count belongs, because the compiler of
  // names (user.js) and the prose sit one file apart.
  const readme = fs.readFileSync(path.join(EXT, 'README.md'), 'utf8');
  assert(
    readme.includes('all twenty-seven'),
    'thunderbird-extension/README.md does not state the current header-name count'
  );
  assert(
    !/all fourteen/.test(readme),
    'thunderbird-extension/README.md carries the stale "fourteen" header-name count'
  );

  return 'junk reported, egress read from mail.smtpserver., no silent pref writes';
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
