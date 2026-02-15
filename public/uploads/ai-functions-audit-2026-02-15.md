# ExamFit AI Functions – Vollständiges Audit
**Datum:** 2026-02-15  
**Version:** Pipeline v4 + Depth Enrichment

---

## 1. ARCHITEKTUR-ÜBERBLICK

### Model Routing (`_shared/model-routing.ts`)
DB-first mit Hardcoded Fallback (TTL-Cache 60s).

| Intent | Primary Provider | Primary Model | Fallback |
|--------|-----------------|---------------|----------|
| learning_course | Anthropic | claude-sonnet-4-20250514 | openai/gpt-4.1 |
| exam_questions | OpenAI | gpt-4.1-mini | openai/gpt-4.1 |
| oral_exam | OpenAI | gpt-4.1-mini | openai/gpt-4.1 |
| handbook | Anthropic | claude-sonnet-4-20250514 | openai/gpt-4.1 |
| minicheck | OpenAI | gpt-4.1-mini | openai/gpt-4.1 |
| seo_content | Anthropic | claude-sonnet-4-20250514 | openai/gpt-4.1 |
| council_review | Anthropic | claude-sonnet-4-20250514 | openai/gpt-4.1 |
| quality_audit | OpenAI | gpt-4.1 | anthropic/claude-sonnet-4 |
| support | OpenAI | gpt-4.1-mini | deepseek/deepseek-chat |
| repair_content | Anthropic | claude-sonnet-4-20250514 | openai/gpt-4.1 |

### Budget Caps (EUR pro Aufruf)
| Intent | Budget |
|--------|--------|
| learning_course | 2.50€ |
| handbook | 2.00€ |
| quality_audit | 1.50€ |
| seo_content | 1.00€ |
| exam_questions | 0.80€ |
| council_review | 0.80€ |
| oral_exam | 0.50€ |
| minicheck | 0.30€ |
| support | 0.15€ |

### AI Client (`_shared/ai-client.ts`)
- **Provider-APIs**: OpenAI, Anthropic, DeepSeek, Google (direkte API-Keys, kein Lovable Credits)
- **Timeout**: 30s Standard, 55s für große Generierungen (>8192 tokens)
- **Error Handling**: RateLimitError (429), PaymentRequiredError (402), AITimeoutError (504)
- **Cost Logging**: `logLLMCostEvent()` nach jedem AI-Call

---

## 2. AI-FUNKTIONEN – VOLLSTÄNDIGE PROMPTS

---

### 2.1 `generate-course` (Scaffolding)
**Zweck:** Erstellt Kursstruktur (Module, Lektionen) aus Curriculum  
**Model:** Kein AI – rein datenbankbasiert  
**Strategie:** Bulk-Insert (Chunk-Größe 200), Generation Lock, Integrity Validation

**Prozess:**
1. Lade Learning Fields + Competencies in einem Query
2. Erstelle Module pro Learning Field (Upsert)
3. Erstelle 5 Lesson-Steps pro Competency: `einstieg`, `verstehen`, `anwenden`, `wiederholen`, `mini_check`
4. Placeholder-Content: `<h3>{title} – {step}</h3><p>⏳ Inhalt wird generiert...</p>`
5. Post-Generation: `validate_course_integrity` RPC

---

### 2.2 `generate-course-batch` (Lerninhaltekurs)
**Zweck:** Füllt Lesson-Steps mit AI-generierten Inhalten  
**Primary Model:** Claude Sonnet 4 (learning_course) / GPT-4.1-mini (minicheck)  
**Depth Enrichment:** ✅ Ja (seit 2026-02-15)

#### System-Prompt:
```
Du bist ein IHK-Experte für berufliche Ausbildungsinhalte. Erstelle strukturierte, praxisnahe Lerninhalte im JSON-Format. Markiere prüfungsrelevante Stellen mit ⭐.

QUALITÄTSSTANDARD TIEFE:
- Jeder Lernschritt MUSS die fachliche Tiefe des Rahmenplans abbilden
- Verwende konkrete Fachbegriffe und Unterthemen aus dem Curriculum
- Oberflächliche Erklärungen ohne Fachtiefe sind NICHT akzeptabel
- Beziehe dich auf spezifische Unterthemen, nicht nur auf das übergeordnete Lernfeld
```

