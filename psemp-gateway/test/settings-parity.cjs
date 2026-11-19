#!/usr/bin/env node
/*
 * PSEMP shared-settings parity.
 *
 * The two halves of the framework must describe the same settings or the user
 * ends up with a header claiming a framework the other half never wrote. The file
 * `psemp-gateway/settings.default.json` is the meeting point, so this test pins the
 * key set and the key ORDER across four places at once:
 *
 *   psemp-gateway/api.js                DEFAULTS (the gateway)
 *   psemp-gateway/settings.default.json (the shared file)
 *   thunderbird-extension/background.js DEFAULTS (what is actually written)
 *   thunderbird-extension/options.js    DEFAULTS (what the options page edits)
 *
 * Importing a settings file must copy every shared key but NOT `origin`: origin names
 * the producer, so the extension always writes `Thunderbird` and the gateway always
 * writes `PSEMP-Gateway`. That single divergence is asserted, not ignored.
 *
 *   node psemp-gateway/test/settings-parity.cjs
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../api.js');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'thunderbird-extension');
const KEYS = [
  'version',
  'framework',
  'origin',
  'organization',
  'caseId',
  'pgpFingerprint',
  'pgpSigner',
  'pgpStandard',
  'enableOts',
  'enableReceipt',
  'enableDeliveryReceipt',
  'receiptMode',
  'receiptAddress',
  // Everything the evidence chain itself says: the Message-ID host, the name and the
  // two protocol words of the manifest, and the algorithms it publishes. They live in
  // settings so a second deployment does not have to patch code to say who it is.
  'messageIdDomain',
  'manifestFilename',
  'manifestFramework',
  'manifestStandard',
  'algoBody',
  'algoExtra',
  'algoMerkle',
  'algoEngine',
  'algoSignature',
  'algoTimestamp',
];

const checks = [];
async function check(name, fn) {
  checks.push({ name, detail: await fn() });
}

/** Pull the keys out of a `const DEFAULTS = { … };` block without executing it. */
function defaultsKeys(file) {
  const text = fs.readFileSync(file, 'utf8');
  const block = /const DEFAULTS = \{([\s\S]*?)\n\};/.exec(text);
  assert.ok(block, `${path.basename(file)} has no DEFAULTS block`);
  return block[1]
    .split('\n')
    .map((line) => /^\s{2}([A-Za-z0-9_]+):/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

/**
 * Run the options page script against a stub DOM so the import path is exercised
 * as the browser would run it, not re-implemented here.
 */
function loadOptionsPage() {
  const handlers = new Map();
  const elements = new Map();
  const writes = [];
  const blobs = [];
  const stored = {};
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: '',
        checked: false,
        textContent: '',
        files: null,
        addEventListener: (type, handler) => {
          handlers.set(`${id}:${type}`, handler);
        },
        click: () => {},
      });
    }
    return elements.get(id);
  }

  const storage = {
    get: async (defaults) => Object.assign({}, defaults, stored),
    set: async (values) => {
      Object.assign(stored, values);
      writes.push(values);
    },
  };

  const sandbox = {
    console,
    browser: { storage: { local: storage } },
    document: {
      getElementById: element,
      addEventListener: (type, handler) => {
        handlers.set(`document:${type}`, handler);
      },
      createElement: () => ({ href: '', download: '', click: () => {} }),
    },
    window: { setTimeout: () => 0 },
    URL: {
      createObjectURL: (blob) => {
        blobs.push(blob);
        return 'blob:stub';
      },
      revokeObjectURL: () => {},
    },
    Blob: class Blob {
      constructor(parts) {
        this.parts = parts;
      }
    },
    setTimeout,
  };

  const source = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'options.js' });

  return { handlers, element, writes, stored, blobs };
}

