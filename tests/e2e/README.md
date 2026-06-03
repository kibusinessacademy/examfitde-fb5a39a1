# ExamFit E2E Test Suite
# Requires: Playwright + @playwright/test

> Zentrales Testing-README: [`docs/testing/README.md`](../../docs/testing/README.md)
> Feature-Guard-Matrix: [`docs/testing/oral-exam-trainer-elevenlabs-guard.md`](../../docs/testing/oral-exam-trainer-elevenlabs-guard.md)
> Lokales Setup (Node aus `.nvmrc`, `E2E_TARGET`, Reports) ist im zentralen README dokumentiert.


## Setup
1. Install: `npm i -D @playwright/test`
2. Run: `npx playwright test`
3. Results are reported to the `test-orchestrator` Edge Function

## Structure
```
tests/e2e/
  helpers/
    auth.ts          – Login helper with storageState
    api.ts           – Edge function call helpers
    seed.ts          – Test seed trigger
  smoke.spec.ts      – Basic health checks (2-5 min)
  sanity.entitlements.spec.ts  – Entitlement system checks
  sanity.exam-pool.spec.ts     – Pool generation checks
  sanity.council.spec.ts       – Council/publish gate checks
  sanity.export.spec.ts        – Export integrity checks
  uat.azubi-flow.spec.ts       – Full learner workflow
  uat.tutor-guardrails.spec.ts – AI Tutor context binding
  uat.oral-exam.spec.ts        – Oral exam simulation
```

## Test Users (seeded via `test-seed` Edge Function)
- `smoke_no_entitlement@examfit.test` – No course access
- `smoke_with_entitlement@examfit.test` – Full course access
- `uat_azubi@examfit.test` – UAT learner account
