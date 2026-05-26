---
name: Cut 6.1 Phase 2 — HR-Demo Edge + Frontend + Activation-Signals
description: SSE-Edge hr-demo-personalize (Hybrid: kuratierte RPC + AI-Gateway Stream), /demo/hr Frontend, lead_activation_signals SSOT, Rate-Limit
type: feature
---

# Cut 6.1 Phase 2 (2026-05-26) — HR-Demo vertikal live

## Lieferungen

### L3 — Activation-Signal-SSOT + Rate-Limit
- **Tabelle** `lead_activation_signals` (anonymous_id, session_id, user_id, persona, signal_type, package_id, painpoint_key, ip_hash, metadata). RLS enabled, service_role-only SELECT+INSERT.
- **RPC** `record_activation_signal(...)` SECURITY DEFINER, EXECUTE für anon+authed+service_role. Pflicht-Validierung persona+signal_type.
- **RPC** `fn_demo_rate_limit_check(_persona,_ip_hash,_anonymous_id,_window_minutes=60,_max_calls=5)` STABLE SECURITY DEFINER, service_role only. Doppel-Schlüssel (ip_hash OR anonymous_id) gegen Cookie-Clearing-Bypass.
- **Audit-Contracts** registriert: `demo_personalize_invoked`, `demo_personalize_rate_limited`, `demo_personalize_completed`.

### Edge `hr-demo-personalize`
- POST { painpoint_key, anonymous_id?, session_id?, role?, company_size? } → SSE.
- Pipeline: ip_hash (SHA-256, gesalzt) → fn_demo_rate_limit_check → 429 mit reset_at bei Block → public_match_packages_for_painpoint (jsonb {matches[], painpoint_label}) → 404 falls keine Matches → public_get_demo_competency_summary → record_activation_signal('demo_personalize_request') → Lovable AI Gateway `google/gemini-3-flash-preview` Stream → Pass-through SSE + Meta-Frame `event: meta` (Frontend rendert Match-Card sofort) → Tail-Audit `demo_personalize_completed` mit `tokens_streamed`.
- AI-Gateway 402/429 wird sauber zum Client durchgereicht.

### Frontend `/demo/hr` (`src/pages/demo/DemoHrPage.tsx`)
- Persona HR, 6 vordefinierte Painpoints (Radio-Group, semantisches fieldset+legend), optionale Felder Rolle/Größe (maxLength 80/40).
- SSE-Parser parsed `event: meta` + `data: {…delta}` getrennt; `aria-live=polite` + `aria-busy` für Screen-Reader.
- Tracking via `trackFunnel`: `lead_magnet_view` (Mount) → `quiz_started` (Run) → `quiz_completed` (Done) → 2 `hero_cta_click`-CTAs (view_package / talk_to_sales) mit package_id.
- Route: `/demo/hr` lazy-registered in `src/routes/AppRoutes.tsx`.

## Smoke 2026-05-26
- `POST /hr-demo-personalize` mit painpoint=ausbildung_ihk → 200, Meta-Frame AEVO (score 30) + Tokens streamen + 2 audit-rows (request, completed/1137 tokens).
- Architectural Continuity: NO_PARALLEL_SYSTEMS ✓ (alle 4 RPCs vorhanden), AUDITABLE_MUTATIONS ✓ (3 contracts), SECURITY_INHERITS ✓ (service_role-only rate-limit), NO_HIDDEN_STATE ✓.

## Noch offen (Phase 3)
- Vitest-Smoke für DemoHrPage + Edge-Smoke-Script `scripts/cut-6-1-hr-demo-smoke.mjs`.
- A11y-axe in `src/test/a11y/`.
- Full-Suite-Gate + Memory-Freeze.

## Rollback
```sql
DROP FUNCTION IF EXISTS public.fn_demo_rate_limit_check(text,text,text,int,int);
DROP FUNCTION IF EXISTS public.record_activation_signal(text,text,text,text,uuid,text,text,text,jsonb);
DROP TABLE IF EXISTS public.lead_activation_signals;
DELETE FROM public.ops_audit_contract WHERE action_type IN ('demo_personalize_invoked','demo_personalize_rate_limited','demo_personalize_completed');
-- Edge: delete supabase/functions/hr-demo-personalize/, Frontend: revert DemoHrPage + route.
```
