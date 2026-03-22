# ExamFit Backup & Recovery Blueprint

## Übersicht

Dieses Dokument definiert die vollständige Backup- und Recovery-Strategie für ExamFit,
basierend auf der **3-2-1-Regel** und einer **3-Klassen-Datenklassifikation**.

---

## 1. Datenklassifikation

### Klasse 1 — Kritisch, häufig sichern (alle 4h)
| Tabelle | Beschreibung | Geschätzte Größe |
|---------|-------------|-----------------|
| `profiles` | Nutzerprofile | Mittel |
| `user_roles` | Rollenzuordnungen | Klein |
| `enterprise_accounts` | B2B-Konten | Klein |
| `licenses` | Lizenzen | Klein |
| `license_claims` | Lizenz-Claims | Klein |
| `orders` | Bestellungen | Klein |
| `seats` | Sitzplätze | Klein |
| `subscriptions` | Abonnements | Klein |
| `exam_sessions` | Prüfungssitzungen | Mittel |
| `exam_attempts` | Prüfungsversuche | Groß |
| `exam_attempt_answers` | Einzelantworten | Sehr groß |
| `user_progress` | Lernfortschritt | Groß |
| `learning_progress` | Detaillierter Fortschritt | Groß |

**Risiko bei Verlust:** Kundendaten, Prüfungsergebnisse, Zahlungsnachweise — geschäftskritisch und ggf. rechtlich relevant.

### Klasse 2 — Kritisch, täglich sichern
| Tabelle | Beschreibung |
|---------|-------------|
| `courses` | Kurse |
| `curricula` | Lehrpläne |
| `learning_fields` | Lernfelder |
| `competencies` | Kompetenzen |
| `modules` | Module |
| `lessons` | Lektionen |
| `exam_blueprints` | Prüfungs-Blueprints |
| `exam_questions` | Fragenpools |
| `course_packages` | Pakete (SSOT) |
| `package_steps` | Pipeline-Schritte |
| `certification_catalog` | Zertifikatskatalog |
| `council_sessions` | Quality Council |
| `council_votes` | Council-Abstimmungen |
| `auto_heal_policies` | Selbstheilungs-Policies |
| `ai_worker_policies` | AI Worker Config |
| `feature_flags` | Feature Flags |
| `model_routing_rules` | LLM Routing |
| `handbook_sections` | Handbuch-Abschnitte |
| `handbook_chapters` | Handbuch-Kapitel |
| `oral_exam_blueprints` | Mündliche Prüfungs-BPs |
| `oral_exam_scenarios` | Mündliche Szenarien |

**Risiko bei Verlust:** Content muss neu generiert werden — teuer, aber möglich.

### Klasse 3 — Betriebsdaten, wöchentlich sichern
| Tabelle | Beschreibung |
|---------|-------------|
| `admin_actions` | Admin Audit Log |
| `auto_heal_log` | Selbstheilungs-Log |
| `admin_notifications` | System-Benachrichtigungen |
| `ai_tutor_logs` | Tutor-Interaktionen |
| `ai_generations` | AI-Generierungen |
| `ai_validations` | AI-Validierungen |
| `job_queue` | Job Queue |
| `backup_snapshots` | Backup-Metadaten |
| `affiliates` | Affiliates |
| `affiliate_referrals` | Empfehlungen |
| `affiliate_payouts` | Auszahlungen |

**Risiko bei Verlust:** Operativer Kontext geht verloren, aber keine Geschäftsunterbrechung.

---

## 2. Backup-Frequenzen & Aufbewahrung

| Tier | Frequenz | Aufbewahrung | Trigger |
|------|----------|-------------|---------|
| **Critical** | Alle 4 Stunden | 7 Tage | GitHub Actions Cron |
| **Daily** | Täglich 03:00 UTC | 30 Tage | GitHub Actions Cron |
| **Weekly** | Sonntag 04:00 UTC | 12 Wochen | GitHub Actions Cron |
| **Verify** | Täglich 06:00 UTC | n/a | GitHub Actions Cron |

### Zusätzlich empfohlen (manuell/extern)
| Maßnahme | Frequenz |
|----------|----------|
| **PITR aktivieren** | Dauerhaft (Supabase Add-on) |
| **Monatliches Archiv** | 1. des Monats → unveränderlicher Speicher |
| **Jahresarchiv** | 1. Januar → 3–7 Jahre |
| **Restore-Drill** | Monatlich in Staging |

---

## 3. Storage-Objekte (Dateien)

Supabase-DB-Backups sichern **nicht** die Storage-Dateien!

### Zu sichernde Buckets
| Bucket | Inhalt | Frequenz |
|--------|--------|----------|
| `course-artifacts` | H5P, PDFs, Medien | Täglich |
| `exports` | Paket-Exporte | Täglich |
| `handbook-pdfs` | Handbuch-PDFs | Wöchentlich |
| `user-uploads` | Nutzer-Uploads | Täglich |
| `backups` | DB-Backups selbst | Extern spiegeln |

**Empfehlung:** Externen Object-Storage-Sync einrichten (z.B. S3, GCS, Hetzner).

---

## 4. Backup-Architektur

