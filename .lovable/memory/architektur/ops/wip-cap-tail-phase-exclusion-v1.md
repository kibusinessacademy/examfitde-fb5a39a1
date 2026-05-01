---
name: WIP-Cap Tail-Phase Exclusion
description: fn_enforce_wip_cap_on_building zählt nur Pakete mit offenem generate_*-Step. Tail-Phase (nur quality_council/auto_publish offen) belegt keinen WIP-Slot mehr.
type: feature
---

## Problem (2026-05-01)
Mehrere Pakete (Maurer, Textil-Schneider/Näher, Spezialtiefbauer u.a.) hingen in `course_packages.status='queued'` mit `0 aktiven Jobs`, obwohl `quality_council` ready war. Symptom in UI: "enqueue_phantom_blocked"-Spam (Phantom-Guard funktionierte korrekt, war nicht der Bug).

## Root-Cause-Kette
1. Pakete schließen Generierungs-Steps ab → bleiben in `building` mit nur Tail-Steps offen
2. Cap (35+32=67) füllt sich mit Tail-Phase-Paketen die keine LLM-Arbeit mehr machen
3. Neue queued→building Promotion bricht mit `WIP_CAP_EXCEEDED_REPAIR`
4. Kollateral: `package_quality_council` Job failed mit `OPS_GUARD:NON_BUILDING_PACKAGE` (verlangt status=building)
5. `auto_publish` wird nie enqueued → Paket hängt permanent

## Fix
`fn_enforce_wip_cap_on_building` zählt nur noch:
```sql
EXISTS (
  SELECT 1 FROM package_steps ps
  WHERE ps.package_id = cp.id
    AND ps.step_key::text LIKE 'generate_%'
    AND ps.status::text IN ('queued','processing')
)
```
Tail-Phase-Pakete (nur council/auto_publish/integrity offen) belegen keinen Slot.

## Invariante
Ein Paket im `building`-Status ohne offenen `generate_*`-Step zählt **nicht** gegen WIP-Cap.

## Verwandt
- Phantom-Guard `enqueue_phantom_blocked` ist Audit-Spam, nicht Bug
- OPS-Guard `NON_BUILDING_PACKAGE` ist Symptom, nicht Cause
