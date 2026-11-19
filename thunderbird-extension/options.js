/*
 * PasevSU Forensic Mail — options page script.
 * Reads/writes browser.storage.local. Keys must match background.js DEFAULTS.
 */

const DEFAULTS = {
  version: "1.0",
  framework: "Forensic-Mail",
  origin: "Thunderbird",
  organization: "PasevSU",
  caseId: "",
  pgpFingerprint: "",
  pgpSigner: "pasevdenislav@gmail.com",
  pgpStandard: "OpenPGP/MIME signed message (RFC 4880 and 3156)",
  enableOts: true,
  enableReceipt: true,
  enableDeliveryReceipt: true,
  receiptMode: "identity",
  receiptAddress: "",
  // The rest of the evidence chain is named here rather than in the code, because a
  // second operator must not need a patch to say who minted a message. The defaults
  // are exactly what this build already writes, so an untouched install is unchanged.
  messageIdDomain: "forensic.evidence.pasevsu",
  manifestFilename: "PasevSU_Manifest.json",
  manifestFramework: "PasevSU",
  manifestStandard: "PSEMP",
  algoBody: "SHA-256",
  algoExtra: "SHA3-512, BLAKE3",
  algoMerkle: "SHA-256",
  algoEngine: "AES-256-GCM",
  algoSignature: "OpenPGP",
  algoTimestamp: "OpenTimestamps",
};

// The three ways a receipt address can be chosen. Kept in step with background.js:
// an unknown value there means "identity", so the page must show that too instead of
// rendering an empty select.
const RECEIPT_MODES = ["identity", "custom", "off"];

function normalizeReceiptMode(value) {
  return RECEIPT_MODES.indexOf(value) === -1 ? "identity" : value;
}

const FIELDS = {
  version: document.getElementById("version"),
  framework: document.getElementById("framework"),
  origin: document.getElementById("origin"),
  organization: document.getElementById("organization"),
  caseId: document.getElementById("caseId"),
  pgpFingerprint: document.getElementById("pgpFingerprint"),
  pgpSigner: document.getElementById("pgpSigner"),
  pgpStandard: document.getElementById("pgpStandard"),
  enableOts: document.getElementById("enableOts"),
  enableReceipt: document.getElementById("enableReceipt"),
  enableDeliveryReceipt: document.getElementById("enableDeliveryReceipt"),
  receiptMode: document.getElementById("receiptMode"),
  receiptAddress: document.getElementById("receiptAddress"),
  messageIdDomain: document.getElementById("messageIdDomain"),
  manifestFilename: document.getElementById("manifestFilename"),
  manifestFramework: document.getElementById("manifestFramework"),
  manifestStandard: document.getElementById("manifestStandard"),
  algoBody: document.getElementById("algoBody"),
  algoExtra: document.getElementById("algoExtra"),
  algoMerkle: document.getElementById("algoMerkle"),
  algoEngine: document.getElementById("algoEngine"),
  algoSignature: document.getElementById("algoSignature"),
  algoTimestamp: document.getElementById("algoTimestamp"),
};

