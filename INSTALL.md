# Installation

Two halves, installed separately and for different reasons:

| Half | What it puts on your machine | Why you might skip it |
| --- | --- | --- |
| The **MailExtension** (`thunderbird-extension/`) | the headers, on every send | — this is the part that satisfies the requirement |
| The **PSEMP gateway** (`psemp-gateway/`) | `node-cli`, evidence sealing, OTS proofs, receipts, PGP checks | skip only if you never intend to verify anything |

Neither half needs a build step, a package install or network access. The gateway has no runtime dependencies — everything it uses is vendored under `psemp-gateway/packages/`.

---

## Requirements

| | Minimum | Notes |
| --- | --- | --- |
| Thunderbird | **ESR 115** | `strict_min_version: "115.0"` in the manifest. Tested on ESR 115 and later. |
| Node.js | **20** | gateway only; `engines.node` is `>=20`. `node --version`. |
| OS | Windows 10/11, macOS 12+, any current Linux | the installer script is PowerShell; other platforms use the manual route below |
| Disk | ~6 MB | 0.2 MB add-on, 5.2 MB gateway including vendored packages |

The add-on also works in Thunderbird 115+ non-ESR builds. It does **not** work in Firefox, SeaMonkey or any browser — `compose.onBeforeSend` does not exist there.

---

## Part 1 — the add-on

### Route A: the installer (Windows, recommended)

Close Thunderbird **completely** — not minimised, not "minimise to tray". The `.xpi` is memory-mapped while it runs, so Windows refuses to replace it.

```powershell
powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1
```

What it does, in order:

