# GitHub Actions Trust Boundary

**Status:** Privileged automatic remediation and PR-triggered registry publication are disabled in this candidate. The current PR gate is a read-only workflow contract test; it does not invoke Codex, consume repository secrets, or write to the repository.

## Untrusted pull-request boundary

Do not use `workflow_run` to check out a pull-request head and then execute an agent, script, or build with repository secrets or write-capable tokens. A `workflow_run` workflow executes from the default-branch workflow definition with a privileged token context; checking out the triggering PR SHA can cross the trust boundary.

The previous `codex-autofix.yml` workflow did exactly that: it reacted to failed CI, checked out `github.event.workflow_run.head_sha`, passed `OPENAI_API_KEY` to Codex, and granted `contents: write` plus `pull-requests: write`. It has been removed. Automated fixes must be prepared through a separately reviewed design that never executes untrusted PR content with privileged credentials.

## Read-only workflow boundary contract

The workflow file `.github/workflows/codex-pr-gate.yml` retains its historical filename, but its current GitHub Actions name is **Workflow Boundary Contract**. It no longer performs a Codex audit or invokes a hosted AI action.

The workflow:

- runs on pull requests that change workflow or security-contract paths, and on pushes to `main` that change those paths;
- grants `contents: read` only at workflow and job level;
- checks out source using a full commit-SHA-pinned `actions/checkout` reference with `persist-credentials: false`;
- runs the Node built-in regression suite at `scripts/security/workflow-boundary.test.mjs`;
- does not reference repository secrets, invoke Codex, parse model output, or write to repository contents or pull requests.

The separate `.github/workflows/workflow-boundary.yml` workflow runs the same regression suite for changes to workflow files or the policy test. It also uses read-only permissions, a full-SHA-pinned checkout, and no persisted checkout credentials.

These checks validate workflow structure. They are not an independent human approval and do not replace CodeQL, dependency review, required checks, or an independent `policedbc` review.

## Supply-chain validation

The supply-chain workflow builds the API image locally, scans it with Trivy, generates a CycloneDX SBOM, and uploads the SBOM as a CI artifact. It has `contents: read` only and does not:

- log in to GHCR;
- push or overwrite an image tag;
- request `packages: write`;
- request `id-token: write`;
- sign an image or create release provenance.

Image publication and signing require a separate, reviewed, main-only release workflow with an exact source SHA, protected environment reviewers, digest verification, and accepted provenance. No registry publication or signing is performed by these PR-triggered validation workflows.

## Separate production-deployment blocker

Main `.github/workflows/cicd.yml` still contains a push-to-main image publication path and a blue-green deployment job. Draft PR [#208](https://github.com/cvsz/zwallet/pull/208) proposes manual-only deployment admission, but it remains open and unmerged. This candidate does not disable or authorize the current Main deployment path.

Keep production deployment blocked until PR #208 is reconciled with current Main, exact-head CI/security and independent review pass, effective Main and environment governance is verified, and an operator explicitly authorizes the release. This document does not claim that production deployment is contained.

## Rollback

Do not restore the removed privileged `workflow_run` auto-fix workflow or PR-triggered registry publication. If automation must be restored, introduce it in a separate reviewed PR with a non-privileged event, read-only execution against untrusted PR content, no production secrets, and explicit operator-controlled publication/deployment gates.
