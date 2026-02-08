-- =============================================================================
-- PRÜFUNGSTRAINING-HANDBUCH SYSTEM
-- Strategischer Prüfungsbegleiter (Meta-Ebene) - SSOT-konform
-- =============================================================================

-- Handbuch Kapitel (Inhaltsstruktur)
CREATE TABLE public.handbook_chapters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curriculum_id UUID REFERENCES public.curricula(id) ON DELETE SET NULL,
  chapter_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  icon TEXT DEFAULT 'book-open',
  sort_order INTEGER NOT NULL DEFAULT 0,
  estimated_reading_minutes INTEGER DEFAULT 15,
  is_premium BOOLEAN DEFAULT true,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Handbuch Sektionen (Unterkapitel)
CREATE TABLE public.handbook_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chapter_id UUID NOT NULL REFERENCES public.handbook_chapters(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  content_type TEXT DEFAULT 'text' CHECK (content_type IN ('text', 'checklist', 'tip', 'warning', 'example', 'quote')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(chapter_id, section_key)
);

-- Strategie-Übungsfragen (NICHT bewertet, keine Punkte)
CREATE TABLE public.handbook_exercises (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chapter_id UUID NOT NULL REFERENCES public.handbook_chapters(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.handbook_sections(id) ON DELETE SET NULL,
  exercise_type TEXT NOT NULL CHECK (exercise_type IN (
    'reflection',      -- Selbstreflexion
    'decision',        -- Entscheidungsfrage
    'analysis',        -- Fehleranalyse
    'structure',       -- Strukturierungsaufgabe
    'self_check'       -- Mini-Selbstcheck
  )),
  question_text TEXT NOT NULL,
  hint_text TEXT,
  explanation_text TEXT,
  example_answer TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Benutzer-Fortschritt im Handbuch (KEIN Score!)
CREATE TABLE public.handbook_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  chapter_id UUID NOT NULL REFERENCES public.handbook_chapters(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  last_section_id UUID REFERENCES public.handbook_sections(id) ON DELETE SET NULL,
  reading_time_minutes INTEGER DEFAULT 0,
  UNIQUE(user_id, chapter_id)
);

-- Benutzer-Antworten auf Übungen (zur Reflexion, NICHT bewertet)
CREATE TABLE public.handbook_exercise_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  exercise_id UUID NOT NULL REFERENCES public.handbook_exercises(id) ON DELETE CASCADE,
  response_text TEXT,
  self_rating INTEGER CHECK (self_rating BETWEEN 1 AND 5),
  responded_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, exercise_id)
);

-- Kontextuelle Handbuch-Empfehlungen (dynamisch)
CREATE TABLE public.handbook_recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'low_score',           -- Nach schlechtem Ergebnis
    'pre_exam',            -- Vor Prüfungssimulation
    'pre_oral',            -- Vor mündlicher Prüfung
    'first_visit',         -- Erster Besuch
    'anxiety_detected',    -- Prüfungsangst erkannt
    'time_pressure'        -- Wenig Zeit bis Prüfung
  )),
  trigger_condition JSONB,
  chapter_id UUID NOT NULL REFERENCES public.handbook_chapters(id) ON DELETE CASCADE,
  recommendation_text TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Handbuch als Produkt-Feature verknüpfen
ALTER TABLE public.store_products 
ADD COLUMN IF NOT EXISTS includes_handbook BOOLEAN DEFAULT false;

-- Indexes für Performance
CREATE INDEX idx_handbook_sections_chapter ON public.handbook_sections(chapter_id);
CREATE INDEX idx_handbook_exercises_chapter ON public.handbook_exercises(chapter_id);
CREATE INDEX idx_handbook_progress_user ON public.handbook_progress(user_id);
CREATE INDEX idx_handbook_recommendations_trigger ON public.handbook_recommendations(trigger_type) WHERE is_active = true;

-- RLS aktivieren
ALTER TABLE public.handbook_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handbook_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handbook_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handbook_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handbook_exercise_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handbook_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Kapitel & Sektionen (öffentlich lesbar für SEO)
CREATE POLICY "Handbook chapters are publicly readable"
  ON public.handbook_chapters FOR SELECT
  USING (is_published = true);

CREATE POLICY "Admins can manage handbook chapters"
  ON public.handbook_chapters FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Handbook sections are publicly readable"
  ON public.handbook_sections FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.handbook_chapters WHERE id = chapter_id AND is_published = true));

