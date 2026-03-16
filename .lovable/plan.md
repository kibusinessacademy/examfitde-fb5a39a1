

# Hardening-Patchset: SSOT-Views + UI auf Echtdaten

## Ist-Zustand

Die Admin V2 Shell mit Leitstelle, Kurse, Queue steht. Die SSOT-Views `v_admin_packages_ssot` und `v_admin_queue_ssot` existieren. Aber 6 konkrete Schwächen wurden identifiziert:

1. **Statusranking falsch**: `published` vor `building` — operative Sicht braucht das umgekehrt
2. **`is_stuck` fragil**: basiert nur auf `cp.last_progress_at`, nicht auf `greatest()` über alle Aktivitätsquellen
3. **`council_complete` vermischt mit `council_approved`**: semantische Verwechslung
4. **`has_publish_drift` fehlt**: published + Gate inhaltlich nicht bestanden wird nicht erkannt
5. **CourseWorkspace nicht SSOT-first**: zeigt Step-Historie als aktuellen Status, direkte `.from('course_packages')` Reads
6. **Queue health_signal** deckt `batch_pending`/`running` nicht ab

## Plan

### 1. SQL Migration — View-Härtung

**`v_admin_packages_ssot`** neu schreiben:

- Statusranking operativ: `building(1) → council_review(2) → queued(3) → blocked(4) → published(5) → failed(6)`
- `is_stuck` über `greatest(cp.last_progress_at, ja.last_job_activity, ca.last_council_activity, cp.updated_at)` statt nur `cp.last_progress_at`
- `council_complete` nur aus Sessions: `pending=0 AND processing=0 AND completed>0` — OHNE `council_approved`
- Neues Flag `has_publish_drift`: `status='published' AND (approved_questions<100 OR ...)`
- Job-Aggregation erweitern: `max(greatest(started_at, completed_at, updated_at))` als `last_job_activity_at`
- Council-Aggregation erweitern: `max(cs.updated_at)` als `last_council_activity_at`

**`v_admin_queue_ssot`** härten:

- Health signal: `running` und `batch_pending` in Zombie/Stale-Logik aufnehmen
- WHERE clause: `batch_pending` und `running` einschließen

### 2. TypeScript-Interface update

**`useAdminPackagesSSOT.ts`**: 
- `council_complete` semantisch korrekt (ohne approval)
- `has_publish_drift: boolean` hinzufügen

### 3. Leitstelle — KPI-Härtung

**`LeitstellePage.tsx`**:
- Neues KPI-Tile: "Publish Drift" (Pakete published aber Gate nicht bestanden)
- `council_complete` Badge korrekt trennen von `council_approved`
- Kritische Pakete: `has_publish_drift` als Warnsignal aufnehmen

### 4. Kurse — Badge-Härtung

**`KursePage.tsx`**:
- Badge für `has_publish_drift`: "Publish Drift" in rot
- `council_complete` ohne `approved` als separates Info-Badge
- Neuer Filter: "Publish Drift"

### 5. Queue — Health-Signal-Erweiterung

**`QueuePage.tsx`**: 
- `batch_pending` und `running` in Summary-Zählung aufnehmen

### 6. CourseWorkspace — SSOT-first Header

**`CourseWorkspace.tsx`** — der größte Einzelpatch:

- Oberer Statusbereich: Canonical Release State aus SSOT-Feldern ableiten, nicht aus Step-Historie
- Stale-Publish-Warnbanner wenn `published_at` gesetzt aber `status !== 'published'`
- Council-Status-Card: Sessions pending/completed/approved separat anzeigen
- Publish-Gate-Card: Soll/Ist für Fragen, Oral, Handbuch, Tutor
- `canPublish` Logik härten: `integrity_passed AND council_approved AND publish_gate_passed`
- Health Score nur noch aus SSOT-Feldern, nicht aus Step-done-Count
- Pipeline-Stepper klar als "Build-Historie" labeln, nicht als aktueller Gesamtstatus

### Dateien die geändert werden

| Datei | Änderung |
|---|---|
| `supabase/migrations/new.sql` | Views v_admin_packages_ssot + v_admin_queue_ssot neu |
| `src/hooks/useAdminPackagesSSOT.ts` | Interface + `has_publish_drift` |
| `src/pages/admin/v2/LeitstellePage.tsx` | Publish Drift KPI, council_complete Trennung |
| `src/pages/admin/v2/KursePage.tsx` | Publish Drift Badge + Filter |
| `src/pages/admin/v2/QueuePage.tsx` | batch_pending/running in Summary |
| `src/pages/admin/CourseWorkspace.tsx` | SSOT-first Header, Warnbanner, Gate-Cards |

