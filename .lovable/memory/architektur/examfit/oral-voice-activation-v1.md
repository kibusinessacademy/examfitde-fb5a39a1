---
name: ExamFit Oral Voice Activation v1 (Browser-native, FROZEN 2026-05-31)
description: Voice-Modus im bestehenden OralExamTrainer auf Web Speech API + speechSynthesis. KEIN ElevenLabs, kein externer Provider. Persona-Wirkung über oral-exam-Engine (followup_chains/stress_config/dual_examiner_roles).
type: feature
---

# Oral Voice Activation v1 — Browser-Native (FROZEN 2026-05-31)

## Cut-Korrektur 2026-05-31
Vorherige ElevenLabs-Bridge (Edge Functions `oral-voice-tts`/`oral-voice-stt`, SQL-Helper `fn_oral_examiner_voice_id` / `fn_oral_session_voice_context`, 3 Audit-Verträge) **vollständig entfernt**. Begründung: Governance + Kosten + kein Realismus-Mehrwert. Realismus entsteht über Fragelogik, nicht über Stimmvariation.

## Zielarchitektur (verbindlich)
- **STT:** Browser `webkitSpeechRecognition` / `SpeechRecognition` (de-DE, continuous, interim).
- **TTS:** Browser `window.speechSynthesis` (de-DE, rate 0.95).
- **Engine:** bestehende Edge Function `oral-exam` (Text-LLM, Phasen-State-Machine, Scoring).
- **DB:** ausschließlich bestehende `oral_exam_*` Tabellen — keine neuen Tabellen, keine neue Engine.
- **Persona-Wirkung:** läuft über `examiner_mode`, `stress_level`, `dual_examiner_roles`, `stress_config`, `followup_chains` aus `oral_exam_session_templates` — **nicht** über externe Stimme.

## Quality-Gates (clientseitig, kein Provider)
`evaluateTranscriptQuality()` in `src/pages/OralExamTrainer.tsx` blockt Submit bei:
- leer / nur Whitespace → Stille
- `length < 8` oder `wordCount < 2` → zu kurz
- vowel-ratio < 0.15 → unverständlich

Kandidat erhält Toast + Timer läuft weiter (zweite Chance, kein Submit).

## Fallback-Verhalten
- `webkitSpeechRecognition`/`SpeechRecognition` nicht verfügbar → `speechSupported=false`, Mic-Toggle zeigt Toast "Spracheingabe nicht verfügbar", Textmodus bleibt voll funktional.
- `speechSynthesis` nicht verfügbar → `speakText` ruft stillen `onEnd?.()` auf, Phase wechselt regulär weiter.

## Verboten (Anti-Drift)
- **Keine** ElevenLabs/externe Voice-Provider im ExamFit-Oral-Pfad. Andere Verticals (ConversationOS HR, VerwaltungsOS) behalten ihre ElevenLabs-Pfade — getrennte Domains.
- Keine neuen Oral-Tabellen.
- Keine zweite Oral-Engine.
- Kein `MediaRecorder`-Push-to-Talk im ExamFit-Trainer (nicht nötig — `webkitSpeechRecognition` macht beides).
- Keine `ELEVENLABS_API_KEY`-Prüfung im Oral-Code.

## Persona/Realismus-Roadmap (Engine-only, kein Voice-Provider)
Stufe 1 (höchster Lernhebel): Followup-Chains aktivieren · Stress-Mode aktivieren · Dual-Examiner aktivieren.
Stufe 2: Pausen/Unterbrechungen im LLM-Prompt.
Stufe 3: optional echte Stimmen — **nur wenn ROI durch Cohort-Test belegt**.

## Akzeptanzkriterien (alle erfüllt)
1. ✅ Azubi kann sprechen (Web Speech API STT).
2. ✅ Prüferfrage wird hörbar vorgelesen (speechSynthesis).
3. ✅ Kein ElevenLabs / kein externer Provider im Code- oder Test-Pfad.
4. ✅ Textmodus bleibt voll funktional als Fallback.
5. ✅ Quality-Gate blockt leere/zu-kurze/unverständliche Sprach-Antworten.
