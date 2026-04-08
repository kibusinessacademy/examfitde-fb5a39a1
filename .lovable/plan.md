
# ExamFit Engagement & Value Layer – Architekturplan

## Architekturprinzipien
- **SSOT-konform**: Keine neuen Content-Silos, nur Views auf bestehende Daten
- **Backend-first**: Alle Logik in DB-RPCs + Edge Functions, Frontend nur Darstellung
- **Event-driven**: Jede Interaktion → `learning_events` Tabelle (besteht bereits)
- **Blueprint-basiert**: Jede Frage referenziert einen Blueprint, jede Erklärung ist nachvollziehbar

---

## Phase 1: Shuttle Mode (Core Feature) 🚀

### DB-Schema
```sql
-- shuttle_sessions: Tracking einer Shuttle-Sitzung
CREATE TABLE shuttle_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  questions_answered INT DEFAULT 0,
  correct_count INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  xp_earned INT DEFAULT 0
);

-- shuttle_events: Einzelne Antwort-Events
CREATE TABLE shuttle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES shuttle_sessions(id),
  question_id UUID NOT NULL,
  is_correct BOOLEAN NOT NULL,
  response_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Edge Function: `shuttle-next-question`
- Gewichtete Auswahl: Schwächen → Prüfungsrelevanz → Wiederholung → Zufall
- Anti-Loop Guard: Keine Frage in den letzten 10 Events wiederholen
- Performance: Single SQL Query mit SSOT-Join auf `user_competency_progress`

### Edge Function: `shuttle-submit-answer`
- Validiert Antwort gegen `exam_questions`
- Schreibt `shuttle_events`
- Updatet `shuttle_sessions` Zähler
- Triggert `update_mastery_from_minicheck` RPC
- Erzeugt `learning_event` (event_type: 'question_answered')

### UI: `ShuttleMode.tsx`
- Fullscreen, Mobile-First
- Kein Menü, kein Header → maximaler Flow
- Swipe/Tap für nächste Frage
- Inline-Feedback nach jeder Antwort
- "Explain My Mistake" Button bei falscher Antwort (→ Phase 3)

---

## Phase 2: Daily Challenge 📅

### DB-Schema
```sql
-- daily_challenges: Deterministisch pro User/Tag
CREATE TABLE daily_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  challenge_date DATE NOT NULL DEFAULT CURRENT_DATE,
  question_ids UUID[] NOT NULL,
  completed BOOLEAN DEFAULT false,
  correct_count INT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, curriculum_id, challenge_date)
);

-- user_streaks: Streak-Tracking
CREATE TABLE user_streaks (
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_completed_date DATE,
  PRIMARY KEY(user_id, curriculum_id)
);
```

### Edge Function: `daily-challenge`
- GET: Holt/generiert heutige Challenge (deterministisch, kein Random bei Reload)
- POST: Submit Antwort, update Streak
- Frageauswahl: Schwächen + Prüfungsrelevanz, 3-5 Fragen

### UI: `DailyChallenge.tsx`
- Kompakte Card auf Dashboard
- Streak-Counter mit Flamme 🔥
- Progress Dots für Fragen

---

## Phase 3: Explain My Mistake (Inline) 🧠

### Kein eigenes DB-Schema nötig
- Nutzt bestehende `ai_tutor_sessions` + `ai_tutor_messages`

### Edge Function: `explain-mistake` (oder Erweiterung von `ai-tutor`)
- Input: `question_id`, `selected_answer_index`
- Lädt: `distractor_meta`, `trap_type`, Blueprint `explanation`
- Generiert inline-Erklärung basierend auf konkreten Daten (KEIN freies Generieren)
- Prompt-Template: "Der Lernende hat Antwort X gewählt. Der Trap-Typ ist Y. Erkläre basierend auf: Z"

### UI: Inline im Frage-Flow (Shuttle + Daily Challenge + Exam)
- Aufklappbar nach falscher Antwort
- Zeigt: Trap-Typ Tag, Erklärung, Blueprint-Referenz

---

## Phase 4: Prüfungs-Heatmap 🗺️

### Kein eigenes DB-Schema nötig
- View auf `user_competency_progress` + `competencies` + `learning_fields`

### RPC: `get_competency_heatmap`
- Gruppiert nach Lernfeldern
- Score-Bereiche: rot (<50), gelb (50-79), grün (≥80)

### UI: `ExamHeatmap.tsx`
- Grid-Layout: Lernfelder × Kompetenzen
- Farbcodiert
- Klickbar → direkt zum Training der Schwäche

---

## Phase 5: Crash Mode (7-Tage Plan) ⚡

### DB-Schema
```sql
CREATE TABLE crash_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  exam_date DATE,
  plan_json JSONB NOT NULL, -- Tage 1-7 mit Lessons, MiniChecks, Simulations
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'active'
);
```

### Edge Function: `generate-crash-plan`
- Input: curriculum_id, optional exam_date
- Analysiert `user_competency_progress`
- Priorisiert schwächste Kompetenzen
- Mapped auf bestehende Lessons + MiniChecks + Exam Simulations
- Output: 7-Tage-Plan als JSON

### UI: `CrashMode.tsx`
- Timeline-View: Tag 1–7
- Tages-Cards mit Aufgaben
- Progress-Tracking

---

## Phase 6: XP & Mastery Layer 🏆

### DB-Schema
```sql
CREATE TABLE user_xp (
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  total_xp INT DEFAULT 0,
  level INT DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(user_id, curriculum_id)
);

CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  badge_type TEXT NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}'
);
```

### XP-Quellen (via DB-Trigger oder Edge Function):
- MiniCheck bestanden: +10 XP
- Shuttle Frage richtig: +2 XP
- Daily Challenge komplett: +15 XP
- Exam Simulation: +25 XP
- Streak-Bonus: +5 XP pro Tag

### Badges:
- "Erste Shuttle Session", "7-Tage Streak", "100 Fragen", "Kompetenz gemeistert"

### UI: XP-Bar + Level im Header, Badge-Galerie im Profil

---

## Phase 7: Prüfungsprotokoll (Export) 📄

### Edge Function: `generate-exam-report`
- Sammelt: Readiness Score, Schwächen-Map, Simulationsergebnisse
- Generiert PDF (pdf-lib) oder strukturiertes JSON
- B2B-fähig: Export pro Lernender

### UI: Download-Button im Dashboard

---

## Next Best Action Engine Erweiterung

Neue Actions in `get_next_best_action` RPC:
- `SHUTTLE_TRAINING`: Wenn User idle + Schwächen vorhanden
- `DAILY_CHALLENGE`: Wenn heutige Challenge noch offen
- `CRASH_MODE`: Wenn Prüfungsdatum < 14 Tage

---

## Implementierungsreihenfolge

| Phase | Modul | Aufwand | Abhängigkeiten |
|-------|-------|---------|----------------|
| 1 | Shuttle Mode | Groß | Keine |
| 2 | Daily Challenge | Mittel | Shuttle Event-System |
| 3 | Explain My Mistake | Mittel | AI Tutor, Shuttle/Daily UI |
| 4 | Prüfungs-Heatmap | Klein | Keine |
| 5 | Crash Mode | Mittel | Keine |
| 6 | XP & Mastery | Mittel | Shuttle + Daily Events |
| 7 | Prüfungsprotokoll | Klein | Heatmap-Daten |

---

## Event-System Integration
Alle Module nutzen die bestehende `learning_events` Tabelle mit neuen Event-Types:
- `shuttle_started`, `shuttle_completed`
- `daily_challenge_completed`
- `crash_plan_created`
- `badge_earned`
- `report_exported`
