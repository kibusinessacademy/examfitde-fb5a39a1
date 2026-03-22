# ExamFit Backup & Recovery Blueprint v2

## Übersicht

Dieses Dokument ist die SSOT für die vollständige Backup- und Recovery-Strategie.
Basierend auf **3-2-1-Regel**, **3-Klassen-Datenklassifikation** und **5-Ebenen-Architektur**.

---

## 1. Architektur — 5 Ebenen

```
┌──────────────────────────────────────────────────────────┐
│                    ExamFit Produktion                      │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐             │
│  │ Supabase │   │ Storage  │   │  GitHub  │             │
│  │    DB    │   │ Buckets  │   │   Repo   │             │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘             │
└───────┼──────────────┼──────────────┼────────────────────┘
        │              │              │
  ┌─────▼─────┐  ┌─────▼─────┐  ┌────▼──────┐
  │ Ebene 1   │  │ Ebene 3   │  │ Ebene 5   │
  │ PITR      │  │ Storage   │  │ GitHub    │
  │ (Supabase)│  │ Sync →    │  │ Mirror    │
  │ nativ     │  │ backups/  │  │ git clone │
  └───────────┘  └───────────┘  │ --mirror  │
        │                       └───────────┘
  ┌─────▼─────┐
  │ Ebene 2   │
  │ Chunked   │
  │ NDJSON →  │
  │ backups/  │
  └─────┬─────┘
        │
  ┌─────▼─────┐
  │ Ebene 4   │
  │ Externer  │   ← Noch nicht implementiert
  │ Offsite   │     (S3/GCS/Backblaze)
  │ Speicher  │
  └───────────┘
```

| Ebene | Was | Wie | Status |
|-------|-----|-----|--------|
| 1 | Supabase PITR | Plattform-nativ, sekundengenaue Recovery | ⚠️ Manuell aktivieren |
| 2 | DB-Snapshots | `db-backup-snapshot` → backups/ Bucket, NDJSON + Manifeste | ✅ Implementiert |
| 3 | Storage-Sync | `storage-backup-sync` → backups/storage-sync/ | ✅ Implementiert |
| 4 | Offsite-Kopie | Extern verschlüsselt, anderer Account/Region | 🔲 Geplant |
| 5 | Code-Backup | GitHub Mirror, Migrations, Edge Functions | ✅ Via GitHub |

---

## 2. Vollständige Backup-Matrix

### Klasse 1 — Kritisch (alle 4 Stunden)

| Datenobjekt | Quelle | Tabelle | Kritisch | Frequenz | Restore-Prio | Aufbewahrung | Offsite |
|-------------|--------|---------|----------|----------|--------------|-------------|---------|
| Nutzerprofile | DB | `profiles` | ✅ | 4h | P1 | 30d | Ja |
| Rollenzuordnungen | DB | `user_roles` | ✅ | 4h | P1 | 30d | Ja |
| B2B-Konten | DB | `enterprise_accounts` | ✅ | 4h | P1 | 30d | Ja |
| Org-Entities | DB | `org_entities` | ✅ | 4h | P1 | 30d | Ja |
| Org-Learner-Links | DB | `org_learner_links` | ✅ | 4h | P1 | 30d | Ja |
| Lizenzen | DB | `licenses` | ✅ | 4h | P1 | 30d | Ja |
| Lizenz-Claims | DB | `license_claims` | ✅ | 4h | P1 | 30d | Ja |
| Bestellungen | DB | `orders` | ✅ | 4h | P1 | 30d | Ja |
| Sitzplätze | DB | `seats` | ✅ | 4h | P1 | 30d | Ja |
| Abonnements | DB | `subscriptions` | ✅ | 4h | P1 | 30d | Ja |
| Prüfungssitzungen | DB | `exam_sessions` | ✅ | 4h | P1 | 30d | Ja |
| Prüfungsversuche | DB | `exam_attempts` | ✅ | 4h | P1 | 30d | Ja |
| Einzelantworten | DB | `exam_attempt_answers` | ✅ | 4h | P1 | 30d | Ja |
| Lernfortschritt | DB | `user_progress` | ✅ | 4h | P1 | 30d | Ja |
| Detail-Fortschritt | DB | `learning_progress` | ✅ | 4h | P1 | 30d | Ja |
| Affiliates | DB | `affiliates` | ✅ | 4h | P2 | 30d | Ja |
| Empfehlungen | DB | `affiliate_referrals` | ✅ | 4h | P2 | 30d | Ja |

**Risiko bei Verlust:** Kundendaten, Prüfungsergebnisse, Zahlungsnachweise — geschäftskritisch.

### Klasse 2 — Täglich (03:00 UTC)