CREATE POLICY "Admins can manage handbook sections"
  ON public.handbook_sections FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- RLS Policies: Übungen (öffentlich lesbar)
CREATE POLICY "Handbook exercises are publicly readable"
  ON public.handbook_exercises FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage handbook exercises"
  ON public.handbook_exercises FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- RLS Policies: Fortschritt & Antworten (nur eigene)
CREATE POLICY "Users can view own handbook progress"
  ON public.handbook_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own handbook progress"
  ON public.handbook_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can modify own handbook progress"
  ON public.handbook_progress FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own exercise responses"
  ON public.handbook_exercise_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own exercise responses"
  ON public.handbook_exercise_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exercise responses"
  ON public.handbook_exercise_responses FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies: Empfehlungen (öffentlich lesbar)
CREATE POLICY "Handbook recommendations are publicly readable"
  ON public.handbook_recommendations FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage handbook recommendations"
  ON public.handbook_recommendations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Trigger für updated_at
CREATE TRIGGER update_handbook_chapters_updated_at
  BEFORE UPDATE ON public.handbook_chapters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- SEED: Initiale Kapitelstruktur mit echten Inhalten
-- =============================================================================

INSERT INTO public.handbook_chapters (chapter_key, title, subtitle, description, icon, sort_order, estimated_reading_minutes, is_published) VALUES
('ihk-verstehen', 'Die IHK richtig verstehen', 'Prüfungslogik erkennen & nutzen', 'Verstehe, wie die IHK denkt, bewertet und welche typischen Fallen in Prüfungen lauern. Dieses Wissen ist dein strategischer Vorteil.', 'building-2', 1, 20, true),
('lernstrategie', 'Lernstrategie nach Azubi-Typ', 'Klüger lernen, nicht mehr', 'Finde heraus, welcher Lerntyp du bist und wie du deine verbleibende Zeit optimal nutzt – egal ob du wenig Zeit hast oder Prüfungsangst verspürst.', 'brain', 2, 25, true),
('pruefungsstrategie', 'Prüfungsstrategie (schriftlich)', 'Punkte sichern mit System', 'Lerne Zeitmanagement, das Ausschlussverfahren und wie du auch bei Unsicherheit Punkte holst. Die Methoden der Profis.', 'target', 3, 30, true),
('typische-fehler', 'Typische IHK-Fehler', 'Wiederholungsfehler eliminieren', 'Die häufigsten Denkfehler, die Azubis Punkte kosten. Erkenne sie, bevor du sie machst.', 'alert-triangle', 4, 25, true),
('muendliche-pruefung', 'Mündliche Prüfung meistern', 'Sicher auftreten & überzeugen', 'Bewertungskriterien, Antwortstruktur und wie du auch bei schwierigen Fragen souverän bleibst.', 'mic', 5, 35, true),
('30-tage-plan', 'Dein 30-Tage-Prüfungsplan', 'Der Fahrplan zum Erfolg', 'Ein konkreter Wochenplan für die letzten 30 Tage vor deiner Prüfung. Strukturiert, realistisch, effektiv.', 'calendar-check', 6, 20, true);

-- Sektionen für Kapitel 1: Die IHK verstehen
INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'aufbau-pruefung', 'Wie IHK-Prüfungen aufgebaut sind', 
'## Der Aufbau deiner IHK-Prüfung

Die IHK-Abschlussprüfung besteht aus **zwei Teilen**, die unterschiedlich gewichtet werden:

### Teil 1: Gestreckte Abschlussprüfung (GAP 1)
- Findet meist nach 18 Monaten statt
- Zählt **20-40%** der Gesamtnote
- Fokus: Grundlagen deines Berufsbildes

### Teil 2: Abschlussprüfung
- Am Ende der Ausbildung
- Zählt **60-80%** der Gesamtnote
- Enthält: Schriftliche Prüfung + Mündliche/Praktische Prüfung

> **Wichtig:** Du kannst Teil 1 nicht wiederholen! Diese Punkte sind fix. Teil 2 entscheidet über Bestehen oder Nicht-Bestehen.

