# Architecture

Why the system is cut into two halves, and why the cut is exactly there. Read this before proposing a change that moves work from one side to the other.

---

## The constraint that decides everything

A Thunderbird MailExtension is an ordinary WebExtension: it may call `browser.*` APIs and use Web Crypto, and nothing else.

| Capability | Inside a MailExtension | Why |
| --- | --- | --- |
| SHA-256 of in-memory bytes | **yes** — `crypto.subtle.digest` | Web Crypto is a browser API |
| Read a compose attachment | **yes** — `compose.getAttachmentFile(id)` | part of the compose API, returns a `File` |
| Add headers to an outgoing message | **yes** — `ComposeDetails.customHeaders` | the reason this design is possible at all |
| **Sign** the message | **no** | the OpenPGP stack needs Thunderbird's keyring and its internal MIME layer |
| **OpenTimestamps** an artefact | **no** | needs a filesystem, HTTP to public calendars, and a `.ots` binary |
| Run `gpg` | **no** | no process spawning |
| Read the keyring | **no** | no API exposes it |
| Collect a **delivery receipt** | **no** | the receipt is an inbound message, and only a mailbox can read one |

That table is the whole architecture. Everything that *can* run in the sandbox does — hashing, the Merkle root, the header block. Everything that cannot is delegated, and each delegation leaves a **marker** so the gap is visible in the message rather than hidden.

```
┌──────────────────────────────────────────────────────────────┐
│ Thunderbird (ESR 115+)                                       │
│                                                              │
│  compose.onBeforeSend  ──────────────────────────────────┐   │
│      │                                                   │   │
│      │  background.js  (sandboxed MailExtension)         │   │
│      │    · body SHA-256      ← crypto.subtle            │   │
│      │    · per-file SHA-256  ← compose.getAttachmentFile│   │
│      │    · Merkle root                                  │   │
│      │    · 27 header values                             │   │
│      │    · manifest as attachment                       │   │
│      ▼                                                   │   │
│  mergeCustomHeaders()  → send proceeds with headers      │   │
└──────────────────────────────────────────────────────────┼───┘
                                                           │
                                        SMTP               │
                                                           ▼
                                                  recipient mailbox
                                                           │
             ┌─────────────────────────────────────────────┘
             │  the message that arrived
             ▼
┌──────────────────────────────────────────────────────────────┐
│ psemp-gateway  (plain Node, no dependencies)                 │
│                                                              │
│   seal / stamp        real OpenTimestamps anchoring          │
│   sign / verify-sig   real OpenPGP detached signature         │
│   pgp-check           compare the header claim to the signer  │
│   verify              recompute every digest                  │
│   receipts            collect and match acknowledgements      │
└──────────────────────────────────────────────────────────────┘
```

The gateway never has a **transport** of its own. It reads and writes files — `.eml`, `.ots`, `.json`. It cannot send. That asymmetry is deliberate: nothing in the verification path can quietly alter a message in flight.

---

## The two halves

### `thunderbird-extension/` — the producer

| File | Role |
| --- | --- |
| `manifest.json` | MV2, `strict_min_version: 115.0`, permissions `compose` + `storage` |
| `background.js` | the whole engine: `compose.onBeforeSend`, digests, Merkle root, 27 headers, attachment manifest, `returnReceipt = true`, breadcrumbs in `storage.local` |
| `options.html` / `options.js` | the five settings and the **Armed** self-check |
| `_locales/{en,bg,de}` | 40 messages each; `manifest.json` uses `__MSG_*__` placeholders |
| `user.js` | the preference template: registers all 27 names for display |
| `tools/install.ps1` | packing, install, hash verification, pref generation |

Design rules that hold inside this folder:

- **No `require()`, no Node built-ins.** `tools/check-repo.cjs` fails the build on it. `require` is not defined in a WebExtension; a stray one is a runtime `ReferenceError` at the worst possible moment.
- **Every listener returns `{ details }`, never `{ cancel: true }`, and never throws.** A failed hash must cost you a header, not your message.
- **`mergeCustomHeaders` removes only our own earlier copies.** Compose can fire the listener more than once for one send; duplicating a header makes Thunderbird reject the whole `setComposeDetails` call. Foreign headers are never touched.

### `psemp-gateway/` — the prover

