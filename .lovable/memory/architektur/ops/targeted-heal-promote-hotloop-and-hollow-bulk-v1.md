---
name: Targeted Heal v1 — Promote-Hotloop & Hollow-Published Bulk-Heilung
description: Zwei nachhaltige Bulk-RPCs (admin_resolve_promote_hotloop, admin_bulk_depublish_hollow) + v_admin_targeted_heal_diagnosis View, integriert als Section 3 im Heal Cockpit. Behebt zwei chronische Probleme der Pipeline.
type: feature
---

# Targeted Heal v1

## Problem-Diagnose (2026-04-27)

Cockpit zeigte zwei chronische Cluster, die durch generische Reaper/Hotloop-Quarantäne nicht nachhaltig geheilt werden:

1. **Promote-Hotloop**: 5 EXAM_FIRST_PLUS-Pakete mit `package_promote_blueprint_variants` Jobs in Endlosschleifen (max_attempts 26). Root Cause: Pakete haben nur 10 variants total, davon 0–9 approved. Promote findet keinen approval-fähigen Pool → schleift endlos.
2. **Hollow-Published**: 24 Pakete im Live-Status mit 0 approved exam_question_variants (z. B. AEVO, Verkäufer/-in, Industriekaufmann, Drogist/-in). Schaden: User sehen leere Fragenpools.

Generische Hot-Loop-Quarantäne löst nur das Symptom (Jobs cancelled), nicht die Ursache (fehlende Variants). Hollow-Forensik-Card war nur Diagnose, ohne Bulk-Heilung.

## Lösung

### admin_resolve_promote_hotloop(p_dry_run, p_attempt_threshold=8, p_max_packages=20)
- Findet alle Pakete mit Promote-Jobs ≥8 Attempts (letzte 7d)
- Cancelled offene Promote-Jobs mit Marker `meta.hotloop_quarantine_v2=true`
- Setzt `package_steps` (`promote_blueprint_variants`, `generate_blueprint_variants`) auf `pending` mit `meta.hotloop_reseed_requested=true`
- Enqueued frische `package_generate_blueprint_variants` Jobs (priority=10)
- Audit in `admin_actions`

### admin_bulk_depublish_hollow(p_dry_run, p_max_packages=30)
- Targets: `status='published'` UND `(integrity_report ILIKE '%hollow%' OR package_steps blocked HOLLOW)` UND `0 approved variants`
- Per-row exception isolation
- Ruft bestehendes `admin_force_depublish_and_rebuild(uuid)` pro Paket
- Audit in `admin_actions`

### v_admin_targeted_heal_diagnosis (View)
Aggregiert für UI:
- PROMOTE_HOTLOOP: packages, jobs, max_attempts
- HOLLOW_PUBLISHED: packages
- STALE_REAPED_RESIDUE: packages, jobs (24h Window)

## UI-Integration

Heal Cockpit Section 3 (zwischen Recover und Triage), defaultOpen.
Card: `src/components/admin/heal/cards/TargetedHealCard.tsx`
- Live-Diagnose-Grid (3 Buckets) refetch alle 30s
- Pro Aktion: Dry-Run → Preview JSON → Execute (Execute disabled bis Dry-Run lief)
- Hollow-Aktion mit explizitem Warn-Alert (Pakete temporär aus Shop)

## Operative Reihenfolge im Cockpit (verbindlich)

1. Live Pulse — Throughput v2 prüfen
2. Recover — Stale-Reap, generische Hot-Loop-Quarantäne
3. **Targeted Heal** — Promote-Hotloop Reseed, Hollow-Bulk-Depublish (NEU)
4. Triage — Failed-Cluster, Blocker-Split, Track-Normalize
5. Targeted Recheck — Cause-aware Re-Enqueue
6. Drill-down, Auto-Selector, Reaper, Strategien, Queue-Tabs

## Anti-Pattern

- ❌ Promote-Hotloop nur cancellen (alte Hot-Loop-Quarantäne) → Loop kommt zurück, sobald Job neu enqueued wird. Lösung erfordert ZUSÄTZLICH Variants-Reseed.
- ❌ Hollow-Pakete einzeln per Force-Depublish heilen → Bei 24 Paketen unrealistisch. Bulk + Limit nötig.
- ❌ Targeted Heal vor Recover ausführen → Ohne stabile Queue laufen Reseed-Jobs sofort wieder in den Stall.

## Sicherheit

- Beide RPCs `SECURITY DEFINER` + `is_admin(auth.uid())` Guard
- View `v_admin_targeted_heal_diagnosis` als SECURITY DEFINER View (Lesegate über Admin-only RPC-Konsumption im Frontend)
- Caps: 20 (Hotloop), 30 (Hollow) Pakete pro Run
- Dry-Run Default true bei beiden