// English fallbacks: the page must stay readable when a catalogue entry is missing
// or when this script runs outside Thunderbird (the tests drive it with a stub DOM).
const FALLBACK = {
  armedChecking: "Checking whether the background script is armed…",
  armedOk: "Armed — background script loaded at $1.",
  armedNoReport: "Not armed — the background script has not reported yet. Restart Thunderbird.",
  armedError: "Not armed — $1",
  manifestError: "Last send: the manifest could NOT be attached — $1",
  lastSendSummary:
    "Stamped $1 message(s). Last: $2, Evidence-ID $3, $4 attachment(s), $5 headers.",
  lastSendNone:
    "Stamped 0 messages — no outgoing message has been stamped yet. Send one and this line will update.",
  attachmentHashes: "Attachment hashes of the last message:",
  attachmentFailures: "Unreadable attachments (named in X-PasevSU-Attachments-Error): $1",
  receiptError:
    "No receipt address: the receipt header is only written when the sending identity or the fallback address below is known.",
  fingerprintInvalid:
    "The fingerprint was not saved: it must be 40 or 64 hexadecimal characters (no spaces).",
  fingerprintIsKeyId:
    "That is a key ID (8 or 16 characters), not a fingerprint. Copy the full 40-character fingerprint.",
  rejectedHeaders:
    "Headers the extension refused to write (only X-, List- and msip_labels names are allowed): $1",
  fingerprintIssueNotHex:
    "Recorded at $1: the PGP fingerprint contains characters other than 0-9 and A-F, so no PGP claim was written.",
  fingerprintIssueKeyId:
    "Recorded at $1: the PGP fingerprint field holds a key ID, not a fingerprint, so no PGP claim was written.",
  fingerprintIssueWrongLength:
    "Recorded at $1: the PGP fingerprint is neither 40 nor 64 hexadecimal characters, so no PGP claim was written.",
  restampReasonEvidenceHeader: "the evidence header was already in the message",
  restampReasonManifestAttached: "the manifest was already attached",
  restampsSummary:
    "A send pass re-ran $1 time(s) without stamping again. Last: $2 — $3.",
  save: "Save",
  saved: "Saved.",
  exported: "Exported settings.default.json",
  imported: "Imported $1 of $2 keys$3",
  notSettingsFile: "Not a settings file: $1",
};

const i18n = (browser && browser.i18n) || null;

function t(key, substitutions) {
  const subs = substitutions == null ? [] : [].concat(substitutions).map(String);
  if (i18n && typeof i18n.getMessage === "function") {
    const message = i18n.getMessage(key, subs);
    if (message) return message;
  }
  const template = FALLBACK[key] || key;
  return template.replace(/\$(\d)/g, (match, index) => {
    const value = subs[Number(index) - 1];
    return value == null ? match : value;
  });
}

// Locale files carry markup (<code>, <strong>), so HTML keys are set as HTML. The
// only values interpolated into them are ours, never message content.
function applyI18n() {
  if (typeof document.querySelectorAll !== "function" || !i18n) return;
  const language = typeof i18n.getUILanguage === "function" ? i18n.getUILanguage() : "";
  if (language) document.documentElement.lang = language;

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const message = i18n.getMessage(node.dataset.i18n);
    if (message) node.textContent = message;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((node) => {
    const message = i18n.getMessage(node.dataset.i18nHtml);
    if (message) node.innerHTML = message;
  });
}

// Same rule as background.js: uppercase hex, no separators, so a fingerprint
// pasted from Thunderbird's key properties is stored exactly as gpg prints it.
function normalizeFingerprint(value) {
  return String(value == null ? "" : value)
    .replace(/[\s:]/g, "")
    .replace(/^0x/i, "")
    .toUpperCase();
}

// Same rule as background.js: a fingerprint is 40 hex digits (v4) or 64 (v6).
// Anything else is rejected HERE, before it is stored, so the send path never has to
// publish a claim that cannot be one. Measured on a real send, a 28-digit value — the
// case ID pasted into the wrong field — reached the wire and made the verifier accuse
// the signer of not matching its own key.
function fingerprintProblem(value) {
  const normalized = normalizeFingerprint(value);
  if (!normalized) {
    return "";
  }
  if (!/^[0-9A-F]+$/.test(normalized)) {
    return "not-hex";
  }
  if (normalized.length !== 40 && normalized.length !== 64) {
    return normalized.length === 8 || normalized.length === 16 ? "key-id-not-fingerprint" : "wrong-length";
  }
  return "";
}

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

function renderLines(container, lines) {
  if (!container) return;
  const items = lines.filter(Boolean);
  if (typeof container.replaceChildren === "function" && typeof document.createElement === "function") {
    container.replaceChildren(
      ...items.map((line) => {
        const row = document.createElement("div");
        row.textContent = line;
        return row;
      }),
    );
  } else {
    container.textContent = items.join(" | ");
  }
}

