# Threat model

What this system defends against, what it deliberately does not, and where the boundary is. Written as a list of **ways a claim could be false** — because a forensic header is only useful if you know how it could lie to you.

The framing matters. This project does not make messages secure. It makes statements about messages that a recipient can check, and it tries to make its own statements hard to fake or silently degrade.

---

## Assets

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| Message body bytes | the thing being evidenced | Thunderbird's compose buffer → SMTP → recipient |
| Attachment bytes | usually the reason the message exists | same |
| The **claim set** (27 headers) | the record that makes verification possible | headers on the wire |
| The manifest | self-contained record of one send | attached `PasevSU_Manifest.json` |
| The OTS proof | independent proof of existence at a time | `psemp-gateway/data/pending/` |
| The PGP signature | proof of *who* | Thunderbird's own MIME layer |
| Delivery receipts | weak evidence of arrival | recipient's infrastructure |
| The key store | who you are | Thunderbird's keyring and `gpg` |

The last two are outside this project's control, and that is the source of most of the honest limitations below.

---

## Adversaries

| Adversary | Capability | Motivated by |
| --- | --- | --- |
| **A recipient who edits and forwards** | full control of their copy | passing off an altered document as yours |
| **A mail gate / middlebox** | rewrites or strips headers | policy, anti-spam heuristics, incompetence |
| **A man in the middle on SMTP** | reads and can modify transit | interception |
| **Someone with your machine** | reads the profile, the keyring, the digest store | impersonation |
| **A later backdater** | wants a false creation time | "this contract existed before yours" |
| **The sender themselves, later** | repudiates having sent it | deniability |
| **A user who mis-configures** | silent no-op | — **the most common cause of a false sense of coverage** |

That last row is not a joke. The measured, repeated failure in this project has never been an attacker; it has been an add-on that computed everything correctly and had the headers dropped for want of a preference.

---

## The seven classes of false claim

Each is a way the system could mislead. For each: the defence, and what remains.

### 1. "These headers describe this message" — but they do not

The digests are computed at `onBeforeSend`, then Thunderbird builds the wire message. If the two differ, every downstream claim is about bytes nobody received.

- **Defence:** the body hash covers the text the add-on actually hashed, and the sender can recompute it from the received message (Level 2 in [`VERIFICATION.md`](VERIFICATION.md)). A mismatch is visible.
- **Residue:** HTML↔plain-text conversion means the received body may legitimately differ from what was hashed. This is a *detectable* problem, not a prevented one. When it happens, the honest reading is "the header does not describe this message", not "the message is unmodified".

### 2. "Nothing was attached" — but something was

If reading attachments fails silently, the message looks clean while files ride along unmentioned.

- **Defence:** `X-PasevSU-Attachments-Count` is emitted **always, including `0`**. A reader can distinguish "genuinely no files" from "the add-on did not look".
- **Defence:** an unreadable file produces `X-PasevSU-Attachments-Error` naming it and the reason, and the send proceeds.
- **Historical failure:** `ComposeDetails.attachments` is documented input-only and returns **empty** in `onBeforeSend`. Reading it there produced zero attachments, no attachment header, and green checks everywhere. The fix reads `compose.listAttachments(tab.id)`.

### 3. "This is what was signed" — but the signature covers nothing useful

The signature is applied by Thunderbird, not by this add-on. It can be attached to a part that contains almost nothing, while the body and files sit outside it.

- **Defence:** `check-sent.cjs` performs a containment test — the signed part must be the **outermost**, and **no payload part** may live outside it.
- **Defence against a vacuous pass:** the test requires that something actually *is* inside, so a message with no parts cannot report "fully covered".
- **Note:** this defect is a Thunderbird configuration matter (MIME structure), outside the add-on's reach. Detecting it is the contribution; preventing it is not.

### 4. "This key signed it" — but the header is a claim, not a signature

`X-PasevSU-PGP-Fingerprint` records what the sender *says*. The add-on cannot read the keyring or sign.

- **Defence:** `pgp-check` compares the claim against the signer actually present. Disagreement is reportable.
- **Defence:** a malformed fingerprint is **omitted** rather than published. A missing header is honest.
- **Residue:** the header can still be a truthful statement about the wrong key. Deciding whether a key belongs to a person is out of scope — that is a key-verification problem, and it is yours.

### 5. "It existed at this time" — but the timestamp is self-asserted

`X-PasevSU-Created` is written by the sender's machine. Anyone can assert any time.

- **Defence:** the OTS proof. A completed proof ties a digest to a **Bitcoin block**, which is not forgeable by the sender.
- **Honest gap:** `X-PasevSU-OTS: pending` means *nothing* has been anchored. It is a marker, and calling it a proof would be a lie the tool is careful not to tell.
- **Residue:** OTS proves existence **no later than** block *N*. It never proves a document did not exist earlier. Backdating a document before the anchored time is not prevented by this scheme.

