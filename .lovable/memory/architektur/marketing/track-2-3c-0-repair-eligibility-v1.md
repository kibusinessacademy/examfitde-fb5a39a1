---
name: Track 2.3c-0 Repair Eligibility Projection v1
description: v_growth_repair_eligibility_v1 — pro Paket × fehlendem Signal eine Zeile mit root_cause, repair_strategy, requires_platform_fix, expected_job_type, expected_artifact, active_job_id, blocked_reason, safe_to_repair. Klassifiziert VOR Dispatch. Diagnose-only.
type: feature
---

# Track 2.3c-0 — Repair Eligibility Projection (2026-05-16)

## Zweck
Verhindert blinde Backfills. Vor jedem Repair-Dispatch (2.3c+) klassifizieren wir das fehlende Signal nach Strategie und Sicherheit. Lehre aus LF-Repair-Hotloops und OPS_GUARD-Requeues: **erst Ursache, dann Reparatur**.

## Schema `v_growth_repair_eligibility_v1` (service_role only)
Eine Zeile pro (package_id × missing signal). 12 Signale aus `v_package_growth_signals_v1` werden expandiert.

| Spalte | Bedeutung |
|---|---|
| `signal` | seo_present / canonical_ok / no_dead_end / tracking_* / conversion_events / blog / og_image / indexnow / internal_links / campaign_assets / distribution_targets |
| `root_cause` | semantische Ursache (missing_seo_page, canonical_unresolved, dead_end_links, tracking_not_emitted_*, no_events_observed, missing_*) |
| `repair_strategy` | enqueue_* / platform_fix_required / verify_pixel_wiring / observe_only |
| `requires_platform_fix` | true für canonical_ok, tracking_*, conversion_events (Code-Fix, kein per-Paket-Job) |
| `expected_job_type` | seo_intent_page_generate, seo_internal_link_repair, growth_blog_post_generate, growth_og_image_generate, seo_indexnow_submit, seo_internal_link_seed, growth_campaign_seed, growth_distribution_seed (NULL = nicht dispatchbar) |
| `expected_artifact` | Erwartetes Artefakt nach Repair (seo_content_pages.published, blog_articles.published, ...) |
| `active_job_id` | Dedup: bestehender pending/processing/queued Job desselben Typs für das Paket |
| `blocked_reason` | PACKAGE_ARCHIVED \| PACKAGE_NOT_PUBLISHED \| PACKAGE_NOT_LIVE \| PACKAGE_NOT_SELLABLE \| REQUIRES_PLATFORM_FIX \| NO_DISPATCHABLE_JOB_TYPE \| ACTIVE_JOB_PRESENT \| NULL |
| `safe_to_repair` | TRUE nur wenn published + sellable + nicht platform-fix + expected_job_type vorhanden + kein active job |

## RPCs (has_role-Gate, SECURITY DEFINER)
- `admin_get_repair_eligibility_summary()` — Aggregat: totals (signals/safe/blocked/platform/active/packages), by_strategy, by_blocked_reason
- `admin_get_repair_eligibility_signals(_strategy, _root_cause, _safe_only, _blocked_reason, _track, _limit)` — Drill-down

## UI
`RepairEligibilityCard` im HealCockpit (nach AttributionAuditCard):
- KPI-Strip (Signale / safe / blocked / platform_fix / active_job / packages)
- Strategy-Tabelle mit safe vs blocked Counts
- Filter: nur safe / nur blocked
- Drill-down zeigt package_key × signal × root_cause × blocked_reason

## Pitfalls
- View ist nur service_role — Frontend MUSS RPC nutzen (siehe SQL-Pitfalls Core-Rule).
- `expected_job_type` Namen sind **noch nicht** alle in `ops_job_type_registry` registriert — Dispatcher (2.3c) muss vor enqueue validieren oder neue Types über die Registry registrieren (siehe Identity-Contract Core-Rule).
- `active_job` Match ist auf (package_id, job_type) — wenn ein Producer mehrere Varianten desselben Repairs braucht (z.B. blog pro persona), wird dies in 2.3c via payload-Hash erweitert.
- `PACKAGE_NOT_SELLABLE` = kein product_id auf course_packages — Wartet auf Entitlement-Foundation S1.
- Kein Cooldown im View (zustandslos). Cooldown gehört in den Dispatcher (2.3c) via `auto_heal_log` last-attempt-Lookup.

## Erwarteter Effekt
Bei 190 published Paketen × 12 Signalen = max 2280 Zeilen, real ~600–700 (nur fehlende Signale). Vorhersage:
- ~190 × `canonical_unresolved` → platform_fix (blocked)
- ~190 × `tracking_*` → platform_fix (blocked)
- ~169 × `missing_seo_page` → safe_to_repair → 2.3c-Worker
- ~121 × distribution/campaign → safe_to_repair
- Real "safe" für Worker: ~300–400 Signale über ~150 Pakete

## Audit
`auto_heal_log.action_type = 'track_2_3c_0_init'` (Baseline 2026-05-16).
