

# Fix: `package_validate_lesson_minichecks` — Endlos-Retry wegen fehlendem Signal

## Diagnose

Die Edge Function `package-validate-lesson-minichecks` funktioniert korrekt (HTTP 200), gibt aber `ok: false` zurück, weil die MiniCheck-Abdeckung nur bei 3% liegt (6/192 Lektionen). 

Das Problem: Die Antwort enthält **keines** der Job-Runner-Steuersignale (`skipped`, `retry`, `permanent`). Dadurch landet sie im generischen `ok=false`-Handler (Zeile 1967), der 3× wiederholt und dann als `edge_function_failed (3/3)` markiert — obwohl sich am Zustand nichts ändert. Das erzeugt die beobachtete Endlosschleife: Pipeline erzeugt alle ~8 Minuten neue Jobs, die alle 3× scheitern.

**15+ Jobs in Folge** mit identischem Ergebnis, alle nutzlos.

## Lösung

### 1. Edge Function Response-Signal anpassen
**Datei:** `supabase/functions/package-validate-lesson-minichecks/index.ts`

Bei `ok: false` (Quality Gate nicht bestanden):
- Wenn Coverage < 10% (also Minichecks noch nicht generiert): `retry: true` + `backoff_seconds: 300` zurückgeben → Job wartet statt zu sterben
- Wenn Coverage ≥ 10% aber < 90% (teilweise generiert, Gate-Fail ist fachlich korrekt): `permanent: true` setzen → Job-Runner versteht: kein Retry sinnvoll
- `error`-Feld immer setzen mit sprechendem Code (z.B. `GATE_FAIL: LOW_COVERAGE 3%`)

### 2. Threshold-Logik für Retry vs. Permanent
```text
Coverage < 10%  → ok:false, retry:true   (Prereq noch nicht fertig)
Coverage ≥ 10%  → ok:false, permanent:true (echtes Gate-Failure)
NO_MINICHECKS   → ok:false, retry:true   (Generation läuft noch)
```

### 3. CORS-Header ergänzen
Die Function hat aktuell keine CORS-Headers — bei allen anderen Validators sind sie vorhanden. Konsistenz-Fix.

## Betroffene Dateien
- `supabase/functions/package-validate-lesson-minichecks/index.ts` — Response-Signale + CORS

## Kein Änderungsbedarf
- Job-Runner-Logik ist korrekt — das Problem ist rein auf der Validator-Seite
- Andere Validators (`validate-exam-pool`, `validate-handbook` etc.) setzen diese Signale bereits korrekt