| Datenobjekt | Quelle | Tabelle | Kritisch | Frequenz | Restore-Prio | Aufbewahrung | Offsite |
|-------------|--------|---------|----------|----------|--------------|-------------|---------|
| Kurse | DB | `courses` | ✅ | täglich | P2 | 30d | Ja |
| Lehrpläne | DB | `curricula` | ✅ | täglich | P2 | 30d | Ja |
| Lernfelder | DB | `learning_fields` | ✅ | täglich | P2 | 30d | Ja |
| Kompetenzen | DB | `competencies` | ✅ | täglich | P2 | 30d | Ja |
| Module | DB | `modules` | ✅ | täglich | P2 | 30d | Ja |
| Lektionen | DB | `lessons` | ✅ | täglich | P2 | 30d | Ja |
| Prüfungs-Blueprints | DB | `exam_blueprints` | ✅ | täglich | P2 | 30d | Ja |
| Fragenpools | DB | `exam_questions` | ✅ | täglich | P1 | 30d | Ja |
| Kurs-Pakete (SSOT) | DB | `course_packages` | ✅ | täglich | P1 | 30d | Ja |
| Pipeline-Schritte | DB | `package_steps` | ✅ | täglich | P2 | 30d | Ja |
| Zertifikatskatalog | DB | `certification_catalog` | ✅ | täglich | P2 | 30d | Ja |
| Quality Council | DB | `council_sessions` | ✅ | täglich | P2 | 30d | Nein |
| Council-Votes | DB | `council_votes` | ✅ | täglich | P2 | 30d | Nein |
| Handbuch-Abschnitte | DB | `handbook_sections` | ✅ | täglich | P3 | 30d | Nein |
| Handbuch-Kapitel | DB | `handbook_chapters` | ✅ | täglich | P3 | 30d | Nein |
| Mündliche BPs | DB | `oral_exam_blueprints` | ✅ | täglich | P3 | 30d | Nein |
| Mündliche Szenarien | DB | `oral_exam_scenarios` | ✅ | täglich | P3 | 30d | Nein |
| Selbstheilungs-Policy | DB | `auto_heal_policies` | ⚠️ | täglich | P2 | 30d | Nein |
| AI Worker Config | DB | `ai_worker_policies` | ⚠️ | täglich | P2 | 30d | Nein |
| Feature Flags | DB | `feature_flags` | ⚠️ | täglich | P2 | 30d | Nein |
| LLM Routing | DB | `model_routing_rules` | ⚠️ | täglich | P2 | 30d | Nein |
| AI Gen Policies | DB | `ai_generation_policies` | ⚠️ | täglich | P3 | 30d | Nein |
| AI Budget Policies | DB | `ai_budget_policies` | ⚠️ | täglich | P3 | 30d | Nein |
| Content Versionen | DB | `content_versions` | ⚠️ | täglich | P3 | 30d | Nein |
| MiniCheck-Fragen | DB | `minicheck_questions` | ✅ | täglich | P2 | 30d | Nein |

**Risiko bei Verlust:** Content muss neu generiert werden — teuer, aber möglich.

### Klasse 3 — Wöchentlich (Sonntag 04:00 UTC)

| Datenobjekt | Quelle | Tabelle | Kritisch | Frequenz | Restore-Prio | Aufbewahrung | Offsite |
|-------------|--------|---------|----------|----------|--------------|-------------|---------|
| Admin Audit Log | DB | `admin_actions` | ⚠️ | wöchentlich | P3 | 84d | Nein |
| Selbstheilungs-Log | DB | `auto_heal_log` | ⚠️ | wöchentlich | P3 | 84d | Nein |
| Benachrichtigungen | DB | `admin_notifications` | Nein | wöchentlich | P4 | 84d | Nein |
| Tutor-Logs | DB | `ai_tutor_logs` | ⚠️ | wöchentlich | P4 | 84d | Nein |
| AI-Generierungen | DB | `ai_generations` | ⚠️ | wöchentlich | P4 | 84d | Nein |
| AI-Validierungen | DB | `ai_validations` | ⚠️ | wöchentlich | P4 | 84d | Nein |
| AI Gen Requests | DB | `ai_generation_requests` | ⚠️ | wöchentlich | P4 | 84d | Nein |
| Job Queue | DB | `job_queue` | ⚠️ | wöchentlich | P3 | 84d | Nein |
| Backup-Metadaten | DB | `backup_snapshots` | Nein | wöchentlich | P4 | 84d | Nein |
| Auszahlungen | DB | `affiliate_payouts` | ✅ | wöchentlich | P3 | 84d | Ja |
| Security Events | DB | `security_events` | ⚠️ | wöchentlich | P3 | 84d | Nein |
| AI Quality Gates | DB | `ai_quality_gates` | ⚠️ | wöchentlich | P4 | 84d | Nein |
| AI Kostenbudgets | DB | `ai_cost_budgets` | ⚠️ | wöchentlich | P4 | 84d | Nein |
| AI Usage Log | DB | `ai_usage_log` | ⚠️ | wöchentlich | P4 | 84d | Nein |

### Storage-Artefakte — Täglich (03:30 UTC)

| Bucket | Inhalt | Frequenz | Restore-Prio | Offsite |
|--------|--------|----------|--------------|---------|
| `course-artifacts` | H5P, PDFs, Medien | täglich | P2 | Ja |
| `exports` | Paket-Exporte | täglich | P3 | Ja |
| `handbook-pdfs` | Handbuch-PDFs | täglich | P3 | Nein |
| `user-uploads` | Nutzer-Uploads | täglich | P2 | Ja |

