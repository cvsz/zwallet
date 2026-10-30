# GitHub Actions Trust Boundary

**Status:** Privileged automatic remediation and registry publication are disabled in this change.

## Untrusted pull-request boundary

Do not use `workflow_run` to check out a pull-request head and then execute an agent, script, or build with repository secrets or write-capable tokens. A `workflow_run` workflow executes from the default-branch workflow definition with a privileged token context; checking out the triggering PR SHA can cross the trust boundary.

The previous `codex-autofix.yml` workflow did exactly that: it reacted to failed CI, checked out `github.event.workflow_run.head_sha`, passed `OPENAI_API_KEY` to Codex, and granted `contents: write` plus `pull-requests: write`. It has been removed. Automated fixes must be prepared through a separately reviewed design that never executes untrusted PR content with privileged credentials.

## Codex PR audit

The remaining Codex PR gate:

- runs only for same-repository pull requests;
- uses a full-SHA, GitHub-verified Codex Action reference;
- checks out without persisting Git credentials;
- grants `contents: read` only;
- uses the `:read-only` Codex permission profile;
- transports the model result through an environment variable and parses JSON in Python, rather than interpolating model output into shell source;
- fails closed for malformed JSON, missing status, or any status other than `PASS`.

The gate is advisory/security validation. It is not an independent human approval and does not replace CodeQL, dependency review, required checks, or a `policedbc` review.

## Supply-chain validation

The supply-chain workflow now builds the API image locally, scans it with Trivy, generates a CycloneDX SBOM, and uploads the SBOM as a CI artifact. It has `contents: read` only and does not:

- log in to GHCR;
- push or overwrite an image tag;
- request `packages: write`;
- request `id-token: write`;
- sign an image or create release provenance.

Image publication and signing require a separate, reviewed, main-only release workflow with an exact source SHA, protected environment reviewers, digest verification, and accepted provenance. No registry publication or signing was performed by this change.

## Separate production-deployment blocker

Main `.github/workflows/cicd.yml` still contains automatic deployment behavior. Existing Draft PR [#208](https://github.com/cvsz/zwallet/pull/208) contains a manual-only deployment-admission candidate, but it is not merged or production-authorized. Keep production deployment blocked until that candidate is reconciled to current Main, exact-head CI/security and independent review pass, effective Main/environment governance is verified, and an operator approves the release. This document does not claim that production deployment is contained.

## Rollback

Do not restore the removed privileged `workflow_run` auto-fix workflow or PR-triggered registry publication. If automation must be restored, introduce it in a separate reviewed PR with a non-privileged event, read-only execution against untrusted PR content, no production secrets, and explicit operator-controlled publication/deployment gates.
