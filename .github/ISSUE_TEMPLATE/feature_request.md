---
name: Feature request
about: A new header, command, or verification step
title: '[feature] '
labels: enhancement
---

## The problem

<!-- What can you not do or not prove today? Describe the situation, not the
     solution — the situation usually admits a simpler fix than the first idea. -->

## What it would take to be convinced

This project treats a header as a **claim** and a digest as **something you
recompute**. So a proposal for a new header is really a proposal for a new
check. Please answer:

1. **What artefact would exist** that does not exist today?
2. **Who can verify it**, and with what command?
3. **What would make it false**, and how would a verifier notice?

A feature that adds a header nobody can check is a feature that adds
unverifiable text to everyone's mail. It will be declined on those grounds, not
on grounds of taste.

## Which half

- [ ] the add-on (`thunderbird-extension/`) — remember: WebExtension APIs and Web Crypto only, no `require()`, no Node, no filesystem, no network, no process spawning
- [ ] the gateway (`psemp-gateway/`)
- [ ] documentation

## Platform check

If this touches the add-on, confirm it is even possible in a MailExtension:

- [ ] the API it needs exists in Thunderbird ESR 115+ (link: )
- [ ] it does not require reading the PGP keyring
- [ ] it does not require signing
- [ ] it does not require filesystem, network, or a child process
- [ ] the header name starts with `X-` (anything else aborts the send with no dialog)

## Compatibility

Adding a header is a **minor** version. Renaming or removing one is a **major**
version — see the semver policy in [`CHANGELOG.md`](../../CHANGELOG.md). Who breaks
if this lands?

- [ ] existing verifiers keep working (headers are appended, never interleaved)
- [ ] `psemp-gateway/test/extension-arming.cjs` can compare both engines for it
- [ ] a line in `thunderbird-extension/user.js`
- [ ] a row in [`HEADERS.md`](../../HEADERS.md) and the `README.md` table

## Alternatives considered

<!-- Including "do nothing" and "do it outside the add-on". Several proposals
     belong in the gateway, or in Thunderbird's own OpenPGP configuration. -->
