# Produktdesign Gap-Analyse: ExamFit.de

## Abgleich: Referenz-Produkt vs. Aktuelle Implementierung

**Erstellt:** 2025-02-08  
**Ziel:** Identifikation von Mehrwert-Potenzialen basierend auf dem Referenz-Produktdesign

---

## Executive Summary

Die ExamFit.de Plattform hat bereits eine **solide Grundarchitektur** mit:
- ✅ Prüfungstrainer mit Modi (Simulation, Practice)
- ✅ Lernkurse mit 5-Schritte-Didaktik
- ✅ Mündlicher Prüfungstrainer mit TTS/STT
- ✅ AI-Tutor mit Governance-Rollen
- ✅ Spaced Repetition (SM-2)
- ✅ Blueprint-basierte Fragegeneration

**Kritische Lücken** für ein "didaktisches System" statt "Content-Plattform":

| Bereich | Status | Priorität |
|---------|--------|-----------|
| Diagnosetest bei Einstieg | ❌ Fehlt | 🔴 Kritisch |
| Adaptive Steuerung (System entscheidet) | ⚠️ Teilweise | 🔴 Kritisch |
| Schwächenmodus im Prüfungstrainer | ❌ Fehlt | 🟡 Hoch |
| Quality Gates vor Publish | ⚠️ Manuell | 🟡 Hoch |
| Bestehens-Prognose Dashboard | ❌ Fehlt | 🟡 Hoch |
| Lernziel-Tracking pro Lesson | ⚠️ Implizit | 🟢 Mittel |

---

## Detaillierte Analyse nach Produktbestandteilen

### A) Prüfungstrainer (Exam Mode)

#### ✅ Vorhanden
- `ExamSimulation.tsx`: Modi (simulation, practice, timed_exam)
- `useExamSimulation.ts`: Session-Management, Antwort-Tracking
- Blueprint-basierte Fragenauswahl mit Gewichtung
- Zeit-Tracking pro Frage
- Ergebnisanalyse nach Lernfeldern

#### ❌ Fehlende Features

**1. Schwächenmodus (Weakness Mode)**
```typescript
// EMPFEHLUNG: Neuer Modus in exam_sessions
type ExamMode = 'simulation' | 'practice' | 'timed_exam' | 'weakness';

// Logik: Nur Fragen aus Kompetenzen mit score < 70%
```

**2. Prüfungsnahe MC- & Szenariofragen (1.000+)**
- Aktuell: Blueprint-generiert, aber Anzahl unklar
- Ziel: ≥1.000 Fragen pro Beruf
- Aktion: Dashboard für Fragenpool-Analyse

**3. Kurze + Lange Erklärungen**
- Aktuell: `explanation` Feld (einzeln)
- Ziel: `explanation_short` (prüfungsrelevant) + `explanation_long` (Verständnis)

**4. Fehlerarten-Tracking**
```typescript
// EMPFEHLUNG: Neue Tabelle exam_error_patterns
interface ExamErrorPattern {
  user_id: string;
  competency_id: string;
  error_type: 'conceptual' | 'calculation' | 'terminology' | 'application';
  frequency: number;
}
```

---

### B) Lernkurs (Lernmodus)

#### ✅ Vorhanden
- 5-Schritte-Didaktik (einstieg, verstehen, anwenden, wiederholen, mini_check)
- H5P-Integration für interaktive Inhalte
- Fortschritts-Tracking
- MiniCheck mit Kompetenz-Bewertung
- `lesson_outcomes` für Mastery-Status

#### ❌ Fehlende Features

**1. Kompetenzbasierte (nicht lineare) Navigation**
- Aktuell: Sequenzielle Modul-Struktur
- Ziel: System empfiehlt nächste Lektion basierend auf Schwächen

```typescript
// EMPFEHLUNG: Neue Funktion getRecommendedNextLesson
async function getRecommendedNextLesson(userId: string, courseId: string) {
  // 1. Hole alle Kompetenz-Scores
  // 2. Finde schwächste Kompetenz unter 80%
  // 3. Finde zugehörige Lektion
  // 4. Return Empfehlung mit Begründung
}
```

**2. "MiniCheck entscheidet: weiter oder vertiefen"**
- Aktuell: Nutzer entscheidet frei
- Ziel: System schlägt Wiederholung vor wenn Score < 80%

**3. Lernziel-Definition pro Lesson (AEVO-konform)**
- Aktuell: Implizit über Kompetenz-Mapping
- Ziel: Explizites `learning_objective` Feld + Anzeige

---

### C) Mündlicher Prüfungstrainer

#### ✅ Vorhanden (Starker USP!)
- `OralExamTrainer.tsx`: Vollständig implementiert
- TTS (Text-to-Speech) für Fragen
- STT (Speech-to-Text) für Antworten
- KI-Evaluation mit IHK-Kriterien
- Musterantwort-Generierung
- Multi-Kriterien-Scoring (Fachlichkeit, Struktur, Vollständigkeit)

#### ❌ Fehlende Features