async function load() {
  applyI18n();
  const stored = await browser.storage.local.get(DEFAULTS);
  const config = Object.assign({}, DEFAULTS, stored);
  FIELDS.version.value = config.version;
  FIELDS.framework.value = config.framework;
  FIELDS.origin.value = config.origin;
  FIELDS.organization.value = config.organization;
  FIELDS.caseId.value = config.caseId;
  FIELDS.pgpFingerprint.value = config.pgpFingerprint;
  FIELDS.pgpSigner.value = config.pgpSigner;
  FIELDS.pgpStandard.value = config.pgpStandard;
  FIELDS.enableOts.checked = Boolean(config.enableOts);
  FIELDS.enableReceipt.checked = Boolean(config.enableReceipt);
  FIELDS.enableDeliveryReceipt.checked = Boolean(config.enableDeliveryReceipt);
  FIELDS.receiptMode.value = normalizeReceiptMode(config.receiptMode);
  FIELDS.receiptAddress.value = config.receiptAddress;
  FIELDS.messageIdDomain.value = config.messageIdDomain;
  FIELDS.manifestFilename.value = config.manifestFilename;
  FIELDS.manifestFramework.value = config.manifestFramework;
  FIELDS.manifestStandard.value = config.manifestStandard;
  FIELDS.algoBody.value = config.algoBody;
  FIELDS.algoExtra.value = config.algoExtra;
  FIELDS.algoMerkle.value = config.algoMerkle;
  FIELDS.algoEngine.value = config.algoEngine;
  FIELDS.algoSignature.value = config.algoSignature;
  FIELDS.algoTimestamp.value = config.algoTimestamp;
  await renderArmed();
}

