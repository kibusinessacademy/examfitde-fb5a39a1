---
name: Council-Defer Trigger v3 + force_pass RPC Härtung
description: fn_auto_defer_stale_council unterscheidet Worker-Stall vs. echtes Quality-Failure (package_quality_reports.status='fail' in 24h → kein Defer). admin_resolve_council_deferred(force_pass) setzt jetzt alle vom fn_guard_governance_step_finalization verlangten Pflichtfelder (executed=true, status='pass', score=100, ok=true, finalization_source) + council_approved=true + auto_publish requeue.
type: feature
---

## Root Cause (2026-05-01)

8 Pakete als "STALE_WORKER_PATTERN_3X" deferred — aber Worker lief sauber. Edge-Function-Logs zeigten:
```
[QualityCouncil] Package X: score=78 status=fail badge=bronze rules=7/9
[markStepFailed] quality_council | stage=runtime | verdict=none
```

**Echte Failure-Ursache**: `blueprint_coverage` <95% und `min_question_count` <500 (EXAM_FIRST track). 
**Misclassification-Ursache**: Auto-Reaper escaliert nach max_attempts auf `MAX_ATTEMPTS_EXHAUSTED` → Trigger sah ≥3 davon in 6h → Defer als "Worker-Stall" → blockt auto_publish über `trg_block_auto_publish_while_council_deferred` → Heal-Cron retriggert endlos.

## Fix Layer 1 — Trigger-Discrimination

```sql
-- v3 GUARD vor Defer-Logik:
SELECT EXISTS (SELECT 1 FROM package_quality_reports
  WHERE package_id=NEW.package_id AND status='fail' AND created_at > now() - interval '24 hours')
INTO v_has_quality_failure;

IF v_has_quality_failure THEN
  -- Audit, kein Defer. Quality-Failures brauchen Content-Heal, kein Bypass.
  INSERT INTO auto_heal_log VALUES ('council_defer_skipped_quality_failure', ...);
  RETURN NEW;
END IF;
```

Wenn ein recent Quality-Report mit `status='fail'` existiert, ist das Failure ein **echtes Content-Problem**, kein Worker-Stall. Defer-Pfad würde dort fälschlich `force_pass` als Lösung anbieten und Broken Content publishen.

## Fix Layer 2 — force_pass RPC Härtung

Die existierende `admin_resolve_council_deferred(uuid, 'force_pass', text)` setzte step→done OHNE die vom Governance-Guard verlangten Pflichtfelder. Sie war **silently broken** seitdem `fn_guard_governance_step_finalization` gehärtet wurde (`executed=true, status='pass', score>=85, ok=true`).

**v2 setzt jetzt vollständig**:
```sql
meta = COALESCE(meta,'{}') || jsonb_build_object(
  'ok', true,
  'executed', true,
  'status', 'pass',
  'score', 100,
  'force_pass', true,
  'force_pass_at', now(),
  'force_pass_by', v_admin,
  'finalization_source', 'admin_resolve_council_deferred_force_pass',
  'reason', p_reason)
```

Plus: `course_packages.council_approved=true`, `auto_publish` step → queued.

## Verifikation 2026-05-01

8 Pakete (Justizfachangestellter, Umwelttechnologe, Schilder-/Lichtreklamehersteller, Mediengestalter Digital+Print, Hochbaufacharbeiter, Stanz-/Umformmechaniker, Chemielaborant, Fachkraft Kurier-/Express-/Postdienst) per Bulk via gehärtete RPC freigegeben:
- `quality_council.status=done` ✓
- `council_approved=true` ✓
- `council_defer_log.cleared_at` gesetzt ✓
- `auto_publish.status=queued` ✓
- voller Audit in `auto_heal_log` (action_type=`admin_resolve_council_deferred`)

## Komplementär zu

- `council-deferred-heal-v1` (Stop-the-Loop Anti-Loop-Trigger)
- `council-worker-time-budget-and-chunked-promotion-v3` (echter Worker-Stall-Fix)
- `tail-step-artifact-aware-defer-v1` (Defer ≠ Block für Tail-Steps)
