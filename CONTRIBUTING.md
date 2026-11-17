# Contributing

This project has an unusually small surface area and an unusually strict one. There is no build step, no dependency install, and no test framework — which means every rule here is enforced by a script you can run yourself, and none of them are style opinions.

`node tools/check-repo.cjs` is the whole gate. Run it before you open a pull request.

```bash
node tools/check-repo.cjs         # or: npm run check     — 8 consistency checks
node psemp-gateway/test/all.cjs   # or: npm run suites    — 13 test suites
node psemp-gateway/cli.js self-test
```

---

## The four things that will get a pull request rejected

These are not preferences. Each one has already caused a real, silent failure.

### 1. CRLF line endings

Every text file in this repository is **LF**. One CRLF breaks the check, and on the add-on side it also breaks the line budget accounting that keeps a header under the 998-octet RFC 5322 limit.

`git` is configured (`core.autocrlf`) differently on different machines, so make it impossible: the repository ships `.gitattributes` with `* text=auto eol=lf`. Do not override it. If your editor writes CRLF, fix the editor — `.editorconfig` is already here for that.

```powershell
# normalise one file without touching anything else
node -e "const f=process.argv[1],fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'))" path\to\file.md
```

### 2. Node.js code in the add-on

`thunderbird-extension/*.js` runs inside a MailExtension sandbox. There is no `require`, no `module.exports`, no `process`, no `node:` import, no filesystem and no network primitive. Code that uses them throws **at runtime, in the user's Thunderbird, on send** — not at review time, not in a test.

`check-repo.cjs` strips comments first and then refuses `require(`, `module.exports`, `process.env|argv|exit` and `from 'node:`. Comments may mention them; code may not.

What the add-on *can* use: `browser.*` WebExtension APIs listed in `manifest.json`, `crypto.subtle`, `TextEncoder`/`TextDecoder`, `TextDecoderStream`, `File`, `Blob`, `URL`. That is the whole toolkit.

### 3. A header name in one place and not the other

The 27 header names live in exactly one authoritative place — the frozen `HEADER_NAMES` object in `psemp-gateway/api.js` — and are registered for display in `thunderbird-extension/user.js`. Adding a header means:

1. a key in `HEADER_NAMES`;
2. its emission in `psemp-gateway/api.js#buildHeaderLines` **and** in `thunderbird-extension/background.js#buildHeaders`, in the same position;
3. a line in `user.js`;
4. a row in `HEADERS.md` and in the header table in `README.md`;
5. a case in `psemp-gateway/test/extension-arming.cjs` proving both engines agree.

Skipping step 5 is how a header ends up on the wire and absent from the evidence bundle. `check-repo.cjs` catches the `user.js` omission; it cannot catch a missing emission, which is why the suite exists.

### 4. Version drift

`thunderbird-extension/manifest.json` carries `1.9`; `package.json` carries `1.9.0`. The check compares `major.minor`. A release bumps both and adds a `CHANGELOG.md` entry.

---

## Where things go

| You are adding | It goes in |
| --- | --- |
| a header | `HEADER_NAMES`, both engines, `user.js`, `HEADERS.md` |
| a CLI command | `psemp-gateway/cli.js` + `docs/CLI.md` + a suite in `psemp-gateway/test/` |
| an option | `options.html`, `options.js` (with a `_locales` string in all three languages), `DEFAULTS` in both engines |
| a check | `tools/check-repo.cjs` — with a comment saying what silent failure it prevents |
| an install path | `INSTALL.md`, and `install.ps1` if it can be automated |
| third-party code | `psemp-gateway/packages/<NN>-<name>/`, plus `THIRD_PARTY.md` and `NOTICE` |

New prose goes in `docs/` unless it is one of the four root documents a reader needs in the first minute (`README.md`, `INSTALL.md`, `HEADERS.md`, `SECURITY.md`).

---

## Localisation

The add-on is translated into English, Bulgarian and German. Every key in `_locales/en/messages.json` must exist in `bg` and `de` — `check-repo.cjs` fails otherwise, naming the missing keys.

- Write the English string first, then translate; never leave an English sentence sitting in the `bg` file as a placeholder.
- Keep `{{placeholder}}` names identical across languages.
- Do not translate the header names, `PasevSU`, `Forensic-Mail`, or the engine code format.

---

## Tests

`psemp-gateway/test/` is plain Node — each suite is a script that exits non-zero on failure, and `all.cjs` runs them all. There is no runner to install and no config file.

A new behaviour needs a test that **would fail without the change**. A test that restates the implementation, or that asserts a constant, is not a test. The suites that matter most:

| Suite | Guards |
| --- | --- |
| `extension-arming.cjs` | the two engines produce byte-identical header sets |
| `settings-parity.cjs` | `settings.default.json`, `DEFAULTS` and `user.js` agree |
| `header-injection-safety.cjs` | no CR/LF, no non-ASCII byte, nothing over the octet budget |
| `settings-parity` / `receipts` | the receipt chain still reports *unknown* rather than *failed* |

---

## Commit messages

One line, imperative, what changed — `Omit the PGP claim when a key-id is typed`, not `fixed stuff`. If the change has a reason a reader would not guess, put it in the body: the reason is the valuable part.

Add `Co-authored-by:` when you are committing on someone's behalf.

---

## Reporting a security problem

Not here — see [`SECURITY.md`](SECURITY.md). Do not open a public issue for a vulnerability.

---

## License of contributions

By contributing you agree your contribution is licensed under the **Apache License 2.0**, the same terms as the rest of the first-party code. Vendored third-party components are not covered by that grant; see [`THIRD_PARTY.md`](THIRD_PARTY.md).
