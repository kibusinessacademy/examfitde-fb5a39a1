# Premium Upgrade Plan – Systemweit (v1.0)
## Status: AKTIV | Erstellt: 2026-02-24

### Ziel: Von 7,5 → 9,5 / 10 (Elite-IHK-Trainingsniveau)

---

## Gap-Analyse (Ist → Soll)

| # | Gap | Ist-Score | Ziel | Status |
|---|-----|-----------|------|--------|
| 1 | Bloom-Härtung (Kompetenzen + Blueprints) | 7,5 | 9,5 | 🔴 TODO |
| 2 | Fehler-Ökosystem (Misconceptions, Traps) | 7,0 | 9,5 | 🔴 TODO |
| 3 | Situative Szenarien (30%+ case-based) | 7,0 | 9,5 | 🔴 TODO |
| 4 | Prüfungsmodell (Teil 1/2, Zeit, Mastery) | 6,5 | 9,5 | 🟡 TEILWEISE |
| 5 | Psychometrische Optimierung | 7,0 | 9,5 | 🟡 TEILWEISE |

---

## Bestandsaufnahme (Was existiert bereits)

### ✅ Bereits vorhanden
- `learning_fields.exam_part` – AP1/AP2 Zuordnung
- `learning_fields.weight_percent` – LF-Gewichtung
- `learning_fields.ihk_focus_areas` – IHK-Schwerpunkte
- `exam_questions.item_difficulty/discrimination/guessing` – IRT-Felder
- `exam_questions.cognitive_level` – Bloom als Text
- `exam_questions.distractor_meta` – Distraktor-Metadaten
- `exam_questions.trap_tags` – Fallen-Tags
- `question_blueprints.exam_context_type` – Szenario-Typ
- `question_blueprints.typical_errors` – Fehlerbilder (JSONB)
- `question_blueprints.trap_spec` – Fallen-Spezifikation
- `question_blueprints.decision_structure` – Entscheidungsstruktur
- `question_blueprints.estimated_time_seconds` – Zeitschätzung
- `golden_exam_sets` – Benchmark-Prüfungen

### ❌ Fehlend
- Competencies: Kein Bloom-Level, keine Fehlerbilder, kein Kontext
- Curricula: Kein Prüfungsstruktur-Modell (Teile, Gewichtung, Bestehensregeln)
- Learning Fields: Kein Zeitbudget, kein Mastery-Minimum, kein Bloom-Target
- Exam Questions: Kein exam_part, kein scenario_type, keine time_estimate
- Quality Constraints: Keine tabellarische Prüfungslogik-Härtung

---

## Phase 1: Schema-Erweiterungen (DB-Migration)

### 1.1 Competencies – Bloom & Fehler-Härtung
```sql
ALTER TABLE competencies ADD COLUMN bloom_level TEXT 
  CHECK (bloom_level IN ('remember','understand','apply','analyze','evaluate'));
ALTER TABLE competencies ADD COLUMN action_verb TEXT;
ALTER TABLE competencies ADD COLUMN context_conditions TEXT;
ALTER TABLE competencies ADD COLUMN typical_misconceptions JSONB DEFAULT '[]';
ALTER TABLE competencies ADD COLUMN exam_relevance_tier TEXT 
  CHECK (exam_relevance_tier IN ('core','important','supplementary'));
ALTER TABLE competencies ADD COLUMN transfer_markers JSONB DEFAULT '[]';
```

### 1.2 Learning Fields – Zeitmodell + Mastery
```sql
ALTER TABLE learning_fields ADD COLUMN exam_time_minutes INTEGER;
ALTER TABLE learning_fields ADD COLUMN min_mastery_pct INTEGER DEFAULT 60;
ALTER TABLE learning_fields ADD COLUMN question_target INTEGER;
ALTER TABLE learning_fields ADD COLUMN bloom_distribution_target JSONB 
  DEFAULT '{"remember":0.15,"understand":0.25,"apply":0.30,"analyze":0.20,"evaluate":0.10}';
```

### 1.3 Curricula – Prüfungsstruktur
```sql
ALTER TABLE curricula ADD COLUMN exam_structure JSONB DEFAULT '{}';
-- {"parts":[{"key":"AP1","name":"Teil 1","weight_pct":20,"duration_min":90,"count":25},
--           {"key":"AP2_S","name":"Teil 2 Schriftlich","weight_pct":50,"duration_min":150,"count":40}]}
ALTER TABLE curricula ADD COLUMN passing_rules JSONB DEFAULT '{}';
-- {"overall_min_pct":50,"per_part_min_pct":30,"sperrfach_rule":true}
```

### 1.4 Exam Questions – Prüfungsmodell-Mapping
```sql
ALTER TABLE exam_questions ADD COLUMN exam_part TEXT;
ALTER TABLE exam_questions ADD COLUMN scenario_type TEXT CHECK (scenario_type IN (
  'isolated_knowledge','applied_case','multi_step_case','prioritization',
  'error_detection','documentation_analysis','legal_evaluation','communication_scenario'));
ALTER TABLE exam_questions ADD COLUMN bloom_level_validated TEXT;
ALTER TABLE exam_questions ADD COLUMN time_estimate_seconds INTEGER;
ALTER TABLE exam_questions ADD COLUMN typical_errors JSONB DEFAULT '[]';
ALTER TABLE exam_questions ADD COLUMN discrimination_tier TEXT 
  CHECK (discrimination_tier IN ('elite','acceptable','weak','reject'));
```