### Was bedeutet das für dich?
- Teil 2 ist dein Hebel – hier holst du die Punkte
- Die mündliche Prüfung kann deine Note retten (oder verschlechtern)
- Strategisches Lernen zahlt sich aus', 'text', 1
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'bewertungskriterien', 'So bewertet die IHK wirklich', 
'## Die Wahrheit über IHK-Bewertungen

Viele Azubis glauben, die IHK bewertet nur Fachwissen. Das stimmt nicht.

### Die drei Bewertungsebenen

| Ebene | Gewichtung | Bedeutung |
|-------|------------|-----------|
| Fachwissen | 40-50% | Korrekte Fakten und Definitionen |
| Anwendung | 30-40% | Transfer auf praktische Situationen |
| Begründung | 10-20% | Logische Herleitung der Antwort |

### Was das konkret heißt:

✅ **Richtig + gut begründet** = volle Punktzahl

⚠️ **Richtig + keine Begründung** = Punktabzug möglich

❌ **Falsch + gute Begründung** = teilweise Punkte möglich!

> **Profi-Tipp:** Bei offenen Fragen immer begründen, auch wenn nicht explizit gefordert. Die IHK belohnt nachvollziehbares Denken.', 'tip', 2
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'typische-fallen', 'Die 5 häufigsten Prüfungsfallen', 
'## Achtung: Diese Fallen kosten dich Punkte

### Falle 1: Die "Fast richtig"-Antwort
Die IHK baut absichtlich Antworten ein, die *logisch klingen*, aber einen kleinen Fehler enthalten.

**Beispiel:** "Der Kaufvertrag kommt durch Angebot und Bestellung zustande."
→ Klingt richtig, ist aber falsch. Es heißt "Annahme", nicht "Bestellung".

### Falle 2: Praxis ≠ Theorie
Was in deinem Betrieb funktioniert, ist nicht automatisch IHK-konform.

**Merke:** Die IHK prüft das *Lehrbuch*, nicht deinen Arbeitsalltag.

### Falle 3: Zeitdruck-Fehler
Unter Stress wählen 73% der Azubis die erste Antwort, die "irgendwie passt".

**Lösung:** Alle Antworten lesen, bevor du entscheidest.

### Falle 4: Doppelte Verneinung
"Welche Aussage ist NICHT falsch?" – Viele kreuzen hier das Gegenteil an.

### Falle 5: Ablenkende Details
Lange Aufgabentexte enthalten oft irrelevante Informationen. Die IHK testet, ob du das Wesentliche erkennst.', 'warning', 3
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

-- Übungsfragen für Kapitel 1
INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, hint_text, explanation_text, example_answer, sort_order)
SELECT id, 'analysis', 
'Lies die folgende Aufgabe und markiere: Welche Information ist entscheidend – und welche lenkt nur ab?

**Aufgabe:** "Die Müller GmbH mit Sitz in Hamburg bestellt am 15. März per E-Mail 500 Bürostühle zum Stückpreis von 89,00 € bei der Schulze KG in Berlin. Die Lieferung soll innerhalb von 14 Tagen erfolgen. Wann kommt der Kaufvertrag zustande?"',
'Fokussiere dich auf die rechtlichen Elemente: Was macht einen Kaufvertrag aus?',
'Entscheidend ist: Bestellung (= Angebot) und wann die Annahme erfolgt. Ablenkend sind: Ort (Hamburg/Berlin), E-Mail als Medium, genaues Datum, Stückpreis. Diese Details sind für die Vertragsentstehung irrelevant.',
'Entscheidend: "bestellt" (= Angebot), "500 Bürostühle" (= Ware), "89 €" (= Preis). Ablenkend: Standorte der Firmen, Lieferfrist, genaues Datum.',
1
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, hint_text, explanation_text, sort_order)
SELECT id, 'reflection', 
'Denke an deine letzte Übungsprüfung oder MiniCheck: Bei welcher Frage hast du zu schnell geantwortet – und es später bereut?',
'Es geht nicht um richtig oder falsch, sondern um Selbsterkenntnis.',
'Schnelles Antworten unter Stress ist einer der häufigsten Fehler. Wer dieses Muster bei sich erkennt, kann es aktiv durchbrechen.',
2
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, explanation_text, sort_order)
SELECT id, 'decision', 
'Die IHK bietet dir vier Antwortmöglichkeiten. Drei davon sind falsch. Warum baut die IHK bewusst "fast richtige" Antworten ein?',
'Die IHK will nicht nur testen, ob du etwas weißt, sondern ob du präzise unterscheiden kannst. "Fast richtig" ist in der Prüfung = falsch. Diese Erkenntnis hilft dir, kritischer zu lesen.',
3
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

