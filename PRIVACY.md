# Privacy

**This project has no telemetry, no analytics, no update check and no remote endpoint.** Nothing about you or your mail leaves your machine unless you run a command that is explicitly designed to send something, and there is exactly one such command class (`stamp`/`stamp-sent`, which submits a digest to an OpenTimestamps calendar).

This file is about a different, more interesting question: **what the headers disclose to the people you send mail to**, because that is deliberate, permanent, and something you should decide with your eyes open.

---

## What is stored locally

The add-on keeps five settings in `thunderbird.storage.local`, inside your Thunderbird profile:

| Key | Default | Meaning |
| --- | --- | --- |
| `version` | `1.0` | framework version written to `X-PasevSU-Version` |
| `caseId` | `""` | optional case label; omitted when empty |
| `pgpFingerprint` | `""` | optional signer fingerprint claim; omitted when empty or invalid |
| `enableOts` | `true` | emit the `X-PasevSU-OTS: pending` marker |
| `enableReceipt` | `true` | set `returnReceipt` and emit `X-PasevSU-Receipt: requested` |

Two diagnostic keys may also appear — `psempSendCount`, `psempLastSend`, `psempManifestError`, `psempReceiptError` — which record that the listener fired and whether the manifest or the receipt address resolved. They exist because "did the add-on stamp this message?" is otherwise unanswerable from the Sent folder. They contain no message content: a timestamp, a count, an evidence id and a short error code.

All of it is local. `thunderbird.storage.local` is never synced anywhere by this add-on.

The gateway writes proofs under `psemp-gateway/data/`, which is git-ignored: manifests, `.ots` proofs, receipts, bundles. **That directory is case material.** It is not encrypted by this project; protect it the way you protect the mail itself.

---

## What every recipient learns

The headers are added to the message and are visible to the recipient, to every relay, and to anyone the message is later forwarded to (assuming nothing strips them — many corporate gateways do strip unknown `X-` headers, which is itself worth knowing).

| Disclosure | Detail | Can you turn it off? |
| --- | --- | --- |
| `X-PasevSU-Evidence-ID` | a UUID v4 unique to this message | no |
| `X-PasevSU-Body-SHA256` | a SHA-256 digest of the plain-text body | no |
| `X-PasevSU-Attachments-SHA256` | each attached file's **name** and digest | no |
| `X-PasevSU-Attachment-N` | the same per file, one header each | no |
| `X-PasevSU-Merkle-Root` | one digest over body + all files | no |
| `X-PasevSU-Message-ID` | a recognisable `<PasevSU.…@forensic.evidence.pasevsu>` id | no |
| `X-PasevSU-Sha256` | the readable digest block | no |
| `X-PasevSU-Cripto-Engine` | 25-digit code | no |
| `X-PasevSU-Cripto-title` | the same block, AES-256-GCM encrypted under that code | no |
| `X-PasevSU-Organization` | `PasevSU` | no |
| `X-PasevSU-WAR` | the no-forwarding / provenance statement | no |
| An extra attachment | `PasevSU_Manifest.json` — the full manifest | no |
| `X-PasevSU-Case-ID` | your case label | yes — leave the setting empty |
| `X-PasevSU-PGP-Fingerprint` | a signer fingerprint | yes — leave the setting empty |
| `X-PasevSU-OTS` | the word `pending` | yes — `enableOts` |
| `X-PasevSU-Receipt` | the word `requested`, plus the MDN field | yes — `enableReceipt` |

### Two things that deserve emphasis

**File names travel in the clear.** `X-PasevSU-Attachments-SHA256` lists `name=hash` pairs. The encrypted `Cripto-title` keeps them out of *plaintext header scanners*, but the code that decrypts it is in the same message, so it is obscurity, not secrecy. If an attachment's **name** is confidential, this project will disclose it.

**A digest is a fingerprint of content.** If the recipient already has a candidate document, `X-PasevSU-Body-SHA256` lets them confirm whether what they hold is what you sent. That is the feature. It also means a digest of a short, guessable body (a single word) can be brute-forced. Digesting the body is the core of the design and cannot be disabled.

---

## What the gateway sends

Only two commands reach the network, and both send a **digest**, never a message or a file:

- `stamp` / `stamp-sent` — submits a digest to the OpenTimestamps calendar servers configured by the client. The digest is what gets committed into a Bitcoin block, publicly and permanently. **A timestamped digest is public forever.** Use `--calendar` for a private calendar if that matters.
- `upgrade` — asks a calendar to extend a pending proof to a complete one. Same disclosure.

Everything else (`status`, `hash`, `evidence`, `eml`, `verify`, `sign`, `seal`, `pgp-info`, `pgp-check`, `package`, `self-test`, `receipts`, `check-sent`) is entirely local. `gpg`, when used, is a local process talking to your local keyring.

The gateway does not phone home, does not check for updates, and has no account, licence key or activation of any kind.

---

## Third parties that see something

| Party | Sees | Because |
| --- | --- | --- |
| Your mail provider / SMTP relay | the headers, the manifest attachment | they carry the message |
| The recipient's provider and client | the same, unless a gateway strips `X-` headers | delivery |
| The recipient, if they acknowledge | nothing extra — the MDN comes back to the address in `From` | you asked for a receipt |
| OpenTimestamps calendar servers | a digest, if you run `stamp` | anchoring |
| Nobody else | — | there is no other network call |

---

## Your obligations

These headers make a message **identifiable and traceable**, which is the point, but it is not always what the person you are writing to expects. If you use this for work:

- tell the people you correspond with that your mail carries provenance headers, or make sure your organisation's policy covers it;
- do not put a client's name, a patient identifier or a case number in `caseId` unless that label is already allowed to travel in mail headers;
- remember that a **forwarded** message may carry the headers onward even though the body says forwarding is forbidden — the headers cannot enforce anything, they only record;
- if you are handling personal data, the digest of an attachment plus its file name may itself be personal data in your jurisdiction.

---

## Removing your data

Uninstalling the add-on does not delete `thunderbird.storage.local`; remove the add-on, then clear its storage from Thunderbird's storage inspector, or delete the `storage` entry for the extension in the profile's `storage/default/` tree.

`psemp-gateway/data/` is a plain directory. Delete it to delete the local evidence. Deleting it does **not** revoke an OpenTimestamps proof — a committed digest is public and permanent by design, and neither this project nor anyone else can withdraw it.

---

## Summary

Local by default. No telemetry, ever. The headers you cannot switch off are the ones that make the message verifiable, and they are visible to your recipient — that is the trade, and it is the whole reason the project exists.
