---
name: Ghost-Completion Healer — Producer Invariant v1
description: fn_heal_ghost_completions nutzt finished_at (nicht completed_at) und setzt meta.executed='true' nur wenn ein completed Producer-Job existiert; sonst executed='false' + producer_evidence_missing
type: feature
---

# Ghost-Completion Healer — Producer Invariant

## Problem
Vorherige Migration v1 verwendete `package_steps.completed_at` — diese Spalte existiert NICHT. Korrekt: `finished_at`. Außerdem setzte der Healer pauschal `executed='true'`, was Ghost-Done-Zustände erzeugen konnte (insb. quality_council).

## Invariante (jetzt erzwungen)
- **Spalte**: `package_steps.finished_at` (NIEMALS `completed_at`).
- **Producer-Pflicht**: Healer dürfen `meta.executed='true'` NUR setzen, wenn ein
  `job_queue` Eintrag mit `status IN ('completed','done')` und passendem `job_type`
  (`package_<step_key>` oder bekannter Repair-Variante) existiert.
- Andernfalls: `executed='false'` + `producer_evidence_missing`. Das Audit-Modal
  (`WhyBlockedModal`) zeigt diesen Fall explizit an.

## Audit
- `admin_validate_done_step_meta(p_limit int)` liefert alle done-Steps ohne `meta.ok='true'`.
- `step_done_meta_audit` hat zusätzliche Indexe auf `source_fn` und `step_key`.
- `prune_step_done_meta_audit(p_keep_days int default 30)` für Retention.

## Frontend
- `useAutoPublishBlockedToast` Hook: Polling auf `step_done_meta_audit.blocked=true`,
  zeigt Sonner-Toast mit "Details"-Action → öffnet `WhyBlockedModal`.
- `StepDoneAuditPage` hat Filter (package_id, step_key, source_fn, blocked-only) + CSV-Export.
