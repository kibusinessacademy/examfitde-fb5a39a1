---
name: BerufAgentOS v2 Cut 2.3 — Continuous Outcome Intelligence (Read-Only)
description: SSOT outcome_intelligence_findings (6 Kinds × 3 Scores) + 4 Admin-RPCs + Mission-Control-Page. Strikt read-only — keine Workflow-Mutationen.
type: feature
---

## SSOT
- Tabelle `outcome_intelligence_findings`: finding_key UNIQUE, kind (workflow_intelligence|outcome_drift|ux_friction|governance_risk|seo_intelligence|support_signal), title, interpretation (≥12 Z., kein KPI-Dump), affected_scope/signals jsonb, recommended_inspection, severity (info..critical), 3 Scores (confidence/severity/business_impact ∈ 0..1), status (open|acknowledged|muted|resolved_observed), FK business_intent_id + bundle_id.
- Helper `fn_outcome_intelligence_priority` = 0.4·severity + 0.4·impact + 0.2·confidence (IMMUTABLE).
- RLS: nur Admin lesen/schreiben/updaten.

## RPCs (admin-gated)
- `admin_record_outcome_intelligence(...)` — upsert via finding_key.
- `admin_classify_outcome_intelligence(id, new_status, reason≥5)` — Status-Transition mit Audit.
- `admin_list_outcome_intelligence(kind?, vertical?, status?, limit)` — sortiert nach priority_score desc.
- `admin_get_outcome_intelligence_summary()` — total/critical/high open, avg_priority, by_kind, by_vertical, recent_24h/_7d.

## Audit-Contracts
- `outcome_intelligence_recorded` (keys: finding_key, kind, severity, confidence_score, business_impact_score)
- `outcome_intelligence_status_changed` (keys: finding_key, from_status, to_status, reason)
- `outcome_intelligence_rescored` (keys: finding_key, severity, confidence_score, business_impact_score)

## UI
- `/admin/berufs-ki/outcome-intelligence` (`OutcomeIntelligencePage`): Outcome-Radar (5 KPI-Tiles), Verteilung nach Art, Filter (Kind × Status), Impact-Cards mit Interpretation + Empfehlung + 3 Scores + Klassifizierungs-Aktionen, Record-Dialog.
- Empty/Loading/Error States.

## Nicht enthalten (bewusst, für spätere Cuts)
- Auto-Detector-Edge (Cut 2.4 baut Fix Loop darauf).
- Auto-Heal / Auto-Notify (Loop B/Notifications-Subsystem zuständig).
- Detector-Heuristik-Library (kommt mit BerufDailyBrief).
- Anomaly-Trigger auf KPI-Tabellen.

## Lessons
- `ops_audit_contract` hat KEIN `description`-Feld — Pflichtspalten: action_type, required_keys, owner_module (default 'unknown').
