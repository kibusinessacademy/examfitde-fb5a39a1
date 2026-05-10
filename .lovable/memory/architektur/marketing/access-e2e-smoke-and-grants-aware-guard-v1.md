---
name: Access E2E Smoke + Grants-Aware Guard v1
description: b2c-ssot-smoke mode=access_e2e mit drop_entitlement, grants-aware can_access_product Path D/D2, CI-Guard für neue Access-RPCs
type: feature
---
**SSOT Layer 2 (Verification)** für den Single Choke-Point aus access-ssot-single-choke-point-v1.

## b2c-ssot-smoke mode=access_e2e
Synth paid order → asserts via service-role RPCs:
- `check_product_access_by_curriculum(feat)` == true für alle 4 Features (learning_course, exam_trainer, ai_tutor, oral_trainer)
- `tutor_access_check.allowed === true` UND `reason !== 'no_entitlement'` (Path D Beweis)
- `has_storage_entitlement === true`
- `can_access_product === true`

Optional `{drop_entitlement: true}` löscht die Entitlement-Zeile (source_ref=order_id) und wiederholt alle Asserts → beweist dass Grant alleine ausreicht. Smoke 2026-05-10: baseline source='entitlement', grant_only source='grant', beide allowed=true.

## can_access_product grants-aware (Path D + D2)
- Path D: direkter `learner_course_grants.product_id = p_product_id AND status='active'`
- Path D2: Grant via curriculum-mapping `JOIN products ON p.curriculum_id = g.curriculum_id` (für Grants ohne product_id)
- Schließt letzte entitlement-only Lücke neben tutor_access_check + has_storage_entitlement.

## CI Guard
`scripts/guards/access-rpc-grants-aware-guard.mjs`:
- Scannt LATEST CREATE OR REPLACE FUNCTION pro Name in supabase/migrations
- Access-shaped Pattern: `check_*access*|can_access_*|has_*entitlement*|tutor_access_check|*_access_check`
- Fail wenn Body `entitlements`/`check_user_entitlement` referenziert OHNE `learner_course_grants` ODER Delegation an SSOT (check_product_access_by_curriculum, can_access_product, has_storage_entitlement, tutor_access_check)
- Baseline: `scripts/guards/access-rpc-grants-aware-baseline.json` (legacy: check_unified_access)
- Workflow: `.github/workflows/access-rpc-grants-aware-guard.yml`

## Server-Smoke Wiring
`scripts/b2c-ssot-server-smoke.mjs` default SMOKE_MODES erweitert um `access_e2e`. Asserts baseline.{4 features, tutor.allowed, storage, product} sowie expliziter `tutor.reason !== 'no_entitlement'` Check.
