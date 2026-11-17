# Verification

How to check a claim this project makes, one claim at a time.

Read this before trusting anything, including the README. The whole premise of the project is that a header is a **claim** and a digest is only worth the recomputation you performed yourself.

---

## The one rule

> **Nothing is verified because a tool said so. It is verified because you recomputed it from the bytes you hold, and the numbers matched.**

Every command below exists to let you do that. Anything that reports a result without giving you the inputs is a summary, not a verification.

---

## Level 0 — is it installed at all?

```bash
node psemp-gateway/tools/verify-install.cjs
```

This answers four separate questions and reports them separately:

| Check | Fails when |
| --- | --- |
| the `.xpi` is in `<profile>/extensions/` | installed manually somewhere else, or never installed |
| the add-on is **enabled** | `extensions.autoDisableScopes` re-disabled it |
| `user.js` registers all 27 names | an older profile, or a manual install that skipped `user.js` |
| the versions agree | `manifest.json` and what is installed diverge |

The third check is the one that matters most in practice. A profile whose `user.js` lists fewer than 27 names produces messages **with no headers and no error** — Thunderbird accepts the header strings and drops the ones it has not been told to keep. Every other check stays green while the feature does nothing.

If `verify-install` fails on the `user.js` count, run the installer again; it regenerates the list from `background.js`.

---

## Level 1 — did the headers actually leave?

Send one message **with at least one attachment**. Then inspect the **raw source**, not the message pane: select the message → **More (⋮) → View Source** (`Ctrl+U`), or in the CLI, a saved `.eml`.

```bash
node psemp-gateway/tools/check-sent.cjs "<profile dir>"
```

This reads the Sent folder and reports what Thunderbird actually stored. The critical output is **signature coverage**.

### "Signed" and "the body is inside the signature" are different claims

A message can be signed and still leave your attachments outside the signed part — the signature then protects an empty or near-empty payload while the files travel unsigned beside it. This is the actual answer to the complaint *"the whole mail is not signed"*.

`check-sent.cjs` resolves it with a containment test:

```js
const covered =
  scope.topLevelSigned &&          // the signed part is the outermost one
  scope.outside.length === 0 &&    // no payload part sits outside it
  (scope.all.length === 0 || scope.inside.length > 0);
```

It fails, with an explicit reason, when:

- **the signed part is nested inside `multipart/mixed`** — the files are covered by nothing at all;
- **parts sit outside the signed part** — they are named in the report;
- **nothing is inside and nothing is outside** — a vacuous pass, which would otherwise report success on a message with no payload at all.

The vacuous case is checked deliberately. A containment test that filters every named part out of `outside` would report "fully covered" for a message that contains nothing. That is the shape of bug this project exists to find, so the check refuses to be fooled by it.

```bash
node psemp-gateway/tools/check-sent.cjs --only 3    # one message
node psemp-gateway/tools/check-sent.cjs --all       # every message it can read
```

---

## Level 2 — do the digests hold?

This is the only verification that is entirely in your hands.

### The body

```bash
node psemp-gateway/cli.js hash sha256 body.txt
```

Compare with `X-PasevSU-Body-SHA256` in the raw source. They must match **character for character** — lowercase hex, 64 characters.

**When they do not match**, the cause is almost always that the body you hashed is not the body that was sent. Thunderbird converts between HTML and plain text at send time, and `isPlainText` decides which of `details.body` / `details.plainTextBody` the add-on hashed. Before reporting a bug:

1. Confirm which composition mode the message was written in (plain-text or HTML).
2. Save the body **as sent** — from the raw source, decoding the transfer encoding — not from your editor.
3. Recompute on those exact bytes, including trailing newlines.

A whitespace-only difference produces a completely different digest, which is correct behaviour for a hash and is not a defect.

### An attachment

```bash
node psemp-gateway/cli.js hash sha256 report.pdf
```

Compare with the `report.pdf=` entry in `X-PasevSU-Attachments-SHA256`, or with `X-PasevSU-Attachment-1`.

Use the file **as received**, not your original. If the delivery chain re-encoded the attachment, the digest will differ, and that difference is a finding rather than a tool failure.

### The Merkle root

Recompute it yourself. The algorithm is short enough to check by hand, and that is intentional:

1. Hex-encode the leaves: body hash first, then each attachment hash.
2. **Sort the hex strings ascending.** Not the file names — the hashes.
3. If one leaf remains, that is the root. Otherwise: concatenate adjacent pairs, SHA-256 each; **duplicate the last leaf if odd**.
4. Repeat until one digest remains; hex-encode it.

A root that matches proves the *set* of leaves is intact and in the order the algorithm defines — independent of the order the files were attached, which is why sorting is part of the definition.

### The whole record at once

```bash
node psemp-gateway/cli.js eml received.eml --out manifest.json
```

Builds the evidence object from a delivered message. Diff it against the `PasevSU_Manifest.json` attachment that came with the message. Two independently produced records that agree are worth more than either alone.

---

## Level 3 — is the sender who they claim?

```bash
node psemp-gateway/cli.js pgp-info  received.eml
node psemp-gateway/cli.js pgp-check received.eml
```

- **`pgp-info`** reports the signer found in the message — a fact read from the signature.
- **`pgp-check`** compares that fact with the `X-PasevSU-PGP-Fingerprint` **claim**.

Three outcomes, and they mean different things:

