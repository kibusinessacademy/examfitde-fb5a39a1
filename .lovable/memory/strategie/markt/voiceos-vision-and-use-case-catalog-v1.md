---
name: VoiceOS Vision + Use-Case-Catalog v1
description: VoiceOS als eigenständiges BerufOS-Modul (nicht Voice-Feature). Strategie, SSOT-Datenmodell (voice_sessions/turns/artifacts/compliance_events), Curriculum-native Blueprints, Vertical-Katalog (ExamFit/HR/Kundenservice/Medizin/Pflege/Immo/Banking/IT/Behörde/Compliance). Track-Gate: nur AUSBILDUNG_VOLL + EXAM_FIRST_PLUS (23 active products 2026-05-26).
type: feature
---

# VoiceOS v1 — AI-native Voice Workflow Platform

## Positionierung
- **Was**: Echtzeit-Sprachschnittstelle für AI-native Operations-Systeme — auditierbar, rollen-/scope-geprüft, curriculum- und workflow-nativ.
- **Was nicht**: kein Sprachbot, kein "Alexa für Unternehmen", kein isolierter Voice-Agent.
- **Differenzierung**: Voice → Intent → Kompetenz/Blueprint/Lernfeld → strukturiertes Artefakt → Workflow → Audit. Das ist der Moat — generische Voice-Assistenten haben nichts davon.

## BerufOS-Position
- VoiceOS = eigenes Modul in `src/lib/berufos/modules.ts` (status `preview`), accent petrol-ice.
- Cross-OS-Layer: dient ExamFit, HR InterviewOS, KundenserviceOS, MedizinOS/PflegeOS, ImmobilienOS, BankingOS, ITSupportOS, BehördenOS, FördermittelOS, ComplianceOS, VibeOS Mission Control.

## SSOT-Datenmodell (Cut 2)
- `voice_sessions` (tenant_id, user_id, role, os_context, session_type, consent_version, language, status, risk_level, started_at/ended_at)
- `voice_turns` (session_id, speaker, transcript, normalized_text, intent, confidence, llm_model, latency_ms, started_at/ended_at)
- `voice_artifacts` (session_id, artifact_type, entity_type, entity_id, summary, structured_payload) — Bridge zu Tickets/Tasks/CRM/Learning-Plans
- `voice_compliance_events` (session_id, event_type, severity, details) — DSGVO/AI-Act-Audit
- RLS: user_id owner + has_role('admin'); service_role für Edges. SECURITY DEFINER RPCs für Cross-Tenant-Aggregate.
- Audit: jeder Mutation via `fn_emit_audit` (action_types: `voice_session_started/ended`, `voice_artifact_emitted`, `voice_compliance_event`, `voice_consent_recorded`).

## Track-Gate (Oral Trainer)
Aus Memory `entitlement-foundation-s1-v1`: Oral-Mode ist **nur** für Tracks
- **AUSBILDUNG_VOLL** (24mo, voll) — Baseline 2026-05-26: 14 active products
- **EXAM_FIRST_PLUS** (+oral+h5p) — Baseline 2026-05-26: 9 active products

EXAM_FIRST (167 exam_trainer + 55 course) hat **keinen** Voice-Zugang — verhindert via `fn_voice_access_check(user_id, product_id)` (gleiches Muster wie `tutor_access_check`).

## Blueprint-Modell (Curriculum-native)
Jeder Voice-Blueprint referenziert verbindlich:
- curriculum_id + learning_field_id + competency_id (FK)
- persona, mood, escalation_level
- evaluation_dimensions (Fachlichkeit/Struktur/Empathie/Compliance/Druckresistenz)
- typical_errors, trigger_words, compliance_rules, follow_up_questions

Reuse: Blueprint-System lebt **erweiterungsweise** auf bestehenden `exam_blueprints` (Phase 2 Bridge) — NICHT als paralleles System (Architectural Continuity Guard SSOT_FIRST/NO_PARALLEL_SYSTEMS).

## Vertical-Katalog (Cut-Reihenfolge)
1. **ExamFit Oral Trainer** (Cut 3 — sofort nach SSOT) — 23 Pakete, echte IHK-nahe mündliche Simulation, Blueprint→Frage→STT→Antwortanalyse→Kompetenzmapping→Folgefrage. Stressmodus + Prüfungsausschuss (3 Stimmen) als Premium-Mode.
2. **HR InterviewOS** (Cut 1 bereits live, Cut 4 = Stressmodus + Panel + Coach-Debrief auf SSOT migrieren)
3. **KundenserviceOS** (Reklamation/Hotline) — Voice-to-Ticket-Bridge als erster echter Workflow-Beweis
4. **MedizinOS/PflegeOS** (Patientenaufnahme/Angehörige/Demenz) — Compliance Guard hart
5. **ImmobilienOS** (Mieter-Hotline → Ticket → Handwerker-Dispatch)
6. **BankingOS/VersicherungsOS** (Beratung + MFA-Gate)
7. **ITSupportOS / BehördenOS / FördermittelOS / ComplianceOS** (B2B Enterprise)

## Compliance-Pflicht
- Consent-Layer vor Start (Gesprächs-/Speicher-/Audio-Hinweis, AI-Transparenz "Sie sprechen mit einem KI-System")
- Rollen: owner/staff/admin/auditor/trainer/candidate (via user_roles + has_role)
- Sensitive-Data-Guard: kein Banking/Medical-Read ohne MFA + scope
- Voice-Memory: persistente Sessions nur mit explizitem Consent + Löschpflicht (Right-to-Erasure RPC)

## Anti-Drift
- VoiceOS baut **nichts**, was nicht curriculum-, blueprint-, kompetenz- oder workflow-gebunden ist.
- Keine generischen "Alexa-Skills".
- Kein Voice-Layer ohne Track-Gate (sonst EXAM_FIRST-User bekommen Premium-Feature gratis).
- Kein Bypass um `voice_compliance_events` — jede Sensitive-Aktion muss event-loggen.

## Premium-USP-Snapshot
Voice + Curriculum + Blueprints + Kompetenzen + Workflow + Compliance + Analytics + Audit Trails — diese 8-fach-Kombi ist extrem schwer kopierbar und macht aus "Voice AI" ein vollständiges berufliches Simulations- und Operationssystem.

## Status
- **Cut 1 (HR Voice-PoC)**: live — Push-to-Talk, STT/TTS, Quality-Gate, Hard-Abort (Stand 2026-05-26).
- **Cut 2 (SSOT-Foundation)**: NEXT — voice_sessions/turns/artifacts/compliance_events + fn_voice_access_check + Audit-Contracts + Module-Eintrag in modules.ts.
- **Cut 3 (ExamFit Oral Trainer)**: nach Cut 2 — Rollout über 23 oral-eligible Pakete (track gate).
- **Cut 4+**: HR-Migration auf SSOT, dann Vertical-Katalog sequentiell mit Market-Activation-Filter.
