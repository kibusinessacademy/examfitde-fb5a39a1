
## Ziel

Autonomes Detect → Classify → Repair → Verify → Republish → Re-Smoke für die Commerce-Schicht — ohne manuelle Reviews. Ergebnis: alle visible Pakete laufen automatisch in `FULLY_OPERATIONAL`, neue Pakete werden mitgeheilt.

## Governance-Vorprüfung (Architectural Continuity Guard)

Pflicht laut Core-Memory vor neuen Views/RPCs/Edges/Crons:

- **EXTEND_EXISTING**: Klassifizierung wird neue View `v_commerce_gap_classification` aufgesetzt auf bestehende SSOTs (`v_public_sellable_courses`, `v_sellable_and_deliverable`, `v_package_customer_safe_v1`, `v_lessons_gap_ssot`, `v_package_operational_state_v1`, `funnel_smoke_runs`). Keine neuen Status-Tabellen.
- **NO_PARALLEL_SYSTEMS**: Repair läuft über `job_queue` + bestehende `repair_*` Job-Types und `ops_job_type_registry`. Kein neuer Worker, kein Schatten-Queue.
- **GOVERNANCE_BEFORE_AUTOMATION**: Cron erst nach Dry-Run-Validierung (≥48h shadow mode mit `auto_heal_log` audit, kein Enqueue).
- **AUDITABLE_MUTATIONS**: jede Heal-Action via `fn_emit_audit` (`commerce_heal_*` action_types in `ops_audit_contract` registriert).
- **NO_AUTONOMOUS_PRODUCTION_WRITES**: WIP-Cap pro Lauf (default 20 Pakete, 1 Repair-Action pro Paket pro Cooldown), Bronze-Lock & Reaper-Loop respektiert.
- **Architecture-Freeze post Bridge 16**: dieses Vorhaben ist **kein** neuer Intelligence-Layer (kein Bridge 17+), sondern **Track-1/Track-3-Operationalisierung** (B2B-Lieferfähigkeit + Conversion-Pfad-Stabilisierung). Damit konsistent zu Freeze.

## P1 — Commerce Gap Classification (SSOT-View)

Read-only View `v_commerce_gap_classification`, eine Zeile pro `course_packages.id`, Spalten:

```text
package_id, canonical_slug, status, is_visible, is_sellable, delivery_ready,
gap_codes text[],   -- subset von:
  MISSING_CANONICAL, MISSING_PRICE, MISSING_DELIVERY, MISSING_LESSONS,
  MISSING_EXAM_POOL, MISSING_TUTOR, MISSING_ENTITLEMENT,
  CHECKOUT_FAIL, TRACKING_FAIL, SEO_NOT_READY
severity int,        -- 0 ok, 1 minor, 2 revenue-blocking, 3 silent-loss
last_smoke_run_id, last_smoke_success, last_heal_at
```

Quellen pro `gap_code` (kein Neubau, nur JOINs):

| gap_code            | Quelle                                                        |
|---------------------|---------------------------------------------------------------|
| MISSING_CANONICAL   | `products.canonical_slug IS NULL`                             |
| MISSING_PRICE       | `fn_package_pricing_ready` = false                            |
| MISSING_DELIVERY    | `v_package_customer_safe_v1.delivery_ready` = false           |
| MISSING_LESSONS     | `v_lessons_gap_ssot` LESSONS_NOT_READY                        |
| MISSING_EXAM_POOL   | `v_package_operational_state_v1.exam_pool_ready` = false      |
| MISSING_TUTOR       | `v_package_operational_state_v1.tutor_ready` = false          |
| MISSING_ENTITLEMENT | `fn_default_channel_policy` Defaults fehlen                   |
| CHECKOUT_FAIL       | letzter `funnel_smoke_runs.success` = false                   |
| TRACKING_FAIL       | `conversion_events` package_id-Bindung fehlt (Strict-Event-Guard) |
| SEO_NOT_READY       | persona_landing/cert_pillar nicht published                   |

Pflicht: Read-only, REVOKE FROM authenticated, Zugriff nur via SECURITY DEFINER RPC `admin_get_commerce_gap_summary` + `_detail` (has_role gate).

## P2 — Commerce Auto-Heal Dispatcher (Repair-Matrix)

Mapping als **Code-SSOT** in `src/lib/commerce/commerceHealMatrix.ts` (kein eigenes Registry-Table — `ops_job_type_registry` ist die Job-SSOT):

```text
gap_code            → job_type (existing)                    cooldown
MISSING_DELIVERY    → post_publish_content_repair_lessons    6h
MISSING_LESSONS     → package_repair_lessons                 6h
MISSING_EXAM_POOL   → package_generate_exam_pool             12h
MISSING_TUTOR       → package_repair_tutor_index             12h
MISSING_PRICE       → (no enqueue) → audit pricing_prepare_required, NO auto
MISSING_CANONICAL   → (no enqueue) → DB-side already STORED, audit drift only
CHECKOUT_FAIL       → re-run funnel-smoke-daily targeted     1h
SEO_NOT_READY       → seo_intent_page_generate (per persona) 24h
TRACKING_FAIL       → audit only, manual review              —
MISSING_ENTITLEMENT → audit + admin_repair_entitlements RPC   24h
```

Dispatcher-RPC `admin_commerce_heal_dispatch_one(p_package_id, p_dry_run default true)`:
- prüft Bronze-Lock (`fn_is_bronze_locked`), aktive Jobs, Cooldown via `auto_heal_log`
- emittiert `commerce_heal_dispatch_attempt` (Pflichtaudit)
- enqueued via existierende `enqueue_package_job_*`-Pfade (NIE direkter `job_queue`-Insert)
- liefert `{decision: enqueued|skipped|deferred, reason, job_id?}`