| Outcome | Meaning |
| --- | --- |
| claim and signer agree | the header did not lie, and the message carries a signature by that key |
| claim and signer **disagree** | a real finding — either the wrong key signed or the header is stale |
| no signature present | **nothing was verified.** The header is a claim about a signature that is not there. |

The third case must never be read as "passed". This add-on cannot sign; Thunderbird does, and only when *Digitally sign messages* is enabled for the identity. A message from a mis-configured identity is unsigned and the header still says which key it *would* have used.

A malformed fingerprint — a key id where 40 hex characters belong — is omitted entirely rather than written. A missing header is honest; a wrong one is not.

---

## Level 4 — is there cryptographic time?

```bash
node psemp-gateway/cli.js stamp-sent --profile "<profile dir>"
node psemp-gateway/cli.js verify <proof.ots>
node psemp-gateway/cli.js upgrade <proof.ots>
```

`stamp-sent` finds the newest Sent message, verifies its evidence chain, and stamps the manifest.

**It refuses when the chain is broken.** That refusal is correct and is not a bug to work around: anchoring broken evidence would make a defect look *proven*, which is worse than having no proof. Fix the chain — usually a digest mismatch from Level 2 — and stamp again.

### Pending is not anchored

`X-PasevSU-OTS: pending` is a **marker**. There is no OpenTimestamps inside a MailExtension: no filesystem, no HTTP, no process. The header states the intent.

A `.ots` proof becomes evidence only when the Bitcoin chain attests it. Until `verify` says so:

- a `pending` proof is a commitment you can still upgrade;
- `verify` distinguishes pending from valid, and that distinction is the whole point;
- **never summarise a pending proof as "stamped"** — the difference between "I committed to this" and "the chain proves this existed at time T" is exactly what an adversary would like you to blur.

---

## Level 5 — did it arrive?

```bash
node psemp-gateway/cli.js receipts --profile "<profile dir>"
```

| Field | Meaning |
| --- | --- |
| `requested` | messages that asked for a receipt |
| `receipts` | distinct acknowledgements found in the incoming mail |
| `copies` | how many folder copies those receipts were read from |
| `matched` | receipts whose `Original-Message-ID` names a message we sent, carrying its `evidenceId` and `manifestSha256` |
| `unmatched` | receipts for other mail — kept, not dropped |

`copies` is separate from `receipts` because Gmail keeps All Mail beside the Inbox: **one** acknowledgement is readable from several folders and must not be counted several times.

### The measured reality

On one real archive (`2026-11-17`): **121 distinct receipts covered 413 copies of messages, and exactly 1 matched** the evidence it purported to acknowledge.

That is not a tool defect. It is what receipts are: a courtesy the receiving side may ignore. So the tool reports `unknown` for an absent receipt and never "not delivered".

> **An absent receipt is not evidence of non-delivery.** A present, matched receipt is evidence that a machine claiming to be the recipient's accepted the message. Nothing here proves a human read anything.

The receipt path has three parts that must all work: `returnReceipt` (the native compose boolean), the `X-PasevSU-Receipt: requested` marker, and — when configured — a receipt address. The add-on sets the boolean; Thunderbird writes `Disposition-Notification-To` itself, because a MailExtension may not write that name through `customHeaders` at all.

---

## Level 6 — the seal

```bash
node psemp-gateway/cli.js seal manifest.json --body body.txt --attach "report.pdf=report.pdf"
```

Fills the SHA3-512 slots the add-on could not compute, writes `<manifest>.asc` (SHA-512 digest) and `<manifest>.ots`, and then:

> **refuses to seal a manifest whose claimed hashes do not match the supplied bytes.**

That refusal is the most valuable check in the entire toolchain, because sealing is the moment claims meet reality. Everywhere else, a digest is compared with another digest; here, a claimed digest is compared with the actual file.

The signature report states the digest **read back out of the signature**, not the one requested. Keys and agents substitute digests more often than people expect, and a report of the request would hide exactly that.

```bash
node psemp-gateway/cli.js verify-sig manifest.json manifest.asc
```

---

## What each level can and cannot prove

| Level | Proves | Does **not** prove |
| --- | --- | --- |
| 0 | the add-on will run | that any header was produced |
| 1 | headers left, in the signed scope | that the values are correct |
| 2 | the body and files are the ones the sender hashed | who the sender is |
| 3 | a signature by a given key exists and matches the claim | that the key belongs to the person you think |
| 4 | the artefact existed no later than a Bitcoin block | that it existed *earlier*, or that it is truthful |
| 5 | a machine acknowledged the message | that a human read it, or that it arrived if no receipt exists |
| 6 | claims match bytes, and the seal covers them | anything about the message after it was sealed |

Read the right-hand column. Most wrong conclusions about forensic email come from reading only the left one.

---

## Reproducing a report

When something fails, these four artefacts make it reproducible without the message itself:

```bash
node psemp-gateway/tools/verify-install.cjs   > install.json
node psemp-gateway/tools/check-sent.cjs       > sent.json
node psemp-gateway/cli.js status              > status.json
node psemp-gateway/cli.js self-test           > selftest.json
```

Before sharing: **redact addresses, case ids, subjects, file names and key fingerprints**. A digest is a fingerprint of the content — for a short body it can be brute-forced — so treat the hash itself as sensitive when the body might be short or guessable. See [`../PRIVACY.md`](../PRIVACY.md).

Report privately per [`../SECURITY.md`](../SECURITY.md) if the failure has security consequences.