async function settle(predicate, label) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  await check('gateway-keys', () => {
    assert.deepStrictEqual(Object.keys(api.DEFAULTS), KEYS);
    return 'api.js DEFAULTS';
  });

  await check('settings-file-keys', () => {
    const file = JSON.parse(fs.readFileSync(api.SETTINGS_PATH, 'utf8'));
    assert.deepStrictEqual(Object.keys(file), KEYS, 'settings.default.json key set/order');
    assert.deepStrictEqual(api.loadSettings(), file, 'loadSettings must return the file verbatim');
    return 'settings.default.json';
  });

  await check('extension-background-keys', () => {
    assert.deepStrictEqual(defaultsKeys(path.join(EXT, 'background.js')), KEYS);
    return 'background.js DEFAULTS';
  });

  await check('extension-options-keys', () => {
    assert.deepStrictEqual(defaultsKeys(path.join(EXT, 'options.js')), KEYS);
    return 'options.js DEFAULTS';
  });

  await check('origin-is-the-only-divergence', () => {
    const file = JSON.parse(fs.readFileSync(api.SETTINGS_PATH, 'utf8'));
    const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
    for (const key of KEYS.filter((name) => name !== 'origin')) {
      assert.deepStrictEqual(
        file[key],
        api.DEFAULTS[key],
        `${key} must agree between the gateway defaults and the shared file`,
      );
      assert.ok(bg.includes(`${key}:`), `background.js must declare ${key}`);
    }
    assert.strictEqual(api.DEFAULTS.origin, 'PSEMP-Gateway');
    assert.match(bg, /origin: "Thunderbird"/, 'the extension announces itself as Thunderbird');
    return 'gateway=PSEMP-Gateway, extension=Thunderbird';
  });

  await check('extension-writes-every-header-name', () => {
    const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
    for (const name of Object.values(api.HEADER_NAMES)) {
      assert.ok(bg.includes(name), `background.js must emit ${name}`);
    }
    return `${Object.keys(api.HEADER_NAMES).length} names`;
  });

  await check('userjs-registers-every-header', () => {
    const text = fs.readFileSync(path.join(EXT, 'user.js'), 'utf8');
    assert.match(text, /"mail\.compose\.other\.header"/, 'the pref is mail.compose.other.header');
    const listed = [...text.matchAll(/"(X-PasevSU-[A-Za-z0-9-]+)"/g)].map((match) => match[1]);
    assert.deepStrictEqual(
      listed,
      Object.values(api.HEADER_NAMES),
      'user.js must register every header, in injection order',
    );
    return 'user.js matches HEADER_NAMES';
  });

  const page = loadOptionsPage();
  page.handlers.get('document:DOMContentLoaded')();
  await settle(() => page.element('version').value !== '', 'the options page to load');

  await check('options-page-loads-stored-values', () => {
    assert.strictEqual(page.element('version').value, api.DEFAULTS.version);
    assert.strictEqual(page.element('enableOts').checked, api.DEFAULTS.enableOts);
    assert.strictEqual(page.element('enableReceipt').checked, api.DEFAULTS.enableReceipt);
    assert.strictEqual(
      page.element('enableDeliveryReceipt').checked,
      api.DEFAULTS.enableDeliveryReceipt,
      'the delivery-receipt switch is on the page and reflects storage',
    );
    assert.strictEqual(page.element('receiptAddress').value, api.DEFAULTS.receiptAddress);
    assert.strictEqual(page.element('messageIdDomain').value, api.DEFAULTS.messageIdDomain);
    assert.strictEqual(page.element('manifestFilename').value, api.DEFAULTS.manifestFilename);
    assert.strictEqual(page.element('algoExtra').value, api.DEFAULTS.algoExtra);
    return 'form reflects storage';
  });

  await check('import-copies-every-shared-key-but-not-origin', async () => {
    const imported = {
      version: '2.5',
      framework: 'Forensic-Mail',
      origin: 'PSEMP-Gateway',
      organization: 'PasevSU',
      caseId: 'CASE-2026-001',
      pgpFingerprint: 'a1b2 c3d4: e5f6',
      pgpSigner: '  other@example.org  ',
      pgpStandard: '  OpenPGP/MIME  ',
      enableOts: false,
      enableReceipt: false,
      enableDeliveryReceipt: false,
      receiptAddress: '  receipts@example.org  ',
      messageIdDomain: '  evidence.example.test  ',
      manifestFilename: '  /Evidence/Manifest.json  ',
      manifestFramework: '  OtherFramework  ',
      manifestStandard: '  OTHER-STD  ',
      algoBody: '  SHA-512  ',
      algoExtra: '  SHA3-512 ,  BLAKE3  ',
      algoMerkle: '  SHA-512  ',
      algoEngine: '  AES-256-GCM  ',
      algoSignature: '  OpenPGP  ',
      algoTimestamp: '  OpenTimestamps  ',
    };
    page.element('importFile').files = [{ text: async () => JSON.stringify(imported) }];
    page.handlers.get('importFile:change')({ target: page.element('importFile') });
    await settle(() => page.writes.length > 0, 'the import to write storage');

    const written = page.writes[page.writes.length - 1];
    assert.ok(!Object.prototype.hasOwnProperty.call(written, 'origin'), 'origin must never be imported');
    assert.strictEqual(written.version, '2.5');
    assert.strictEqual(written.pgpFingerprint, 'A1B2C3D4E5F6', 'the fingerprint is normalized on import');
    assert.strictEqual(written.pgpSigner, 'other@example.org', 'the signer travels with the settings file');
    assert.strictEqual(written.pgpStandard, 'OpenPGP/MIME', 'the standard travels with the settings file');
    assert.strictEqual(written.enableOts, false);
    assert.strictEqual(written.enableReceipt, false, 'the receipt switch travels with the settings file');
    assert.strictEqual(
      written.enableDeliveryReceipt,
      false,
      'the delivery-receipt switch travels with the settings file',
    );
    assert.strictEqual(written.caseId, 'CASE-2026-001', 'caseId used to be dropped on import');
    assert.strictEqual(written.receiptAddress, 'receipts@example.org', 'the address is trimmed');
    assert.strictEqual(
      written.messageIdDomain,
      'evidence.example.test',
      'the Message-ID host travels with the settings file',
    );
    assert.strictEqual(
      written.manifestFilename,
      '/Evidence/Manifest.json',
      'the manifest name travels with the settings file',
    );
    assert.strictEqual(written.manifestFramework, 'OtherFramework');
    assert.strictEqual(written.manifestStandard, 'OTHER-STD');
    assert.strictEqual(written.algoBody, 'SHA-512', 'the published digest travels with the settings file');
    assert.strictEqual(written.algoExtra, 'SHA3-512 ,  BLAKE3', 'only the outer whitespace is trimmed');
    assert.strictEqual(written.algoMerkle, 'SHA-512');
    assert.strictEqual(written.algoEngine, 'AES-256-GCM');
    assert.strictEqual(written.algoSignature, 'OpenPGP');
    assert.strictEqual(written.algoTimestamp, 'OpenTimestamps');
    assert.strictEqual(page.element('version').value, '2.5', 'the form is refreshed after import');
    return 'origin stripped, fingerprint normalized';
  });

  await check('export-keeps-the-shared-key-order', async () => {
    page.handlers.get('exportFile:click')();
    await settle(() => page.blobs.length > 0, 'the export blob');
    const text = page.blobs[page.blobs.length - 1].parts.join('');
    const exported = JSON.parse(text);
    assert.deepStrictEqual(Object.keys(exported), KEYS, 'exported key set/order');
    assert.match(text, /\n$/, 'the exported file ends with a newline, like the one on disk');
    assert.strictEqual(exported.enableReceipt, false, 'the export reflects the imported value');
    assert.strictEqual(exported.origin, 'Thunderbird', 'origin stays the extension, never the file');
    return Object.keys(exported).join(',');
  });

  await check('import-rejects-a-non-settings-file', async () => {
    const before = page.writes.length;
    page.element('status').textContent = '';
    page.element('importFile').files = [{ text: async () => '{not json' }];
    page.handlers.get('importFile:change')({ target: page.element('importFile') });
    await settle(() => page.element('status').textContent !== '', 'the error status');
    assert.match(page.element('status').textContent, /Not a settings file/);
    assert.strictEqual(page.writes.length, before, 'a broken file must not touch storage');
    return 'parse error reported, nothing written';
  });

  // background.js has always recorded these four conditions and the page never
  // showed them, so a dropped header or an omitted PGP claim was invisible. The
  // fixture seeds exactly what the background script writes — codes, not sentences
  // — and asserts the page turns them into readable text.
  const healthPage = loadOptionsPage();
  Object.assign(healthPage.stored, {
    psempRejectedHeaders: ['X-Evidence-Salt', 'List-Case'],
    psempFingerprintIssue: 'key-id-not-fingerprint',
    psempFingerprintIssueAt: '2026-11-09T10:20:30.000Z',
    psempRestamps: 2,
    psempLastRestamp: { at: '2026-11-09T10:21:00.000Z', reason: 'manifest-attached' },
  });
  healthPage.handlers.get('document:DOMContentLoaded')();
  await settle(() => healthPage.element('rejectedHeaders').textContent !== '', 'the health block to render');

  await check('the-page-shows-the-headers-the-extension-dropped', () => {
    const text = healthPage.element('rejectedHeaders').textContent;
    assert.match(text, /refused to write/, 'the page names the dropped headers');
    assert.match(text, /X-Evidence-Salt, List-Case/, 'both dropped names are listed in recorded order');
    return 'dropped header names rendered';
  });

  await check('the-page-explains-why-the-pgp-claim-was-omitted', () => {
    const text = healthPage.element('fingerprintIssue').textContent;
    assert.match(text, /key ID, not a fingerprint/, 'the stored code is mapped to a sentence');
    assert.match(text, /2026-11-09T10:20:30\.000Z/, 'the recorded moment is shown verbatim');
    assert.ok(!/key-id-not-fingerprint/.test(text), 'the internal code never reaches the page');
    return 'fingerprint issue rendered from its code';
  });

  await check('the-page-counts-the-send-passes-that-did-not-restamp', () => {
    const text = healthPage.element('restamps').textContent;
    assert.match(text, /re-ran 2 time/, 'the recorded count is shown');
    assert.match(text, /2026-11-09T10:21:00\.000Z/, 'the last restamp moment is shown');
    assert.match(
      text,
      /the manifest was already attached/,
      'the reason code becomes the sentence for it',
    );
    assert.ok(!/manifest-attached/.test(text), 'the internal reason code never reaches the page');
    return 'restamps rendered from count + reason code';
  });

  await check('a-clean-profile-renders-no-invented-warning', async () => {
    const clean = loadOptionsPage();
    clean.handlers.get('document:DOMContentLoaded')();
    await settle(() => clean.element('version').value !== '', 'the clean page to load');
    for (const id of ['rejectedHeaders', 'fingerprintIssue', 'restamps']) {
      assert.strictEqual(
        clean.element(id).textContent,
        '',
        `${id} must stay empty when the background script recorded nothing`,
      );
    }
    return 'nothing recorded, nothing claimed';
  });

  console.log('settings-parity:');
  for (const entry of checks) console.log(`  ok  ${entry.name} — ${entry.detail}`);
  console.log('settings-parity: OK');
}

main().catch((error) => {
  console.error('settings-parity: FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
