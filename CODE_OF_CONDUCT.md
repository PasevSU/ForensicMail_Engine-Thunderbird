# Code of conduct

This is a small forensic-engineering project. The bar is simple: behave like a professional whose work will be read by someone else, and assume the other person is doing the same.

## Expected

- **Criticise the code, not the coder.** "This digest lets a filename inject a header" is useful. "You clearly don't understand headers" is not.
- **Bring evidence.** A reproduction, a line reference, a test that fails, a captured header block — anything checkable. This project's whole subject is verifiability, so its conversations should be verifiable too.
- **Say when you are unsure.** "I think this is wrong but I have not run it" is a valuable sentence. Guessing confidently about cryptographic behaviour is not.
- **Accept that security claims are load-bearing.** If you propose that something is signed, anchored, or verified, be ready to show the artefact that proves it.
- **Respect that mail is private.** Do not paste a real message, a real address list, a case id, a key fingerprint or a receipt into an issue. Redact first. If the bug requires the real artefact, ask for a private channel.
- **Write in whichever language you are clearest in.** English, Bulgarian and German are all fine here — the add-on is shipped in all three.

## Not acceptable

- Harassment, personal attacks, or sustained disruption.
- Publishing someone's private mail, address, key material, case material or credentials.
- Presenting someone else's work as your own, or removing a copyright or license notice from vendored code.
- Pressing for a security fix to be disclosed publicly before a fixed version exists. See [`SECURITY.md`](SECURITY.md) for the channel.
- Using an issue thread to argue that the project should not exist, or that forensic provenance should be weaker by default. Disagreement with the design is fine and welcome; a campaign against it is not a contribution.

## Scope

This applies to issues, pull requests, commit messages, discussions and any private correspondence about the project.

## Enforcement

Report a problem to `pasevdenislav@gmail.com`. Reports are read by the maintainer alone.

Responses are proportionate: a private note for a first lapse, a comment deletion or a temporary block for a repeat, a permanent ban for harassment or for publishing someone's private data. The maintainer will tell the reporter what was done, unless doing so would identify them against their wishes.

There is no committee and no appeals process. That is a limitation of a one-maintainer project, and it is stated here rather than discovered later.

## On disagreement

Technical disagreement is expected and healthy in this area — there are real arguments about whether digests belong in headers at all, whether a marker header like `X-PasevSU-OTS: pending` is honest enough, and whether a delivery receipt should be on by default. Make the argument with evidence. A pull request that makes the case concretely will be taken seriously even if it reverses a decision recorded here.

## Attribution

This document is original to this project rather than a copy of a standard template, so it can state what actually matters here: reproducible claims, private mail, and licence integrity.