-- Sektionen für Kapitel 3: Prüfungsstrategie
INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'zeitmanagement', 'Zeitmanagement in der Prüfung', 
'## Dein Zeitplan für 90 Minuten Prüfung

Die meisten Azubis verlieren Punkte nicht durch fehlendes Wissen, sondern durch schlechtes Zeitmanagement.

### Die 3-Phasen-Strategie

**Phase 1: Überblick (5 Minuten)**
- Alle Aufgaben überfliegen
- Schwierigkeit einschätzen
- Punkteverteilung notieren

**Phase 2: Sichere Punkte (50 Minuten)**
- Beginne mit Aufgaben, die du sicher kannst
- Überspringe Blockaden sofort
- Markiere unsichere Antworten

**Phase 3: Restliche Aufgaben (30 Minuten)**
- Zurück zu übersprungenen Fragen
- Ausschlussverfahren anwenden
- Notfalls raten (nie leer lassen!)

**Letzte 5 Minuten:**
- Alle Antworten auf Vollständigkeit prüfen
- Keine Änderungen mehr – Bauchgefühl war oft richtig

> **Goldene Regel:** Pro Punkt maximal 1 Minute. Bei 100 Punkten = 100 Minuten theoretisch. Real: 90 Minuten, also Fokus auf Effizienz.', 'text', 1
FROM public.handbook_chapters WHERE chapter_key = 'pruefungsstrategie';

INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'ausschlussverfahren', 'Das Ausschlussverfahren', 
'## So erhöhst du deine Trefferquote von 25% auf 50%+

Bei Multiple-Choice-Fragen mit 4 Antworten hast du eine Basiswahrscheinlichkeit von 25%. Mit dem Ausschlussverfahren verdoppelst du diese.

### Schritt für Schritt

1. **Lies alle 4 Antworten** (nicht nur bis zur "richtigen")
2. **Streiche offensichtlich Falsches** (meist 1-2 Antworten)
3. **Vergleiche die Restlichen** detailliert
4. **Entscheide dich** – und bleib dabei

### Typische Ausschluss-Kriterien

| Wenn die Antwort... | Dann wahrscheinlich falsch |
|---------------------|---------------------------|
| ...zu extrem formuliert ist ("immer", "niemals") | ❌ |
| ...viel länger ist als die anderen | ⚠️ Prüfen |
| ...einen kleinen Fehler enthält (Zahl, Begriff) | ❌ |
| ...zur anderen Antwort widersprüchlich ist | Eine davon richtig ✅ |

### Beispiel:

**Frage:** Ab wann gilt ein Kaufvertrag als geschlossen?

A) Nach Unterzeichnung durch beide Parteien ❌ (nicht immer nötig)
B) Nach Übersendung der Ware ❌ (zu spät)
C) Nach Zugang der Annahme beim Anbietenden ✅
D) Nach Ablauf von 24 Stunden ❌ (willkürlich)', 'text', 2
FROM public.handbook_chapters WHERE chapter_key = 'pruefungsstrategie';

-- Übungsfragen für Kapitel 3
INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, hint_text, example_answer, sort_order)
SELECT id, 'decision', 
'Du hast noch 20 Minuten und 3 Aufgaben übrig: 
- Aufgabe A: 5 Punkte, du bist unsicher
- Aufgabe B: 15 Punkte, du verstehst sie nicht
- Aufgabe C: 10 Punkte, du kannst sie

In welcher Reihenfolge bearbeitest du sie?',
'Denke an Punkte pro Minute und Erfolgswahrscheinlichkeit.',
'C → A → B. Zuerst die sichere Aufgabe (10 Punkte garantiert), dann die unsichere mit wenig Punkten (5 Punkte evtl.), dann die schwere mit Ausschlussverfahren versuchen (15 Punkte teilweise möglich).',
1
FROM public.handbook_chapters WHERE chapter_key = 'pruefungsstrategie';

INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, explanation_text, sort_order)
SELECT id, 'analysis', 
'Welche dieser Antworten würdest du bei einer IHK-Prüfung zuerst ausschließen und warum?