// Readiness comes from the background script itself: it writes a heartbeat as soon
// as it loads, records an error if it cannot register onBeforeSend, and records one
// if Thunderbird refuses the manifest attachment during a send.
async function renderArmed() {
  const health = await browser.storage.local.get({
    psempLastLoadedAt: "",
    psempArmError: "",
    psempManifestError: "",
    psempLastSend: null,
    psempSendCount: 0,
    psempReceiptError: "",
    // Written by background.js but never shown until now: the sender could not see
    // that a header had been dropped, that the PGP claim was omitted, or that the
    // send pass had re-run. Values are plain data — the wording lives in _locales.
    psempRejectedHeaders: [],
    psempFingerprintIssue: "",
    psempFingerprintIssueAt: "",
    psempRestamps: 0,
    psempLastRestamp: null,
  });
  const armed = document.getElementById("armed");
  if (armed) {
    if (health.psempArmError) {
      armed.textContent = t("armedError", health.psempArmError);
    } else if (health.psempLastLoadedAt) {
      armed.textContent = t("armedOk", health.psempLastLoadedAt);
    } else {
      armed.textContent = t("armedNoReport");
    }
  }

  // The headers can be injected while the manifest attachment is refused, so this
  // is reported separately: the last send went out without PasevSU_Manifest.json.
  const manifest = document.getElementById("manifest");
  if (manifest) {
    manifest.textContent = health.psempManifestError
      ? t("manifestError", health.psempManifestError)
      : "";
  }

  const send = health.psempLastSend;
  const count = Number(health.psempSendCount) || 0;

  // Proof that the extension stamped a message, independent of any Sent folder.
  const lastSend = document.getElementById("lastSend");
  if (lastSend) {
    if (send && send.at) {
      lastSend.textContent = t("lastSendSummary", [
        count,
        send.at,
        send.evidenceId || "—",
        send.attachmentCount || 0,
        (send.headers || []).length,
      ]);
    } else {
      lastSend.textContent = t("lastSendNone");
    }
  }

  // The reported defect was "the attachment hashes are missing". They are shown
  // here as name=hash, exactly as they were written into the header.
  const hashesWrap = document.getElementById("attachHashesWrap");
  const hashes = document.getElementById("attachHashes");
  const entries = send && Array.isArray(send.attachments) ? send.attachments : [];
  if (hashesWrap) {
    if (entries.length > 0 && hashesWrap.classList) hashesWrap.classList.remove("hidden");
    else if (hashesWrap.classList) hashesWrap.classList.add("hidden");
  }
  if (hashes) {
    renderLines(
      hashes,
      entries.map((entry) => `${entry.filename}=${entry.sha256}`),
    );
  }

  const failures = send && Array.isArray(send.attachmentFailures) ? send.attachmentFailures : [];
  const failuresNode = document.getElementById("attachFailures");
  if (failuresNode) {
    failuresNode.textContent = failures.length
      ? t("attachmentFailures", failures.map((f) => `${f.filename} (${f.reason})`).join(", "))
      : "";
  }

  // The background script stores a CODE, not a sentence, so the wording stays in
  // the locale files (the German page must not show an English reason).
  const receiptProblem = document.getElementById("receiptProblem");
  if (receiptProblem) {
    receiptProblem.textContent = health.psempReceiptError ? t("receiptError") : "";
  }

  // A custom header the extension refused to write is dropped silently on the wire:
  // the message still goes out, only without that header. The names are recorded, so
  // this is where the sender learns which claim is missing.
  const rejected = Array.isArray(health.psempRejectedHeaders) ? health.psempRejectedHeaders : [];
  const rejectedNode = document.getElementById("rejectedHeaders");
  if (rejectedNode) {
    rejectedNode.textContent = rejected.length ? t("rejectedHeaders", rejected.join(", ")) : "";
  }

  // The PGP claim is omitted when the stored value cannot be a fingerprint. The
  // stored value is a code ("not-hex", "key-id-not-fingerprint", "wrong-length"),
  // mapped here to a sentence; an unknown code falls back to nothing rather than
  // printing an internal identifier on the page.
  const issueCodes = {
    "not-hex": "fingerprintIssueNotHex",
    "key-id-not-fingerprint": "fingerprintIssueKeyId",
    "wrong-length": "fingerprintIssueWrongLength",
  };
  const issueNode = document.getElementById("fingerprintIssue");
  if (issueNode) {
    const key = issueCodes[health.psempFingerprintIssue];
    const when = health.psempFingerprintIssueAt || "—";
    issueNode.textContent = key ? t(key, when) : "";
  }

  // A second pass over an already stamped message does not stamp again; it is counted
  // anyway, because "sent once, stamped once" is a claim the evidence chain makes.
  const restamps = Number(health.psempRestamps) || 0;
  const restampNode = document.getElementById("restamps");
  if (restampNode) {
    const last = health.psempLastRestamp;
    if (restamps > 0) {
      const reasonKeys = {
        "evidence-header": "restampReasonEvidenceHeader",
        "manifest-attached": "restampReasonManifestAttached",
      };
      const reasonKey = last && reasonKeys[last.reason];
      const reason = reasonKey ? t(reasonKey) : (last && last.reason) || "—";
      const when = (last && last.at) || "—";
      restampNode.textContent = t("restampsSummary", [restamps, when, reason]);
    } else {
      restampNode.textContent = "";
    }
  }
}

