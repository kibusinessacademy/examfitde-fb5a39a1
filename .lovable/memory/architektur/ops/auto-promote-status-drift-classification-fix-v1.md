---
name: auto_promote_status_drift Klassifikations-Fix
description: Re-Block bei release_block geht jetzt auf content_gap (statt pipeline_repair_required)
type: feature
---

## Problem

`auto_promote_status_drift` markierte alle nicht-publishbaren Pakete (mit allen Steps done) hart als `pipeline_repair_required` — auch echte Content-Lücken (NO_ORAL, NO_TUTOR, NO_HANDBOOK). Folge: Heal-Cockpit zeigte Pipeline-Bugs an, wo eigentlich Content-Repair-Jobs (`repair_oral_exam`, `enqueue_build_ai_tutor_index`) nötig waren.

## Fix

```
release_block → content_gap          (echte Inhalts-Lücke)
release_warn  → pipeline_repair_required
NULL/sonst    → pipeline_repair_required (Fallback)
```

## Kontext

Tail-Step-Defer (`tail-step-artifact-aware-defer-v1`) schützt nur vor Job-Cancel — NICHT vor diesem Re-Block. Beide Mechanismen sind komplementär: Defer hält den Job am Leben, der jetzt korrekt klassifizierte Block lenkt UI/Heal-Empfehlung auf Content-Repair statt Pipeline-Reset.

## Audit

`auto_heal_log.action_type='reclassify_blocked_reason'` für nachträgliche Korrekturen falsch klassifizierter Bestandspakete.
