# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) *within the add-on's own line*: `MAJOR.MINOR` must match `thunderbird-extension/manifest.json`, and the patch digit may move independently. `npm run check` enforces the match.

Two versions exist in the ecosystem and must not be confused:

- **the add-on** — `1.9`, this file's subject;
- **the hAPI Home Assistant add-on** — a separate product with its own numbering, not part of this repository.

---

## [Unreleased]

Nothing yet.

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
