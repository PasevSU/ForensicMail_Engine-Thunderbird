# Header reference

Twenty-seven headers, defined once in `psemp-gateway/api.js` as the frozen `HEADER_NAMES` object, registered for display by `thunderbird-extension/user.js`, and emitted by both engines.

The **order** below is the injection order and is a contract: `psemp-gateway/test/extension-arming.cjs` compares the two engines' output, and the options page and the README table are written against this sequence. New headers are appended, never interleaved, so an older reader keeps finding what it expects where it expects it.

Nothing in this table is a setting except where the "When" column says so. **The identity block cannot be turned off** — that is the requirement the project exists to satisfy.

---

## 1. Identity and statement

| # | Header | Value | When |
| --- | --- | --- | --- |
| 1 | `X-PasevSU-Version` | framework version, default `1.0` | always |
| 2 | `X-PasevSU-Build` | gateway/add-on build id | always, when a build id resolves |
| 3 | `X-PasevSU-Framework` | `Forensic-Mail` | always |
| 4 | `X-PasevSU-Origin` | `Thunderbird` in the add-on, `PSEMP-Gateway` in the CLI | always |
| 5 | `X-PasevSU-Organization` | `PasevSU` | always |
| 6 | `X-PasevSU-WAR` | the no-forwarding / provenance statement (below) | always |
| 7 | `X-PasevSU-Evidence-ID` | UUID v4, one per message | always |
| 8 | `X-PasevSU-Case-ID` | your case label, sanitised | only when configured |

### `X-PasevSU-WAR`

Fixed, ASCII-only, never configurable. The value is the same in both engines byte for byte:

```
An email that does not carry the OpenPGP/MIME signed message (RFC 4880 and 3156)
signature made with the PGP key registered to pasevdenislav@gmail.com is not ours.
Only that signature proves our identity and preserves the integrity of the message.
FORWARDING THIS EMAIL IS STRICTLY FORBIDDEN AND IS STATED EXPLICITLY IN THE EMAIL
BODY. {{ PasevSU-WAR }}
```

(Shown wrapped for reading; on the wire it is one line.)

It is a **requirement, not a claim**: the add-on does not sign anything — Thunderbird's built-in OpenPGP does, per identity — so the header names the signature that would prove the message instead of asserting that one is attached.

The same `{{ PasevSU-WAR }}` marker closes the Subject and appears in a plain-text notice in the body. The gateway, which composes the whole message, also emits the unprefixed `PasevSU-WAR:` twin; a MailExtension cannot, because `ComposeDetails.customHeaders` rejects any name that does not start with `X-` and a rejected call aborts the send.

---

## 2. Digests

| # | Header | Value | When |
| --- | --- | --- | --- |
| 9 | `X-PasevSU-Body-SHA256` | 64 hex chars: SHA-256 of the plain-text body | always |
| 10 | `X-PasevSU-Attachments-Count` | decimal count, including `0` | always |
| 11 | `X-PasevSU-Attachments-SHA256` | comma-separated `name=hash` | only when files are present |
| 12 | `X-PasevSU-Attachments-Error` | comma-separated `name=reason` | only when files were attached but none could be read |
| 13 | `X-PasevSU-Manifest-SHA256` | 64 hex chars: digest of the manifest text | always |
| 14 | `X-PasevSU-Merkle-Root` | 64 hex chars: root over body + every attachment | always |

### Why the count is always emitted

`X-PasevSU-Attachments-Count: 0` is a **signed claim** that the message carried no files. Without it, a recipient who sees no attachment list cannot tell an add-on that failed to hash the files from a message that genuinely had none. This was a reported defect — "the attachment hashes are missing" was unanswerable from the headers alone — and the count is the answer.

### The `name=hash` list

- `name` passes through `headerToken()`: commas and `=` become `_`, and any byte outside printable ASCII is percent-encoded as `%XX`. A Cyrillic filename therefore cannot push an 8-bit byte onto the wire (RFC 5322 §2.1.1) and cannot forge a row boundary.
- `hash` is lowercase hex, 64 characters.
- One `X-PasevSU-Attachment-1` … `-N` header is emitted **per file as well**, in the same order. A long comma list is truncated or folded by some clients and mail gates, and a folded list loses its tail silently; the per-file headers survive that.

### The Merkle root, exactly