#### Step-Prompts:
| Step | Prompt |
|------|--------|
| **einstieg** | Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt. Nutze ein konkretes Praxisszenario aus dem Berufsalltag. |
| **verstehen** | Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Gegenbeispielen und IHK-Prüfungsbezügen. Markiere prüfungsrelevante Inhalte mit ⭐. Füge nach jeder Erklärung ein Gegenbeispiel hinzu, das typische Fehlannahmen verdeutlicht. |
| **anwenden** | Erstelle ein Entscheidungsszenario (KEINE reine Beschreibung). Der Lernende muss eine berufliche Entscheidung treffen und begründen. Zeige typische Prüfungsfallen mit ⚠️. Mindestens 2 Entscheidungsoptionen mit Abwägung. |
| **wiederholen** | Erstelle KEINE erneute Erklärung. Erstelle stattdessen PRÜFUNGSVERDICHTUNG: 1. Merksätze 2. Typische IHK-Prüfungsfallen 3. Abgrenzungen 4. Formulierungsübungen 5. Prüfer-Hinweis |
| **mini_check** | Erstelle 4 situative Multiple-Choice-Fragen auf IHK-Prüfungsniveau. QUALITÄTSSTANDARD: Mindestens 2 Fragen MÜSSEN ein konkretes Fallbeispiel/Szenario enthalten. Distraktoren müssen PLAUSIBEL sein. |

#### MiniCheck Tool Schema:
```json
{
  "name": "create_mini_check",
  "parameters": {
    "questions": [{ "question": "", "options": [], "correct_answer": 0, "explanation": "" }],
    "objectives": ["..."]
  }
}
```

#### Depth Enrichment (Curriculum Topics):
```
--- CURRICULUM-TIEFE (Unterthemen aus dem Rahmenplan) ---
📚 {Parent Topic}:
  • {Subtopic 1} (schwer)
  • {Subtopic 2} (mittel)
  • ...
Nutze diese Unterthemen als fachliche Grundlage für tiefgehende, prüfungsrelevante Inhalte.
```

---

### 2.3 `package-generate-exam-pool` (Prüfungstrainer)
**Zweck:** Generiert Prüfungsfragen pro Blueprint  
**Primary Model:** GPT-4.1 (DB-routed mit Provider-Autopilot)  
**Depth Enrichment:** ❌ Nein (nutzt Blueprint-Kontext)

#### ⚠️ KRITISCHER BUG: Hardcoded "Automobilkaufleute"
```
System-Prompt Zeile 162:
"Du bist ein IHK-Prüfungsexperte für Automobilkaufleute."
```
**→ Dieser Beruf ist HARDCODED statt dynamisch aus dem Curriculum geladen!**

#### System-Prompt (Dominanz-Engine v2):
```
Du bist ein IHK-Prüfungsexperte für Automobilkaufleute. Du erstellst prüfungsrelevante 
Fragen auf {difficulty}-Niveau.

ABSOLUTE REGELN:
1. KEINE Platzhalter wie {variable}, {amount}, {akteur} — ALLE Werte konkret einsetzen!
2. Jede Frage muss einen konkreten Praxis-Kontext haben (Namen, Zahlen, Situationen)
3. Erklärungen müssen fachlich korrekt und ausführlich sein
4. Distraktoren bilden echte Irrtümer ab, nicht offensichtlichen Unsinn
5. Sprache: Fachsprachlich korrekt, B2-Niveau, IHK-Prüfungsstil
6. Jede Frage MUSS einzigartig sein — keine Variationen derselben Grundfrage
```

#### Schwierigkeitsverteilung:
| Schwierigkeit | Anteil |
|---------------|--------|
| easy | 5% |
| medium | 35% |
| hard | 45% |
| very_hard | 15% |

