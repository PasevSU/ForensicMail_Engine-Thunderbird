# Third-party components

This repository contains two kinds of code: **first-party code** written for this project and covered by the Apache License 2.0 in [`LICENSE`](LICENSE), and **vendored third-party code** that keeps its own license and is *not* relicensed by Apache-2.0.

The distinction matters legally, so this file records both, with the exact paths and the exact obligations.

---

## Summary

| Component | Version | Path | License | Modified? |
| --- | --- | --- | --- | --- |
| PasevSU Forensic Mail Engine | 1.9.0 | `thunderbird-extension/`, `psemp-gateway/*.js`, `tools/`, `docs/` | Apache-2.0 | — |
| `evidence-object-email-core` | 0.1.0-dev | `psemp-gateway/packages/05-forensics/email-evidence-js-core/` | first-party, no field declared → Apache-2.0 | no |
| `pasevsu-ots` | undeclared | `psemp-gateway/packages/07-ots/` | first-party, no field declared → Apache-2.0 | no |
| OpenPGP.js (`openpgp`) | 6.3.1 | `psemp-gateway/packages/15-openpgpjs/` | **LGPL-3.0-or-later** | no |
| OpenTimestamps client (`opentimestamps`) | 0.4.9 | `psemp-gateway/packages/17-javascript-opentimestamps/` | **LGPL-3.0** | no |

---

## OpenPGP.js 6.3.1 — LGPL-3.0-or-later

- **Path:** `psemp-gateway/packages/15-openpgpjs/`
- **Package:** `openpgp` 6.3.1, declared `"license": "LGPL-3.0+"`
- **Full license text ships at:** `psemp-gateway/packages/15-openpgpjs/LICENSE` (166 lines, complete)
- **Upstream:** <https://www.openpgp.org/>

**What it does here.** `psemp-gateway` uses OpenPGP.js to verify signatures on messages and detached signatures, to read the signer fingerprint out of an OpenPGP/MIME part, and to inspect key material during `pgp-info` and `pgp-check`. It never generates or exports keys.

**Why it is vendored rather than installed.** The gateway promises *zero runtime dependencies*: `git clone` then `node psemp-gateway/cli.js` must work with no `npm install`, on a machine that may be offline or air-gapped — which is the normal condition for forensic work. Vendoring is how that promise is kept, and it is why `node tools/check-repo.cjs` fails if `psemp-gateway/package.json` ever grows a `dependencies` block.

**LGPL-3.0 obligations, and how they are met.**

| Obligation | How |
| --- | --- |
| Ship the license text (§4) | `LICENSE` sits inside the package directory, unmodified (verified: 7 652 bytes, 166 lines) |
| State that the code is LGPL and where the text is | This file, and [`NOTICE`](NOTICE) |
| Do not relicense it | Apache-2.0 is applied only to first-party code; this file says so explicitly |
| Preserve copyright notices | The vendored tree is copied verbatim, `git archive` export, no edits |
| Allow relinking with a modified LGPL component (§4, combined works) | Nothing here is a combined work that would restrict relinking: OpenPGP.js is used as a separate JavaScript module via `require`, and nothing in the Apache-2.0 code is derived from it. A user who modifies the vendored copy can replace it in place — no compilation, no linking step exists |

**Distribution is unmodified.** No file under `packages/15-openpgpjs/` was edited. If you need to patch it, do so in a way that keeps the replacement possible, and record the change in `CHANGELOG.md`.

---

## OpenTimestamps client 0.4.9 — LGPL-3.0

- **Path:** `psemp-gateway/packages/17-javascript-opentimestamps/`
- **Package:** `opentimestamps` 0.4.9, declared `"license": "LGPL-3.0"`
- **Full license text ships at:** `psemp-gateway/packages/17-javascript-opentimestamps/LICENSE` (178 lines, complete — *"The OpenTimestamps Client is free software…"*)
- **Upstream:** <https://opentimestamps.org/>

**What it does here.** Builds the serialized `.ots` proof for a digest, upgrades a pending proof against a calendar server, and verifies a proof against the Bitcoin block header it commits to. The public calendar servers receive **only a digest**, never a message or a file.

The same LGPL-3.0 obligations and the same mitigations as above apply: license text shipped, verbatim copy, replaceable module, no relicensing.

---

## Attribution inside the vendored trees

`psemp-gateway/packages/**/mode-ctr-gladman.js` carries a copyright header naming **Jan Hruby**. It is part of OpenPGP.js's cipher implementation and is distributed under the same LGPL-3.0 terms as the surrounding package.

Any further copyright lines inside `packages/` belong to the upstream packages and are preserved verbatim.

### Directories that are *not* separate works

The following directories inside the two package trees are sub-libraries of OpenPGP.js or of the OpenTimestamps client, not independent dependencies:

`01-core` · `06-hash-crypto` · `bin` · `cipher` · `cipherMode` · `core` · `crypto` · `elliptic` · `email` · `encoding` · `functions` · `hash` · `kem` · `key` · `packet` · `post_quantum` · `public_key` · `s2k` · `schema` · `signature` · `src` · `ts` · `type`

They are covered by the license of the package that contains them.

---

## Why the repository is not simply "Apache-2.0"

A single SPDX identifier on the whole tree would be false. The accurate statement, and the one this repository makes everywhere:

> First-party code: **Apache-2.0**. Vendored `openpgp` 6.3.1: **LGPL-3.0-or-later**. Vendored `opentimestamps` 0.4.9: **LGPL-3.0**.

If you redistribute this repository, carry [`LICENSE`](LICENSE), [`NOTICE`](NOTICE) and this file, and do not remove the two `LICENSE` files inside `psemp-gateway/packages/`.

---

## Adding a dependency

`psemp-gateway` has no runtime dependencies and the add-on has none at all. If that ever has to change:

1. The component must be license-compatible with Apache-2.0 *and* with LGPL-3.0 as used here (MIT, BSD-2/3, ISC, Apache-2.0, LGPL-3.0 all qualify; GPL-3.0-only does not, because it cannot be combined with the LGPL-3.0 grant under the terms we rely on).
2. Vendor it under `psemp-gateway/packages/<NN>-<name>/` with its `LICENSE` file intact.
3. Add a row to the summary table above, with the version and the exact license.
4. Add the rows to [`NOTICE`](NOTICE).
5. Note it in `CHANGELOG.md`.

A pull request that adds a dependency without these five steps will not be merged.