async function save() {
  const typedFingerprint = FIELDS.pgpFingerprint.value;
  const fingerprintIssue = fingerprintProblem(typedFingerprint);
  if (fingerprintIssue) {
    // Refused at the point of entry: the field keeps what was typed so it can be
    // corrected, and nothing impossible is written to storage.
    if (fingerprintIssue === "key-id-not-fingerprint") {
      setStatus(t("fingerprintIsKeyId"));
    } else {
      setStatus(t("fingerprintInvalid"));
    }
    return;
  }
  const next = {
    version: FIELDS.version.value.trim() || DEFAULTS.version,
    framework: FIELDS.framework.value.trim() || DEFAULTS.framework,
    origin: FIELDS.origin.value.trim() || DEFAULTS.origin,
    organization: FIELDS.organization.value.trim() || DEFAULTS.organization,
    caseId: FIELDS.caseId.value.trim(),
    pgpFingerprint: normalizeFingerprint(typedFingerprint),
    pgpSigner: FIELDS.pgpSigner.value.trim() || DEFAULTS.pgpSigner,
    pgpStandard: FIELDS.pgpStandard.value.trim() || DEFAULTS.pgpStandard,
    enableOts: FIELDS.enableOts.checked,
    enableReceipt: FIELDS.enableReceipt.checked,
    enableDeliveryReceipt: FIELDS.enableDeliveryReceipt.checked,
    receiptMode: normalizeReceiptMode(FIELDS.receiptMode.value),
    receiptAddress: FIELDS.receiptAddress.value.trim(),
    messageIdDomain: FIELDS.messageIdDomain.value.trim() || DEFAULTS.messageIdDomain,
    manifestFilename: FIELDS.manifestFilename.value.trim() || DEFAULTS.manifestFilename,
    manifestFramework: FIELDS.manifestFramework.value.trim() || DEFAULTS.manifestFramework,
    manifestStandard: FIELDS.manifestStandard.value.trim() || DEFAULTS.manifestStandard,
    algoBody: FIELDS.algoBody.value.trim() || DEFAULTS.algoBody,
    algoExtra: FIELDS.algoExtra.value.trim(),
    algoMerkle: FIELDS.algoMerkle.value.trim() || DEFAULTS.algoMerkle,
    algoEngine: FIELDS.algoEngine.value.trim() || DEFAULTS.algoEngine,
    algoSignature: FIELDS.algoSignature.value.trim() || DEFAULTS.algoSignature,
    algoTimestamp: FIELDS.algoTimestamp.value.trim() || DEFAULTS.algoTimestamp,
    // A fingerprint just accepted clears the complaint background.js recorded for the
    // previous one, so the page stops reporting a defect the user has already fixed.
    psempFingerprintIssue: "",
  };
  await browser.storage.local.set(next);
  FIELDS.pgpFingerprint.value = next.pgpFingerprint;
  FIELDS.pgpSigner.value = next.pgpSigner;
  FIELDS.pgpStandard.value = next.pgpStandard;
  FIELDS.receiptMode.value = next.receiptMode;
  FIELDS.receiptAddress.value = next.receiptAddress;
  setStatus(t("saved"));
}

document.addEventListener("DOMContentLoaded", load);
document.getElementById("save").addEventListener("click", save);

// ── Shared settings file ────────────────────────────────────────────────────────
// `psemp-gateway/settings.default.json` carries the same keys, so one file can
// describe both halves. `origin` is the exception: it names the producer and must
// stay `Thunderbird` here, otherwise the extension would claim to be the gateway.