#### Fragentyp-Mix:
| Typ | Anteil | Spezifika |
|-----|--------|-----------|
| mc_single | 25% | 4 Optionen, 1 korrekt |
| mc_multiple | 20% | 5 Optionen, 2-3 korrekt |
| calculation | 20% | Konkrete Zahlen, Lösungsweg |
| case_study | 25% | Fallstudie mit Handlungsempfehlung |
| transfer | 10% | Wissen auf neue Situation anwenden |

#### Qualitätskontrolle:
- Hash-basierte Duplikat-Erkennung (`simpleHash()`)
- Platzhalter-Rejection: `/\{[a-z_]+\}/i`
- Fan-out by Learning Field (parallele Jobs pro LF)
- Provider-Autopilot mit Rate-Limit-Failover (3 Versuche)

---

### 2.4 `generate-blueprint-questions` (Blueprint-Varianten)
**Zweck:** Deterministische Fragenvarianten aus Blueprint-Templates  
**Model:** Kein AI – rein algorithmisch  
**Strategie:** Mulberry32 PRNG, Constraint Engine, Template Rendering

#### Constraint-Typen:
- `forbidden` – Verbotene Wertekombinationen
- `conditional` – If-Then Regeln
- `range` – Wertebereich-Validierung
- `in_list` – Erlaubte Werte
- `regex` – Muster-Validierung
- `implies_one_of` – Bedingte Wertebeschränkung

#### Qualitätssicherung:
- Value-Level Similarity Check (max 0.82)
- Text-Level Hash-Dedup (`normalizeTextHash()`)
- Unit Validation (€, %, Monate)
- Safe Math Evaluator (sichere Formelberechnung)

---

### 2.5 `package-generate-handbook` (Handbuch)
**Zweck:** Erstellt Prüfungshandbuch aus Curriculum  
**Model:** Kein AI – Template-basiert mit DB-Daten  
**Depth Enrichment:** ✅ Ja (seit 2026-02-15)

#### Template-Struktur pro Section:
```markdown
## {LF-Code}: {LF-Title}

{Description}

### Kernthemen (aus dem Rahmenplan)
- {Subtopic 1} (schwer)
- {Subtopic 2} (mittel)
- ...

### Typische Prüfungsfallen
- _Wird durch Council + Blueprint-Analyse ergänzt._

### Praxisbeispiele
- _Wird durch Council ergänzt._
```

#### Depth Loading (`loadFieldTopicDepth`):
- Sucht Parent-Topics matching Learning Field Title
- Lädt Subtopics mit difficulty_level
- Fallback: Alle Subtopics des Curriculums

---

### 2.6 `package-generate-oral-exam` (Mündliche Prüfung)
**Zweck:** Erstellt Oral-Exam Blueprints pro Kompetenz  
**Model:** Kein AI – Template-basiert  
**Depth Enrichment:** ✅ Ja (seit 2026-02-15)

#### Blueprint-Struktur:
```json
{
  "title": "Mündliche Prüfung: {Kompetenz}",
  "scenario": "Der Prüfling soll nachweisen... + Relevante Fachthemen aus dem Rahmenplan",
  "lead_questions": [
    "Erklären Sie den Zusammenhang von {Kompetenz} und gehen Sie auf {Subtopic 1} ein.",
    "Welche praktischen Erfahrungen... Beschreiben Sie insbesondere {Subtopic 2}.",
    "Beschreiben Sie eine konkrete Situation..."
  ],
  "followups": [
    "Alternative Situation?",
    "Rechtliche Grundlagen?",
    "Ergebnis bewerten?",
    "Wie hängt {Subtopic 3} mit Ihrer Situation zusammen?"
  ],
  "rubric": {
    "Fachkompetenz": 40%,
    "Problemlösekompetenz": 30%,
    "Kommunikation": 30%
  }
}
```

---