A) "Der Arbeitgeber muss immer eine schriftliche Kündigung aussprechen."
B) "Die Kündigungsfrist beträgt in der Probezeit 2 Wochen."
C) "Eine fristlose Kündigung ist nur bei wichtigem Grund möglich."
D) "Kündigungen können auch mündlich erfolgen."',
'Antwort A enthält das Wort "immer" – ein typisches Ausschlusskriterium. In der Realität gibt es fast nie "immer" oder "niemals". Antworten B, C und D sind differenzierter formuliert und daher wahrscheinlicher korrekt.',
2
FROM public.handbook_chapters WHERE chapter_key = 'pruefungsstrategie';

-- Sektionen für Kapitel 5: Mündliche Prüfung
INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'antwortstruktur', 'Die perfekte Antwortstruktur', 
'## Das 3-Satz-Prinzip für mündliche Antworten

Prüfer bewerten nicht nur WAS du sagst, sondern WIE strukturiert du antwortest.

### Die Struktur (3 Sätze)

**Satz 1: Einordnung**
"Bei dieser Frage geht es um [Thema]..."

**Satz 2: Kernaussage**
"Konkret bedeutet das, dass [Antwort]..."

**Satz 3: Praxisbezug**
"In meinem Betrieb habe ich das bei [Beispiel] erlebt..."

### Beispiel

**Frage:** "Was verstehen Sie unter Gewährleistung?"

**Antwort:**
1. "Bei dieser Frage geht es um die gesetzlichen Rechte des Käufers bei Mängeln."
2. "Konkret bedeutet Gewährleistung, dass der Verkäufer 2 Jahre für Sachmängel haftet und der Käufer Nachbesserung, Ersatzlieferung oder Rücktritt fordern kann."
3. "In meinem Betrieb hatte ich einen Fall, bei dem ein Kunde einen defekten Drucker reklamiert hat und wir ihm ein Ersatzgerät geliefert haben."

> **Warum funktioniert das?** Du zeigst Fachwissen (Satz 2) UND Praxistransfer (Satz 3) – genau das, was die IHK sehen will.', 'text', 1
FROM public.handbook_chapters WHERE chapter_key = 'muendliche-pruefung';

INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'koerpersprache', 'Körpersprache & Auftreten', 
'## Die unsichtbare Bewertung

Studien zeigen: 55% des ersten Eindrucks entstehen durch Körpersprache.

### ✅ DO: Souveränität ausstrahlen

- **Blickkontakt** halten (nicht starren, aber präsent)
- **Aufrechte Haltung** – Schultern zurück, Kopf gerade
- **Hände sichtbar** auf dem Tisch oder ruhig im Schoß
- **Lächeln** beim Betreten des Raumes
- **Nicken** zeigt aktives Zuhören

### ❌ DON´T: Nervosität zeigen

- Auf dem Stuhl wippen
- Mit Stiften spielen
- Haare/Gesicht berühren
- Arme verschränken
- Auf den Tisch/Boden schauen

### Die 4-Sekunden-Regel

Wenn du eine Frage nicht sofort beantworten kannst:
1. Atme einmal tief durch (2 Sekunden)
2. Sage: "Das ist eine gute Frage. Lassen Sie mich kurz überlegen." (2 Sekunden)
3. Dann erst antworten

> **Wirkung:** Du wirkst reflektiert statt überrumpelt. Prüfer schätzen das.', 'tip', 2
FROM public.handbook_chapters WHERE chapter_key = 'muendliche-pruefung';

INSERT INTO public.handbook_sections (chapter_id, section_key, title, content_markdown, content_type, sort_order)
SELECT id, 'schwierige-fragen', 'Umgang mit schwierigen Fragen', 
'## Wenn du die Antwort nicht weißt

Panik ist der größte Feind. Hier ist dein Notfallplan:

### Strategie 1: Ehrlich eingestehen (respektvoll)

**Falsch:** "Das weiß ich nicht."

**Richtig:** "In diesem speziellen Bereich bin ich nicht ganz sicher, aber ich würde vermuten, dass... Könnten Sie mir einen Hinweis geben?"

### Strategie 2: Verwandtes Wissen zeigen

"Zu diesem konkreten Punkt kann ich nicht direkt antworten, aber ich weiß, dass im verwandten Bereich [X] gilt..."

### Strategie 3: Nachfragen (klug eingesetzt)

