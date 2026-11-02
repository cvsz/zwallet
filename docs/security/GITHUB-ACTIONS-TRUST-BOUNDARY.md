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

## Production publication and deployment disabled in this candidate

This candidate removes .github/workflows/cicd.yml entirely. The Main version of that workflow combines:
- push-to-main GHCR image publication;
- a blue-green EKS deployment path;
- OIDC permission and cluster mutation steps.

The candidate deliberately does not replace those paths with another deployment workflow. The remaining .github/workflows/ci.yml is the source-validation workflow, and .github/workflows/supply-chain.yml builds locally, scans, and uploads an SBOM without registry credentials or write permissions. This is fail-closed containment, not evidence that production deployment is ready.

Main remains exposed until this candidate is reviewed and merged. Do not merge PR #217 until exact-head CI/security is executable and green, the candidate commit is signed, and independent review approves. Do not treat PR #208 as an alternate release path; it requires its own exact-head trust-boundary review.

A future production release workflow must be introduced separately and must include:
- protected Main and a protected Environment with required reviewers;
- exact source SHA and immutable, verified action references;
- narrowly scoped packages: write and id-token: write permissions;
- image digest verification and signed provenance;
- explicit operator confirmation;
- non-default, allowlisted target namespace and verified cluster identity;
- tested rollback and post-deployment health gates.

## Chaos test execution boundary

The pull-request workflow .github/workflows/chaos.yml is validation-only. It runs shell syntax validation and workflow contract tests; it does not execute tests/chaos/kill-pod.sh, invoke kubectl, or access cluster credentials. The script remains a potentially destructive operator tool and must not be run from pull-request automation. Any future chaos drill requires a separately reviewed manual workflow, a disposable non-production target, explicit context/namespace/pod allowlists, and an operator confirmation.

## Rollback

Do not restore the removed privileged workflow_run auto-fix workflow, secret-bearing PR Codex workflow, PR-triggered registry publication, automatic Main-push publication, or automatic cluster mutation. If automation must be restored, introduce it in a separate reviewed PR with a non-privileged event, read-only execution against untrusted PR content, no production secrets, and explicit operator-controlled publication/deployment gates.