### 2.7 `package-build-ai-tutor-index` (AI-Tutor Setup)
**Zweck:** Erstellt Tutor-Context-Index + Policy  
**Model:** Kein AI – rein datenbankbasiert  
**Depth Enrichment:** ✅ Ja (Depth Gate warnt bei fehlenden Subtopics)

#### Tutor Policy:
```json
{
  "forbid_invention": true,
  "require_reference": true,
  "allowed_sources": ["curriculum_topics", "lessons", "question_blueprints", "exam_sessions", "oral_exam_sessionsets"],
  "modes": ["explainer", "coach", "examiner", "feedback"],
  "binding_rule": "each answer must map to competency OR lesson OR exam_session OR curriculum_topic",
  "depth_requirement": "tutor must reference curriculum_topics subtopics when answering domain-specific questions"
}
```

#### Stats tracked:
- `lessonCount`, `topicCount`, `subtopicCount`
- `depthStatus`: "deep" vs "shallow"
- `policyVersion`

---

### 2.8 `ai-tutor` (Learner-Facing Tutor)
**Zweck:** Interaktiver Lern-Tutor für Azubis  
**Generator:** OpenAI GPT-4.1 (Streaming)  
**Validator:** Claude Sonnet 4 (Post-Validation, async)

#### System-Prompts nach Modus:

**LEARNING:**
```
Du bist ein erfahrener IHK-Lern-Tutor für Azubis in der dualen Ausbildung.
Du nutzt Deep Thinking um komplexe Zusammenhänge verständlich zu erklären.
Du darfst: Inhalte erklären, Beispiele geben, Schritt-für-Schritt-Erklärungen, 
Merkhilfen, Lernpfade empfehlen.
WICHTIG: Du referenzierst NUR das Curriculum. Erfinde KEINE Fakten, Gesetze oder Paragraphen.
Nenne immer die Quelle wenn du Fachbegriffe oder Regelungen erklärst.
Sei freundlich, ermutigend und pädagogisch wertvoll.
```

**PRACTICE:**
```
Du bist ein Übungs-Tutor im Trainingsmodus.
REGELN: Gib NIEMALS die Lösung BEVOR der Nutzer geantwortet hat.
Nach Antwort: Gib detailliertes Feedback, erkläre Denkfehler, zeige den korrekten Lösungsweg.
Goldene Regel: Erst Antwort → dann Hilfe
```

**EXAM:**
```
Du bist ein Prüfungsassistent im STRIKTEN PRÜFUNGSMODUS.
🚨 STRIKT VERBOTEN: Lösungen, Hinweise, Erklärungen, inhaltliche Hilfe.
✅ ERLAUBT: Organisatorisches, Technisches, Navigation.
Bei JEDER inhaltlichen Anfrage: "Im Prüfungsmodus kann ich keine inhaltliche Hilfe geben."
```

#### Rollen-Prompts:
| Rolle | Prompt |
|-------|--------|
| EXPLAINER | Erkläre Konzepte einfach, nutze Analogien, zerlege komplexe Themen. |
| COACH | Gib Tipps zur Lernstrategie, motiviere, identifiziere Lernblockaden. |
| EXAMINER | Stelle IHK-Prüfungsfragen, gib Feedback, trainiere Zeitmanagement. |
| FEEDBACK | Analysiere Leistung, identifiziere Stärken/Schwächen. |

#### SSOT Context Loader:
- Lädt Curriculum, Learning Field, Competency, Lesson **serverseitig** per ID
- Client sendet nur IDs → Server lädt Daten aus DB
- Verhindert Client-Manipulation

#### Post-Validation (Claude Sonnet 4):
```
Du prüfst eine KI-Tutor-Antwort auf fachliche Korrektheit. SCHNELL und PRÄZISE.
PRÜFE:
1. Alle Fakten korrekt?
2. Keine erfundenen Gesetze/Paragraphen/Normen?
3. Fachbegriffe korrekt verwendet?
```

---

### 2.9 `tutor-answer` (Council 5 Runtime)
**Zweck:** SSOT-konformer Tutor mit hartem Source-Ref-Gate  
**Generator:** OpenAI GPT-4.1  
**Validator:** Anthropic Claude Sonnet 4

