# Memory: architektur/didaktik/examfit-engagement-layer-and-shuttle-mode-v2
Updated: now

Der 'Engagement & Value Layer' transformiert ExamFit in ein hürdenfreies Prüfungstrainings-System. Kernstück ist der Shuttle Mode (Phase 1): Ein hocheffizienter Fragen-Stream mit gewichteter Selektion und 5 Trainingsmodi (adaptive, random, weakness, speed, exam_lite).

## Shuttle Mode (Phase 1) — Production-Ready
- **DB-Schema**: `shuttle_sessions` (erweitert um mode, current_streak, best_streak, xp_earned, average_response_ms, started_from, metadata), `shuttle_events`, `shuttle_question_state`, `shuttle_user_stats`
- **RPCs**: `fn_select_next_shuttle_question` (5 Modi mit mode-spezifischer Gewichtung), `fn_submit_shuttle_answer` (XP-Vergabe: 2 richtig/1 falsch + Streak-Bonus, leichte Mastery-Beeinflussung), `fn_get_or_create_shuttle_session` (Resume aktiver Sessions), `fn_get_shuttle_dashboard_summary` (Tagesstats, Streak, schwächste Kompetenz, Modus-Empfehlung), `fn_complete_shuttle_session`
- **Edge Function**: `shuttle-engine` mit Actions: `start`, `next`, `submit`, `end`, `explain`, `dashboard`
- **UI-Komponenten**: Modulare Struktur mit `ShuttleEntryCard`, `ShuttleModeTabs`, `ShuttleQuestionCard`, `ShuttleFeedbackCard`, `ShuttleSessionSummary`, `ShuttleHeader`
- **XP-System**: 2 XP richtig, 1 XP falsch, +3 Streak-Bonus alle 5er-Serie
- **Mastery-Integration**: Leichte Score-Beeinflussung (+0.5/-0.3) auf `user_competency_progress`
- **NBA-Integration**: `DAILY_CHALLENGE` und `SHUTTLE_TRAINING` Aktionen in `get_next_best_action` eingefügt

## Phase 2: Daily Challenge (implementiert)
Die Daily Challenge bietet 3-5 deterministische Fragen pro Tag mit Streak-Tracking:
- **DB-Tabellen**: `daily_challenges` (pro User/Curriculum/Tag, question_ids, answers als JSONB, completion-Status), `user_streaks` (current/longest streak, last_completed_date, total_challenges_completed)
- **RPCs**: `get_daily_challenge`, `submit_daily_challenge_answer`
- **Edge Function**: `daily-challenge` mit `get` und `submit` Actions
- **Dashboard-Integration**: Quick-Launch Card im LearnerDashboard

## Phase 3: Explain My Mistake (implementiert)
Inline-KI-Feedback nach falschen Antworten im Shuttle Mode via google/gemini-2.5-flash.

## Phase 4: Prüfungs-Heatmap (implementiert)
Visuelle Reife-Übersicht pro Lernfeld basierend auf Shuttle-Events.

Geplante Erweiterungen: Crash Mode (Phase 5), XP & Mastery Layer (Phase 6), Prüfungsprotokoll (Phase 7).