### Nicht im App-Backup (separate Sicherung nötig)

| Datenobjekt | Quelle | Sicherung |
|-------------|--------|-----------|
| Auth-User (Identity) | Supabase Auth | PITR / Supabase-native Backups |
| Auth-Sessions | Supabase Auth | Nicht sicherbar, regeneriert sich |
| Edge Function Code | GitHub | Git Mirror |
| Migrations | GitHub | Git Mirror |
| GitHub Workflows | GitHub | Git Mirror |
| Docs/Policies | GitHub | Git Mirror |

---

## 3. Sicherheitsarchitektur

### Aufruf-Autorisierung
- Alle Backup-/Verify-/Sync-Functions erfordern `x-backup-job-secret` Header
- Secret in Supabase Edge Function Env + GitHub Actions Secret
- Kein Aufruf über Publishable/Anon Key möglich

### Datenformat
- **NDJSON** (eine JSON-Zeile pro Record) statt monolithisches JSON
- **Chunked**: 1000 Rows pro Part-Datei → kein OOM-Risiko
- **SHA-256** pro Part + kombinierter Hash pro Tabelle
- **Manifest** pro Tabelle + globales Manifest pro Run

### Integrität vs. Drift
| Prüfung | Fail-Kriterium | Nur Info |
|---------|---------------|---------|
| Manifest existiert | ✅ | |
| Datei existiert | ✅ | |
| Hash stimmt | ✅ | |
| NDJSON parsebar | ✅ | |
| Row-Count = Manifest | ✅ | |
| DB-Drift (mehr/weniger Rows) | | ✅ |
| Spot-Check (Record in DB) | | ✅ |

### Aufbewahrung
| Tier | Retention |
|------|-----------|
| Critical (4h) | 7 Tage |
| Daily | 30 Tage |
| Weekly | 12 Wochen (84 Tage) |
| Storage-Sync | 30 Tage |
| Monatliches Archiv | 12 Monate (manuell) |

---

## 4. Restore-Runbook

### Szenario A: Versehentliches Löschen (< 24h)
1. PITR nutzen → Zeitpunkt VOR dem Löschen
2. Wenn kein PITR: Backup-Parts aus `backups/` Bucket laden
3. NDJSON-Parts zusammenfügen und in Staging importieren
4. Verifizieren, dann gezielt in Prod einspielen

### Szenario B: Fehlerhafte Migration
1. Rollback-Migration schreiben (inverse SQL)
2. Wenn komplex: PITR auf Zeitpunkt vor Migration
3. Schema aus `supabase/migrations/` neu anwenden

### Szenario C: Stille Datenkorruption
1. `verify-backup` ausführen mit `spot_check: true`
2. Betroffene Tabellen identifizieren
3. Letztes verifiziertes Backup laden (Manifest-Hash prüfen)
4. Diff erstellen, gezielt korrigieren

### Szenario D: Kompletter Datenverlust
1. Neues Supabase-Projekt
2. Schema aus Migrations restaurieren
3. Klasse 1 Daten zuerst importieren
4. Klasse 2 + 3 nachziehen
5. Storage aus `storage-sync/` restaurieren
6. Edge Functions deployen
7. DNS/Auth umstellen
8. Smoke-Tests

### Szenario E: Storage-Dateien gelöscht
1. Manifest aus `backups/storage-sync/{date}/{bucket}/_manifest.json` laden
2. Dateien aus `backups/storage-sync/` in Quell-Bucket zurückkopieren
3. Hash-Verifikation gegen Manifest

---

## 5. Monatlicher Restore-Drill

- [ ] Letzten `_global_manifest.json` identifizieren
- [ ] `verify-backup` mit `spot_check: true` ausführen
- [ ] Alle Hashes müssen übereinstimmen
- [ ] Random-Tabelle: NDJSON-Parts herunterladen, zusammenfügen, in Staging importieren
- [ ] Row-Count muss ≥ 95% des Backup-Stands betragen
- [ ] 5 Random-Records manuell gegen Prod prüfen
- [ ] Storage: 3 Random-Dateien aus Sync laden und öffnen
- [ ] Ergebnis in `backup_snapshots` dokumentieren
- [ ] Bei Fehlern: sofort Incident erstellen

---

## 6. Offene Punkte

### Sofort
- [ ] **PITR aktivieren** (Supabase Dashboard → Database → Backups)
- [ ] `BACKUP_JOB_SECRET` auch als GitHub Actions Secret anlegen
- [ ] Ersten manuellen Backup-Run triggern

### Kurzfristig (1–2 Wochen)
- [ ] Externen Storage-Sync (Ebene 4) einrichten
- [ ] Backup-Verschlüsselung mit externem Key
- [ ] Ersten Restore-Drill durchführen

### Mittelfristig
- [ ] Zweites externes Backup-Ziel
- [ ] OIDC statt langlebiger Cloud-Secrets in GitHub Actions
- [ ] Automatisierte monatliche Restore-Drills
- [ ] Admin-Dashboard Widget für Backup-Gesundheit