### 6. "It was delivered" — but only a machine said so

`X-PasevSU-Receipt: requested` records a **request**. Receipts are voluntary, and frequently declined or ignored.

- **Defence:** `receipts` pairs acknowledgements with evidence, reports `matched` separately from `unmatched`, and reports an absent receipt as **`unknown`** — never as non-delivery.
- **Defence:** `copies` is counted separately from `receipts`, because one acknowledgement is readable from several folders and must not count several times.
- **Reality:** 121 receipts covering 413 copies, **1 matched**, on a real archive. That is the honest base rate.

### 7. "It came from me" — but the sender repudiates it

A sender who later denies sending a message is a real adversary, and cryptography is their friend here too.

- **Defence:** a PGP signature by a key the sender controls makes repudiation *harder* but not impossible — they can always claim key compromise.
- **Defence:** `Evidence-ID`, `Nonce`, `Sequence` and `Canary` make it possible to trace a specific copy to a specific send.
- **Residue:** non-repudiation is a legal and procedural question. No header settles it.

---

## What is deliberately not defended

| Not defended | Why not | Mitigation |
| --- | --- | --- |
| **Confidentiality** | digests are fingerprints, not encryption; `Cripto-title` is decryptable by anyone with the message | use Thunderbird's OpenPGP encryption for the payload |
| **Header stripping** | a middlebox may remove headers | content digests let you detect absence; an OTS proof lives outside the mail |
| **Recipient-side storage** | their mailbox, their rules | nothing to do |
| **Key compromise** | outside the boundary | rotate, revoke, and check fingerprints out of band |
| **Forwarding** | the WAR header forbids it; the recipient may ignore it | the header states the prohibition, it does not enforce it |
| **A compromised Thunderbird** | malware in the process writes whatever it likes | endpoint security |
| **Clock manipulation at send time** | `Created` is local time | OTS anchoring after the fact |
| **Brute force of a short body digest** | a digest of a guessable string is guessable | treat hashes of short bodies as sensitive |

**Confidentiality is the one people assume and should not.** The project ships `X-PasevSU-Cripto-Engine` and `X-PasevSU-Cripto-title`, and the name invites the wrong reading: this keeps file names and digests out of plaintext header scanners. The key travels in the same message. It is obfuscation against casual inspection, **not** encryption against the recipient.

---

## Trust boundaries

```
   trusted  ─────────────────────────────────────────────────────
            the bytes you recompute a digest from
            the OTS proof verified against a Bitcoin block
            a PGP signature verified against a key you trust
   ───────────────────────────────────────────────────────────────
   asserted ── a header value (including all of ours)
            Created / Expires
            PGP-Fingerprint (a claim about a signature)
            OTS: pending (an intention)
            Receipt: requested (a request)
   ───────────────────────────────────────────────────────────────
   unknown ─── whether a receipt that never came implies anything
            whether a key belongs to a named person
            whether the sender's clock was right
   ───────────────────────────────────────────────────────────────
   trusted  ─────────────────────────────────────────────────────
```

Everything in the middle band is *checkable*, which is the entire design goal. Nothing in it is *true by assertion*.

---

## Threats to this project's own supply chain

Worth stating, because a forensic tool that is itself tampered with is worse than none.

| Threat | Defence |
| --- | --- |
| A vendored dependency is altered | licenses and versions recorded in [`../THIRD_PARTY.md`](../THIRD_PARTY.md); `packages/` is vendored so an upstream publish cannot change what runs |
| A header is added on one side only | `extension-arming.cjs` computes the same message through both engines and compares byte for byte |
| The header list drifts from `user.js` | `tools/check-repo.cjs` cross-checks `HEADER_NAMES` against `user.js` |
| CRLF creeps in and breaks pref parsing | `.gitattributes` forces LF; `check-repo.cjs` walks every text file |
| Node code sneaks into the add-on | `check-repo.cjs` fails on `require()` in `background.js` |
| A version bump is forgotten | `check-repo.cjs` requires `package.json` major.minor to equal `manifest.json` |

Run `node tools/check-repo.cjs` before trusting any clone, including one you made yourself.

---

## Reporting

If you find a way to make a claim **false** — that is the definition of a vulnerability here — report it privately per [`../SECURITY.md`](../SECURITY.md).

Things that are not vulnerabilities, listed so the report does not have to be argued:

- the recipient can read the digest block (by design);
- `X-PasevSU-PGP-Fingerprint` is not proof of identity (it is a claim, and `pgp-check` exists);
- `X-PasevSU-OTS: pending` is not a proof (it is a marker);
- a receipt did not arrive (it is a request);
- `Expires` passed (expiry bounds currentness, not integrity);
- a short body's digest can be brute-forced (that is what a digest is).