1. Reads `manifest.json` for the id and version, and refuses to continue if `manifest.json`, `background.js`, `options.html`, `options.js` or the `_locales` tree named by `default_locale` is missing.
2. Packs those files at the archive **root** — plus `_locales/` — into `%TEMP%\hapi-forensic-headers@pasev.example-<version>.xpi`, writing entry names with forward slashes by hand.
3. Finds the profile. With `-Profile` it uses exactly that path; otherwise it looks under `%APPDATA%\Thunderbird\Profiles` for `*.default-esr` / `*.default`, and when there are several it prefers the one named by `Default=` in `profiles.ini`, falling back to the most recently modified.
4. Copies the `.xpi` to `<profile>\extensions\hapi-forensic-headers@pasev.example.xpi` and **verifies the SHA-256 of the installed file against the build**.
5. Rewrites `<profile>\user.js` from the header names actually found in `background.js` (see [why `user.js`](#why-userjs-and-not-prefsjs)).
6. Prints the next step.

Two things it does that are easy to miss:

- **It normalises `user.js` to LF before editing it.** The pref-editing regex anchors on end-of-line, and in multiline mode `$` matches before `\n` but not before `\r`. On a CRLF file the pattern cannot match, so every pref it was asked to *replace* would instead be **appended as a second copy**. This was observed: a CRLF `user.js` ended up with two `extensions.autoDisableScopes` lines, the first still `15`.
- **It keeps only the last line per key.** `user.js` is applied in file order and the last assignment wins, so a stale `autoDisableScopes = 15` earlier in the file would leave the file carrying the old value while appearing fixed.

A backup of the previous `user.js` is written beside it as `user.js.psemp-before-install`.

Flags:

```powershell
# build the .xpi and stop, without touching any profile
powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1 -BuildOnly

# target a specific profile
powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1 -Profile "C:\path\to\xxxxxxxx.default-esr"
```

**Exit code `2`** means the prefs were written but the `.xpi` swap was refused because Thunderbird still had it mapped. Close Thunderbird and run the same command once more.

### Route B: manual install (any OS)

1. Pack the add-on yourself. Zip these into one archive and rename it `.xpi`:
   ```
   manifest.json
   background.js
   options.html
   options.js
   _locales/bg/messages.json
   _locales/de/messages.json
   _locales/en/messages.json
   ```
   They must sit at the **archive root** — a top-level folder inside the zip makes the manifest invisible. Entry names must use `/`, not `\`.

   ```bash
   cd thunderbird-extension
   zip -r ../hapi-forensic-headers.xpi manifest.json background.js options.html options.js _locales
   ```

2. Copy it to `<profile>/extensions/hapi-forensic-headers@pasev.example.xpi`. On Linux and macOS this is `~/.thunderbird/<profile>/extensions/`; on Windows `%APPDATA%\Thunderbird\Profiles\<profile>\extensions\`.

3. Put the prefs in place. Copy `thunderbird-extension/user.js` into the **profile root** (next to `prefs.js`). If a `user.js` already exists, merge the five blocked in — do not overwrite.

4. Start Thunderbird.

### Route C: temporary add-on (throwaway, for trying it out)

Thunderbird → **Settings → Add-ons and Themes → gear (⚙) → Debug Add-ons → Load Temporary Add-on… → select `thunderbird-extension/manifest.json`**.

This works without packing, which makes it the fastest way to see whether the headers appear. It has three consequences you must know:

- **It vanishes when Thunderbird closes.** Good for a first look, wrong for the standing requirement.
- **It bypasses the installer's pref work.** Unless `mail.compose.other.header` already lists all 27 names, Thunderbird will accept your headers and then silently **drop them from the composed message**. You will see a message with no headers and no error. Route A or B avoids this.
- **`user.js` edits made while Thunderbird runs are not applied to the current session.**

---

## Part 2 — the gateway (optional, needed for verification only)

There is nothing to install. It is plain Node with no dependencies:

```bash
node psemp-gateway/cli.js self-test
node psemp-gateway/tools/verify-install.cjs
```

`verify-install.cjs` checks the profile's `user.js`, the installed `.xpi`, and whether the add-on is actually enabled.

Let `PSEMP` be a wrapper so the rest of the docs read cleanly:

```powershell
# PowerShell
function psemp { node "C:\path\to\psemp-gateway\cli.js" @args }
```

```bash
# bash / zsh
alias psemp='node /path/to/psemp-gateway/cli.js'
```

---

## First run: prove it works

Do not assume. The whole point of this project is that claims are checkable.

1. **Options page says Armed.** Add-ons → hAPI Forensic Mail → Options, or the gear menu. It must read **Armed**, and list the 27 header names with no red row. A key fingerprint entered here that is not 40 hex characters turns its row red and is **not** written as a header — malformed claims are omitted rather than published.
2. **Send one message to yourself, with one file attached.** Text in the body, at least one attachment.
3. **Look at the raw source of what arrived.** Thunderbird: select the message → **More (⋮) → View Source** (`Ctrl+U`). Do not judge by the message pane — it shows a curated subset.
4. Expect all of these, and `X-PasevSU-Attachments-Count: 1`:

   ```text
   X-PasevSU-Version: 1.0
   X-PasevSU-Framework: Forensic-Mail
   X-PasevSU-Origin: Thunderbird
   X-PasevSU-Evidence-ID: <uuid>
   X-PasevSU-Body-SHA256: <64 hex>
   X-PasevSU-Attachments-Count: 1
   X-PasevSU-Attachments-SHA256: report.pdf=<64 hex>
   X-PasevSU-Merkle-Root: <64 hex>
   X-PasevSU-OTS: pending
   X-PasevSU-Receipt: requested
   X-PasevSU-Headers-SHA256: <64 hex>
   ```

5. **Recompute the body digest by hand** and compare:

   ```bash
   node psemp-gateway/cli.js hash sha256 body.txt   # must equal X-PasevSU-Body-SHA256
   ```

   If the digests do not match, the body Thunderbird sent is not the body you hashed. See troubleshooting below.

6. **Check the delivery path** (`X-PasevSU-OTS: pending` now becomes provable):

   ```bash
   node psemp-gateway/cli.js stamp-sent --profile "<profile dir>"
   node psemp-gateway/tools/check-sent.cjs "<profile dir>"
   ```

Full verification procedure: [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## Why `user.js` and not `prefs.js`

`prefs.js` is **rewritten by Thunderbird**, typically on exit, from what it holds in memory. Anything you add to it can disappear the next time Thunderbird quits. `user.js` is read **at start-up**, every time, and overrides `prefs.js`. It is the only durable way to keep the custom header names registered.

Four prefs matter, and the installer enforces rather than merely adds them:

| Pref | Value | What breaks without it |
| --- | --- | --- |
| `mail.compose.other.header` | all 27 names, comma-separated | **the headers are dropped silently** — the send succeeds, the message has no headers |
| `mailnews.headers.extraExpandedHeaders` | the same names, lowercased, space-separated | the headers exist but the message pane will not show them; View Source still works |
| `extensions.autoDisableScopes` | `0` | a hand-placed `.xpi` is registered with `userDisabled: true`, so the add-on is installed and inert |
| `xpinstall.signatures.required` | `false` | factory default already `false`, but a Firefox-style `user.js` can carry `true`, and the unsigned build is then refused outright |

`extensions.autoDisableScopes` is the one that catches people after a rebuild: any non-zero mask re-disables the add-on every time, which silently breaks the standing requirement that headers appear without anyone touching the Add-ons Manager.

---

## Upgrading

1. Close Thunderbird.
2. `powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1`
3. Start Thunderbird, confirm the options page says **Armed** and that the version shown matches `manifest.json`.

Because the installer regenerates the registry from `background.js`, a new header added by an upgrade is registered automatically. If you installed manually, re-merge `user.js`.

Thunderbird's normal Add-ons updater does not apply here — this is not distributed through addons.thunderbird.net.

---

## Uninstalling

1. Thunderbird → Add-ons → hAPI Forensic Mail → **Remove**.
2. Delete `<profile>/extensions/hapi-forensic-headers@pasev.example.xpi` if it is still there.
3. Remove the four prefs from `user.js` — the installer's changes are the four lines it wrote; the backup `user.js.psemp-before-install` is the previous file.
4. Optional: remove the `psemp-*` keys from the add-on's storage (Add-ons → hAPI Forensic Mail → remove also clears this) and delete `psemp-gateway/data/` if you no longer need the evidence you sealed.

Uninstalling stops headers from being **produced**. It cannot recall anything already sent, and it does not invalidate any proof already produced.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Message sends, but has **no** `X-PasevSU-*` headers | `mail.compose.other.header` does not list the names | run the installer; a temporary add-on also needs this |
| Installer exits **2** | `.xpi` still memory-mapped | close Thunderbird fully, run again |
| Add-on disappears after a restart | manifest placeholders (`__MSG_extName__`) unpacked without `_locales/` | repack including `_locales/`; the installer does this |
| Add-on shows but is **disabled** every time | `extensions.autoDisableScopes` non-zero, or duplicate keys in `user.js` | installer sets `0` and collapses duplicate keys |
| Add-on refused: "could not be verified" | `xpinstall.signatures.required` is `true` | set it to `false`; the build is unsigned |
| Headers present, but `Attachments-Count: 0` **with** files attached | attachments were read from `ComposeDetails.attachments`, which is empty in `onBeforeSend` | use this build — it calls `compose.listAttachments(tab.id)`; report if it recurs |
| Send aborts with no dialog at all | a custom header name not starting with `X-` was passed | this is why the `X-` twins exist; do not edit header names by hand |
| Body digest does not match the message | Thunderbird converted the body (HTML↔plain text) differently from what was hashed | see [`docs/VERIFICATION.md`](docs/VERIFICATION.md); report a reproduction |
| `X-PasevSU-PGP-Fingerprint` missing although configured | the value is not a 40-hex fingerprint, so it was rejected | enter the full fingerprint, not a key id |
| `X-PasevSU-OTS` stays `pending` forever | expected — the marker is not a proof | run `psemp-gateway stamp` / `stamp-sent` |
| No receipt arrives | a receipt is a **request**; the recipient or their server may decline it | [`docs/VERIFICATION.md`](docs/VERIFICATION.md) explains what the measured rate looks like |

### Diagnostics, when you need them

Two places, and they answer different questions.

**The options page** is the health panel — it reads `storage.local` and shows what actually happened:

| Shown | Storage key | Meaning |
| --- | --- | --- |
| **Armed** + a timestamp | `psempLastLoadedAt` | the listener is registered; the timestamp is when it armed |
| a red armed message | `psempArmError` | `onBeforeSend` could not be registered — nothing else matters until this is empty |
| manifest line | `psempManifestError` | the manifest attachment could not be added |
| send count + last send | `psempSendCount`, `psempLastSend` | breadcrumbs proving a send went through the listener |
| receipt problem | `psempReceiptError` | why the receipt request could not be set |

**The add-on console** carries the detail: Add-ons → gear → **Debug Add-ons → Inspect**. Everything is prefixed `[PasevSU]`:

- `skipped attachment (could not read/hash): <name> <error>` — one file lost, the send continued
- `pgpFingerprint is <problem>; the claim is omitted.` — the malformed-fingerprint path
- `could not enumerate attachments:` — the `listAttachments` fallback was used
- `header injection failed; sending without PasevSU headers:` — the catch-all; the message went out **without** headers
- `could not arm onBeforeSend:` — fatal for this feature

A rejected header name is recorded separately in `psempRejectedHeaders`, so it survives a console that was not open at the time.

To read the raw storage:

```javascript
// paste in the add-on console
browser.storage.local.get().then(console.log)
```

---

## Where things live

| Path | What |
| --- | --- |
| `<profile>/extensions/hapi-forensic-headers@pasev.example.xpi` | the installed add-on |
| `<profile>/user.js` | the durable prefs |
| `<profile>/user.js.psemp-before-install` | the pre-install backup |
| `storage.local` (inside the profile) | the add-on's settings and breadcrumbs — inspect via the options page or the add-on console |
| `psemp-gateway/data/` | evidence produced by the gateway — **git-ignored, never publish this** |