**1. Prüfer-Nachfragen**
```typescript
// EMPFEHLUNG: Zusätzliches Feld in Evaluation
interface EvaluationResult {
  // ... bestehende Felder
  follow_up_questions: string[]; // Potenzielle Nachfragen
  critical_gaps: string[];       // Was fehlte
}
```

**2. Themenbasierte Simulation**
- Aktuell: Curriculum-basiert
- Ziel: Spezifische Themenbereiche auswählbar (z.B. "nur Warenwirtschaft")

---

### D) AI-Tutor (Didaktischer Kern)

#### ✅ Vorhanden
- `useAITutor.ts`: 3 Modi (learning, practice, exam)
- 4 Rollen (explainer, coach, examiner, feedback)
- Kontextuelle Eingriffe basierend auf Session-Typ
- Exam-Mode: Inhaltliche Hilfe blockiert (AEVO-konform!)
- `ai-tutor/index.ts`: Edge Function mit Governance

#### ❌ Fehlende Features

**1. Fehlerhistorie-Bewusstsein**
```typescript
// EMPFEHLUNG: Erweitere Context
interface AITutorContext {
  // ... bestehende Felder
  errorHistory: {
    competencyId: string;
    errorCount: number;
    lastErrorType: string;
  }[];
  recommendedFocus: string[];
}
```

**2. Lernstrategie-Empfehlungen (Coach-Rolle)**
- Aktuell: Reaktiv auf Fragen
- Ziel: Proaktive Tipps basierend auf Lernverhalten

**3. Prüfungs-Stress-Simulation (Examiner-Rolle)**
- Aktuell: Nur Fragen beantworten
- Ziel: Zeitdruck-Simulation, Stress-Indikatoren

---

## 2. Lernlogik – Das Herzstück

### ❌ KRITISCHE LÜCKE: Diagnosetest bei Einstieg

**Problem:** Lernende starten direkt mit Content, nicht mit Diagnose.

**Referenz-Workflow:**
1. Diagnosetest → Lernstand ermitteln
2. Lernzielabfrage → Prüfungstermin, Schwerpunkte
3. Zeitbudget → Realistischer Lernplan

**EMPFEHLUNG: Neues Onboarding-Flow**

```typescript
// Neue Seite: src/pages/LearnerOnboarding.tsx
interface LearnerProfile {
  userId: string;
  curriculumId: string;
  
  // Diagnosetest Ergebnisse
  diagnosticResults: {
    competencyId: string;
    score: number;
    level: 'weak' | 'partial' | 'strong';
  }[];
  
  // Lernziele
  examDate: Date | null;
  weeklyTimeMinutes: number;
  focusAreas: string[];
  
  // Adaptive Empfehlung
  recommendedPath: 'course_first' | 'exam_trainer' | 'mixed';
  estimatedReadinessDate: Date | null;
}
```

### ⚠️ TEILWEISE: Adaptive Steuerung

**Aktuell:**
- Nutzer wählt frei zwischen Kurs/Trainer
- Kein "System entscheidet mit"

**EMPFEHLUNG: Intelligente Startseite**

```typescript
// Dashboard zeigt kontextuelle Empfehlung
function getAdaptiveRecommendation(userProgress: UserProgress) {
  if (userProgress.weakCompetencies.length > 3) {
    return { action: 'COURSE', reason: 'Mehrere Lücken erkannt', route: '/course/...' };
  }
  if (userProgress.lastExamScore > 70) {
    return { action: 'SIMULATION', reason: 'Prüfungsnah, Feinschliff', route: '/exam-simulation' };
  }
  if (daysUntilExam < 14) {
    return { action: 'ORAL_TRAINER', reason: 'Mündliche Prüfung priorisieren', route: '/oral-exam' };
  }
}
```

---

## 3. Quality Gates

### ⚠️ TEILWEISE IMPLEMENTIERT

**Vorhanden:**
- `QualityGatesPage.tsx`: Admin-Seite existiert
- Manuelle Prüfungen möglich

**Fehlend:**

**1. Automatisierte Prüfungstrainer-Validierung**
```sql
-- Check: ≥98% Fragen mit korrekter Lösung + Erklärung
SELECT 
  curriculum_id,
  COUNT(*) as total,
  COUNT(CASE WHEN explanation IS NOT NULL AND correct_answer_index IS NOT NULL THEN 1 END) as valid,
  ROUND(COUNT(CASE WHEN explanation IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as coverage
FROM exam_questions
GROUP BY curriculum_id;
```

**2. Automatisierte Kurs-Validierung**
```sql
-- Check: Jede Lesson hat Lernziel + MiniCheck
SELECT 
  c.id as course_id,
  l.id as lesson_id,
  l.title,
  l.learning_objective IS NOT NULL as has_objective,
  EXISTS(SELECT 1 FROM lesson_steps ls WHERE ls.lesson_id = l.id AND ls.step_type = 'mini_check') as has_minicheck
FROM courses c
JOIN modules m ON m.course_id = c.id
JOIN lessons l ON l.module_id = m.id
WHERE c.status = 'draft';
```

