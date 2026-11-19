# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) *within the add-on's own line*: `MAJOR.MINOR` must match `thunderbird-extension/manifest.json`, and the patch digit may move independently. `npm run check` enforces the match.

Two versions exist in the ecosystem and must not be confused:

- **the add-on** — `1.9`, this file's subject;
- **the hAPI Home Assistant add-on** — a separate product with its own numbering, not part of this repository.

---

## [Unreleased]

### Added

- **Delivery receipt (DSN, RFC 3461) as a real, configurable request.**
  `enableDeliveryReceipt` joins `enableReceipt` in the shared defaults
  (`thunderbird-extension/background.js`, `psemp-gateway/api.js`,
  `psemp-gateway/settings.default.json`) and gets its own checkbox in the options
  page, translated in all three locales — German uses the standard
  "Zustellbestätigung (DSN)". The listener now sets Thunderbird's native
  `deliveryStatusNotification` compose field, which is the only way to request a
  delivery receipt: the RFC 3461 header names are not admissible in
  `customHeaders` and writing them there made the platform reject the send
  details, so no delivery receipt had ever left the client.
- The two receipts are **independent**. The read receipt (MDN, RFC 8098) is
  answered by the recipient's mail client; the delivery receipt (DSN) is answered
  by the receiving server. Each is requested only when its own switch is on, so
  turning one off never silently turns the other off. The
  `X-PasevSU-Receipt: requested` marker is written when **either** switch is on.
- `psemp-gateway/test/extension-arming.cjs` grew a check asserting exactly that
  independence, plus an assertion that the delivery receipt is requested by
  default through the native field.
- **Every remaining hardcoded value is now a setting, in both engines.** Ten keys
  join the shared set — `messageIdDomain`, `manifestFilename`, `manifestFramework`,
  `manifestStandard`, `algoBody`, `algoExtra`, `algoMerkle`, `algoEngine`,
  `algoSignature`, `algoTimestamp` — so the options page holds twenty-three keys
  instead of thirteen, and `psemp-gateway/settings.default.json` describes the same
  twenty-three. Nothing that used to be a constant is now unreachable: the
  `Message-ID` domain, the name the manifest is attached under, the `framework`/
  `standard` words written inside the hashed manifest and the provenance block, and
  the six fields of the published `algorithms` object are all editable.
- **The defaults are byte-for-byte what the constants produced.** An install that
  never opens the options page writes the same `Message-ID`, the same attachment
  name and the same `algorithms` block as before, so no existing record stops
  verifying. `algoExtra` is the one field allowed to be empty — it publishes `[]`
  there, never a string.
- **Settings are sanitised where they become header text.** A newline typed into
  `pgpSigner` or `pgpStandard` is flattened to a space by the shared `warSafeText`,
  and characters that cannot appear in an attachment name are dropped from
  `manifestFilename` — a stored setting cannot inject a header or make every
  re-fired pass stamp the message again.
- `psemp-gateway/test/extension-arming.cjs` adds a fixture that renders the WAR
  wording from a **configured** signer and standard in both engines and compares
  the three output strings byte for byte, including the blank-field fallback and a
  hostile value containing `\r\n`. Two engines that agreed only on their defaults
  would still hand a verifier a footer the other one never wrote.