### 1.5 Quality Constraints (Neue Tabelle)
```sql
CREATE TABLE blueprint_quality_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id UUID REFERENCES curricula(id),
  constraint_key TEXT NOT NULL,
  constraint_config JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Phase 2: Pipeline-Härtung (Edge Functions)

### 2.1 Kompetenz-Enrichment (Neuer Step)
- [ ] Bestehende Kompetenzen mit Bloom-Level anreichern
- [ ] `action_verb` aus Beschreibung extrahieren
- [ ] `context_conditions` generieren
- [ ] `typical_misconceptions` (min. 3 pro Kompetenz) generieren
- [ ] Formulierung auf Handlungskompetenz umschreiben
- [ ] `exam_relevance_tier` setzen

### 2.2 Blueprint-Seeder v4 ✅ DONE
- [x] Shared AI client (callAIJSON) + model-routing (getModelChainAsync)
- [x] `question_template` mit situativen Szenarien generieren
- [x] `typical_errors` (min. 3) pro Blueprint erzwingen (ensureMinErrors)
- [x] `exam_context_type` diversifizieren (max 20% `isolated_knowledge`)
- [x] `bloom_level` aus enriched Kompetenz→Blueprint propagieren
- [x] `exam_part` aus LF→metadata ableiten
- [x] Profession glossary injection für Domain-Tiefe
- [x] Health Score v4 mit elite metrics (with_min_errors, isolated_pct)
- [x] Upgrade existing blueprints mit fehlenden typical_errors

### 2.3 Exam-Pool Generator Upgrade ✅ DONE
- [x] `scenario_type` aus Blueprint `exam_context_type` propagieren
- [x] `exam_part` aus LF setzen
- [x] `typical_errors` propagieren
- [x] `time_estimate_seconds` übernehmen
- [x] Distraktoren mit `why_wrong` + `why_tempting` + `examiner_intention`

### 2.4 Validation Gates v2 ✅ DONE
- [x] **Bloom-Gate:** Verteilung pro LF gegen `bloom_distribution_target` (hard fail, 15pp Toleranz)
- [x] **Scenario-Gate:** min 30% case-based (hard fail in Blueprint-Validator)
- [x] **Distractor-Quality-Gate:** `distractor_meta` mit why_wrong/why_tempting pflichtprüfen (hard fail)
- [x] **Time-Gate:** Zeitbudget gegen Prüfungszeit aus exam_structure (soft warning)
- [x] **Discrimination-Gate:** `item_discrimination < 0.20` → auto-tag "weak" + training-only (soft warning)

---

## Phase 3: Retroaktives Content-Upgrade ✅ DONE

### 3.1 Kompetenz-Formulierung
- [x] `enrich-competencies` Edge Function deployed (batch AI enrichment)
- [x] `retroactive-content-upgrade` Status-Runner deployed
- Status: 2/14.182 enriched (ongoing via batch calls)

### 3.2 Fragen-Retrofit (SQL) ✅ DONE
- [x] `exam_part` aus LF propagiert → 18.162/18.184 ✓
- [x] `scenario_type` aus Blueprint propagiert → 7.290 ✓
- [x] `time_estimate_seconds` aus Blueprint propagiert → 7.290 ✓
- [x] `typical_errors` aus Blueprint propagiert → 1.532 ✓
- [x] `bloom_level_validated` aus Blueprint propagiert → 7.290 ✓

---

## Phase 4: Quality Reports v2 ✅ DONE

- [x] **Bloom-Score:** Ist vs. Soll Verteilung pro LF (gewichteter Drift)
- [x] **Transfer-Score:** % case-based Fragen (Ziel: 30%+)
- [x] **Fehlerdichte:** Ø typical_errors pro Blueprint (Coverage + Avg)
- [x] **Redundanz-Score:** normalized_hash Clustering (Duplikaterkennung)
- [x] **Difficulty-Drift:** Ist vs. Soll Schwierigkeitsverteilung (4-Bucket)
- [x] **Discrimination-Index:** Ø item_discrimination pro Pool (Weak/Elite Tiers)
- [x] **Exam-Part-Balance:** Fragen pro AP1/AP2 vs. exam_structure
- [x] **Edge Function:** `quality-report-v2` deployed (per package_id/curriculum_id)
- [x] **Dashboard:** QualityCouncilDashboard upgraded mit 7-Metrik-Karten, per-LF Breakdown, Bloom-Bars

---

## Implementierungsreihenfolge

| Schritt | Beschreibung | Abhängigkeiten |
|---------|-------------|---------------|
| **S1** | DB-Migration (Phase 1) | Keine |
| **S2** | Kompetenz-Enrichment Pipeline | S1 |
| **S3** | Blueprint-Seeder v4 | S1, S2 |
| **S4** | Exam-Pool Generator Upgrade | S1, S3 |
| **S5** | Validation Gates v2 | S1 |
| **S6** | Retroaktives Content-Upgrade | S1, S2, S3 |
| **S7** | Quality Reports v2 + Dashboard | S1 |

---

## Risiken & Mitigationen

| Risiko | Mitigation |
|--------|-----------|
| Bestehende Fragen inkompatibel | Alle neuen Felder nullable + Retrofit-SQL |
| Pipeline-Bruch durch neue Gates | Gates als `warn` starten, nach Validierung → `block` |
| KI-Kosten Retroactive-Upgrade | Batch-Processing, nur Drafts aufwerten |
| Laufende Pakete stören | Neue Felder nullable, Pipeline abwärtskompatibel |