#### System-Prompt:
```
Du bist ExamFit Tutor (Council 5 Runtime).
REGELN (hart):
- Antworte ausschließlich auf Basis des SSOT-Kontexts und freigegebener Tutor-Templates.
- Erfinde KEINE Fakten/Normen/Paragraphen.
- Output STRICT JSON:
{ "answer_html": "...", "source_refs": ["<SSOT-ID>"], "next_steps": ["..."], "confidence": 0-1 }
Wenn SSOT nicht reicht: antworte kurz und setze confidence niedrig.
```

#### Hard Gates:
1. **Scope Binding Required** – scope_id muss gesetzt sein (außer global)
2. **Published Assets Required** – Nur freigegebene Tutor-Templates
3. **Source Refs Required** – Output MUSS SSOT-Zitierungen enthalten
4. **Validator Approval** – Claude prüft auf erfundene Fakten

#### Validator-Prompt:
```
Du bist Validator für Tutor-Antworten. Output STRICT JSON:
{ "decision":"approved"|"rejected", "issues":[], "rationale":"..." }
Reject wenn: keine source_refs, falsche Fakten, erfundene Normen/Paragraphen.
```

---

### 2.10 `oral-exam` (Mündliche Prüfungssimulation)
**Zweck:** Interaktive mündliche Prüfungssimulation  
**Model:** OpenAI GPT-4.1 (Fragen + Bewertung), DeepSeek (Follow-ups)

#### Fragen-Generierung (LLM Fallback):
```
Du bist ein IHK-Prüfer für die mündliche Abschlussprüfung.
Generiere eine mündliche Prüfungsfrage zum Thema:
Lernfeld: {title}
Kompetenz: {title}

Die Frage soll:
- Offen formuliert sein (keine Multiple Choice)
- Praxisbezug haben
- In 2-3 Minuten beantwortbar sein
- Dem IHK-Prüfungsniveau entsprechen
```

#### Bewertungs-Prompt:
```
Du bist ein IHK-Prüfer und bewertest eine mündliche Prüfungsantwort.

FRAGE: {question_text}
ERWARTETE KERNPUNKTE: {expected_answer_points}
ANTWORT DES PRÜFLINGS: {user_answer}

Bewerte nach IHK-Kriterien (0.0 bis 1.0):
1. Fachlichkeit (35%): Korrektheit und Vollständigkeit
2. Struktur (20%): Logischer Aufbau
3. Begriffssicherheit (25%): Korrekter Einsatz von Fachbegriffen
4. Praxisbezug (20%): Anwendungsbeispiele und Bezug zur Praxis
```

---

### 2.11 `generate-questions` (Ad-hoc Fragen)
**Zweck:** Manuelle Fragengenerierung (Admin)  
**Model:** OpenAI (default)

#### System-Prompt:
```
Du bist ein Experte für die Erstellung von Prüfungsfragen für Berufsausbildungen (IHK-Prüfungen).
Erstelle Multiple-Choice-Fragen basierend auf dem gegebenen Thema und der Kompetenz.

Regeln:
- Jede Frage hat genau 4 Antwortmöglichkeiten
- Nur eine Antwort ist korrekt
- Fragen sollen praxisnah und prüfungsrelevant sein
- Schwierigkeit anpassen: easy (Wissen), medium (Verstehen/Anwenden), hard (Analysieren/Bewerten)
- Ausführliche Erklärung für die richtige Antwort
```

---

### 2.12 `validate-content` (Qualitätsvalidierung)
**Zweck:** Automatische Qualitätsprüfung aller AI-Outputs  
**Model:** GPT-4.1 (quality_audit intent)

