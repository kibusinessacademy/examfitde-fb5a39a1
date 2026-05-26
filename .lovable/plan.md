# Phase 2 Cut 1 — Voice-native HR Simulation Runtime

Ziel: aus dem Text-Chat einen **Oral Conversation Trainer** machen. Nicht alles auf einmal — sondern der minimale Schnitt, der spürbar den Kategoriewechsel vollzieht ("Das fühlt sich real an").

## Was im Cut drin ist (1 Sprint, ein Vertical: HR InterviewOS)

### 1. Voice Layer (Push-to-Talk, Half-Duplex)
- **STT**: ElevenLabs `scribe_v2_realtime` (deutsch, Streaming) — Mikrofon aufnehmen, live transkribieren, am Ende des Turns committen.
- **TTS**: ElevenLabs `eleven_turbo_v2_5` — Charakter spricht die AI-Antwort. Voice-ID pro `character_brief` (Werner Mittag = Brian, Bewerber = Liam, etc.) in `conversation_os_scenarios.character_brief.voice_id` persistieren.
- **UI**: Großer Push-to-Talk-Button (halten = sprechen, loslassen = senden). Text-Modus bleibt als Fallback.
- **Voice-Activity-Indikator**: pulsierender Ring während Charakter spricht / User spricht.

### 2. Quality-Gate auf User-Turn (das "Fghjo"-Problem)
Neue Komponente `inputQualityGate` im `conversation-os-turn`:
- Heuristik vor LLM-Call: min. Token, kein Random-Tasten-Pattern, kein Single-Word-Filler.
- **Bei Fail**: Charakter reagiert in-character ("Bitte formulieren Sie eine Antwort, sonst breche ich das Gespräch ab" / "Sie weichen aus — ich frage konkret nach §99 BetrVG"), `state.trust -= 0.15`, `state.tension += 0.2`.
- Drei Fails in Folge → Charakter beendet das Gespräch hart (`session.status = 'aborted_by_character'`, Debrief mit Critical Moment "Vertrauensverlust durch Nicht-Antwort").

### 3. Interruption + Druckmechanik
- **Charakter unterbricht**, wenn User-Antwort > X Sekunden ohne neuen Inhalt (Voice-Mode: TTS bricht ab und Charakter sagt "Lassen Sie mich Sie da unterbrechen — ...").
- **Schweige-Druck**: wenn User nach Charakter-Turn > 8s nicht antwortet, kommt ein Press: "Ich warte." / "Ist die Frage unklar?" → `tension += 0.1`.
- **State steuert Stimme**: Bei `tension > 0.7` wird `voice_settings.stability` runter, `style` rauf → Stimme klingt schärfer. Bei `trust < 0.3` ändert Painpoint-Graph aktiv den `system_prompt`-Tonfall.

### 4. Examiner-Hooks vorbereiten (kein neuer Score — bestehende Rubric reicht für Cut 1)
- Quality-Gate-Events landen in `conversation_os_turns.scoring_delta` (neue Keys: `evasion_detected`, `gibberish_detected`, `silence_pressure`).
- Debrief zeigt diese im Critical-Moments-Block mit `better_alternative`.

## Was NICHT in Cut 1 (bewusst Anti-Drift)
- Kein Full-Duplex / WebRTC Conversational-Agent (würde Painpoint-Engine umgehen → SSOT-Bruch).
- Kein Multi-Agent.
- Kein eigener Examiner-Score parallel zur Rubric.
- Keine weiteren Verticals.
- Keine Hidden-Objectives-Engine (Phase 2 Cut 2).
- Keine Timer-UI / Zeitbudget pro Turn (Cut 2).

## Technische Umsetzung

```text
Client (ConversationOSRunPage)
  ├─ Voice-Mode Toggle
  ├─ Push-to-Talk Button → MediaRecorder (webm/opus)
  ├─ POST audio → edge: conversation-os-stt   ──► ElevenLabs Scribe → {transcript}
  ├─ transcript → existing edge: conversation-os-turn (SSE)
  │     └─ NEU: inputQualityGate(transcript, state)
  │           ├─ ok → bestehende Pipeline
  │           └─ fail → Charakter-Refusal-Turn (kein LLM) + state-delta
  ├─ assistant text + x-conv-voice-id header
  └─ POST text → edge: conversation-os-tts   ──► ElevenLabs Turbo v2.5 → MP3 stream → Audio()

DB
  └─ conversation_os_scenarios.character_brief += { voice_id, voice_profile }
  └─ conversation_os_sessions += { quality_gate_fails int default 0, voice_mode bool }
  └─ conversation_os_turns.scoring_delta erweitert (kein Schema-Change, jsonb)

Edge Functions (neu)
  ├─ conversation-os-stt        (POST audio/webm → {transcript, lang, duration_ms})
  └─ conversation-os-tts        (POST {session_id, text} → audio/mpeg stream)

Edge Function (geändert)
  └─ conversation-os-turn       (+ inputQualityGate, + abort-on-3-fails, + voice_id header)
```

## Voraussetzungen
- **ELEVENLABS_API_KEY** muss als Secret im Lovable-Cloud-Backend liegen. Ohne den Key kann Voice nicht live gehen. Ich frage ihn als nächsten Schritt ab.
- Voice-ID-Backfill für die 20 HR-Szenarien (1 Migration, 1 Charakter pro Szenario, Default = Brian).

## Akzeptanzkriterien (Pilot HR InterviewOS)
1. User kann Push-to-Talk halten, Audio wird transkribiert, Charakter antwortet **per Stimme**.
2. "Fghjo" als Antwort führt zu sichtbarer Charakter-Reaktion + Trust-Drop, nicht zu freundlichem Weiter-Chat.
3. Drei Fails in Folge brechen die Session ab und erzeugen einen Critical-Moment "Vertrauensverlust" im Debrief.
4. 8s Schweigen nach Charakter-Turn löst Druck-Nachfrage aus.
5. Voice-Modus ist Toggle — Text-Modus bleibt funktional (Fallback / B2B-Demo ohne Mikro).

## Was Cut 2 wäre (sichtbar machen, nicht bauen)
- Echtes Full-Duplex Voice mit Interruption während TTS-Playback.
- Timer / Zeitbudget pro Turn.
- Hidden Objectives (Betriebsrat hat verstecktes Ziel "Zustimmung verzögern").
- Examiner-Engine mit eigener Scorecard (Deeskalation, Rechtssicherheit, Souveränität).

---

**Bitte freigeben.** Sobald du OK gibst, frage ich den ElevenLabs-Key ab und ziehe Cut 1 in einem Rutsch durch (DB-Migration → 2 neue Edge Functions → Turn-Function-Update → RunPage-Voice-UI).