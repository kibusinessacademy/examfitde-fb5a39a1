# Memory: architektur/didaktik/examfit-engagement-layer-and-shuttle-mode-v2
Updated: now

Der 'Engagement & Value Layer' transformiert ExamFit in ein hürdenfreies Prüfungstrainings-System. Kernstück ist der Shuttle Mode (Phase 1): Ein hocheffizienter Fragen-Stream mit gewichteter Selektion (Schwächen > Blueprint-Relevanz > Kompetenz-Varianz > Cooldown > Random Tiebreaker) und Anti-Loop-Schutz (Ausschluss der letzten 10 Fragen und der letzten 3 Kompetenzen der Session). Die Architektur nutzt transaktionale RPCs ('fn_select_next_shuttle_question', 'fn_submit_shuttle_answer') zur serverseitigen Validierung und Persistenz von Events, Stats und Mastery-Fortschritten. Das System ist gegen Double-Submits geschützt (Partial Index auf 'question_answered' Events) und nutzt ein flexibles Antwortmodell ('selected_option_indexes' als JSONB).

## Phase 2: Daily Challenge (implementiert)
Die Daily Challenge bietet 3-5 deterministische Fragen pro Tag mit Streak-Tracking:
- **DB-Tabellen**: `daily_challenges` (pro User/Curriculum/Tag, question_ids, answers als JSONB, completion-Status), `user_streaks` (current/longest streak, last_completed_date, total_challenges_completed)
- **RPCs**: `get_daily_challenge` (erstellt oder lädt heutige Challenge mit gewichteter Fragenauswahl: Schwächen > Kompetenz-Varianz > Zufall, Anti-Wiederholung gegen gestrige Fragen), `submit_daily_challenge_answer` (validiert serverseitig, aktualisiert Streak bei Completion)
- **Edge Function**: `daily-challenge` mit `get` und `submit` Actions
- **UI**: `/daily-challenge?curriculum=<id>` mit Fortschrittsbalken, Streak-Anzeige (Flame-Icon), Frage-/Feedback-Karten, Ergebnis-Screen mit Streak-Stats
- **Dashboard-Integration**: Quick-Launch Card im LearnerDashboard

## Phase 3: Explain My Mistake (implementiert)
Inline-KI-Feedback nach falschen Antworten im Shuttle Mode:
- **Action**: `explain` im `shuttle-engine` Edge Function
- **AI-Modell**: google/gemini-2.5-flash via Lovable AI Gateway
- **Prompt-Logik**: Kontextbezogen mit Frage, gewählter (falscher) und richtiger Antwort, Trap-Tags und Basis-Erklärung
- **Fallback**: Bei AI-Fehler wird die statische Erklärung aus der DB verwendet
- **UI**: "Fehler erklären lassen" Button (Lightbulb-Icon) erscheint nur bei falschen Antworten, KI-Erklärung wird in separater Karte (Amber-Akzent) angezeigt
- **Hook**: `explainMistake(questionId, selectedAnswer)` in `useShuttleMode`

Geplante Erweiterungen umfassen eine 'Prüfungs-Heatmap' (Phase 4), den 'Crash Mode' (Phase 5, 7-Tage-Plan), einen 'XP & Mastery Layer' (Phase 6) sowie ein 'Prüfungsprotokoll' (Phase 7). Alle Module agieren strikt SSOT-konform auf Basis bestehender Datenquellen.
