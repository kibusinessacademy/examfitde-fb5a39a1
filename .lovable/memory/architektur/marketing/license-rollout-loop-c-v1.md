---
name: License-Rollout & AI-Tutor Strict-RAG (Loop C)
description: Order paid → learner_course_grants. AI-Tutor mit Access-Gate (tutor_access_check), Strict-RAG Citation-Contract und ai_tutor_audit. Citation-Block [SOURCES] Pflicht.
type: feature
---

## Komponenten

**DB (Loop C Migration)**
- `ai_tutor_audit` — Citations + Decision + Validator-Score je Antwort. RLS: Owner+Admin SELECT.
- `learner_course_grants` (UNIQUE user+curriculum) — kanonisches Onboarding nach Order paid.
- `tutor_access_check(curriculum_id, daily_limit=200)` → JSONB {allowed,reason,used,limit}. Prüft has_role(admin), check_user_entitlement(...,'ai_tutor'), 24h-Rate über ai_tutor_logs.
- `tutor_log_audit(...)` SECURITY DEFINER — Audit-Insert.
- `grant_learner_course_access(...)` — idempotenter Grant.
- `process_order_paid_fulfillment(order_id)` — resolved curriculum via order_items→products→curriculum_id; ruft grant + crm_activity('order_fulfilled').
- Trigger `trg_orders_paid_grant` auf orders AFTER INSERT/UPDATE OF status.
- View `v_ai_tutor_audit_kpis` (30d, decision-Verteilung, avg_citations, avg_validator_score).

**Edge Function ai-tutor**
- Vor SSOT-Loader: `tutor_access_check` → 403 + Audit (blocked_no_entitlement|blocked_rate_limit) bei Deny.
- `loadAllowedSources()` baut Whitelist (lessons/competencies/blueprints/minichecks/exam_sessions).
- `buildCitationContract(allowed)` an System-Prompt angehängt — erzwingt `[SOURCES]…[/SOURCES]` Block mit Whitelist-IDs ODER exakte Refusal-Phrase "Ich kann diese Frage nicht aus dem freigegebenen Lehrmaterial beantworten."
- Nach Stream-Ende: `extractAndValidateCitations` → `writeTutorAudit` mit decision allowed/blocked_no_citation/validator_rejected.
- Im EXAM-Modus deaktiviert (Mode-Regeln dominieren).

## Pfade
- supabase/functions/_shared/tutor/strict-rag.ts (neu)
- supabase/functions/ai-tutor/index.ts (Gate + Contract + Audit)

## Verifikation
- `SELECT * FROM v_ai_tutor_audit_kpis` zeigt Decision-Mix.
- Order-Fulfillment auch ohne Stripe-Webhook-Code, da DB-Trigger orders.status='paid' fängt (auch für externe Inserts).