const SHARED_KEYS = Object.keys(DEFAULTS).filter((key) => key !== "origin");

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  if (source.version != null) next.version = String(source.version).trim() || DEFAULTS.version;
  if (source.framework != null) next.framework = String(source.framework).trim() || DEFAULTS.framework;
  if (source.organization != null) {
    next.organization = String(source.organization).trim() || DEFAULTS.organization;
  }
  // `caseId` used to be dropped here: the field exists in the page and in every
  // DEFAULTS block, but an imported settings file silently lost its value.
  if (source.caseId != null) next.caseId = String(source.caseId).trim();
  if (source.pgpFingerprint != null) next.pgpFingerprint = normalizeFingerprint(source.pgpFingerprint);
  if (source.pgpSigner != null) {
    next.pgpSigner = String(source.pgpSigner).trim() || DEFAULTS.pgpSigner;
  }
  if (source.pgpStandard != null) {
    next.pgpStandard = String(source.pgpStandard).trim() || DEFAULTS.pgpStandard;
  }
  if (source.enableOts != null) next.enableOts = source.enableOts === true || source.enableOts === "true";
  if (source.enableReceipt != null) {
    next.enableReceipt = source.enableReceipt === true || source.enableReceipt === "true";
  }
  if (source.enableDeliveryReceipt != null) {
    next.enableDeliveryReceipt =
      source.enableDeliveryReceipt === true || source.enableDeliveryReceipt === "true";
  }
  // An imported file may name a mode this build does not know; keep the page usable
  // by ignoring it instead of writing a value the background script cannot honour.
  if (source.receiptMode != null) {
    const mode = String(source.receiptMode).trim();
    if (RECEIPT_MODES.indexOf(mode) !== -1) next.receiptMode = mode;
  }
  if (source.receiptAddress != null) next.receiptAddress = String(source.receiptAddress).trim();
  // An imported file may omit these or carry blanks; each one falls back to the shipped
  // value so a half-filled settings file cannot blank out the evidence chain. `algoExtra`
  // is deliberately allowed to become empty: it means "no extra hashes", which is a real
  // choice, whereas an empty `algoBody` would name no digest at all.
  if (source.messageIdDomain != null) {
    next.messageIdDomain = String(source.messageIdDomain).trim() || DEFAULTS.messageIdDomain;
  }
  if (source.manifestFilename != null) {
    next.manifestFilename = String(source.manifestFilename).trim() || DEFAULTS.manifestFilename;
  }
  if (source.manifestFramework != null) {
    next.manifestFramework = String(source.manifestFramework).trim() || DEFAULTS.manifestFramework;
  }
  if (source.manifestStandard != null) {
    next.manifestStandard = String(source.manifestStandard).trim() || DEFAULTS.manifestStandard;
  }
  if (source.algoBody != null) next.algoBody = String(source.algoBody).trim() || DEFAULTS.algoBody;
  if (source.algoExtra != null) next.algoExtra = String(source.algoExtra).trim();
  if (source.algoMerkle != null) {
    next.algoMerkle = String(source.algoMerkle).trim() || DEFAULTS.algoMerkle;
  }
  if (source.algoEngine != null) {
    next.algoEngine = String(source.algoEngine).trim() || DEFAULTS.algoEngine;
  }
  if (source.algoSignature != null) {
    next.algoSignature = String(source.algoSignature).trim() || DEFAULTS.algoSignature;
  }
  if (source.algoTimestamp != null) {
    next.algoTimestamp = String(source.algoTimestamp).trim() || DEFAULTS.algoTimestamp;
  }
  return next;
}

async function importSettings(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setStatus(t("notSettingsFile", error.message));
    return;
  }
  const incoming = normalizeSettings(parsed);
  const unknown = Object.keys(parsed || {}).filter(
    (key) => !Object.prototype.hasOwnProperty.call(DEFAULTS, key),
  );
  await browser.storage.local.set(incoming);
  await load();
  const applied = Object.keys(incoming).length;
  const extra = unknown.length ? ` (ignored: ${unknown.join(", ")})` : "";
  setStatus(t("imported", [applied, SHARED_KEYS.length, extra]));
}

async function exportSettings() {
  const stored = await browser.storage.local.get(DEFAULTS);
  const config = Object.assign({}, DEFAULTS, stored);
  // Same key order and shape as psemp-gateway/settings.default.json.
  const body = JSON.stringify(
    {
      version: config.version,
      framework: config.framework,
      origin: config.origin,
      organization: config.organization,
      caseId: config.caseId,
      pgpFingerprint: config.pgpFingerprint,
      pgpSigner: config.pgpSigner,
      pgpStandard: config.pgpStandard,
      enableOts: config.enableOts,
      enableReceipt: config.enableReceipt,
      enableDeliveryReceipt: config.enableDeliveryReceipt,
      receiptMode: config.receiptMode,
      receiptAddress: config.receiptAddress,
      messageIdDomain: config.messageIdDomain,
      manifestFilename: config.manifestFilename,
      manifestFramework: config.manifestFramework,
      manifestStandard: config.manifestStandard,
      algoBody: config.algoBody,
      algoExtra: config.algoExtra,
      algoMerkle: config.algoMerkle,
      algoEngine: config.algoEngine,
      algoSignature: config.algoSignature,
      algoTimestamp: config.algoTimestamp,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([`${body}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "settings.default.json";
  link.click();
  setStatus(t("exported"));
}

document.getElementById("importFile").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) importSettings(file);
  event.target.value = "";
});
document.getElementById("exportFile").addEventListener("click", exportSettings);
