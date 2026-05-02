---
name: Pattern X5 — Queued-Pipeline-Stall + RPC-Grant-Drift
description: Pakete in status=queued mit erledigten Vorgänger-Steps + 0 Jobs sind unsichtbar für Standard-Heal-Crons. Fix: admin_heal_pending_enqueue_drift erkennt 'queued' als eligible, RPC admin_step_reset_detailed bekommt EXECUTE-Grant für service_role.
type: feature
---

# Pattern X5 — Queued-Pipeline-Stall (2026-05-02)

## Symptom
- UI Heal-Action meldet `function admin_step_reset_detailed(...) does not exist`
- Pakete bleiben dauerhaft auf `status=queued`, `0 active_jobs`, `done_steps>0`, `open_steps>0`
- Cron `admin_heal_pending_enqueue_drift` greift nicht — Eligibility war `status IN ('building','blocked')`

## Root Causes (mehrere Ebenen)
1. **RPC-Layer:** Kollidierender Overload `admin_step_reset_detailed(uuid,text[],text,text,boolean,boolean)` ohne EXECUTE-Grant → PostgREST gibt "does not exist" zurück.
2. **Cron-Layer:** Drift-Heiler ignorierte `queued` (nur `building/blocked` eligible).
3. **Track-Layer:** Track-Drift-Phantom-Steps (`generate_oral_exam` etc.) blieben `queued` mit `last_error LIKE '%track-drift detected%'`, weil kein Heiler sie auf `skipped` setzte.
4. **DAG-Layer:** `non_building_blocked` und `CAUSALITY_BLOCKED`-Errors auf Steps wurden nicht autom. resettet.

## Fix
- `DROP FUNCTION admin_step_reset_detailed(uuid,text[],text,text,boolean,boolean)` (alter Overload).
- `GRANT EXECUTE ON admin_step_reset_detailed(uuid,text[],text,text,boolean) TO service_role`.
- Neuer Helper `admin_skip_track_drift_steps(uuid)` mit Audit `pattern_x5_track_drift_skip`.
- `admin_heal_pending_enqueue_drift` erweitert: `queued` ist jetzt eligible, wenn `done_steps>0 AND open_steps>0 AND active_jobs=0`. Promote `queued/blocked → building` mit Feature-Flag `admin_force_building_pattern=X5_queued_pipeline_stall`.
- Tail-Steps + Steps mit `non_building_blocked`/`CAUSALITY_BLOCKED` werden auf `queued` resettet, `meta - 'last_atomic_enqueue_at'` clearen, dann `admin_nudge_atomic_trigger`.

## Manueller Bypass (Service-Role-Wrap)
```sql
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM admin_heal_pending_enqueue_drift(ARRAY['<uuid>']::uuid[], 'reason', false);
END $$;
```

## False-Positive-Filter (WICHTIG)
- Pakete mit `blocked_reason` der Form `ENRICHMENT_GATE: ...` oder `*_GATE:` sind **legitim blockiert** (warten auf Pre-Pipeline-Job wie Mass-Enrich). NICHT als X5 behandeln — Trigger `trg_assert_blocked_status_reason_consistency` kippt sie sofort zurück.
- v_admin_heal_pattern_x5_candidates sollte gates ausfiltern: `blocked_reason IS NULL OR blocked_reason NOT LIKE '%_GATE:%'`.

## Audit-Beweise
- `auto_heal_log` action_type: `pattern_x5_queued_stall_heal`, `pattern_x5_track_drift_skip`, `pattern_x5_cluster_heal`, `pattern_x5_reheal_verification`.
- Baseline 2026-05-02: 32 Pakete (Energieberater + Verwaltungswiss. + 30er-Cluster) in 1 Pass geheilt; 1 Re-Block (Verwaltungswiss.) als legitimer ENRICHMENT_GATE identifiziert. ~129 weitere Cluster-Kandidaten verbleiben für Folge-Pässe.
