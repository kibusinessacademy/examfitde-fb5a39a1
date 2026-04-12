# Dauermaßnahme: Fast-Release Guard v3.0

## Umgesetzt: 2026-04-12

### Problem
Die BUDGET_EXHAUSTED Fast-Release im Content-Runner hat das `status: pending` Update
nicht auf Fehler geprüft. Wenn das Supabase-Update fehlschlug (Timeout, Connection Drop),
blieb der Job im Status `processing` stecken — obwohl der Runner "released" loggte.

### Auswirkung
- 15 Zombie-Processing-Jobs fleetweit
- `count_active_jobs()` meldete weiter "aktiv"
- FINALIZATION_RULES konnten nicht feuern
- Steps blieben trotz erfüllter Meta-Signale auf `queued`

### Kausalkette
```
Runner pickt Job → Budget reicht nicht
→ Fast-Release: update({status: pending})
→ Update schlägt fehl (kein Error-Check!)
→ Runner loggt "released" (fälschlicherweise)
→ Job bleibt processing
→ count_active_jobs > 0
→ Finalisierung blockiert
→ Loop
```

### Fixes (v3.0)

#### 1. Runner: Error-Checked Fast-Release
- `{ error }` wird jetzt geprüft
- Ein automatischer Retry nach 200ms bei Fehler
- `.eq("status", "processing")` Guard gegen Race Conditions
- Explizites Fehler-Logging bei Misserfolg

#### 2. DB: fn_reset_stale_processing_jobs()
- Permanente Sicherungsfunktion (Cron-fähig)
- Setzt processing-Jobs mit Lock > 5min auf pending
- Audit-Trail in auto_heal_log
- Limit 50 pro Aufruf, idempotent

### Invarianten
- Jeder DB-Update im Runner muss das `{ error }` Feld prüfen
- Kein Job darf länger als 5min in `processing` bleiben ohne aktiven Worker
- fn_reset_stale_processing_jobs ist der letzte Safety-Net
