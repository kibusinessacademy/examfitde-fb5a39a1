---
name: Cockpit-Triage v1 — Failed-Cluster, Blocker-Split, Hollow-Forensik, Track-Normalize
description: Vier neue Admin-RPCs in der operativen Reihenfolge Queue→Hotloops→Cluster→Blocker→Track. Verdrahtet als TriageRow in BlockerOpsPage unmittelbar nach Throughput/Reap/Hotloop.
type: feature
---

# Cockpit-Triage v1

## Operative Reihenfolge (verbindlich)
1. **Queue stabilisieren** — Throughput v2 prüfen, Reap Now bei oldest_processing>600s.
2. **Hotloops quarantänen** — `admin_quarantine_hotloop_jobs` mit Whitelist (`package_promote_blueprint_variants,package_auto_publish`).
3. **Failed-Cluster diagnostizieren** — `admin_get_failed_clusters(p_window_hours)` gruppiert nach `(job_type, last_error_code, error_class)`.
4. **Blocker-Split** — `admin_get_blocked_packages_split()` zeigt blocked-Packages nach `(primary_blocker, package_track)` mit Sample-IDs.
5. **Hollow-Published Forensik** — `admin_get_hollow_published_packages()` listet Pakete mit `HOLLOW`-Blocker oder `hollow_published_auto_quarantine` im Integrity-Report.
6. **Track-Normalisierung statt Einzel-Heal** — `admin_normalize_track_steps(dry_run, tracks[], max_packages)` setzt nicht-applicable Steps für `EXAM_FIRST`/`EXAM_FIRST_PLUS` auf `skipped` via SSOT `track_step_applicability`. Marker: `meta.track_normalized=true`, `meta.normalize_reason='TRACK_NOT_APPLICABLE'`.

## Datenlage zum Build-Zeitpunkt (2026-04-27)
- 229 EXAM_FIRST-Pakete mit `EXAM_FIRST_HAS_LEARNING_CONTENT` Track-Violation → Kandidaten für Track-Normalize.
- 17 blocked Packages, 14 davon `INTEGRITY_NEVER_CHECKED` / `INTEGRITY_REPORT_MISSING` (überwiegend EXAM_FIRST_PLUS).
- Hollow-Pakete: forensik-only, NICHT mit Track-Normalize beheben — separate P0/P1-Pipeline.

## Sicherheit
- Alle 4 RPCs: `SECURITY DEFINER` + expliziter `is_admin(auth.uid())` Guard + `GRANT EXECUTE TO authenticated`.
- `admin_normalize_track_steps` audit-loggt sowohl Dry-Run als auch Execute in `admin_actions`.
- Default `p_max_packages=50` deckelt einen einzelnen Run.

## UI
- `BlockerOpsPage.tsx` enthält neue `<TriageRow />` direkt nach Throughput/Reap/Hotloop-Reihe.
- 3 Cards horizontal (Failed/Blocker/Hollow) + Track-Normalize-Card vollbreit darunter.
- Track-Whitelist als komma-getrennter Input, Dry-Run zwingend vor Execute kommunizieren.

## Anti-Pattern (explizit nicht tun)
- ❌ Bei Queue-Stall + 14% Failrate zuerst neue Integritätschecks enqueuen → erzeugt nur mehr Last.
- ❌ Track-Violations einzeln per Paket reparieren → Skalierung scheitert. Stattdessen Track-Normalisierung.
- ❌ Hollow-Published als Track-Issue behandeln → eigene Pipeline (Depublish + Rebuild).