#### Lesson Validation Prompt:
```
Du bist ein IHK-Prüfer und Didaktik-Experte. Du validierst KI-generierte Lerninhalte.

BEWERTUNGSDIMENSIONEN (gewichtet):
1. FACHLICHE KORREKTHEIT (30%): Fakten korrekt? Keine Halluzinationen?
2. DIDAKTISCHE QUALITÄT (25%): 5-Schritte-Didaktik? Anwenden = Entscheidungsszenario?
3. PRÜFUNGSRELEVANZ (20%): Explizite IHK-Prüfungsbezüge?
4. SPRACHLICHE KLARHEIT (15%): Azubi-Niveau? Klare Fachsprache?
5. VOLLSTÄNDIGKEIT (10%): Lernziele definiert?

PFLICHT-PRÜFUNGEN (Auto-Reject bei Fehlen):
- Kein IHK-Prüfungsbezug → Score max 75
- Anwenden-Phase ohne Entscheidungsszenario → Score max 80
- Halluzination erkannt → Score max 50, decision=reject

ENTSCHEIDUNGSLOGIK:
- score >= 85 → approve
- score 60-84 → revise (mit suggested_fixes)
- score < 60 → reject
```

#### Question Validation Prompt:
```
BEWERTUNGSDIMENSIONEN:
1. EINDEUTIGKEIT (35%): Genau eine richtige Antwort?
2. DISTRAKTOREN-QUALITÄT (25%): Plausibel aber eindeutig falsch?
3. IHK-KONFORMITÄT (25%): IHK-Prüfungsstil?
4. TAXONOMIE-PASSUNG (15%): Passt zur Bloom-Stufe?

AUTO-REJECT:
- Mehrere korrekte Antworten möglich → reject
- Offensichtlich falsche Distraktoren → revise
- Fachlicher Fehler in korrekter Antwort → reject
```

---

### 2.13 `improve-lesson` (Lesson Improvement Agent)
**Zweck:** Verbessert bestehende Lessons basierend auf Audit-Ergebnissen  
**Model:** OpenAI (default)

#### System-Prompt:
```
Du bist ein IHK-Prüfungsexperte, der bestehende Lerninhalte VERBESSERT (nicht neu erstellt).

WICHTIG:
- Behalte den Kern des bestehenden Inhalts bei
- Ergänze und verbessere gezielt
- Lösche KEINEN korrekten bestehenden Inhalt
- Der verbesserte Inhalt MUSS länger sein als der Originalinhalt
- Verwende HTML-Formatierung (<h3>, <strong>, <ul>, <li>, <blockquote>)
- Alle Verbesserungen müssen IHK-prüfungsniveau erreichen
```

#### Improvement Instructions:
| Key | Beschreibung |
|-----|-------------|
| `pruefungsbezug_ergaenzen` | IHK-Prüfungsbezug-Block mit typischen Fragen/Fallen |
| `anwenden_umformulieren` | Entscheidungsbasierte statt beschreibende Aufgaben |
| `betriebsbezug_ergaenzen` | Konkreter betrieblicher Bezug |
| `gegenbeispiel_ergaenzen` | Gegenbeispiele nach Definitionen |
| `minicheck_verbessern` | Distraktoren, Situationsaufgaben, Schwierigkeit-Mix |
| `wiederholen_verdichten` | Prüfungsverdichtung statt Wiederholung |

---

### 2.14 `support-ai` (Support-Assistent)
**Zweck:** Beantwortet Lerner-Supportanfragen  
**Model:** DeepSeek Chat (kosteneffizient)

#### Guardrail Rules:
```
1. Du bist ein IHK-Prüfungsassistent. Du antwortest NUR basierend auf dem bereitgestellten Kontext.
2. Erfinde KEINE Informationen. Wenn du es nicht weißt, sage 'Das kann ich nicht beantworten'.
3. Antworte immer auf Deutsch, klar und prüfungsnah.
4. Maximal 3-5 Sätze pro Antwort.
5. Gib KEINE rechtlichen oder medizinischen Ratschläge.
6. Bei Prüfungsangst: Sei empathisch, beruhigend, verweise auf professionelle Hilfe.
7. Nenne KEINE konkreten Prüfungsfragen oder Lösungen aus echten Prüfungen.
```

