# AI für exportierte Kurspakete — Lösung & Roadmap

Stand: 2026-06-26
Owner: Platform / Edge Functions

## Problem

Exportierte Kurspakete (`Bulk Course Export` → ZIP mit `player/index.html` + `data.json`)
laufen **offline / auf Fremd-Hosting** und haben keinen Lovable-Cloud-Kontext mehr:

- Kein `supabase` Client, kein JWT, keine RLS-Session.
- Kein `LOVABLE_API_KEY` — der darf **niemals** ins ZIP gepackt werden.
- Keine `tutor_access_check`-Gates, keine `ai_validations`, keine Audit-Trails.

Folge: `LessonTutorBox`, `OralExamTrainer`, `AITutorChat` rendern im exportierten
Player ins Leere oder schlagen mit CORS/401-Fehlern fehl.

## Lösung — 3 Modi, vom Paket-Generator gesteuert

Der Export erhält einen neuen `aiMode`-Switch (`offline` | `proxy` | `disabled`,
Default `proxy`). Der Modus wird beim Build in `data.json` und in einem
`player/manifest.json` verankert.

### Mode A — `offline` (Demo / Voll-Offline)

- Pre-Generation während des Exports: für jede Lektion werden
  **3 vorgefertigte Tutor-Antworten** (`explain_simpler`, `exam_example`,
  `exam_pitfall`) batch-generiert und als `data.tutor[lessonId]` ins ZIP gelegt.
- Player rendert statt Live-Chat eine „**Geprüfte Tutor-Hinweise**"-Karte mit
  diesen vorgenerierten Antworten — kein Netzwerk nötig.
- `OralExamTrainer` fällt auf browser-native STT/TTS zurück (ist bereits so
  gebaut, siehe `oral-trainer-cinematic-voice` memory).
- **Kosten:** einmalig beim Build, deterministisch, vertraglich saubere
  Distribution (DSGVO, kein Datenabfluss zum Käufer).

### Mode B — `proxy` (Lizenz-gebundener Live-Tutor, Default)

- Beim Build vergibt der Export einen **scoped, signed Package Token** (JWT,
  Audience = `package:<id>`, Scope = `tutor.read`, Curriculum-allowlist, TTL =
  Lizenzlaufzeit). Token wird per Stripe-Webhook an den Käufer gemailt **und**
  in `player/manifest.json` (mit Platzhalter für SaaS-Bind) abgelegt.
- Neue Edge Function `ai-tutor-package-proxy` (public, `verify_jwt = false`):
  - Validiert Package-Token (HS256 mit `PACKAGE_TUTOR_SIGNING_KEY`).
  - Prüft `package_tutor_quota` (Tabelle, rate-limit pro Token, default
    500 req/Tag).
  - Ruft intern `ai-tutor` mit serviceseitig erzeugtem Bearer auf.
  - Schreibt Audit (`ai_tutor_logs.metadata.package_id` + `token_jti`).
- Player nutzt diese Proxy-URL statt der internen `ai-tutor`-URL —
  `LOVABLE_API_KEY` bleibt server-side.

### Mode C — `disabled`

- AI-Surfaces werden vom Builder entfernt (`LessonTutorBox` rendert nicht).
- Für Compliance-strikte Distributionen (Behörden, Schulen ohne Datentransfer).

## Auswahl pro Export

Die `BulkCourseExportPage` bekommt ein neues Dropdown „AI-Modus" mit den drei
Optionen + Tooltip-Erklärung. Default = `proxy`. Mode wird an
`export-course-package` als Body-Param `aiMode` durchgereicht.

## Implementierungs-Schritte (priorisiert)

1. **Phase 1 — Mode A scaffolden** (1 Tag): Pre-Gen-Loop in
   `export-course-package` + `LessonTutorBox` Offline-Fallback rendern
   `data.tutor[lessonId]` falls vorhanden.
2. **Phase 2 — Mode B Proxy** (2 Tage): Edge Function +
   `package_tutor_tokens` Tabelle + Stripe-Webhook-Mail.
3. **Phase 3 — Quota & Audit-Cockpit** (1 Tag): Admin-View
   `v_admin_package_tutor_usage`.
4. **Phase 4 — UI-Switch + Doku** (0.5 Tage).

## Nicht-Ziele

- Keine Inklusion von `LOVABLE_API_KEY` o.ä. ins Paket.
- Keine RLS-bypassing Funktionen ohne Token-Validierung.
- Keine Änderung am internen Live-Tutor-Pfad (nur Proxy-Layer neu).
