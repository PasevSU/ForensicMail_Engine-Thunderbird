<!--
  Thank you. Two things before the checklist, because they decide most reviews:

  1. This repository has no build step. Its gates are `node tools/check-repo.cjs`
     and the PSEMP suites. Paste their real output below — a claim that they pass
     is not the same as their output, and this project is about the difference.
  2. A header is a CLAIM and a digest is something a verifier recomputes. If this
     change adds or alters a claim, say what makes it false and how a verifier
     would notice.
-->

## What this changes

<!-- One paragraph. -->

## Why

<!-- The situation, not only the solution. Link the issue if there is one. -->

## Which half

- [ ] the add-on (`thunderbird-extension/`)
- [ ] the gateway (`psemp-gateway/`)
- [ ] documentation / metadata only

## Checklist

- [ ] **A test would fail without this change.** Behaviour changes need one; it is not optional here.
- [ ] If a header was added: `HEADER_NAMES`, both engines (`buildHeaderLines` **and** `buildHeaders`), `user.js`, [`HEADERS.md`](../HEADERS.md), the `README.md` table, and a case in `extension-arming.cjs`.
- [ ] Header order respected — new headers appended, never interleaved.
- [ ] No `require()` or Node built-in in code that runs inside the MailExtension.
- [ ] Every listener still returns `{ details }` and still cannot throw.
- [ ] Version bumped in `manifest.json` **and** `package.json` (major.minor must match), plus the mirrors listed in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- [ ] [`CHANGELOG.md`](../CHANGELOG.md) has a line.
- [ ] Files are LF, not CRLF.
- [ ] Relative links in new Markdown resolve.

## Header contract

Only if this touches a claim on the wire:

| Field | Before | After |
| --- | --- | --- |
| name | | |
| value format | | |
| always / conditional | | |
| what makes it false | | |
| how a verifier notices | | |

## Validation

Paste the actual output, not a summary.

```text
$ node tools/check-repo.cjs
...
$ npm run suites
...
```

- [ ] `node tools/check-repo.cjs` — pass count: ___
- [ ] `npm run selftest` — pass
- [ ] `npm run suites` — suites passing: ___ / 13
- [ ] Tested on a real Thunderbird ESR 115+ profile (say so if not — some changes cannot be validated without one)

## Not tested

<!-- Be explicit. "I did not test the receipt path because it needs a live IMAP
     account" is a useful line; leaving it out is not. -->

## Licence

- [ ] I agree my contribution is licensed under Apache-2.0, and I have not removed a copyright or licence notice from vendored code (see [`THIRD_PARTY.md`](../THIRD_PARTY.md)).