#### Emotionale Erkennung:
- **Prüfungsangst:** angst, unsicher, panik, überfordert, stress, sorge
- **Frustration:** frustri, nerv, geht nicht, funktioniert nicht, kaputt, schlecht

---

## 3. PIPELINE-STATUS (2026-02-15)

### 3.1 Package-Status (Top 20)
| Status | Anzahl |
|--------|--------|
| blocked | 6 |
| queued | 12 |
| council_review | 1 |
| building | 0 |
| done | 0 (in Top 20) |

**⚠️ Problem:** Alle Packages haben `build_progress: 0` und nur 1 `done_step`.  
**→ Die Pipeline stagniert. Packages kommen nicht über den ersten Step hinaus.**

### 3.2 Job Queue (letzte 7 Tage)
| Job Type | Completed | Failed | Pending | Cancelled |
|----------|-----------|--------|---------|-----------|
| generate_course_batch | 1.944 | 0 | 0 | 1.558 |
| package_generate_exam_pool | 582 | 164 | 72 | 113 |
| package_scaffold_learning_course | 168 | 0 | 0 | 0 |
| generate_curriculum_content | 319 | 0 | 0 | 0 |
| setup_course_package | 221 | 0 | 0 | 0 |
| package_auto_seed_exam_blueprints | 152 | 0 | 0 | 0 |
| package_generate_handbook | 19 | 0 | 0 | 0 |
| package_build_ai_tutor_index | 15 | 0 | 0 | 2 |
| package_generate_oral_exam | 12 | 0 | 0 | 0 |
| auto_gap_close | 16 | 0 | 0 | 0 |
| upgrade_ihk | 11 | 0 | 0 | 2 |

### 3.3 Identifizierte Probleme

#### 🔴 KRITISCH: Hardcoded "Automobilkaufleute" in exam-pool
- **Datei:** `package-generate-exam-pool/index.ts`, Zeile 162
- **Impact:** ALLE generierten Prüfungsfragen haben Automobilkaufleute-Kontext, unabhängig vom Beruf
- **Fix:** System-Prompt muss dynamisch den Beruf aus dem Curriculum laden

#### 🟡 WARNUNG: Hohe Cancelled-Rate
- `generate_course_batch`: 1.558 cancelled vs 1.944 completed (44% Abbruchrate)
- `package_generate_exam_pool`: 113 cancelled + 164 failed vs 582 completed (32% Fehlerrate)
- **Ursache:** Vermutlich Timeouts oder Rate Limiting

#### 🟡 WARNUNG: Packages stagnieren
- Alle Top-20 Packages bei `build_progress: 0`
- Nur 1 von vielen Steps abgeschlossen
- **Ursache:** `scaffold_learning_course` ist der Bottleneck (timeouts bei großen Curricula)

#### 🟢 INFO: Depth Enrichment aktiv
- `generate-course-batch`: ✅ Curriculum Topics geladen
- `package-generate-handbook`: ✅ Subtopics pro Learning Field
- `package-generate-oral-exam`: ✅ Fachthemen in Szenarien
- `package-build-ai-tutor-index`: ✅ Depth Gate + Stats
- `package-generate-exam-pool`: ❌ Nutzt nur Blueprint-Kontext, kein Curriculum-Topic-Depth

---

## 4. BEKANNTE BUGS & TODO

1. **Hardcoded "Automobilkaufleute"** – System-Prompt in exam-pool dynamisch machen
2. **Hohe Cancelled-Rate** – Timeout-Handling und Retry-Strategie verbessern
3. **Pipeline stagniert** – Bottleneck bei scaffold_learning_course identifizieren
4. **Exam Pool ohne Depth** – Curriculum Topics in Prüfungsfragen-Generierung integrieren
5. **Support-AI nutzt DeepSeek direkt** – Sollte über model-routing.ts geroutet werden
6. **ai-tutor Post-Validation** – Nutzt direkte Anthropic API statt ai-client.ts

---

*Generiert am 2026-02-15 von ExamFit AI Audit System*