| File | Role |
| --- | --- |
| `api.js` | the shared engine: `HEADER_NAMES`, sanitisers, digest block, engine code, replay, chunking |
| `cli.js` | the 16 commands |
| `packages/` | vendored dependencies (two of them LGPL-3.0 — see [`THIRD_PARTY.md`](THIRD_PARTY.md)) |
| `test/` | 13 suites, each proving one contract |
| `tools/check-sent.cjs` | inspect what Thunderbird actually sent, including signature coverage |
| `tools/check-receipts.cjs` | collect and match receipts |

**`api.js` is the single source of truth for header names and value formats.** The two engines must not disagree, so `test/extension-arming.cjs` computes the same message through both and compares byte for byte. When it fails, the fix is to make one side match the other — never to relax the test.

---

## Three decisions worth understanding

### 1. Why `ComposeDetails.attachments` is not trusted

`ComposeDetails.attachments` is documented as **input-only**, and in `onBeforeSend` it returns an **empty list** even when the message carries files. Measured failure mode when this was missed: zero attachments in the manifest, no `X-PasevSU-Attachments-SHA256`, and every other check still green — a silent hole exactly where the evidence was strongest.

The attachment list therefore comes from `compose.listAttachments(tab.id)`, with the `details.attachments` snapshot kept only as a fallback.

### 2. Why the manifest becomes a real attachment

Each send attaches `PasevSU_Manifest.json` via `compose.addAttachment`: the evidence id, the case id, every leaf hash, the Merkle root, the timestamp. Two reasons:

- A header line can be truncated or folded somewhere in the delivery chain; an attachment is preserved as bytes, and can be hashed.
- The manifest includes the timestamp, which the headers do not, so the artefact is self-contained.

It is deliberately **excluded** from the attachment hash list and from the Merkle root. Including it would be circular: the manifest contains the root.

### 3. Why header order is a contract

Headers are appended in a fixed sequence and new ones go at the end. An older reader — a script, a mail rule, a person with a checklist — keeps finding what it expects where it expects it. Interleaving a header in the middle silently breaks every positional parser downstream, and those parsers are the ones handling evidence.

---

## The units of truth

| Question | Authoritative source |
| --- | --- |
| Which headers exist, in what order | `HEADER_NAMES` in `psemp-gateway/api.js` |
| What is on the wire from Thunderbird | `thunderbird-extension/background.js` |
| Which names Thunderbird is allowed to keep | `thunderbird-extension/user.js`, generated by `install.ps1` |
| What a header means | [`HEADERS.md`](HEADERS.md) |
| What we claim about the platform | [`README.md`](README.md), the limitations table |
| What a dependency obliges us to | [`THIRD_PARTY.md`](THIRD_PARTY.md), [`NOTICE`](NOTICE) |

`node tools/check-repo.cjs` cross-checks the first three. Nothing else is allowed to become a fourth copy of the header list.

---

## Failure behaviour

The design rule is: **a degraded message is always better than an unsent one**, and every degradation must be visible in the message itself.

| Failure | Behaviour |
| --- | --- |
| body unreadable | body hash omitted; the rest still emitted |
| one attachment unreadable | that leaf omitted, `X-PasevSU-Attachments-Error` names it and the reason; other files still hashed |
| all attachments unreadable | count still emitted, error header explains |
| hash computation throws | the whole listener catches, returns `{ details }` unchanged, send proceeds |
| value longer than 900 octets | split into `-C2`… with `-Chunks: N` — **never truncated silently** |
| malformed PGP fingerprint | header omitted, error surfaced in the options page |
| Thunderbird rejects a header name | prevented by construction: every name starts with `X-` |

The one thing that must never happen is a message that **looks** complete and is not. That is why `Attachments-Count` is emitted even as `0`, and why a rejected fingerprint is omitted rather than written as-is.

---

## What this architecture does not do

- **It does not make the message confidential.** Digests are fingerprints, not encryption. The `Cripto-title` block is readable by anyone holding the message.
- **It does not prove the sender's identity.** Only the OpenPGP signature does, and Thunderbird applies that, not this add-on.
- **It does not prove delivery.** `X-PasevSU-Receipt: requested` records a request. A receipt that never arrives proves nothing — see [`docs/VERIFICATION.md`](docs/VERIFICATION.md).
- **It does not stop a recipient from editing the message.** It makes edits *detectable* to someone who has the original.
- **It is not a notary.** A `pending` OTS marker is an intention; only a `.ots` proof anchored in the Bitcoin chain is evidence, and that is produced out of band.

Full threat model: [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).
