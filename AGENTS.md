# AGENTS.md — zWallet Autonomous Engineering Protocol (v2 - Production)

## READ FIRST — Canonical ZeaZDev Policy

Before changing this repository, read the canonical ecosystem policy:
https://github.com/cvsz/zeaz/blob/main/zeaz.md

This policy is mandatory. This repository's wallet, ledger, key-management, and transaction invariants below remain in force and may be stricter. Do not weaken them to bypass security, privacy, review, validation, or release controls.

## 0) Mission
Deliver production-grade, secure, scalable crypto + payment infrastructure.

System scope includes:
- Non-custodial wallet (MPC / AA)
- Swap engine (DEX + RFQ)
- Card + fiat rails
- Distributed backend services

---

## 1) Execution Contract (MANDATORY LOOP)

Analyze → Plan → Implement → Validate → Test → Fix → Output

Additional enforcement:
- All blockchain operations must be simulated before execution
- All financial operations must be idempotent

---

## 2) Non-Negotiable Rules

- No TODO / placeholder / pseudo
- No broken builds
- No unsafe crypto usage
- No direct trust in external RPC/API
- Diff must be minimal and scoped

---

## 3) Architecture Authority

Layers:
- `/apps` → Android / UI
- `/services` → APIs, workers
- `/packages` → crypto, shared logic
- `/infra` → deployment

Strict separation:
- Signing → client or MPC only
- Backend → orchestration only

---

## 4) WALLET + CRYPTO RULES (CRITICAL)

- Private keys:
  - NEVER leave client or MPC boundary
  - MUST be encrypted at rest (AES-256-GCM or stronger)

- Signing:
  - MUST be deterministic
  - MUST verify chain ID + nonce

- Memory:
  - Wipe sensitive buffers after use

- Preferred:
  - MPC / threshold signing
  - Account abstraction (ERC-4337)

---

## 5) TRANSACTION PIPELINE (MANDATORY)

All tx must follow:

1. Input validation
2. Simulation (eth_call / dry-run)
3. Gas estimation
4. Nonce management
5. Signing
6. Broadcast via trusted RPC
7. Confirmation tracking

Reject if:
- simulation fails
- gas spikes beyond threshold

---

## 6) SWAP ENGINE RULES

- Must:
  - Compare multiple routes
  - Include gas in scoring
  - Enforce slippage limits

- Prefer:
  - RFQ / intent-based execution
  - MEV-protected RPC (Flashbots/private mempool)

- Reject:
  - single-source routing
  - unbounded slippage

---

## 7) CARD + FIAT RULES (STRICT)

- PCI data must NEVER enter core backend
- Use tokenized card providers only

All card flows:
1. KYC must be completed
2. Risk engine must approve
3. Liquidity must be pre-funded

- Must support:
  - freeze/unfreeze
  - spend limits
  - MCC filtering

---

## 8) RPC + INFRA RESILIENCE

- MUST use multi-RPC providers
- Implement:
  - fallback routing
  - circuit breakers
  - timeout + retry policies

- NEVER rely on single RPC endpoint

---

## 9) EVENT PROCESSING RULES

- All async jobs must be:
  - idempotent
  - retry-safe

- Use:
  - message queues (Kafka/NATS)
  - deduplication keys

---

## 10) SECURITY HARDENING

- Enforce:
  - input validation (Zod / strict types)
  - rate limiting
  - JWT rotation

- Mobile:
  - secure storage (keystore)
  - certificate pinning
  - root detection

---

## 11) TESTING REQUIREMENTS

Must include:
- Unit tests (core logic)
- Integration tests (API + chain)
- Failure scenarios:
  - RPC failure
  - insufficient liquidity
  - invalid signature

---

## 12) DEPLOYMENT

- Dockerized services
- Kubernetes-ready
- Health checks required
- Observability:
  - metrics (Prometheus)
  - logs (structured)

---

## 13) QUALITY GATE

Reject PR if:
- insecure crypto
- missing validation
- centralization risk
- no test coverage for critical logic

---

## 14) Definition of Done

- docker-compose up works
- critical flows pass (wallet + swap + card)
- no security violations
- logs + metrics visible

---

## 15) Final Output Format

- Summary (file-level changes)
- Validation (checks run)
- Testing (commands + results)
- Risks (real only)

---

## 16) Guiding Principle

If trade-off exists:
→ prioritize **security > correctness > performance > speed**