"Könnten Sie die Frage vielleicht anders formulieren oder einen Hinweis geben, in welche Richtung Sie denken?"

> **Wichtig:** Prüfer wollen sehen, wie du mit Unsicherheit umgehst. Ehrlichkeit + Denkprozess zeigen = Punkte.

### Was du NIEMALS tun solltest

❌ Lügen oder Erfinden
❌ Endlos reden, um Zeit zu schinden
❌ Den Prüfer beschuldigen ("Das hatten wir nicht")
❌ Aufgeben ("Ich kann das nicht")', 'warning', 3
FROM public.handbook_chapters WHERE chapter_key = 'muendliche-pruefung';

-- Übungsfragen für Kapitel 5
INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, hint_text, example_answer, sort_order)
SELECT id, 'structure', 
'Formuliere eine 60-Sekunden-Antwort nach dem 3-Satz-Prinzip:

**Frage:** "Was ist der Unterschied zwischen Skonto und Rabatt?"',
'Nutze die Struktur: 1. Einordnung, 2. Kernaussage, 3. Praxisbezug',
'1. "Bei dieser Frage geht es um zwei verschiedene Arten von Preisnachlässen im Geschäftsverkehr."
2. "Der Unterschied ist: Skonto ist ein Preisnachlass für schnelle Zahlung, meist 2-3% bei Zahlung innerhalb von 10 Tagen. Rabatt ist ein allgemeiner Preisnachlass, zum Beispiel für Großkunden oder bei Aktionen."
3. "In meinem Betrieb gewähren wir Stammkunden 5% Rabatt und bieten allen Kunden 2% Skonto bei Zahlung innerhalb von 14 Tagen."',
1
FROM public.handbook_chapters WHERE chapter_key = 'muendliche-pruefung';

INSERT INTO public.handbook_exercises (chapter_id, exercise_type, question_text, explanation_text, sort_order)
SELECT id, 'reflection', 
'Die Prüferin fragt dich etwas, das du definitiv nicht weißt. Wie würdest du reagieren?

Schreibe deinen Satz auf, den du sagen würdest.',
'Es gibt keine "richtige" Antwort – aber es gibt Antworten, die Souveränität zeigen und solche, die Unsicherheit verstärken. Der Schlüssel ist, ehrlich zu sein und gleichzeitig Lernbereitschaft zu zeigen.',
2
FROM public.handbook_chapters WHERE chapter_key = 'muendliche-pruefung';

-- Kontextuelle Empfehlungen
INSERT INTO public.handbook_recommendations (trigger_type, trigger_condition, chapter_id, recommendation_text, priority)
SELECT 'low_score', '{"score_below": 60}'::jsonb, id, 'Du hast im Prüfungstrainer unter 60% erreicht. Lies das Kapitel "Typische IHK-Fehler" – viele Azubis machen dieselben Denkfehler.', 1
FROM public.handbook_chapters WHERE chapter_key = 'typische-fehler';

INSERT INTO public.handbook_recommendations (trigger_type, trigger_condition, chapter_id, recommendation_text, priority)
SELECT 'pre_oral', '{}'::jsonb, id, 'Vor deiner mündlichen Prüfung: Lies die Antwortstruktur im Kapitel "Mündliche Prüfung meistern".', 1
FROM public.handbook_chapters WHERE chapter_key = 'muendliche-pruefung';

INSERT INTO public.handbook_recommendations (trigger_type, trigger_condition, chapter_id, recommendation_text, priority)
SELECT 'first_visit', '{}'::jsonb, id, 'Neu hier? Starte mit "Die IHK richtig verstehen" – so lernst du strategisch statt nur fleißig.', 2
FROM public.handbook_chapters WHERE chapter_key = 'ihk-verstehen';

INSERT INTO public.handbook_recommendations (trigger_type, trigger_condition, chapter_id, recommendation_text, priority)
SELECT 'anxiety_detected', '{"exam_anxiety_score": 3}'::jsonb, id, 'Prüfungsangst erkannt? Das Kapitel "Lernstrategie nach Azubi-Typ" hilft dir, mit Stress umzugehen.', 1
FROM public.handbook_chapters WHERE chapter_key = 'lernstrategie';

-- Bundle-Produkt aktualisieren (Handbuch inkludieren)
UPDATE public.store_products 
SET includes_handbook = true 
WHERE product_key = 'bundle';