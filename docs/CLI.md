# CLI reference — `psemp-gateway`

Sixteen commands. No dependencies, no install step, no network unless a command explicitly goes online (`stamp`, `upgrade`).

```bash
node psemp-gateway/cli.js <command> [args] [--options]
node psemp-gateway/cli.js help
```

The wrapper used throughout the docs:

```powershell
function psemp { node "C:\path\to\psemp-gateway\cli.js" @args }   # PowerShell
```
```bash
alias psemp='node /path/to/psemp-gateway/cli.js'                  # bash / zsh
```

## Conventions

- **Machine-readable output.** Every command that produces a report writes **JSON to stdout**. Diagnostics go to stderr. This is deliberate: the reports are evidence, and evidence gets diffed.
- **`--key value`.** A bare `--flag` becomes `true`. `--attach` may repeat.
- **Absolute paths in errors.** A failure tells you which file it looked at.
- **Exit code 0 means the command ran**, not "everything verified". Read the JSON. Several commands report a negative finding — an absent receipt, a broken chain — as a first-class result rather than a crash.
- **Nothing is written outside the paths you name**, except working state under `psemp-gateway/data/` (git-ignored) and `--out` defaults.

---

## Diagnostics

### `status`

Tooling and adapter availability: whether `gpg` was found and how, whether the OpenTimestamps runtime loaded and in which mode, and which adapters are usable. **Run this first** when a command behaves unexpectedly — most "it refuses to stamp" reports are a missing adapter, not a bug.

```bash
psemp status
```

### `self-test`

Known-answer vectors plus parity checks between the two engines.

```bash
psemp self-test
```

This is the same body of checks the suites use. If it fails, the hashes are wrong and nothing downstream means anything — fix this before interpreting any other output.

---

## Hashing and evidence

### `hash <algo> <file>`

Digest a file. `algo` is one of:

| `algo` | Implementation |
| --- | --- |
| `sha256` | SHA-256 — **the algorithm in the headers** |
| `sha384`, `sha512`, `sha224` | SHA-2 family |
| `sha3`, `sha3-512` | SHA3-512 |
| `sha3-256` | SHA3-256 |
| `ripemd160` | RIPEMD-160 |

```bash
psemp hash sha256 body.txt
```

The body and attachment leaves in the message are SHA-256. Recomputing one and comparing it with `X-PasevSU-Body-SHA256` is the single most direct verification you can perform.

> SHA3-512 is computed here but **not** in the add-on: Web Crypto has no SHA3, so the manifest's SHA3 slots are filled later by `seal`. That is why `seal` exists as a separate step.

### `evidence <file> [--name n]`

Build headers and a manifest for one file treated as the message body.

```bash
psemp evidence body.txt --name report.txt
```

Useful when you want to see what the gateway would claim about a given body without touching mail — for example to reproduce a digest you saw in a message.

### `eml <file.eml> [--out manifest.json]`

Parse an RFC 822 message and produce its evidence object. Handles the real shape of a delivered message: MIME structure, multiple parts, existing headers.

```bash
psemp eml received.eml --out manifest.json
```

---

## OpenTimestamps

Three commands, and the distinction between them matters.

### `stamp <file> [--out proof.ots]`

Create an OpenTimestamps proof for a file. **Degrades gracefully:** with no network — or no calendar reachable — it still produces a proof, but the proof stays `pending`. A pending proof is a commitment you can upgrade later, not a verification.

```bash
psemp stamp manifest.json --out manifest.ots
```

### `verify <proof.ots>`

Verify a proof. Takes the proof only — the attested artefact is identified from the proof itself.

```bash
psemp verify manifest.ots
```

A proof is not verified because it exists; it is verified because the Bitcoin chain says so. A `pending` proof reports as pending, and reporting that honestly is the point. **A pending proof must never be summarised as "stamped".**

### `upgrade <proof.ots>`

Attempt to complete a pending proof against the calendar servers.

```bash
psemp upgrade manifest.ots
```

Until this succeeds, the artefact is committed-to but not anchored.

### `stamp-sent`

The one you actually want after sending real mail.

```bash
psemp stamp-sent --profile "<profile dir>" [--file msg] [--out dir]
```

It finds the **newest Sent message**, verifies its evidence chain, and stamps its manifest. Proofs land in `psemp-gateway/data/pending/`.

Two behaviours to know:

- **It refuses to stamp when the chain is broken.** This is not caution for its own sake: anchoring broken evidence would make a defect look *proven*. A refusal with a reason is a correct result. Fix the chain, then stamp.
- **`--file`** targets a specific message instead of the newest.

---

## Receipts

### `receipts [--profile dir] [--include-sent]`

Pair delivery receipts found in the incoming mail with the evidence behind the message each one acknowledges.

```bash
psemp receipts --profile "<profile dir>"
```

- An **absent** receipt is reported as **`unknown`**, never as non-delivery. Someone declining a receipt request is not evidence that a message did not arrive, and a tool that conflated the two would produce exactly the false conclusion this project exists to prevent.
- `--include-sent` widens the scan to sent mail.

