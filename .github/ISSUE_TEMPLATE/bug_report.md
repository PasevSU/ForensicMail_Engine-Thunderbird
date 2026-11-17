---
name: Bug report
about: Something computed, sent or verified the wrong thing
title: '[bug] '
labels: bug
---

<!--
  Please do not paste a real message, a real address list, a case id, a key
  fingerprint or a receipt into this issue. Redact first. If the report cannot
  be made without the real artefact, say so and we will arrange a private
  channel — see SECURITY.md.

  If the problem is that a claim can be made FALSE (a header that lies, a digest
  that can be bypassed, evidence that can be forged), that is a security report:
  use SECURITY.md instead of this form.
-->

## What happened

<!-- One paragraph. What did you expect, what happened instead. -->

## Which half

- [ ] the add-on (`thunderbird-extension/`)
- [ ] the gateway (`psemp-gateway/`)
- [ ] both
- [ ] documentation only

## Version

<!-- Both matter and they are independent. -->

- Add-on version (`manifest.json`, and the options page header):
- Thunderbird version, and whether it is ESR:
- Node version (`node --version`), if the gateway is involved:

## Reproduction

<!-- The smaller the better. A body of "hello" and one attachment is enough. -->

1.
2.
3.

## What you already checked

Please run these and paste the **redacted** output. A report that includes them
is dramatically more likely to be actionable, because most of these failures are
environmental rather than logical.

```bash
node tools/check-repo.cjs
node psemp-gateway/cli.js status
node psemp-gateway/cli.js self-test
node psemp-gateway/tools/verify-install.cjs
```

## Headers from the raw source

Paste the `X-PasevSU-*` block from **View Source** (`Ctrl+U`), not from the
message pane — the pane shows a curated subset and hides exactly the headers
that tend to be missing.

```text
X-PasevSU-Version:
X-PasevSU-Body-SHA256:
...
```

## Relevant console output

Add-ons → gear → **Debug Add-ons → Inspect**. Everything from the add-on is
prefixed `[PasevSU]`.

```text

```

## Does it happen every time?

- [ ] every send
- [ ] only with attachments
- [ ] only with HTML composition
- [ ] intermittently — roughly ___ of ___ sends

## Anything else

<!-- A hunch is welcome. "I think this is wrong but I have not run it" is a
     useful sentence; a confident guess about cryptographic behaviour is not. -->
