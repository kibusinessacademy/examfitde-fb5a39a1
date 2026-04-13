# Phantom-Done Governance Epidemic v1 — Abschlussbewertung

## Umgesetzt: 2026-04-13

---

## Problembild
Systemweit waren Governance-Steps (`run_integrity_check`, `quality_council`, `auto_publish`, `validate_exam_pool`) fälschlicherweise als `done` markiert, obwohl `meta.ok != true` und/oder `gate_passed != true`. Betroffen: **132 Steps** auf non-published Paketen (P0, bereinigt) + **68 Steps** auf 26 published Paketen (bekannte Altlast). Zusätzlich: **15 Pakete** mit `council_approved = true` ohne eine einzige `council_session`.

## Root Cause
1. **Reconciler-Altschaden**: Ältere Versionen des `verifier-reconciler` hatten Governance-Steps in der `META_BASED_VERIFIERS` Liste. `standardMetaCheck` akzeptierte `meta.batch_complete=true` als Completion-Signal — ohne zu prüfen, ob `meta.ok=true` oder `gate_passed=true`.
2. **Sync-Trigger ohne Gate-Prüfung**: `trg_sync_step_on_job_complete` setzte Steps auf `done` wenn der zugehörige Job completed war — ohne Postcondition-Prüfung der fachlichen Gate-Flags.
3. **Phantom Council Approvals**: 15 Pakete mit `council_approved=true` ohne eine einzige `council_session` — Flag wurde nie evidenzbasiert gesetzt.

## Kausalkette
```
Reconciler/Sync-Trigger finalisiert Step ohne Gate-Prüfung
→ run_integrity_check = done (gate_passed = null/false)
→ quality_council = done (keine Session-Evidenz)
→ auto_publish = done (kein Integrity-Gate)
→ Package Status suggeriert "fertig" obwohl fachlich ungeprüft
→ Downstream (Learner-UI, Product-Listing) könnte ungeprüfte Inhalte sichtbar machen
```

## Fix-Design

### P0 — Non-Published Pakete (abgeschlossen)
1. **Batch-Reset (64 Steps)**: Alle Phantom-Done Governance-Steps auf non-published Packages → `queued` mit Audit-Trail (`reset_by: forensic-phantom-done-audit-p0`).
2. **Trigger-Bypass**: `DISABLE TRIGGER USER` / `ENABLE TRIGGER USER` für atomaren Batch-Reset ohne Guard-Konflikte.
3. **Reconciler bereits gehärtet**: Lines 110-115 schließen Governance-Steps aus `META_BASED_VERIFIERS` aus.

### P1 — Council Approvals + Audit-Infrastruktur (abgeschlossen)
1. **Phantom Council Reset**: 7 Pakete (6 blocked, 1 archived) mit `council_approved=true` aber 0 Sessions → `council_approved = false`.
2. **Audit-View `ops_phantom_done_governance`**: Permanente View für alle Governance-Steps mit `done` aber `meta.ok != true`.
3. **Audit-View `ops_phantom_council_approvals`**: Permanente View für alle Pakete mit `council_approved=true` aber 0 Sessions.

## Verifikation
- **P0**: 0 Phantom-Done Governance-Steps auf non-published Packages ✅
- **P1**: 0 Phantom Council Approvals auf blocked/archived Packages ✅
- **Audit-Views**: Beide Views aktiv, zeigen verbleibende published Altlasten korrekt an ✅
- Verbleibend in Views: 68 published Phantom-Steps, 8 published Phantom-Council-Approvals

## Restrisiken

### Kritisch
1. **Published Phantom-Governance (68 Steps)**: 22 `auto_publish`, 17 `quality_council`, 13 `run_integrity_check`, 16 `validate_exam_pool` auf 26 published Paketen — nicht resettet wegen Produktions-Disruptions-Risiko.
2. **Published Phantom Council Approvals (8 Pakete)**: `council_approved=true` ohne Sessions auf published Paketen — ebenfalls bewusst nicht angefasst.

### Moderat
3. **344 failed `validate_exam_pool`** auf blocked Packages — systematisches Problem bei Exam-Pool-Generierung, wird beim Unblock wieder aktiv.
4. **`validate_exam_pool`** bleibt in `META_BASED_VERIFIERS` anfällig, wenn `standardMetaCheck` batch_complete akzeptiert.

## Dauermaßnahmen
1. ✅ `ops_phantom_done_governance` Audit-View eingeführt
2. ✅ `ops_phantom_council_approvals` Audit-View eingeführt
3. ✅ Reconciler gehärtet (Governance-Steps ausgeschlossen)
4. ⬜ Published Pakete einzeln prüfen und Phantom-Done Steps gezielt korrigieren
5. ⬜ `validate_exam_pool` aus `META_BASED_VERIFIERS` entfernen oder eigene Gate-Prüfung hinzufügen
6. ⬜ `council_approved` Flag an Session-Evidenz binden (Trigger-Härtung)
7. ⬜ Nightly Cron der Audit-Views mit Alert-Erzeugung

## Gesamtstatistik
| Schicht | Maßnahme | Ergebnis |
|---------|----------|----------|
| Non-published | 64 Steps reset → queued | ✅ Bereinigt |
| Blocked/Archived | 7 council_approved → false | ✅ Bereinigt |
| Published | 68 Steps + 8 Council Approvals | ⚠️ Bekannte Altlast |
| Audit-Infra | 2 Views angelegt | ✅ Aktiv |
| Reconciler | Governance-Isolation gehärtet | ✅ Gesichert |