The measured reality is sobering and worth internalising before you rely on receipts: in one real archive, **121 distinct receipts covered 413 copies of messages, and exactly 1 matched** the evidence it purported to acknowledge. Receipts are a courtesy of the receiving side. See [`VERIFICATION.md`](VERIFICATION.md).

### `tools/check-receipts.cjs`

The lower-level collector behind `receipts`. Use it when you want the raw scan. It reads `--profile <dir>`, and with no argument it auto-discovers the default profile.

```bash
node psemp-gateway/tools/check-receipts.cjs
node psemp-gateway/tools/check-receipts.cjs --profile "<profile dir>"
```

Its report separates `requested`, `receipts`, `copies`, `matched` and `unmatched`. `copies` exists because Gmail keeps All Mail beside the Inbox: one acknowledgement is read from several folders and must not count several times.

---

## OpenPGP

### `sign <file> [--key id] [--out .asc] [--force] [--digest SHA512]`

Produce a detached OpenPGP signature. Needs `gpg`.

```bash
psemp sign manifest.json --out manifest.asc
```

- **SHA-512 is the default digest**, and the report states the digest **read back out of the signature**, not the one requested. The difference matters: many keys or agents silently substitute a digest, and a report of what you asked for would hide that.
- **Skipped when the message is already signed** — signing a signed message adds nothing and breaks the outer signature. `--force` overrides.

### `verify-sig <file> <file.asc>`

Verify a detached signature against its file.

```bash
psemp verify-sig manifest.json manifest.asc
```

### `pgp-info <file>`

Who signed this message. Reports the signer Thunderbird's keyring produced, not a claim.

### `pgp-check <file> [--fingerprint hex]`

Compare the `X-PasevSU-PGP-Fingerprint` **claim** with the **actual** signer.

```bash
psemp pgp-check received.eml
psemp pgp-check received.eml --fingerprint "ABCD 1234 ..."
```

This is the command that turns the header from a claim into a checked fact — or into a contradiction, which is itself the finding. Without a signature in the message there is nothing to compare, and the output says so rather than passing.

---

## Sealing

### `seal <manifest.json> [--body f] [--attach name=f]…`

The step that fills the gaps a MailExtension cannot.

```bash
psemp seal manifest.json --body body.txt --attach "report.pdf=report.pdf"
```

It:

1. fills the **SHA3-512** slots the add-on could not compute (no SHA3 in Web Crypto),
2. writes `<manifest>.asc` with a **SHA-512** digest,
3. writes `<manifest>.ots`,
4. **refuses to seal a manifest whose claimed hashes do not match the supplied bytes.**

Point 4 is the reason to run it: sealing is the moment claims meet reality. If they disagree, the seal does not happen and the disagreement is reported.

---

## Packaging

### `package <manifest.json> [--out f] [--body-name n] [--fingerprint hex]`

Build the self-describing evidence package defined in [`../psemp-gateway/PROTOCOL.md`](../psemp-gateway/PROTOCOL.md) §12 — the single artefact you hand to someone else.

```bash
psemp package manifest.json --out evidence.zip
```

---

## Tools

Three scripts beside the CLI, for the install-and-observe loop.

| Script | Question it answers |
| --- | --- |
| `tools/verify-install.cjs` | Is the add-on actually installed, enabled, and armed — and does `user.js` list all 27 names? |
| `tools/check-sent.cjs [<dir>…]` | What did Thunderbird really send? Positional arguments name profiles or files; with none it auto-discovers. Includes **signature coverage**: whether the file is inside the signed MIME scope, which is the answer to "the whole mail is not signed". |
| `tools/check-receipts.cjs [--profile <dir>]` | Which receipts exist, and do any match the evidence? |

```bash
node psemp-gateway/tools/verify-install.cjs
node psemp-gateway/tools/check-sent.cjs "<profile dir>"
node psemp-gateway/tools/check-sent.cjs --only 3
```

`check-sent.cjs` is the one to run when signature coverage is in doubt. "Signed" and "the part you care about is inside the signature" are different claims, and only the second one protects the body.

---

## Quick reference

| Command | Writes files | Network | Exit 0 can still mean "no" |
| --- | --- | --- | --- |
| `status` | — | — | n/a |
| `hash` | — | — | n/a |
| `evidence` | — | — | n/a |
| `eml` | with `--out` | — | n/a |
| `stamp` | yes (proof) | yes | **yes** — may be `pending` |
| `verify` | — | yes | **yes** — read the proof state |
| `upgrade` | yes | yes | **yes** — may stay pending |
| `stamp-sent` | yes | yes | **refuses** on a broken chain |
| `receipts` | — | — | **yes** — `unknown` is a result |
| `sign` | yes | — | **yes** — may be skipped |
| `verify-sig` | — | — | **yes** |
| `pgp-info` | — | — | **yes** — may find no signer |
| `pgp-check` | — | — | **yes** — may find no claim |
| `seal` | yes | — | **refuses** on a hash mismatch |
| `package` | yes | — | n/a |
| `self-test` | — | — | no — failure is failure |

The "exit 0 can still mean no" column is the most important column here. This tool reports; it does not guarantee. Anything that reads only an exit code will eventually state something false.
