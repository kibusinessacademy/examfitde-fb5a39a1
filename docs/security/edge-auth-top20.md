# Edge Auth Contract — Top-20 Risk Ranking

Generated: 2026-05-08T16:23:05.610Z
Baseline: 392 legacy functions, scored by SERVICE_ROLE blast radius.

## Scoring
+3 service_role · +2 writes · +2 deletes · +2 admin_rpc · +1 pii · +1 no_method_gate · −1 cron_secret_check

| # | Function | Score | Signals | LOC |
|---|----------|-------|---------|-----|
| 1 | `b2c-ssot-smoke` | **11** | service_role, writes, deletes, admin_rpc, pii, no_method_gate | 646 |
| 2 | `pipeline-watchdog` | **10** | service_role, writes, deletes, admin_rpc, no_method_gate | 1162 |
| 3 | `e2e-product-test-runner` | **9** | service_role, deletes, admin_rpc, pii, no_method_gate | 279 |
| 4 | `admin-social-engine` | **8** | service_role, writes, deletes, no_method_gate | 319 |
| 5 | `build-course-package` | **8** | service_role, writes, deletes, no_method_gate | 320 |
| 6 | `content-runner` | **8** | service_role, writes, deletes, no_method_gate | 1646 |
| 7 | `course-reset` | **8** | service_role, writes, deletes, no_method_gate | 134 |
| 8 | `heal-recommend` | **8** | service_role, writes, admin_rpc, no_method_gate | 360 |
| 9 | `job-runner` | **8** | service_role, writes, admin_rpc, no_method_gate | 2711 |
| 10 | `nightly-forensic-audit` | **8** | service_role, writes, admin_rpc, no_method_gate | 1289 |
| 11 | `ops-runner-integration-test` | **8** | service_role, writes, deletes, no_method_gate | 314 |
| 12 | `package-elite-harden` | **8** | service_role, writes, admin_rpc, no_method_gate | 912 |
| 13 | `package-generate-handbook` | **8** | service_role, writes, deletes, no_method_gate | 867 |
| 14 | `package-generate-learning-content` | **8** | service_role, writes, deletes, no_method_gate | 531 |
| 15 | `package-generate-oral-exam` | **8** | service_role, writes, deletes, no_method_gate | 435 |
| 16 | `package-quality-council` | **8** | service_role, writes, admin_rpc, no_method_gate | 474 |
| 17 | `package-repair-failed-lessons` | **8** | service_role, writes, admin_rpc, no_method_gate | 202 |
| 18 | `package-scaffold-learning-course` | **8** | service_role, writes, deletes, no_method_gate | 218 |
| 19 | `pipeline-forensic-test` | **8** | service_role, writes, deletes, no_method_gate | 825 |
| 20 | `pipeline-logic-test` | **8** | service_role, writes, deletes, no_method_gate | 1034 |

## Refactor procedure
1. `import { assertAdmin } from "../_shared/edgeAuthContract.ts"`
2. `await assertAdmin(req, "<function-name>")` as the first statement after CORS preflight.
3. Remove the entry from `scripts/security/edge-auth-contract-baseline.json`.
4. CI guard will then HARD FAIL any regression.
