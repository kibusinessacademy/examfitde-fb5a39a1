---
name: Admin Heal UI Context-Sensitive v7
description: Auto-Heal Queue UI bietet kontextsensitive Heal-Buttons (Force-Publish, Reconcile, Mark content_gap), Bulk-Heal nach release_class und manuellen Zombie-Sweep — getrieben von v_package_release_classification
type: feature
---

Die Auto-Heal Queue (`AdminAutoHealQueue.tsx`) ist v7-erweitert um kontextsensitive Heilung:

- **Pro Item** zeigt ein `ReleaseClassBadge` die aktuelle Klassifikation (release_ok / warn / block) + deficiency_codes aus `v_package_release_classification`.
- **`ContextSensitiveHealActions`** wechselt Buttons je Klasse:
  - `release_ok` → primär **Force-Publish** (RPC `admin_force_steps_done` mit `p_force_publish=true`)
  - `release_warn` → primär **Reconcile** + sekundär **Mark content_gap**
  - `release_block` → **Reconcile (kein Publish)** + **Mark content_gap**
- **Bulk-Heal**: Mehrfachauswahl per Checkbox → Bulk-Buttons gruppiert nach Klasse → Edge-Action `bulk_heal_by_class` (max 50 pro Call, validiert release_class pro Paket).
- **Zombie-Sweep Button** im Header → Edge-Action `zombie_sweep` (default >30min stale processing → failed).

Alle Aktionen laufen über `admin-ops-actions` Edge Function mit `assertAdmin` + `auditLog` in `admin_actions`. Heal-Mutation markiert das Queue-Item nach Erfolg automatisch als `done`. Hollow-Publish-Guard greift weiterhin — `force_publish_release_ok` validiert `release_class='release_ok'` vor dem Bypass.