1. Hex-encode every leaf digest: the body first, then each attachment in listed order.
2. Sort the hex strings ascending.
3. If one leaf remains, that is the root. Otherwise, repeat: concatenate adjacent pairs and SHA-256 each pair; an odd last leaf is **duplicated** before hashing.
4. Hex-encode the final digest.

The result is independent of attachment order but changes when a file is renamed or swapped. Both engines implement this identically and `extension-arming.cjs` proves it.

---

## 3. Signing claim and markers

| # | Header | Value | When |
| --- | --- | --- | --- |
| 15 | `X-PasevSU-PGP-Fingerprint` | normalised fingerprint (`ABCD 1234 …`) | only when configured **and** valid |
| 16 | `X-PasevSU-OTS` | the literal `pending` | when `enableOts`, default **on** |
| 17 | `X-PasevSU-Receipt` | the literal `requested` | when `enableReceipt` **and** a receipt address resolves, default **on** |
| 18 | `X-PasevSU-Message-ID` | `<PasevSU.<stamp>.<evidence>+<a>_<b>~<c>.<d>@forensic.evidence.pasevsu>` | always |

### `X-PasevSU-PGP-Fingerprint` is a claim

The MailExtension cannot read Thunderbird's keyring and cannot sign. This header records what the sender *says* Thunderbird signs with. The signature itself is applied by Thunderbird when *Digitally sign messages* is enabled for the identity, and:

```bash
node psemp-gateway/cli.js pgp-check <message.eml>
```

compares the claim against the signer actually found in the delivered message. That comparison is the verification; the header alone proves nothing.

A typed key-id where a 40-hex fingerprint belongs is treated as an error: it is written to the console and to the options page, and the header is **omitted**. Publishing "there is a claim" when the claim is malformed is worse than publishing nothing.

### `X-PasevSU-OTS: pending` is a marker

There is no OpenTimestamps inside a MailExtension — no filesystem, no HTTP, no binary to run. The header states the intent, and `psemp-gateway stamp` / `stamp-sent` produce the real `.ots` proof from the sent message.

```bash
node psemp-gateway/cli.js stamp-sent --profile "<profile dir>"
```

### `X-PasevSU-Receipt: requested`

The real request is the standard `Disposition-Notification-To` field (RFC 8098), and **Thunderbird writes it itself** when `ComposeDetails.returnReceipt` is true. It cannot be written through `customHeaders`: the name is rejected by the platform and the message would never be sent at all. So the add-on sets the boolean, and this header marks what was asked for.

