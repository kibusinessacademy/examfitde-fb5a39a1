---
name: Growth Classification SSOT v1 Track 2.2
description: v_growth_signal_classification_v1 — 6 Klassen × scope × severity × repairable. Systemic ≥80% global gap → Plattform-Fix, NICHT Per-Paket-Repair. Diagnose-only.
type: feature
---

# Track 2.2 — Growth Signal Classification SSOT

## SSOT
`public.v_growth_signal_classification_v1` (service_role only) — eine Zeile pro **published Paket × fehlendem Signal** mit:
- `class`: SYSTEMIC_PLATFORM_DRIFT | SEO_ARTIFACT_MISSING | TRACKING_NOT_EMITTED | TRACKING_NOT_ATTRIBUTED | FANOUT_NOT_STARTED | OBSERVABILITY_GAP
- `scope`: `systemic` wenn ≥80% aller published Pakete dasselbe Gap haben, sonst `local`
- `severity`: critical (SYSTEMIC_PLATFORM_DRIFT, SEO_ARTIFACT_MISSING) / warn (TRACKING_*, FANOUT_*) / info (OBSERVABILITY_GAP)
- `repairable`: false für SYSTEMIC_PLATFORM_DRIFT + OBSERVABILITY_GAP, sonst true

Aggregat: `v_growth_classification_summary_v1` (class × scope × severity × repairable counts).

## Anti-Phantom-Prinzip
**Systemic ≥80% Gap = 1 Plattform-Fix, NIEMALS 190 Per-Paket-Repair-Jobs.** Beispiel canonical_ok=false bei 100% aller 190 Pakete → 1 Incident-Objekt, kein job_queue-Spam.

## Klassen-Repair-Matrix
| Klasse | Repairable | Wer fixt? |
|--------|-----------|-----------|
| SYSTEMIC_PLATFORM_DRIFT | nein | Plattform-Team (1×) |
| SEO_ARTIFACT_MISSING | ja | Artefakt-Generator (lokal oder batched) |
| TRACKING_NOT_EMITTED | ja | Pixel-/Producer-Wiring |
| TRACKING_NOT_ATTRIBUTED | ja | Attribution-Fix (package_id propagation) |
| FANOUT_NOT_STARTED | ja | post_publish_growth Worker |
| OBSERVABILITY_GAP | nein | Daten-Backfill / Metric-Sync |

## RPCs (has_role-Gate, SECURITY DEFINER)
- `admin_get_growth_classification_summary()` — total + critical_systemic_classes + repairable_local_signals + classes[]
- `admin_get_growth_classification_signals(_class,_scope,_severity,_repairable,_track,_limit)` — Drill-down

## UI
- `GrowthClassificationCard` im HealCockpit (nach GrowthSignalsCard)
- 3-KPI-Strip (published / systemic-critical / repairable-local) + Matrix-Tabelle + 4-Filter-Drill-down

## Baseline 2026-05-16 (190 published)
| Class | Scope | Sev | Repair | Signals | Pakete | Gap % |
|-------|-------|-----|--------|---------|--------|-------|
| SYSTEMIC_PLATFORM_DRIFT | systemic | critical | no | 190 | 190 | 100 |
| SEO_ARTIFACT_MISSING | systemic | critical | yes | 169 | 169 | 89 |
| TRACKING_NOT_ATTRIBUTED | systemic | warn | yes | 379 | 190 | 100 |
| FANOUT_NOT_STARTED | systemic | warn | yes | 156 | 156 | 82 |
| TRACKING_NOT_EMITTED | local | warn | yes | 139 | 139 | 73 |
| FANOUT_NOT_STARTED | local | warn | yes | 221 | 121 | 54 |

**Klare Ableitung:** 1 Plattform-Fix für Canonical (190 → 0), 1 Plattform-Fix für Attribution-Propagation (379 Signale → ~0), 1 Backfill für SEO-Artefakte (169 Pakete). Erst danach lokale 139 TRACKING_NOT_EMITTED + 121 lokale FANOUT-Gaps angehen.

## Audit
`auto_heal_log.action_type = 'growth_classification_v1_init'` (Baseline).

## Pitfalls
- View darf nie an authenticated granted werden — nur via SECURITY DEFINER RPC + has_role-Gate.
- Systemic-Threshold (80%) hartcodiert; spätere Anpassung via separater Config-Tabelle.
- Track 2.2 ist **diagnose-only** — keine Auto-Repair-Trigger gewired (verhindert Phantom-Welle).