**3. Publish-Blocker**
```typescript
// curriculum_products Tabelle erweitern
interface CurriculumProduct {
  // ... bestehende Felder
  quality_gate_passed: boolean;
  quality_gate_results: {
    question_coverage: number;    // ≥98%
    explanation_coverage: number; // ≥95%
    learning_field_coverage: number; // 100%
    minicheck_coverage: number;   // 100%
  };
  can_publish: boolean; // Berechnet aus quality_gate_passed
}
```

---

## 4. Produktpaket (Verkaufsfertig)

### ✅ Vorhanden
- `ShopPage.tsx`: Shop-System
- `store_products`: 3 Produkte (Lernkurs, Prüfungstrainer, Bundle)
- `curriculum_products`: Verknüpfung Curriculum → Produkt
- Entitlement-System für Feature-Zugriff

### ❌ Fehlend

**1. Fortschrittsanalyse-Dashboard für Käufer**
```typescript
// Neue Komponente: LearnerProgressDashboard
interface LearnerAnalytics {
  overallReadiness: number;        // 0-100% Bestehens-Prognose
  timeSpentTotal: number;          // Minuten
  timeSpentThisWeek: number;
  competencyBreakdown: {
    competencyId: string;
    title: string;
    mastery: number;
    trend: 'improving' | 'stable' | 'declining';
  }[];
  predictedExamScore: number;
  recommendedActions: string[];
}
```

**2. "Updates inklusive" Kommunikation**
- Aktuell: Nicht sichtbar für Käufer
- Ziel: Changelog/News-Feed für gekaufte Produkte

---

## 5. USP-Matrix (Differenzierung)

| Feature | Klassische Plattform | ExamFit.de (Aktuell) | ExamFit.de (Ziel) |
|---------|---------------------|---------------------|-------------------|
| Kursstruktur | Statisch | 5-Schritte-Didaktik ✅ | + Adaptive Pfade |
| Fragen | PDF/Quiz | Blueprint-generiert ✅ | + Schwächenmodus |
| Feedback | Keine | AI-Tutor ✅ | + Proaktive Tipps |
| Mündlich | ❌ | TTS/STT + KI-Eval ✅ | + Nachfragen-Sim |
| Diagnose | ❌ | ❌ | **Diagnosetest** |
| Prognose | ❌ | ❌ | **Bestehens-%** |

---

## Priorisierte Roadmap

### Phase 1: Kritische Lücken (2-4 Wochen)
1. **Diagnosetest-Onboarding** - Einstiegstest für neue Lerner
2. **Adaptive Dashboard-Empfehlungen** - "System entscheidet mit"
3. **Bestehens-Prognose** - Motivations-Killer oder -Booster

### Phase 2: Hohe Priorität (4-6 Wochen)
4. **Schwächenmodus im Prüfungstrainer** - Gezieltes Üben
5. **Automatisierte Quality Gates** - Publish-Blocker
6. **Kurze + Lange Erklärungen** - Differenzierte Hilfe

### Phase 3: Differenzierung (6-8 Wochen)
7. **Prüfer-Nachfragen-Simulation** - Oral Trainer USP
8. **Proaktiver AI-Coach** - Lernstrategie-Empfehlungen
9. **Fehlertypen-Analyse** - Deep Learning Insights

---

## Technische Empfehlungen

### Neue Datenbank-Tabellen

```sql
-- Diagnosetest-Ergebnisse
CREATE TABLE learner_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  curriculum_id UUID REFERENCES curricula NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  results JSONB NOT NULL, -- Kompetenz-Scores
  recommended_path TEXT,
  exam_date DATE,
  weekly_time_minutes INTEGER
);

-- Fehlertypen-Tracking
CREATE TABLE error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  competency_id UUID REFERENCES competencies NOT NULL,
  error_type TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_occurred_at TIMESTAMPTZ DEFAULT now()
);

-- Bestehens-Prognose
CREATE TABLE readiness_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  curriculum_id UUID REFERENCES curricula NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT now(),
  overall_readiness NUMERIC(5,2),
  predicted_exam_score NUMERIC(5,2),
  weak_areas JSONB,
  strong_areas JSONB
);
```

### Neue Edge Functions

```
supabase/functions/
├── calculate-readiness/     # Bestehens-Prognose berechnen
├── generate-diagnostic/     # Diagnosetest erstellen
└── analyze-error-patterns/  # Fehlertypen auswerten
```

---

## Fazit

ExamFit.de hat bereits **80% der technischen Basis** für ein erstklassiges didaktisches System. Die kritischsten Lücken sind:

1. **Diagnosetest bei Einstieg** → Ermöglicht personalisierte Pfade
2. **Adaptive Steuerung** → System wird zum intelligenten Begleiter
3. **Bestehens-Prognose** → Motiviert und zeigt Fortschritt

Mit diesen Ergänzungen wandelt sich die Plattform von einer "guten Lernplattform" zu einem **didaktischen Begleitsystem, das Prüfungssicherheit verkauft**.
