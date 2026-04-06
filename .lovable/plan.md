
# Admin UI Komplett-Überarbeitung

## Ist-Zustand
Die 3 Admin-Seiten (Command, Studio, Queue) existieren bereits mit SSOT-Daten. Hauptprobleme:
- **403-Fehler** auf `ops_validate_exam_pool_progress` (fehlende Berechtigungen)
- **Alte Leitstelle** (`Leitstelle.tsx`, 1080 Zeilen) noch vorhanden, wird aber nicht geroutet → aufräumen
- **Fehlende Bulk-Aktionen** auf der Leitstelle (z.B. Admin-Hold aufheben, Pakete rebuilden)
- **Recovery Board** und **Finalization Stall** Daten werden geladen, aber fehlende interaktive Buttons

## Plan

### Phase 1: Daten-Zugang sichern
- Fix `ops_validate_exam_pool_progress` View-Berechtigung (GRANT SELECT)
- Sicherstellen, dass alle Admin-Views für `authenticated` zugänglich sind

### Phase 2: Leitstelle (Command) härten
- **KPI-Karten** mit Live-Daten und Klick-Aktionen (bereits vorhanden, aber prüfen)
- **Schnellaktionen** hinzufügen:
  - Admin-Hold aufheben (Batch für alle 266 Pakete)
  - Failed Jobs requeuen
  - Cooldowns freigeben
  - Stuck Steps resetten
- **Recovery Board** mit "Rebuild starten" und "Status ändern" Buttons
- Alte `Leitstelle.tsx` als dead code entfernen

### Phase 3: Studio (Kurse) erweitern
- **Heal-Aktionen** pro Paket sind vorhanden → prüfen ob alle funktionieren
- **Batch-Aktionen** hinzufügen (alle Blockierten freigeben, Track wechseln)

### Phase 4: Queue (Jobs) erweitern
- Ist bereits gut → Batch-Aktionen (retry all failed, purge) prüfen
- **Worker-Liveness** Panel einbauen

### Phase 5: Aufräumen
- Alte `Leitstelle.tsx` entfernen
- Ungenutzte Hooks/APIs entfernen