```
┌──────────────────────────────────────────────────────┐
│                    ExamFit Prod                       │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │  Supabase DB │  │   Storage   │  │  GitHub Repo │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘ │
└─────────┼────────────────┼────────────────┼──────────┘
          │                │                │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
    │  Layer 1   │   │  Layer 2   │   │  Layer 3   │
    │  PITR      │   │  Storage   │   │  GitHub    │
    │  (Supabase)│   │  Backup    │   │  Mirror    │
    │  ∞ Tage    │   │  Bucket    │   │  git clone │
    └────────────┘   │  30 Tage   │   │  --mirror  │
                     └────────────┘   └────────────┘
                           │
                     ┌─────▼─────┐
                     │  Layer 4   │
                     │  Externer  │
                     │  Speicher  │
                     │  (S3/GCS)  │
                     │  90+ Tage  │
                     └────────────┘
```

---

## 5. Restore-Runbook

### Szenario A: Versehentliches Löschen (< 24h)

1. **Sofort:** PITR nutzen → Zeitpunkt VOR dem Löschen wählen
2. **Wenn kein PITR:** Letztes Backup aus Storage laden:
   ```
   # Backup-Datei herunterladen
   supabase storage cp backups/YYYY-MM-DD/daily/TABLE_TIMESTAMP.json ./restore/
   
   # Daten prüfen
   cat ./restore/TABLE_*.json | python3 -m json.tool | head -20
   
   # In Staging importieren und verifizieren
   # Dann gezielt in Prod einspielen
   ```
3. **Verifikation:** Row-Count prüfen, Spot-Check auf kritische Records

### Szenario B: Fehlerhafte Migration

1. **Sofort:** Rollback-Migration schreiben (inverse SQL)
2. **Wenn komplex:** PITR auf Zeitpunkt vor Migration
3. **Wenn kein PITR:** DB aus letztem Backup restaurieren, Migration fixen, neu anwenden

### Szenario C: Datenkorruption / Stille Drift

1. Backup-Hashes mit `verify-backup` Edge Function prüfen
2. Betroffene Tabellen identifizieren
3. Letztes verifiziertes Backup laden
4. Diff zwischen Backup und aktueller DB erstellen
5. Gezielt korrigieren (nicht komplett überschreiben)

### Szenario D: Kompletter Datenverlust

1. Neues Supabase-Projekt erstellen
2. Schema aus `supabase/migrations/` restaurieren
3. Daten aus externem Backup importieren (Klasse 1 zuerst)
4. Storage-Dateien aus externem Sync restaurieren
5. Edge Functions deployen
6. DNS/Auth umstellen
7. Smoke-Tests durchführen

### Szenario E: Storage-Dateien gelöscht

1. DB-Metadaten prüfen (storage.objects)
2. Dateien aus externem Storage-Sync restaurieren
3. Wenn kein externer Sync: Dateien aus Backup-Bucket kopieren

---

## 6. Monatlicher Restore-Drill (Checkliste)

- [ ] Backup-Snapshot der letzten 24h identifizieren
- [ ] `verify-backup` Edge Function ausführen (mit `spot_check: true`)
- [ ] Alle Hashes müssen übereinstimmen
- [ ] Random-Tabelle aus Backup in lokale/Staging-DB importieren
- [ ] Row-Count muss ≥ 95% des Backup-Stands betragen
- [ ] 5 Random-Records manuell gegen Prod prüfen
- [ ] Storage: 3 Random-Dateien aus Backup herunterladen und öffnen
- [ ] Ergebnis in `backup_snapshots` dokumentieren
- [ ] Bei Fehlern: sofort Incident erstellen

---

## 7. Automatisierung

### Implementierte Komponenten

| Komponente | Pfad | Funktion |
|-----------|------|----------|
| Backup Edge Function | `supabase/functions/db-backup-snapshot/` | Tiered DB export mit Hashing |
| Verify Edge Function | `supabase/functions/verify-backup/` | Hash-Verifikation + Spot-Check |
| GitHub Workflow | `.github/workflows/backup-recovery.yml` | Cron-Trigger für alle Tiers |

### API-Aufrufe

```bash
# Critical backup (alle 4h)
curl -X POST "$URL/functions/v1/db-backup-snapshot" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"tier": "critical"}'

# Daily backup
curl -X POST "$URL/functions/v1/db-backup-snapshot" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"tier": "daily"}'

# Weekly backup
curl -X POST "$URL/functions/v1/db-backup-snapshot" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"tier": "weekly"}'

# Verify yesterday's backup
curl -X POST "$URL/functions/v1/verify-backup" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"spot_check": true}'

# Dry-run (no export, just row counts)
curl -X POST "$URL/functions/v1/db-backup-snapshot" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{"tier": "daily", "dry_run": true}'
```

---

## 8. Offene Empfehlungen

### Sofort umsetzen
- [ ] PITR bei Supabase aktivieren (Dashboard → Database → Backups)
- [ ] `backups` Storage Bucket erstellen (wird automatisch beim ersten Backup erstellt)
- [ ] GitHub Secrets prüfen: `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY`

### Kurzfristig (1–2 Wochen)
- [ ] Externen Storage-Sync für Backup-Bucket einrichten
- [ ] Storage-Dateien-Sync für Course-Artifacts einrichten
- [ ] Ersten manuellen Restore-Drill durchführen

### Mittelfristig (1–3 Monate)
- [ ] Zweites externes Backup-Ziel in anderer Region
- [ ] Backup-Verschlüsselung mit externem Key
- [ ] Automatisierte monatliche Restore-Drills
- [ ] Monitoring-Dashboard für Backup-Gesundheit im Admin-Panel