- **`install.ps1` now reports why a receipt may not come back, instead of pretending
  to configure it.** Two new output blocks:
  - `junk` lists the mailboxes that route junk mail and the
    `mail.server.<name>.spamLevel` each one carries, because a message Thunderbird
    has marked as junk never gets a read receipt: `msgHdrView.js:4396` returns
    before the `Disposition-Notification-To` header is even read, and no preference
    or add-on can override that. The only remedies are per message ("Mark As Not
    Junk", which writes `IS_HAM_SCORE` with origin `"user"`) or per sender (the
    account's whitelist), so the script reports the setting and leaves the decision
    to the operator.
  - `egress` prints each identity's outgoing server — read from
    `mail.smtpserver.<name>.hostname` / `.username`, which is where Thunderbird
    stores it — so a relay hop is visible. A relay that rewrites the envelope
    sender or `Return-Path` breaks SPF/DKIM/DMARC alignment for the receipt and the
    receiving side may discard it, which looks identical to "no one read it". The
    block says what it cannot know and gives three ranked remedies.
- The installer sets `mail.spam.manualMarkMode` to `0`, so a false positive stays
  visible in the Inbox instead of being moved to Junk.
- **`tools/check-repo.cjs` gained a tenth check**, so neither of the two defects
  above can come back unnoticed. It pins that the three `mail.spam.*` prefs are
  written through `Set-PrefLine`, that `useServerFilter` and `spamLevel` are
  **not** written, that the egress table reads `mail.smtpserver.<name>.` and never
  `mail.smtp.<name>.`, that the junk block still names `msgHdrView.js:4396`, and
  that `thunderbird-extension/README.md` states the current header-name count.
  Every one of those assertions describes a failure that was silent: the script
  printed a reassuring line while the profile disagreed.

### Fixed

- **The read-receipt label no longer claims to be a delivery receipt.** The
  options page, the German and Bulgarian catalogues and the protocol notes used
  one sentence for both mechanisms; they now name the standard each one uses.
- **`caseId` survives a settings import.** `normalizeSettings()` dropped it, so a
  case number typed on one machine silently vanished on another
  (`psemp-gateway/test/settings-parity.cjs` now asserts it travels).
- `psemp-gateway/api.js`: the `loadSettings()` comment claimed "the same six
  keys" were mirrored in the extension. It is ten, and the comment no longer
  states a number that can rot.
- **The installer's relay diagnostic had never printed a line.** It read the
  outgoing server from `mail.smtp.<name>.hostname`; Thunderbird stores it under
  `mail.smtpserver.<name>.hostname`, so the table stayed empty on every run and
  the warning it was supposed to raise was silently absent. A diagnostic that
  always agrees with the profile is worse than none.
- **Two `install.ps1` comments asserted semantics the source contradicts.**
  `mail.spam.manualMark` was presented as the switch that stops the spam filter
  from marking messages; per `msgHdrView.js:3826–3832` it only decides whether a
  message that is *already* junk is reloaded in place or moved/deleted, and the
  real classifier switch is `mail.server.<name>.spamLevel`. The comment on
  `mail.server.<name>.useServerFilter` claimed it suppressed junk marking, while
  the pref means "trust spam headers set by:" and can only *increase* tagging.
- **`psemp-gateway`'s sibling test `thunderbird-extension/tools/test-pref-rewrite.ps1`
  had been failing two of its nine checks ever since the rewrite started working.**
  Both assertions scanned the generated `user.js` for individually quoted
  `"X-PasevSU-…"` strings, but a *successful* compression collapses the readable
  array into one comma-separated value with a single pair of quotes around the
  whole list. The checks therefore returned zero names precisely when the rewrite
  was correct. They now read the names out of the pref value.
- `thunderbird-extension/README.md` said `user.js` registers "all fourteen" header
  names. It registers twenty-seven.
- **`Set-PrefLine` could delete the pref next to the one it was asked to rewrite.**
  Its value pattern ended in a greedy `[^\r\n]*\)`, so when two prefs shared a
  line it ran past the first `);` and replaced both with a single line. The
  condition is easy to reach: appending to a `user.js` that has no trailing
  newline glues the new pref onto the last one. Reproduced, then fixed twice over
  — the value match now refuses to cross a `user_pref(`, and any line holding two
  prefs is split before the line-anchored rewrites run. This was found while
  proving the `useServerFilter` retirement below: the glued leftover was being
  deleted here, uncounted, so a retirement of ten lines reported nine.
- **The first `useServerFilter` retirement under-reported what it removed**, for
  the reason above. It now reports the true count — ten of ten in the
  reproduction, twenty of twenty with the leftovers doubled.

### Changed

- `mail.server.<name>.useServerFilter` is **no longer written** by `install.ps1`.
  It is inert unless the account also sets `serverFilterName`
  (`modules/MsgIncomingServer.sys.mjs:1157` returns early, `:1162` returns again),
  no server in the shipped profile sets it, and where it does take effect it can
  only raise the junk score — the opposite of the intent. The value is now
  reported when present.
- The old relay heuristic (does the SMTP host end with the identity's domain?) is
  replaced by the `egress` table. The heuristic could not have worked even after
  the prefix fix: `mail.pasevsu-dev.com` ends with `pasevsu-dev.com`, so the one
  identity that does relay through it was the one identity it cleared.
- The installer still does not touch SMTP servers, `From:` addresses or
  `spamLevel`. Deciding to turn spam detection off stays the operator's decision,
  and the output says so.

---

## [1.9.0] — 2026-11-16

The first public release of the standalone repository. It publishes the two halves that had been developed together — the Thunderbird MailExtension and the `psemp-gateway` CLI — at the sibling paths they already used, so every cross-reference between them still resolves.

### The header contract

- **Twenty-seven `X-PasevSU-*` headers**, defined once in `psemp-gateway/api.js` as the frozen `HEADER_NAMES` object and registered for display in `thunderbird-extension/user.js`. `node tools/check-repo.cjs` asserts that all 27 names present in the engine also appear in the preference template, so a name added in one place cannot be forgotten in the other.
- **The headers are produced on every send, with no opt-in.** The listener is `compose.onBeforeSend`, it never returns `{ cancel: true }`, and the identity block (`Version`, `Framework`, `Origin`, `Organization`, `WAR`, `Evidence-ID`, `Body-SHA256`, `Attachments-Count`, `Manifest-SHA256`, `Merkle-Root`, `Message-ID`, `Sha256`, `Cripto-Engine`, `Cripto-title`) has no setting that disables it. This is the requirement the project exists to satisfy: *трябва да се създават стандартно винаги*.
- **`X-PasevSU-Attachments-Count` is always emitted**, including `0`. Without it, a recipient cannot distinguish an add-on that failed to hash the files from a message that genuinely had none.
- **One header per attachment** (`X-PasevSU-Attachment-1` … `-N`) alongside the comma-separated list, because a long list is truncated or folded by some clients and mail gates, silently losing its tail.
- **`X-PasevSU-Attachments-Error`** is written instead of a digest list when files were attached but none could be read, so a broken chain never looks like a complete one.

### Digests and the Merkle root

- Body digest is SHA-256 over the UTF-8 plain-text body (Web Crypto, inside the add-on).
- Every attachment is read through `compose.getAttachmentFile()`, hashed inside its own `try`/`catch`, and an unreadable file never aborts the send.
- The Merkle root is built over the sorted hex leaves (body first, then attachments), duplicating the last leaf on an odd count, so the root is independent of attachment order but changes if a file is swapped or renamed.
- `X-PasevSU-Cripto-Engine` is a 25-digit code derived from the Merkle root and the body digest; `X-PasevSU-Cripto-title` is the digest block encrypted under that code with AES-256-GCM, so file names and digests stay out of plaintext header scanners while remaining recoverable by anyone holding the message.

### Delivery receipts

- `details.returnReceipt = true` on every send, so Thunderbird writes the standard `Disposition-Notification-To` field itself — a MailExtension may not write it, and attempting to would abort the send.
- `X-PasevSU-Receipt: requested` marks the intent. `psemp-gateway receipts` matches returned MDNs back to the message, reports one acknowledgement once however many folders its copies occupy, and reports an absent one as **unknown**, never as non-delivery.
- The feature is on by default. The `enableReceipt` switch exists for accounts where a receipt request is unwanted, not to make the user opt in.

### OpenPGP and OpenTimestamps

- **PGP signing is stated, not faked.** `X-PasevSU-PGP-Fingerprint` is a *claim*; Thunderbird's own End-to-End Encryption settings apply the signature, and `psemp-gateway pgp-check` compares the claim with the signer actually found in the delivered message. A typed key-id where a fingerprint belongs is logged and omitted rather than published as noise.
- **`X-PasevSU-OTS: pending` is a marker only.** A MailExtension cannot reach the network, write a file, or read a keyring, so the real proof comes from `psemp-gateway stamp` / `stamp-sent` / `seal`. Enabled by default; the marker is honest about being pending.
- **`psemp-gateway seal`** fills the SHA3-512 slots and produces the OpenPGP seal over the evidence, which Web Crypto cannot compute.

### Replay defence and cryptographic time (PSEMP 1.1)

- `Nonce` (single-use, 128 bits), `Sequence` (monotonic per sender), `Created`/`Expires` (a bounded freshness window that says nothing about integrity — the Merkle root, PGP seal and OTS proof never expire), `Canary` (a derived `PASEVSU-YYYY-MM-DD-XXXXXXXX` leak-tracing token), and `Headers-SHA256` (a digest over Subject/From/To/Date/Message-ID and the attachment set, so a signature cannot be reused under a different subject or with a file swapped).

### Long values

- Header values over 900 octets are split into `<name>`, `<name>-C2`, … plus `<name>-Chunks: N`, because RFC 5322 §2.1.1 caps a line at 998 octets and nothing in the delivery chain folds a custom header for us. A 14-attachment digest block measured 1 853 characters on one line and made the send abort; that is why the budget exists.

### The gateway CLI

- `status` · `hash` · `evidence` · `eml` · `stamp-sent` · `receipts` · `stamp` · `verify` · `upgrade` · `sign` · `verify-sig` · `seal` · `pgp-info` · `pgp-check` · `package` · `self-test`.
- Node ≥ 20, **zero runtime dependencies**; the crypto and OpenTimestamps code is vendored under `packages/` so forensic work needs no `npm install` and no network at run time.
- `gpg` is located even when it is not on `PATH` (Git for Windows ships it under `usr/bin`), and is invoked with relative paths and a working directory, because an MSYS gpg mis-parses an absolute Windows `--homedir`.

### Install and verification tools

- `thunderbird-extension/tools/install.ps1` — builds the `.xpi`, installs it, and writes the 27 header names into the profile's `user.js` so Thunderbird also *displays* them. Exits `2` rather than fighting a locked file.
- `psemp-gateway/tools/verify-install.cjs` — answers "is the loaded add-on the source in this repository?".
- `psemp-gateway/tools/check-sent.cjs` — answers "did the message I actually sent carry the headers, the signature, and were the files *inside* the signature?".
- `psemp-gateway/tools/check-receipts.cjs` — answers "did an acknowledgement come back, and for which message?".
- `tools/check-repo.cjs` — the repository's only gate: LF everywhere, JSON parses, add-on version matches `package.json`, the manifest satisfies the MailExtension contract, all 27 names registered, **no Node built-ins in add-on code**, the three locales define the same messages, and the gateway declares no dependencies. 8 checks, all green.

### Documentation

- `README.md`, `HEADERS.md` (the 27-name reference with verification commands), `INSTALL.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- `docs/CLI.md`, `docs/VERIFICATION.md`, `docs/THREAT-MODEL.md`.
- `psemp-gateway/PROTOCOL.md` — the normative PSEMP 1.1 specification.
- Localisation for the add-on in **English, Bulgarian and German** (40 messages each, checked for parity).

### Fixed before publication

- The documentation and the `user.js` template no longer name a specific local Thunderbird profile directory; they use `xxxxxxxx.default-esr`, so the published tree carries no machine-specific path.
- Profile-id leakage was removed from `thunderbird-extension/README.md` and `psemp-gateway/README.md` in the same change.

### Known limitations, stated plainly

- A MailExtension cannot sign, anchor or write files. PGP signing is Thunderbird's job; OpenTimestamps anchoring is the gateway's.
- A delivery receipt is a request, not a guarantee. A recipient client may ignore it and a gateway may strip it.
- The freshness window limits how long a copy is a *currently-issued statement*; it weakens nothing that proves integrity.
- The add-on runs on Thunderbird 115 or newer. It has been exercised on 115 ESR and later; older releases are not supported and the manifest says so.

---

## Versioning policy

- **Patch** (`1.9.x`) — a fix that changes no header name, no header meaning, and no stored setting.
- **Minor** (`1.x.0`) — a new header, a new CLI command, a new setting, or a change in the bundle's structure.
- **Major** (`2.0.0`) — a header renamed or removed, a digest definition changed, or a manifest requirement change. Anything that would make a previously captured message verify differently is a major change.

`thunderbird-extension/manifest.json` carries `MAJOR.MINOR` only, because Thunderbird compares versions loosely; `package.json` carries the full triple and is the authority for the patch digit.