A receipt is a request, not a guarantee — see [`PRIVACY.md`](PRIVACY.md) and [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## 4. The digest block

| # | Header | Value | When |
| --- | --- | --- | --- |
| 19 | `X-PasevSU-Sha256` | readable digest block, one comma-separated line | always |
| 20 | `X-PasevSU-Cripto-Engine` | exactly 25 decimal digits | always |
| 21 | `X-PasevSU-Cripto-title` | `gcm1.<iv>.<tag>.<ciphertext>` (base64url) | always |

**The block** is, in this order, on one line with `,` as the row separator:

```
body - <body hash>,<name> - <hash>,…,timestep - <ISO 8601 timestamp>
```

It is one line rather than a folded block on purpose: `customHeaders` carries `Name: value` strings and the `header-injection-safety` self-test rejects CR/LF, so a literal folded block would be undefined behaviour. `headerToken()` escapes `,` and `=` out of file names, so the rows stay unambiguous.

**The engine code** is 96 bits of `SHA-256("PasevSU-Cripto-Engine:v1|<merkle>|<body>")` reduced modulo 10²⁵, which always lands inside 25 digits.

**The title** encrypts the block with AES-256-GCM under a key derived from that code, with the IV derived from the code and the Merkle root — deterministic, so both engines agree.

> **This is not confidentiality against the recipient.** The code travels in the same message. The encryption keeps file names and digests out of plaintext header scanners while remaining recoverable by anyone holding the message. Anyone with the message can decrypt it, and that is the intent.

---

## 5. Replay defence and cryptographic time (PSEMP 1.1)

| # | Header | Value | When |
| --- | --- | --- | --- |
| 22 | `X-PasevSU-Created` | ISO 8601 issue time | always |
| 23 | `X-PasevSU-Expires` | ISO 8601, `Created` + 3600 s by default | always |
| 24 | `X-PasevSU-Nonce` | 128 bits, hex, single-use | always |
| 25 | `X-PasevSU-Sequence` | monotonic per sender, integer | always |
| 26 | `X-PasevSU-Canary` | `PASEVSU-YYYY-MM-DD-XXXXXXXX` | always |
| 27 | `X-PasevSU-Headers-SHA256` | 64 hex chars over the signed metadata | always |

- **Nonce + Sequence** — a message already accepted cannot be accepted again. Randomness makes a guess hopeless; a monotonic sequence makes a *deliberate* rollback visible even if a nonce is reused.
- **Created / Expires** — bounds how long a copy is a *currently-issued statement*. **Expiry weakens nothing that proves integrity:** the Merkle root, the PGP seal and the OTS proof remain valid forever.
- **Canary** — derived, never random: `SHA-256("PasevSU-Canary:v1|<org>|<day>|<sequence>|<nonce>")`, first 8 hex characters uppercased. It traces a leak to the copy it came from without putting fabricated documents into evidence.
- **Headers-SHA256** — the digest of `{subject, from, to, date, message_id, attachments_sha256}`, where `attachments_sha256` hashes the *sorted* `[filename, hash]` pairs. A signature over the body alone would let someone re-send the same signed body under a new subject or with a file swapped.

---

## Long values: `-C2` and `-Chunks`

RFC 5322 §2.1.1 caps a header line at 998 octets and **nothing in the delivery chain folds a custom header for us** — Thunderbird's `sanitizeCustomHeaderValue` is a bare `.trim()`. A 14-attachment digest block measured 1 853 characters on one line and made the send abort. The budget is therefore 900 octets per value, and an over-long value is split:

```
X-PasevSU-Attachments-SHA256: <first 900, cut on a ',' boundary>
X-PasevSU-Attachments-SHA256-C2: <next part>
X-PasevSU-Attachments-SHA256-C3: <next part>
X-PasevSU-Attachments-SHA256-Chunks: 3
```

Concatenating the parts **in order** restores the value byte for byte. The split prefers a `,` row boundary when that keeps a piece at least half full, so a reader that understands only the first line still sees a whole number of rows. A value that fits is returned untouched and gets no `-Chunks` header.

Any parser must therefore reconstruct `<name>` from `<name>`, `<name>-C2`, … when `<name>-Chunks` is present. Splitting **must not** be treated as several independent values.

---

## Header names on the wire vs. in the bundle

A MailExtension may only write names starting with `X-`. This has three consequences visible in the headers:

| Field | On the live Thunderbird path | In the gateway's bundle |
| --- | --- | --- |
| `Message-ID` | only `X-PasevSU-Message-ID` | both `Message-ID:` and the `X-` twin |
| `PasevSU-WAR` | only `X-PasevSU-WAR` | both |
| `Disposition-Notification-To` | written by Thunderbird from `returnReceipt = true` | both, when a receipt address resolves |

The gateway has no transport of its own, so its unprefixed lines exist in the generated bundle (`.eml`), not on the wire. This is a platform difference, documented rather than papered over.

---

## Verifying a received message

```bash
# 1. Headers + manifest for a body file, recomputed independently
node psemp-gateway/cli.js evidence body.txt

# 2. Evidence object for a received message
node psemp-gateway/cli.js eml <message.eml>

# 3. Recompute one leaf digest (algo: sha256|sha384|sha512|sha224|sha3|sha3-256|sha3-512|ripemd160)
node psemp-gateway/cli.js hash sha256 <file>

# 4. Is the signer claim true?
node psemp-gateway/cli.js pgp-check <message.eml>
node psemp-gateway/cli.js pgp-info  <message.eml>   # who actually signed it

# 5. Does an OpenTimestamps proof exist, and does it verify?
node psemp-gateway/cli.js verify <proof.ots>
node psemp-gateway/cli.js upgrade <proof.ots>       # try to complete a pending proof

# 6. Did an acknowledgement come back?
node psemp-gateway/cli.js receipts --profile "<profile dir>"
```

`verify` reports each check separately and never collapses "no claim to compare" into "verified". Read the per-check output, not only the exit code.

---

## Adding a header

1. A key in `HEADER_NAMES` (`psemp-gateway/api.js`).
2. Emission in `buildHeaderLines` (gateway) **and** `buildHeaders` (`thunderbird-extension/background.js`), in the same position.
3. A line in `thunderbird-extension/user.js`.
4. A row in this file and in the `README.md` table.
5. A case in `psemp-gateway/test/extension-arming.cjs` proving both engines agree.

`node tools/check-repo.cjs` enforces 3; the suite enforces 2 and 5. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
