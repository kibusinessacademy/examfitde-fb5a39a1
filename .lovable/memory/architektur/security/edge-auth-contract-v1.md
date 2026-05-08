---
name: Edge Auth Contract v1
description: assertAdmin SSOT für Edge Functions, Forbidden-Patterns, Baseline-Ratchet, security_events Audit
type: feature
---
SSOT-Helper supabase/functions/_shared/edgeAuthContract.ts → assertAdmin(req, fnName).
Akzeptiert genau drei Modi: (1) x-internal-secret/x-job-runner-key === EDGE_INTERNAL_SHARED_SECRET (constant-time), (2) Bearer === SUPABASE_SERVICE_ROLE_KEY (exact, KEINE substring-includes), (3) Admin-JWT via user_roles.has_role.

Forbidden patterns (CI-Guard scripts/security/edge-auth-contract-guard.mjs blockt PRs):
- authHeader.includes(serviceKey|SERVICE_ROLE)
- trustedSources.includes(...)
- body.source === "ci"|"cron"|"cron_nightly"|"nightly"
- mode==="simulate" ohne assertAdmin/requireAdmin/EDGE_INTERNAL_SHARED_SECRET

Ratchet: scripts/security/edge-auth-contract-baseline.json (392 Legacy-Funktionen). Neue SERVICE_ROLE-Nutzung ohne Guard = HARD FAIL. Refactor (= Entfernen aus Baseline) jederzeit erlaubt. PUBLIC_FUNCTION_ALLOWLIST nur für signierte Webhooks.

Audit-Log: Bei blocked auth schreibt assertAdmin security_events (event_type='edge_auth_blocked', decision='block', reason, ip_hash/ua_hash sha256[0..16], meta.function_name).

Refactored 2026-05-08: admin-production-supervisor-cron, course-heal-plan-generate, pipeline-forensic-monitor, run-tests, schema-health.

Workflow: .github/workflows/edge-auth-contract-guard.yml.
RLS-Audit Snapshot: .lovable/security/rls-audit-2026-05-08.md (33 anon-policies dokumentiert intentional, 1 RLS-no-policy table = no-access by design).
