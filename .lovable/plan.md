

# Plan: MiniCheck-Antwortqualität heilen + Exportfunktion reparieren

## Kontext (Verkäufer-Paket)
- **Package**: `59b6e214-e181-4c2b-986e-1ce544984d04` / Course: `ae943f8c-da2e-422e-af5f-d7ff721cbf0c`
- **Curriculum**: `63635f46-0186-49e7-80c1-67925dbdf638`
- 200 Lessons, davon 192 auf `draft` — aber 160 haben echten HTML-Content (8-12KB)
- 5.401 MiniCheck-Fragen (alle approved), aber Antwortschlüssel teilweise fehlerhaft
- 419 Exam-Fragen ohne `blueprint_id` (28%)

## Zwei Arbeitspakete

---

### 1. Exportfunktion reparieren

**Problem**: `export-course-package/index.ts` Zeile 264 — die Lesson-Query selektiert **kein `content`-Feld**. Der ZIP-Export enthält daher nur Metadaten, keine Lerninhalte.

**Fix**:
- `content` zum SELECT in der Lesson-Query hinzufügen (Zeile 264)
- Das `content`-Feld im Lesson-Objekt (Zeile 277-297) mappen — als `content_html` extrahiert (nur das HTML-Feld aus dem JSON)
- Sicherstellen, dass die Dateigröße handhabbar bleibt (content wird pro Lesson ~10KB sein, bei 200 Lessons ~2MB — kein Problem)

**Datei**: `supabase/functions/export-course-package/index.ts`

---

### 2. MiniCheck-Antwortqualität heilen (AI-gestützt)

**Problem**: Teils falsche `correct_answer`-Indizes, fehlerhafte Rechenlogik, inkonsistente Optionen.

**Ansatz**: AI-gestütztes Batch-Audit über die 5.401 MiniCheck-Fragen:
- Script nutzt die AI-Gateway-Skill, um Batches von ~20 Fragen gleichzeitig zu validieren
- AI prüft: Stimmt `correct_answer` mit der fachlich richtigen Lösung überein? Sind die Optionen konsistent? Sind Rechenwege korrekt?
- Ergebnis: Liste der fehlerhaften Fragen mit korrektem `correct_answer`
- Korrekturen werden via `supabase--insert` (UPDATE) direkt in `minicheck_questions` geschrieben

**Zusätzlich (Datenbereinigung)**:
- 192 Lessons von `draft` → `published` setzen (Content ist vorhanden)
- 419 Exam-Fragen ohne `blueprint_id` auf passende Blueprints verteilen

---

### 3. Governance-Reconciliation

- `quality_gate_status` der Lessons auf `passed` setzen
- `auto_publish` Step-Status synchronisieren

---

## Technische Details

| Schritt | Tool/Datei | Aktion |
|---|---|---|
| Export-Fix | `export-course-package/index.ts:264` | `content` zum SELECT + Mapping |
| MiniCheck-Audit | AI-Gateway Script | Batch-Validierung mit Gemini |
| MiniCheck-Fix | `supabase--insert` | UPDATE fehlerhafte `correct_answer` |
| Lesson-Status | `supabase--insert` | UPDATE 192 Lessons → `published` |
| Blueprint-Bind | `supabase--insert` | UPDATE 419 Fragen mit `blueprint_id` |
| Governance | `supabase--insert` | Steps + Quality Gates reconciliieren |

## Reihenfolge
1. Export-Fix (Code-Änderung + Deploy)
2. Lesson-Status-Healing (DB)
3. Blueprint-Rückverfolgbarkeit (DB)
4. MiniCheck-Audit + Fix (AI-Script + DB)
5. Governance-Reconciliation (DB)