## P3 — Re-Smoke Verification Loop

Verify ist Pflicht — sonst Heal-Loop. Ablauf nach Heal-Job-Done (Trigger auf `job_queue` AFTER UPDATE status=done):

1. Wenn `payload.commerce_heal_run_id` gesetzt → enqueue `funnel-smoke-daily` mit `mode=targeted, slugs=[<canonical_slug>]`.
2. Smoke-Resultat schreibt `funnel_smoke_runs.success` → re-evaluate `v_commerce_gap_classification`.
3. Audit-Kette: `commerce_heal_repair_done` → `commerce_heal_verify_smoked` → `commerce_heal_state_transition` (closed | still_failing | new_gap_emerged).
4. Nach 3 erfolglosen Verify-Cycles pro Paket → hard-fail breaker (status `manual_review_required`, kein weiterer Auto-Enqueue).

## P4 — Commerce Readiness Cockpit

UI-Card `CommerceReadinessCard` im bestehenden `/admin/v2/heal-cockpit`:
- KPI-Strip: visible / sellable / deliverable / fully_operational / heal_in_progress / breaker_locked
- Gap-Verteilung (stacked bar pro `gap_code`)
- Top 10 stuck packages (severity desc, last_heal_at asc)
- Heal-Efficacy 7d (`enqueued / closed / still_failing / breaker`)
- SLA-Trend: median time-to-fully_operational
- Re-Run-Button → `admin_commerce_heal_dispatch_one(dry_run=false)`

Quelle: drei neue SECURITY DEFINER RPCs (`admin_get_commerce_readiness_summary`, `_detail`, `_efficacy_trend`).

## P5 — Auto-Promotion (gated)

State-Machine Trigger `trg_commerce_auto_promote_on_green`:
- Wenn `v_commerce_gap_classification.gap_codes = '{}'` und letzter Smoke success und `funnel_smoke_runs` ≥3 grün in Folge → `course_packages.feature_flags.commerce_auto_promoted_at = now()`.
- Promotion ist additiv (Sichtbarkeit/Sellable/Deliverable/SEO-Published bleiben Existing-Flags). Trigger setzt **nicht selbst** publish-state, sondern enqueued `package_auto_publish` (gehärteter Pfad) + Audit `commerce_auto_promote_enqueued`. Damit bleibt die bestehende Publish-Governance der Single-Source-of-Truth.
- Pflicht-Skip: Bronze-Lock, manueller `do_not_auto_publish`-Flag, `manual_review_required` Breaker.

## Cron & Rollout

| Cron                                  | Schedule    | Wirkung                       |
|--------------------------------------|------------|-------------------------------|
| `commerce-gap-detect-15min`          | `*/15 * * * *` | Phase 1: nur audit `commerce_gap_snapshot` (shadow) |
| `commerce-heal-dispatch-15min`       | `5,20,35,50 * * * *` | Phase 2: enqueue (WIP-Cap 20)         |
| `commerce-heal-verify-10min`         | `*/10 * * * *` | Phase 3: re-smoke targeted    |

**Rollout-Stages**:
1. **Stage A (read-only)**: View + RPCs + Cockpit-Card. Detect-Cron schreibt nur Snapshots. **48h beobachten.**
2. **Stage B (dry-run)**: Dispatcher live mit `dry_run=true` default. Audit zeigt geplante Enqueues. **48h beobachten.**
3. **Stage C (bounded enqueue)**: Dispatcher real, WIP-Cap 5/Stunde, kein Auto-Promote.
4. **Stage D (full loop)**: WIP-Cap 20/Stunde, Verify-Loop aktiv, Auto-Promote Trigger an.

Jede Stage-Promotion via Architecture-Review-Eintrag.

## Tests

- pgTAP/SQL-Smoke `supabase/tests/commerce_gap_classification_smoke.sql`: jede `gap_code`-Quelle isoliert + kombiniert.
- Vitest `src/lib/commerce/__tests__/commerceHealMatrix.test.ts`: Mapping-Vollständigkeit, Cooldown-Werte, Bronze-Skip.
- Deno `supabase/functions/commerce-heal-dispatcher/dispatcher_test.ts`: Dry-Run, Cooldown, Breaker.
- E2E: `scripts/commerce-heal-loop-smoke.mjs` simuliert Gap → Dispatch → Verify → Close auf Test-Paket.

## Akzeptanzkriterien

- 100% der `v_public_sellable_courses` Pakete haben in `v_commerce_gap_classification` eine Zeile.
- Stage A: 0 unerwartete `gap_codes` außerhalb der dokumentierten 10 Codes.
- Stage C: ≥80% der enqueued Heal-Actions schließen den Gap innerhalb 24h (`commerce_heal_state_transition=closed`).
- Stage D: Heal-Loop-Detector zeigt 0 Pakete mit >3 Verify-Cycles ohne Breaker.
- Cockpit zeigt Trend-Reduktion `MISSING_DELIVERY` Kohorte (164 → <20) ohne manuelles Eingreifen.

## Out of Scope (bewusst)

- Pricing-Generation (`MISSING_PRICE`) bleibt manueller Pricing-Integrity-Hard-Gate v2.
- Tracking-Repair (`TRACKING_FAIL`) bleibt manuelles Review (Daten-Integrität-Risiko).
- Bridge 17+ Intelligence-Schichten (Forecast-Calibration, Heal-RL): explizit gesperrt durch Architecture-Freeze.

## Architectural-Continuity-Eintrag (vor Implementierung)

Pflicht-Submission unter `/admin/governance/architecture` mit `proposal_kind=automation`, Begründung: alle 10 Rules erfüllt (siehe oben), erweitert nur Existing Systems.

