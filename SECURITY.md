# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private channel: **Security → Report a vulnerability** on this repository. That opens a private advisory visible only to the maintainer.

If that is unavailable, write to `pasevdenislav@gmail.com` with `[SECURITY]` in the subject, and — if you have one — your PGP public key. Please do not send a proof-of-concept exploit in the first message; say what class of problem it is and we will agree on a channel.

Please include:

- what is affected (the add-on, the gateway CLI, the OTS bridge, the OpenPGP bridge, or the protocol itself),
- the version (`manifest.json` for the add-on, `package.json` for the gateway),
- what an attacker gains that they should not,
- the smallest reproduction you can manage.

**What to expect.** An acknowledgement within a few days. This is a small project maintained by one person, not a vendor with a rotation; there is no 24-hour SLA and claiming one would be dishonest. A confirmed problem gets a fix, a `CHANGELOG.md` entry and — where possible — a test that fails on the old behaviour.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.9.x | yes |
| older | no |

## What counts as a vulnerability here

This project makes claims, and a vulnerability is a way to make a claim false. That is a wider category than "code execution", so it is spelled out:

| Class | Example |
| --- | --- |
| **Evidence integrity** | a way to make `X-PasevSU-Merkle-Root` or `-Body-SHA256` cover something other than what was sent; a digest collision path; a value that verifies but was not produced by the sender |
| **Header injection** | a filename containing `\r\n`, `,` or `=` that injects a header or forges a list row; an over-long value that splits into `<name>-C2` in a way that reorders meaning; a non-ASCII byte reaching the wire |
| **Send aborted silently** | input that makes `setComposeDetails()` reject, because a rejected call aborts the send with no dialog and the user believes the mail was sent |
| **Evidence disclosure** | a way to recover the encrypted `Cripto-title` block without holding the message; a way to make the plaintext `Sha256` block reveal something the encrypted one hides |
| **Receipt forgery** | a way to make `receipts` report an acknowledgement that never happened, or to make a genuine one attach to the wrong message |
| **Replay** | a way to re-inject a captured message as fresh despite `Nonce`/`Sequence`/`Created`/`Expires` |
| **Cross-boundary execution** | a way to get the MailExtension sandbox to load Node code, reach the filesystem, or make a network request |
| **Command injection** | a crafted filename, case id or fingerprint that escapes into the `gpg` or `ots` invocation in the gateway |

A problem with a *third-party* component (`openpgp` 6.3.1, `opentimestamps` 0.4.9) should go upstream as well, but tell us too — the version is pinned and vendored, so an upstream fix reaches users only when we re-vendor it.

## What is *not* a vulnerability

Stated plainly, because these will be reported and they are by design:

- **`X-PasevSU-Cripto-title` is not confidential against the recipient.** The 25-digit engine code travels in the message. The encryption exists to keep file names and digests out of plaintext header scanners, not to hide them from whoever holds the message. Documented in [`HEADERS.md`](HEADERS.md).
- **`X-PasevSU-PGP-Fingerprint` is a claim, not a proof.** The add-on cannot read the keyring. Verify it with `psemp-gateway pgp-check`, which compares the claim against the signer actually present. A message may carry a fingerprint and no signature; that is what `pgp-check` is for.
- **`X-PasevSU-OTS: pending` means pending.** It is a marker that a real OpenTimestamps proof is expected. It does not assert that one exists. No `.ots` file, no anchoring.
- **A missing receipt is not a vulnerability.** An MDN request can be ignored by the recipient's client or stripped by a gateway. `receipts` says *unknown*, never *failed*, for exactly this reason.
- **The headers are visible to every recipient.** That is the point. They disclose a per-message id, digests, an optional case label and an optional fingerprint. If a case label is sensitive to you, see [`PRIVACY.md`](PRIVACY.md) before using it.
- **Expiry does not invalidate the evidence.** `X-PasevSU-Expires` bounds how long a copy is a *currently-issued statement*. The Merkle root, the PGP seal and the OTS proof remain valid forever.
- **No encryption of the message itself.** This project proves origin and integrity. It does not make the body private; that is what PGP encryption in Thunderbird is for.

## Hardening notes for operators

- `thunderbird-extension/user.js` is **durable by design**: Thunderbird re-applies it at every startup and it overrides `prefs.js`. That is how the 27 header names stay registered. It also means an unexpected entry in `user.js` wins — review it if you did not write it.
- `psemp-gateway/data/` holds real evidence output (manifests, proofs, receipts) and is git-ignored. Treat it as case material: back it up, control access, do not sync it to a shared drive.
- `psemp-gateway` reads your Thunderbird profile directly. Run it as the user who owns the profile, not elevated, and not against a profile another process is writing.
- **The pinned, vendored dependency versions are part of the security posture.** Pinning is deliberate (offline forensic use), but it also means a fixed upstream CVE does not arrive by itself. Watch `openpgp` 6.3.1 and `opentimestamps` 0.4.9 releases.
- An OpenTimestamps submission sends **a digest** to public calendar servers. Nothing else. If that digest is itself sensitive in your context, use a private calendar with `--calendar`.

## Disclosure

A confirmed issue is disclosed in `CHANGELOG.md` once a fixed version is available, together with what was affected and what an attacker could have done. Reporter credit is given unless asked otherwise.
