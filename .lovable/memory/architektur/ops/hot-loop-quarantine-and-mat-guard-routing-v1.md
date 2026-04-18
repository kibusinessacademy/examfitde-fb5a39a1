---
name: Hot-Loop Quarantine & Materialization-Guard Routing v1
description: Phase-2 Härtung gegen deterministische Failure-Loops im Claim-Pfad + saubere Trennung von Mat-Guard-Failures aus Retry-Loops
type: feature
---

# Hot-Loop-Quarantäne & Materialization-Guard Routing (Phase 2 Härtung)

## Umgesetzt: 2026-04-18

### Problem
Trotz Hardcap-Erhöhung auf 50 blieb der Durchsatz niedrig (~3 completions/min), weil:
1. **Hot-Loops**: Pakete mit deterministischen Failures wurden vom Claim-Pfad immer wieder geclaimed → Slot-Verschwendung
2. **Materialization-Guard im Retry-Loop**: `TOO_FEW_CHUNKS`/`MATERIALIZATION_GUARD` wurden als normale Failures gezählt und endlos wiederholt
3. **Obsolete-Race in Failure-Statistik**: bereits behoben — `step_finalized_job_obsoleted` ist `cancelled`

### Lösung — 3 Komponenten

#### 1. Tabelle `package_job_quarantine`
- Speichert temporäre Sperren pro `(package_id, job_type)` mit `failure_signature` und `blocked_until`
- Unique Index auf aktive Quarantänen (`cleared_at IS NULL`)
- RLS: nur Admins lesen direkt

#### 2. RPC `fn_check_hot_loop_quarantine(pkg_id, job_type, window=30min, threshold=5, block=30min)`
- Wird in `_shared/job-fail.ts` nach jedem **echten** Failure aufgerufen (best-effort, fail-open)
- Setzt Quarantäne wenn:
  - ≥5 echte Failures derselben Signatur in 30min
  - 0 Completions im selben Fenster
  - Keine aktive Quarantäne bereits vorhanden
- Skipt `OBSOLETE_RACE` automatisch (kein echter Failure)
- Triggert Admin-Notification (`severity=warning`) und `auto_heal_log`

#### 3. RPC `fn_route_materialization_block(job_id, last_error)`
- Erkennt `MATERIALIZATION_GUARD` / `TOO_FEW_CHUNKS` Patterns
- Setzt Job auf `status=cancelled` mit Reason `BLOCKED_BY_MATERIALIZATION:` statt `failed`
- Verhindert Retry-Loop und verfälscht Failure-Statistik nicht

#### 4. Claim-RPCs erweitert
Beide produktiven Claim-Pfade haben einen `NOT EXISTS`-Filter auf aktive Quarantänen:
- `claim_pending_jobs_v4(p_worker_id, p_limit, p_worker_pool)` — verwendet von `content-runner` (Prebuild)
- `claim_pending_jobs_by_types(p_job_types, p_limit, p_worker_id, p_worker_pool)` — verwendet von `content-runner` und `job-runner` (Lane-basierter Claim)

#### 5. Admin-View `v_active_job_quarantines`
- Zeigt aktive Sperren mit `minutes_remaining`, `failure_signature`, `package_title`
- Granted für authenticated, RLS via Tabelle

#### 6. Admin-Funktion `admin_clear_job_quarantine(quarantine_id)`
- Setzt `cleared_at` für sofortige manuelle Aufhebung
- Nur Admins (Rollen-Check)

### Code-Integration
- `_shared/job-fail.ts`:
  - `FailCtx` erweitert um `jobType`
  - Bei Mat-Guard-Pattern → `fn_route_materialization_block`
  - Bei normalem Failure → `fn_check_hot_loop_quarantine`
- Keine Änderung an Runnern selbst — Filter wirkt automatisch im RPC

### Komplementär zu
- **`poison-loop-guard.ts`** (F-5): synchroner Block beim **Enqueue** bei 3+ identischen Failures in 60min für Generator-Job-Types. Greift VOR Insert.
- **Diese Lösung**: Block beim **Claim** bei 5+ identischen Failures in 30min für ALLE package-Job-Types. Greift NACH Insert, vor Slot-Vergeudung.
- **production-guardian POISONED_LOOP**: async/reactive 3-Strike. Diese Lösung ist proaktiv im heißen Pfad.

### Invarianten
- Hot-Loop-Check ist fail-open: Wenn der RPC fehlschlägt, läuft der normale Failure-Pfad weiter
- `OBSOLETE_RACE` wird in `fn_extract_failure_signature` als nicht-Failure-Signatur erkannt → kein Trigger
- Quarantäne ist additiv (`ON CONFLICT … DO UPDATE`) — letzte Signatur gewinnt
- Materialization-Routing macht idempotent UPDATE auf bestimmte Status (kein doppeltes Schreiben)

### Erwartete Wirkung
- Failure-Slots werden nicht mehr durch deterministische Wiederholungen verschwendet
- TOO_FEW_CHUNKS verschwindet aus Failure-Statistik (jetzt cancelled mit klarem Reason)
- Echte Bugs werden besser sichtbar (saubere Failure-Cluster)
- Recovery-Lane bekommt mehr Luft für sinnvolle Heilung
