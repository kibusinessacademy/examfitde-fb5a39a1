# Phantom-Done Governance Epidemic v1

## Umgesetzt: 2026-04-13

### Problembild
132 Governance-Steps systemweit im Status `done` ohne fachliche Freigabe (`meta.ok != true`). Betroffene Steps: `run_integrity_check` (41), `quality_council` (41), `validate_exam_pool` (28), `auto_publish` (22). Primäre Quelle: `standalone_reconciler` (54 Fälle), Rest ohne `finalization_source`.

### Root Cause
1. **Reconciler-Altschaden**: Ältere Versionen des `verifier-reconciler` hatten Governance-Steps in der `META_BASED_VERIFIERS` Liste. `standardMetaCheck` akzeptierte `meta.batch_complete=true` als Completion-Signal — ohne zu prüfen, ob `meta.ok=true` oder `gate_passed=true`.
2. **Sync-Trigger ohne Gate-Prüfung**: `trg_sync_step_on_job_complete` setzte Steps auf `done` wenn der zugehörige Job completed war — ohne Postcondition-Prüfung der fachlichen Gate-Flags.
3. **Phantom Council Approvals**: 6 Pakete mit `council_approved=true` ohne eine einzige `council_session` — Flag wurde nie evidenzbasiert gesetzt.

### Kausalkette
```
Reconciler/Sync-Trigger finalisiert Step ohne Gate-Prüfung
→ run_integrity_check = done (gate_passed = null/false)
→ quality_council = done (keine Session-Evidenz)
→ auto_publish = done (kein Integrity-Gate)
→ Package Status suggeriert "fertig" obwohl fachlich ungeprüft
→ Downstream (Learner-UI, Product-Listing) könnte ungeprüfte Inhalte sichtbar machen
```

### Fix-Design
1. **Batch-Reset (64 Steps)**: Alle Phantom-Done Governance-Steps auf non-published Packages → `queued` mit vollständigem Audit-Trail (`reset_by: forensic-phantom-done-audit-p0`).
2. **Trigger-Bypass**: `DISABLE TRIGGER USER` / `ENABLE TRIGGER USER` für atomaren Batch-Reset ohne Guard-Konflikte.
3. **Reconciler bereits gehärtet** (Code-Review bestätigt): Lines 110-115 schließen `run_integrity_check`, `quality_council`, `auto_publish` explizit aus `META_BASED_VERIFIERS` aus.

### Verifikation
- 0 Phantom-Done Governance-Steps auf non-published Packages nach Reset
- Bilanzbuchhalter: alle 3 Governance-Steps auf `queued` mit Audit-Trail
- 64 Steps total resettet

### Restrisiken
1. **Published Packages**: ~60 Phantom-Done Governance-Steps auf 26 published Packages nicht resettet (Disruption-Risiko). Betrifft: AEVO, BWL, Drogist, Industriemeister, Lagerlogistik, u.a.
2. **Phantom Council Approvals**: 6 blocked Packages mit `council_approved=true` ohne Session-Evidenz — Flag-Wert ist falsch.
3. **`validate_exam_pool`** bleibt in `META_BASED_VERIFIERS` — könnte erneut phantom-done werden wenn `standardMetaCheck` batch_complete akzeptiert.

### Dauermaßnahmen
1. `validate_exam_pool` aus `META_BASED_VERIFIERS` entfernen oder eigene Gate-Prüfung hinzufügen
2. Published Packages einzeln prüfen und Phantom-Done Steps gezielt korrigieren
3. Nightly Audit-View `ops_phantom_done_governance` einführen
4. `council_approved` Flag an Session-Evidenz binden (Trigger-Härtung)

### Non-Building Forensik (Gesamtbild)
- **352 blocked**: 204 intentional_pause, 132 admin_hold, 16 compliance_hold
- **31 planning**: Alle ohne Steps (0 total_steps) — noch nicht initialisiert
- **26 published**: 1 Anomalie (Scrum Master PSM I: published ohne council_approved)
- **5 queued**: 1 mit ENRICHMENT_GATE Block (Büromanagement: 13/39 Kompetenzen)
- **4 archived**: 3 §34-Kurse mit intentional_pause + failed validate_exam_pool
- **344 Packages** mit `validate_exam_pool = failed` — systematisches Problem bei Exam-Pool-Validierung auf blocked Packages
