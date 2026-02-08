export interface BlogArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  author: string;
  publishedAt: string;
  readingTime: number;
  tags: string[];
  featured?: boolean;
}

export const blogArticles: BlogArticle[] = [
  {
    id: '1',
    slug: 'ihk-pruefung-beim-ersten-mal-bestehen',
    title: 'Wie du deine IHK-Prüfung beim ersten Mal bestehst',
    excerpt: 'Die IHK-Abschlussprüfung ist der wichtigste Meilenstein deiner Ausbildung. Mit der richtigen Strategie schaffst du es beim ersten Anlauf.',
    category: 'Prüfungsvorbereitung',
    author: 'Sarah Müller',
    publishedAt: '2023-01-02',
    readingTime: 8,
    tags: ['IHK-Prüfung', 'Lerntipps', 'Prüfungsvorbereitung'],
    featured: true,
    content: `
# Wie du deine IHK-Prüfung beim ersten Mal bestehst

Die IHK-Abschlussprüfung markiert das Ende deiner Ausbildung und den Beginn deiner beruflichen Karriere. Kein Wunder also, dass viele Azubis nervös werden, wenn der Prüfungstermin näher rückt. Aber keine Sorge: Mit der richtigen Vorbereitung und Strategie kannst du die Prüfung souverän meistern.

## 1. Früh anfangen zahlt sich aus

Der größte Fehler, den Azubis machen? Sie beginnen zu spät mit der Vorbereitung. Idealerweise startest du **mindestens drei Monate** vor dem Prüfungstermin mit strukturiertem Lernen. Das gibt dir genug Zeit, alle Themen durchzuarbeiten und Wissenslücken zu schließen.

**Tipp:** Erstelle dir einen realistischen Lernplan. Plane nicht mehr als 2-3 Stunden konzentriertes Lernen pro Tag ein – dein Gehirn braucht auch Pausen, um Informationen zu verarbeiten.

## 2. Die Prüfungsordnung kennen

Bevor du loslegst, solltest du genau wissen, was dich erwartet:

- Welche Fächer werden geprüft?
- Wie ist die Gewichtung der einzelnen Bereiche?
- Welche Hilfsmittel sind erlaubt?
- Wie lange dauern die einzelnen Prüfungsteile?

Diese Informationen findest du in der Prüfungsordnung deines Berufs. Deine IHK stellt diese online zur Verfügung.

## 3. Mit echten Prüfungsfragen üben

Theorie lernen ist wichtig, aber nichts ersetzt das Üben mit echten Prüfungsaufgaben. Alte Prüfungen zeigen dir:

- Welche Themen besonders häufig drankommen
- Wie die Fragen formuliert sind
- Wie viel Zeit du pro Aufgabe einplanen solltest

**Wichtig:** Simuliere die Prüfungssituation so realistisch wie möglich. Stelle dir einen Timer und arbeite ohne Unterbrechungen.

## 4. Verstehen statt Auswendiglernen

Auswendiglernen funktioniert vielleicht für einzelne Fakten, aber für komplexe Zusammenhänge brauchst du echtes Verständnis. Frage dich bei jedem Thema:

- Warum ist das so?
- Wie hängt das mit anderen Themen zusammen?
- Wie würde ich das einem Freund erklären?

Wer Zusammenhänge versteht, kann auch unbekannte Aufgaben lösen.

## 5. Die mündliche Prüfung nicht unterschätzen

Viele konzentrieren sich nur auf den schriftlichen Teil und vernachlässigen die mündliche Prüfung. Dabei zählt sie oft genauso viel! Übe, dein Wissen laut zu erklären – vor dem Spiegel, mit Freunden oder Familie.

## Fazit

Die IHK-Prüfung ist machbar, wenn du dich systematisch vorbereitest. Fang früh an, übe regelmäßig und vergiss nicht: Du hast in deiner Ausbildung schon so viel gelernt. Jetzt geht es nur noch darum, dieses Wissen abzurufen.

**Du schaffst das!**
    `
  },
  {
    id: '2',
    slug: 'haeufigste-fehler-pruefungsvorbereitung',
    title: 'Die 5 häufigsten Fehler bei der Prüfungsvorbereitung',
    excerpt: 'Diese typischen Fehler kosten Azubis wertvolle Punkte. Lerne, wie du sie vermeidest und entspannter in die Prüfung gehst.',
    category: 'Lerntipps',
    author: 'Markus Weber',
    publishedAt: '2023-02-15',
    readingTime: 6,
    tags: ['Lerntipps', 'Prüfungsvorbereitung', 'Fehler vermeiden'],
    content: `
# Die 5 häufigsten Fehler bei der Prüfungsvorbereitung

Nach Jahren der Arbeit mit Auszubildenden haben wir immer wieder dieselben Muster gesehen. Hier sind die fünf häufigsten Fehler – und wie du sie vermeidest.

## Fehler 1: Zu spät anfangen

„Ich lerne das kurz vor der Prüfung" – dieser Satz hat schon viele Azubis in Schwierigkeiten gebracht. Das Gehirn braucht Zeit und Wiederholungen, um Wissen langfristig zu speichern. Wer erst zwei Wochen vor der Prüfung anfängt, kann nur oberflächlich lernen.

**Besser:** Starte mindestens 8-12 Wochen vor dem Prüfungstermin. So hast du Zeit für mehrere Wiederholungsdurchgänge.

## Fehler 2: Ohne Plan lernen

Einfach irgendwo anfangen und hoffen, dass man alles schafft? Das funktioniert selten. Ohne klaren Plan verlierst du Zeit mit unwichtigen Details und übersiehst wichtige Themen.

**Besser:** Erstelle einen Lernplan mit:
- Allen Themengebieten
- Realistischen Zeitblöcken
- Pufferzeiten für Wiederholungen
- Festen Lernzeiten

## Fehler 3: Nur lesen, nicht anwenden

Passives Lesen fühlt sich nach Lernen an, ist aber wenig effektiv. Dein Gehirn speichert Informationen besser, wenn du aktiv damit arbeitest.

**Besser:**
- Erkläre Themen laut (auch dir selbst)
- Löse Übungsaufgaben
- Erstelle eigene Zusammenfassungen
- Nutze Karteikarten für Wiederholungen

## Fehler 4: Pausen vernachlässigen

Durchlernen bis zur Erschöpfung bringt nichts. Nach 45-60 Minuten lässt die Konzentration deutlich nach. Wer keine Pausen macht, lernt ineffizient und erschöpft sich unnötig.

**Besser:** Nutze die Pomodoro-Technik:
- 25 Minuten konzentriert lernen
- 5 Minuten Pause
- Nach 4 Durchgängen: 30 Minuten lange Pause

## Fehler 5: Sich isolieren

Alleine vor den Büchern zu sitzen kann frustrierend sein. Viele Azubis trauen sich nicht, bei Problemen um Hilfe zu bitten.

**Besser:**
- Bilde Lerngruppen mit anderen Azubis
- Frage Ausbilder oder Berufsschullehrer
- Nutze Online-Foren und Communities
- Erkläre anderen, was du gelernt hast

## Fazit

Die gute Nachricht: Alle diese Fehler sind vermeidbar. Mit der richtigen Strategie und etwas Disziplin kannst du dich optimal vorbereiten. Und denk daran: Jeder hat mal angefangen. Du bist nicht allein auf diesem Weg.
    `
  },
  {
    id: '3',
    slug: 'ausbildungsberufe-mit-zukunft-2023',
    title: 'Ausbildungsberufe mit Zukunft: Diese Jobs sind gefragt',
    excerpt: 'Die Arbeitswelt verändert sich rasant. Welche Ausbildungsberufe bieten auch in Zukunft sichere Perspektiven?',
    category: 'Berufswahl',
    author: 'Lisa Schneider',
    publishedAt: '2023-03-22',
    readingTime: 10,
    tags: ['Berufswahl', 'Zukunft', 'Karriere'],
    featured: true,
    content: `
# Ausbildungsberufe mit Zukunft: Diese Jobs sind gefragt

Die Digitalisierung verändert die Arbeitswelt grundlegend. Manche Berufe verschwinden, andere entstehen neu. Doch eines bleibt: Die duale Ausbildung in Deutschland ist ein Erfolgsmodell, das weltweit bewundert wird. Hier sind die Berufsfelder, die auch in den kommenden Jahrzehnten hervorragende Perspektiven bieten.

## IT und Digitalisierung

Die Nachfrage nach IT-Fachkräften ist ungebrochen hoch. Unternehmen aller Branchen suchen händeringend nach:

- **Fachinformatiker/in** (Anwendungsentwicklung oder Systemintegration)
- **IT-System-Elektroniker/in**
- **Kaufleute für Digitalisierungsmanagement**

**Warum zukunftssicher?** Digitalisierung durchdringt alle Wirtschaftsbereiche. Selbst klassische Handwerksbetriebe brauchen IT-Expertise.

## Gesundheit und Pflege

Der demografische Wandel führt zu einem enormen Bedarf an Fachkräften im Gesundheitswesen:

- **Pflegefachmann/-frau**
- **Medizinische/r Fachangestellte/r**
- **Pharmazeutisch-kaufmännische/r Angestellte/r**

**Warum zukunftssicher?** Menschen werden älter, der Pflegebedarf steigt. Diese Berufe sind nicht automatisierbar.

## Handwerk und Technik

Das Handwerk erlebt eine Renaissance. Fachkräfte sind Mangelware und werden hervorragend bezahlt:

- **Elektroniker/in** (besonders Energie- und Gebäudetechnik)
- **Anlagenmechaniker/in** (Sanitär, Heizung, Klima)
- **Mechatroniker/in**

**Warum zukunftssicher?** Energiewende, Elektromobilität und Smart Homes schaffen enormen Bedarf.

## Kaufmännische Berufe

Auch klassische kaufmännische Ausbildungen bleiben relevant – wenn sie sich anpassen:

- **Industriekaufmann/-frau**
- **Kaufmann/-frau im E-Commerce**
- **Kaufmann/-frau für Büromanagement**

**Warum zukunftssicher?** Unternehmen brauchen Menschen, die komplexe Prozesse verstehen und steuern können.

## Logistik und Mobilität

Die vernetzte Wirtschaft braucht effiziente Warenströme:

- **Fachkraft für Lagerlogistik**
- **Kaufmann/-frau für Spedition und Logistikdienstleistung**
- **Berufskraftfahrer/in**

**Warum zukunftssicher?** E-Commerce wächst, internationale Lieferketten werden komplexer.

## Was bei der Berufswahl zählt

Bei all diesen Möglichkeiten gilt: Der beste Beruf ist der, der zu dir passt. Frage dich:

1. Was interessiert mich wirklich?
2. Wo liegen meine Stärken?
3. Welche Arbeitsbedingungen passen zu meinem Leben?
4. Wie wichtig ist mir Sicherheit vs. Abwechslung?

## Fazit

Die Zukunft gehört denjenigen, die bereit sind zu lernen und sich anzupassen. Eine solide Ausbildung ist dafür das beste Fundament. Egal für welchen Beruf du dich entscheidest: Mit Engagement und Lernbereitschaft hast du gute Chancen.
    `
  },
  {
    id: '4',
    slug: 'lerntypen-verstehen-lernstrategie',
    title: 'Lerntypen verstehen: So findest du deine optimale Lernstrategie',
    excerpt: 'Jeder lernt anders. Finde heraus, welcher Lerntyp du bist und wie du dieses Wissen für bessere Prüfungsergebnisse nutzt.',
    category: 'Lerntipps',
    author: 'Dr. Anna Hoffmann',
    publishedAt: '2023-04-10',
    readingTime: 7,
    tags: ['Lerntypen', 'Lerntipps', 'Selbstoptimierung'],
    content: `
# Lerntypen verstehen: So findest du deine optimale Lernstrategie

Hast du dich schon mal gefragt, warum manche Lernmethoden bei dir super funktionieren und andere gar nicht? Das liegt an deinem individuellen Lerntyp. Wenn du verstehst, wie du am besten lernst, kannst du deine Prüfungsvorbereitung deutlich effektiver gestalten.

## Die vier Lerntypen nach Vester

Der Wissenschaftler Frederic Vester unterschied vier grundlegende Lerntypen:

### 1. Der visuelle Lerntyp

Du merkst dir Dinge besser, wenn du sie siehst? Dann bist du wahrscheinlich ein visueller Lerntyp.

**Erkennungsmerkmale:**
- Du erinnerst dich gut an Bilder und Grafiken
- Du malst gerne Skizzen oder Mind-Maps
- Du bevorzugst geschriebene Anleitungen

**Lerntipps für visuelle Lerntypen:**
- Nutze Farben und Markierungen
- Erstelle Schaubilder und Diagramme
- Arbeite mit Karteikarten
- Schau dir Lernvideos an

### 2. Der auditive Lerntyp

Hörst du lieber zu, statt zu lesen? Dann verarbeitest du Informationen besonders gut über das Gehör.

**Erkennungsmerkmale:**
- Du merkst dir Gespräche gut
- Musik lenkt dich beim Lernen ab
- Du liest dir Texte gerne laut vor

**Lerntipps für auditive Lerntypen:**
- Höre Podcasts und Hörbücher
- Nimm dich selbst beim Erklären auf
- Lerne mit Lernpartnern durch Diskussionen
- Lies wichtige Texte laut

### 3. Der haptische/motorische Lerntyp

Begreifst du Dinge besser, wenn du sie anfassen und ausprobieren kannst?

**Erkennungsmerkmale:**
- Du lernst am besten durch Ausprobieren
- Längeres Stillsitzen fällt dir schwer
- Du machst dir gerne handschriftliche Notizen

**Lerntipps für haptische Lerntypen:**
- Baue Modelle oder nutze Lernspiele
- Bewege dich beim Lernen (Laufen, Gehen)
- Schreibe Zusammenfassungen per Hand
- Nutze praktische Übungen

### 4. Der kommunikative Lerntyp

Lernst du am besten im Austausch mit anderen?

**Erkennungsmerkmale:**
- Diskussionen helfen dir beim Verstehen
- Du stellst viele Fragen
- Du erklärst anderen gerne Themen

**Lerntipps für kommunikative Lerntypen:**
- Bilde Lerngruppen
- Erkläre Themen anderen (oder dir selbst)
- Nutze Frage-Antwort-Spiele
- Diskutiere Inhalte mit Kollegen

## Die Wahrheit: Mischtypen sind normal

Die wenigsten Menschen sind reine Lerntypen. Die meisten von uns sind Mischtypen und profitieren von verschiedenen Methoden. Nutze dieses Wissen:

1. **Experimentiere** mit verschiedenen Methoden
2. **Beobachte**, was bei dir am besten funktioniert
3. **Kombiniere** verschiedene Ansätze
4. **Passe** deine Strategie an das Thema an

## Fazit

Es gibt keine „richtige" Art zu lernen – nur die richtige Art für dich. Nimm dir Zeit, deinen Lernstil zu erkunden. Die Investition zahlt sich aus: Wer lerntypgerecht lernt, braucht weniger Zeit und erzielt bessere Ergebnisse.
    `
  },
  {
    id: '5',
    slug: 'gehalt-nach-ausbildung-verdienst',
    title: 'Gehalt nach der Ausbildung: Was du in deinem Beruf verdienen kannst',
    excerpt: 'Was verdient man eigentlich nach der Ausbildung? Ein realistischer Überblick über Einstiegsgehälter in verschiedenen Branchen.',
    category: 'Karriere',
    author: 'Thomas Klein',
    publishedAt: '2023-05-18',
    readingTime: 9,
    tags: ['Gehalt', 'Karriere', 'Berufswahl'],
    content: `
# Gehalt nach der Ausbildung: Was du in deinem Beruf verdienen kannst

Eine der häufigsten Fragen bei der Berufswahl: Was kann ich später verdienen? Hier bekommst du einen ehrlichen Überblick über realistische Einstiegsgehälter nach der Ausbildung.

## Wichtig vorab: Gehalt ist nicht alles

Bevor wir in die Zahlen einsteigen: Ein hohes Gehalt macht keinen Sinn, wenn du den Job hasst. Trotzdem ist es wichtig, realistische Erwartungen zu haben.

## Einstiegsgehälter nach Branchen (Bruttogehalt/Monat)

### IT und Technik
- Fachinformatiker/in: 2.400 – 3.200 €
- IT-System-Elektroniker/in: 2.300 – 2.900 €
- Mechatroniker/in: 2.500 – 3.100 €

### Kaufmännische Berufe
- Industriekaufmann/-frau: 2.200 – 2.800 €
- Kaufmann/-frau im Einzelhandel: 1.900 – 2.400 €
- Bankkaufmann/-frau: 2.400 – 3.000 €

### Handwerk
- Elektroniker/in: 2.300 – 2.900 €
- Anlagenmechaniker/in SHK: 2.400 – 3.000 €
- Kfz-Mechatroniker/in: 2.100 – 2.600 €

### Gesundheit
- Pflegefachmann/-frau: 2.500 – 3.000 €
- Medizinische/r Fachangestellte/r: 2.000 – 2.500 €

## Faktoren, die dein Gehalt beeinflussen

### 1. Region
In München oder Frankfurt verdienst du oft 20-30% mehr als in ländlichen Gebieten. Aber: Die Lebenshaltungskosten sind auch entsprechend höher.

### 2. Unternehmensgröße
Große Konzerne zahlen meist besser als kleine Betriebe – bieten dafür aber oft weniger Flexibilität und Entwicklungsmöglichkeiten.

### 3. Tarifbindung
Unternehmen mit Tarifvertrag zahlen in der Regel besser und bieten zusätzliche Leistungen (Urlaubs- und Weihnachtsgeld, betriebliche Altersvorsorge).

### 4. Deine Abschlussnote
Ein sehr guter Abschluss kann bei Gehaltsverhandlungen helfen – ist aber nicht der einzige Faktor.

### 5. Zusatzqualifikationen
Wer sich weiterbildet (Fachwirt, Meister, Zusatzzertifikate), kann sein Gehalt deutlich steigern.

## Gehaltsentwicklung: So geht's nach oben

Nach 3-5 Jahren Berufserfahrung kannst du in vielen Berufen mit 20-40% mehr rechnen. Weitere Möglichkeiten:

- **Weiterbildung:** Meister, Techniker, Fachwirt
- **Spezialisierung:** Nischenexpertise wird gut bezahlt
- **Führungsverantwortung:** Teamleitung, Abteilungsleitung
- **Branchenwechsel:** Manchmal lohnt sich ein Umstieg

## Verhandlungstipps fürs erste Gehalt

1. **Recherchiere vorher** – kenne die üblichen Gehälter
2. **Nenne einen konkreten Wunsch** (nicht „so viel wie möglich")
3. **Begründe deinen Wert** – was bringst du mit?
4. **Denke an Zusatzleistungen** – Urlaub, Weiterbildung, flexible Arbeitszeiten

## Fazit

Geld ist wichtig, aber nicht alles. Wähle einen Beruf, der dich erfüllt und entwickle dich kontinuierlich weiter. Das Gehalt kommt dann oft von alleine.
    `
  },
  {
    id: '6',
    slug: 'pruefungsangst-ueberwinden-techniken',
    title: 'Prüfungsangst überwinden: 7 bewährte Techniken',
    excerpt: 'Schweißnasse Hände, Blackout, Panik? Prüfungsangst ist weit verbreitet, aber überwindbar. Diese Techniken helfen wirklich.',
    category: 'Prüfungsvorbereitung',
    author: 'Dr. Nina Berger',
    publishedAt: '2023-06-28',
    readingTime: 8,
    tags: ['Prüfungsangst', 'Mental Health', 'Prüfungsvorbereitung'],
    featured: true,
    content: `
# Prüfungsangst überwinden: 7 bewährte Techniken

Dein Herz rast, die Hände zittern, im Kopf ist plötzlich alles leer – Prüfungsangst kann lähmend sein. Die gute Nachricht: Du bist nicht allein, und es gibt wirksame Strategien dagegen.

## Warum haben wir Prüfungsangst?

Prüfungsangst ist eine Stressreaktion unseres Körpers. Er bereitet sich auf eine „Bedrohung" vor – auch wenn eine Prüfung natürlich keine echte Gefahr darstellt. Diese Reaktion ist evolutionär sinnvoll, aber in der Prüfungssituation hinderlich.

## 7 Techniken, die wirklich helfen

### 1. Die 4-7-8 Atemtechnik

Diese einfache Übung beruhigt das Nervensystem in Sekunden:

- **4 Sekunden** einatmen durch die Nase
- **7 Sekunden** Luft anhalten
- **8 Sekunden** langsam durch den Mund ausatmen

Wiederhole das 4-5 Mal. Dein Puls sinkt, die Anspannung lässt nach.

### 2. Reframing: Aufregung statt Angst

Angst und Aufregung fühlen sich körperlich ähnlich an. Der Unterschied liegt in der Interpretation. Sage dir:

> „Ich bin nicht nervös, ich bin aufgeregt und bereit."

Diese einfache Umdeutung kann die Leistung messbar verbessern.

### 3. Worst-Case-Analyse

Was ist das Schlimmste, das passieren kann? Durchdenke es ehrlich:

- Prüfung nicht bestanden → Wiederholung möglich
- Schlechte Note → Eine Note definiert nicht deinen Wert
- Blackout → Du kannst um Pause bitten

Meist ist der Worst Case gar nicht so schlimm – und sehr unwahrscheinlich.

### 4. Progressive Muskelentspannung

Spannung lösen durch bewusstes Anspannen und Loslassen:

1. Balle deine Fäuste fest für 5 Sekunden
2. Lass los und spüre die Entspannung
3. Wiederhole mit anderen Muskelgruppen

Diese Technik kannst du unauffällig auch während der Prüfung anwenden.

### 5. Positive Visualisierung

Stelle dir vor, wie du die Prüfung erfolgreich absolvierst:

- Du sitzt entspannt am Platz
- Die Aufgaben sind machbar
- Du schreibst konzentriert und ruhig
- Du gibst zufrieden ab

Das Gehirn kann Vorstellung und Realität nicht komplett unterscheiden – nutze das!

### 6. Früh da sein, aber nicht zu früh

Komm rechtzeitig, aber vermeide panische Last-Minute-Gespräche mit anderen Prüflingen. 15-20 Minuten vorher ist ideal.

**Tipp:** Höre Musik, die dich in gute Stimmung bringt, statt Lernstoff durchzugehen.

### 7. Das „Wer jetzt nicht kann"-Prinzip

Sage dir ehrlich: Was du bis jetzt nicht gelernt hast, lernst du in den letzten Minuten auch nicht mehr. Also lass es. Konzentriere dich darauf, was du kannst – und das ist mehr, als du denkst.

## Bei starker Prüfungsangst: Professionelle Hilfe

Wenn Prüfungsangst dich stark einschränkt, scheue dich nicht, Hilfe zu suchen:

- Beratungsstellen der IHK
- Psychologische Beratung (oft kostenlos für Azubis)
- Coaches, die auf Prüfungsangst spezialisiert sind

## Fazit

Prüfungsangst ist normal und überwindbar. Mit den richtigen Techniken kannst du sie nicht nur kontrollieren, sondern sogar als Energiequelle nutzen. Du hast so viel gelernt – jetzt ist es Zeit, es zu zeigen.
    `
  },
  {
    id: '7',
    slug: 'muendliche-ihk-pruefung-tipps',
    title: 'Mündliche IHK-Prüfung: So überzeugst du die Prüfer',
    excerpt: 'Die mündliche Prüfung macht vielen Azubis besonders Angst. Mit diesen Tipps gehst du selbstbewusst ins Fachgespräch.',
    category: 'Prüfungsvorbereitung',
    author: 'Michael Braun',
    publishedAt: '2023-08-14',
    readingTime: 7,
    tags: ['Mündliche Prüfung', 'IHK-Prüfung', 'Prüfungstipps'],
    content: `
# Mündliche IHK-Prüfung: So überzeugst du die Prüfer

Die mündliche Prüfung – für viele der stressigste Teil der Abschlussprüfung. Aber keine Panik: Mit der richtigen Vorbereitung kannst du hier richtig punkten.

## Was dich erwartet

Je nach Beruf besteht die mündliche Prüfung aus:

- **Fachgespräch** (15-30 Minuten)
- **Präsentation** mit anschließenden Fragen
- **Fallbezogene Aufgabe** mit Diskussion

Der Prüfungsausschuss besteht meist aus 3 Personen: Arbeitgeber-, Arbeitnehmervertreter und Berufsschullehrer.

## Die richtige Vorbereitung

### 1. Kenne deine Unterlagen

Egal ob Report, Projektarbeit oder Dokumentation – du musst sie in- und auswendig kennen. Rechne mit Fragen wie:

- „Warum haben Sie sich für diesen Ansatz entschieden?"
- „Welche Alternativen gab es?"
- „Was würden Sie heute anders machen?"

### 2. Übe laut

Gedanken laut zu formulieren ist schwieriger als im Kopf. Übe:

- Vor dem Spiegel
- Mit Familie oder Freunden
- Nimm dich per Video auf

### 3. Fachbegriffe parat haben

Nutze die korrekten Fachbegriffe deines Berufs. Das zeigt Kompetenz. Aber: Nur Begriffe verwenden, die du auch erklären kannst!

## Während der Prüfung

### Der erste Eindruck zählt

- Pünktlich erscheinen (10 Minuten vorher)
- Gepflegte, angemessene Kleidung
- Freundlicher Blickkontakt
- Fester Händedruck

### Körpersprache beachten

- Sitze aufrecht, aber nicht steif
- Halte Blickkontakt mit allen Prüfern
- Vermeide nervöse Gesten (Kugelschreiber klicken, Haare spielen)
- Lächeln nicht vergessen!

### Richtig antworten

**Bei Wissensfragen:**
- Kurz nachdenken ist erlaubt
- Strukturiert antworten
- Lieber „Das weiß ich nicht" als erfinden

**Bei Verständnisfragen:**
- Zeige deine Denkprozesse
- Erkläre Zusammenhänge
- Nutze Beispiele aus deiner Praxis

**Bei kritischen Fragen:**
- Ruhig bleiben
- Sachlich argumentieren
- Eigene Fehler eingestehen können

### Wenn du die Antwort nicht weißt

Passiert den Besten! Mögliche Reaktionen:

- „Da bin ich mir nicht sicher, aber ich würde vermuten..."
- „Das konkrete Detail kenne ich nicht, aber der Zusammenhang ist..."
- „Diese Information müsste ich nachschlagen, aber ich weiß wo."

Nie: Raten, erfinden oder stumm bleiben.

## Nach der Prüfung

Egal wie es lief – sei stolz auf dich. Du hast es durchgezogen! Das Ergebnis kommt meist direkt im Anschluss oder wenige Tage später.

## Fazit

Die mündliche Prüfung ist deine Chance, zu zeigen, was du drauf hast. Mit guter Vorbereitung und der richtigen Einstellung wirst du die Prüfer überzeugen. Tief durchatmen – und los!
    `
  },
  {
    id: '8',
    slug: 'azubi-rechte-ausbildung-wissen',
    title: 'Azubi-Rechte: Was du über deine Ausbildung wissen musst',
    excerpt: 'Arbeitszeit, Urlaub, Kündigungsschutz – als Azubi hast du Rechte. Hier erfährst du, was dir zusteht.',
    category: 'Ausbildung',
    author: 'Rechtsanwältin Julia Keller',
    publishedAt: '2023-10-05',
    readingTime: 9,
    tags: ['Azubi-Rechte', 'Ausbildung', 'Arbeitsrecht'],
    content: `
# Azubi-Rechte: Was du über deine Ausbildung wissen musst

Als Auszubildender hast du besondere Rechte, die dich schützen. Leider kennen viele Azubis ihre Rechte nicht – und lassen sich deshalb manchmal mehr gefallen, als sie müssten.

## Dein Ausbildungsvertrag

Der Ausbildungsvertrag ist die Grundlage deiner Ausbildung. Er muss enthalten:

- Art, Ziel und Gliederung der Ausbildung
- Beginn und Dauer
- Ausbildungsmaßnahmen außerhalb der Ausbildungsstätte
- Dauer der täglichen Arbeitszeit
- Dauer der Probezeit
- Zahlung und Höhe der Vergütung
- Urlaubsanspruch
- Kündigungsvoraussetzungen

**Wichtig:** Ohne schriftlichen Vertrag ist die Ausbildung trotzdem gültig, aber du solltest auf einen bestehen!

## Arbeitszeit

Für Azubis unter 18 gelten strenge Regeln (Jugendarbeitsschutzgesetz):

- Maximal 8 Stunden pro Tag
- Maximal 40 Stunden pro Woche
- Keine Arbeit vor 6 Uhr und nach 20 Uhr (Ausnahmen möglich)
- Keine Wochenendarbeit (mit Ausnahmen)

Für Azubis über 18:
- Maximal 8 Stunden pro Tag (10 bei Ausgleich)
- Maximal 48 Stunden pro Woche

## Urlaub

Mindestens:
- Unter 16 Jahre: 30 Werktage
- Unter 17 Jahre: 27 Werktage
- Unter 18 Jahre: 25 Werktage
- Ab 18 Jahre: 24 Werktage

Viele Tarifverträge sehen mehr Urlaub vor – prüfe deinen!

## Vergütung

Deine Ausbildungsvergütung muss:
- Angemessen sein
- Jährlich steigen
- Mindestens den Mindestlohn für Azubis betragen (2023: 620 € im 1. Jahr)

**Neu:** Seit 2020 gibt es einen Mindestlohn speziell für Azubis, der jährlich steigt.

## Freistellung für Berufsschule

Der Betrieb muss dich für die Berufsschule freistellen. Die Schulzeit gilt als Arbeitszeit. Nach einem Schultag mit mehr als 5 Unterrichtsstunden darfst du nicht mehr in den Betrieb.

## Kündigungsschutz

### In der Probezeit
Beide Seiten können ohne Angabe von Gründen kündigen. Die Probezeit dauert 1-4 Monate.

### Nach der Probezeit
Der Betrieb kann nur noch außerordentlich kündigen bei:
- Schweren Pflichtverletzungen
- Wiederholten Vergehen trotz Abmahnung

Du kannst kündigen mit 4 Wochen Frist, wenn du die Ausbildung aufgeben oder wechseln möchtest.

## Was tun bei Problemen?

1. **Gespräch suchen** mit Ausbilder oder Personalabteilung
2. **Jugend- und Auszubildendenvertretung (JAV)** einschalten
3. **IHK/HWK kontaktieren** – die haben Ausbildungsberater
4. **Gewerkschaft** beitreten für rechtliche Unterstützung
5. **Beratungsstellen** nutzen (oft kostenlos)

## Fazit

Du hast Rechte – nutze sie! Wer seine Rechte kennt, kann selbstbewusster auftreten und wird im Zweifelsfall besser behandelt. Bei Unsicherheiten: Immer nachfragen oder beraten lassen.
    `
  },
  {
    id: '9',
    slug: 'karriere-nach-ausbildung-weiterbildung',
    title: 'Karriere nach der Ausbildung: Deine Weiterbildungsmöglichkeiten',
    excerpt: 'Nach der Ausbildung ist vor der Karriere. Welche Weiterbildungen lohnen sich und wie finanzierst du sie?',
    category: 'Karriere',
    author: 'Sandra Neumann',
    publishedAt: '2024-01-15',
    readingTime: 10,
    tags: ['Weiterbildung', 'Karriere', 'Meister', 'Fachwirt'],
    content: `
# Karriere nach der Ausbildung: Deine Weiterbildungsmöglichkeiten

Die Ausbildung ist geschafft – und jetzt? Für viele ist das erst der Anfang. Mit der richtigen Weiterbildung kannst du Karriere machen, mehr verdienen und neue Türen öffnen.

## Warum Weiterbildung?

Die Arbeitswelt verändert sich rasant. Wer stehenbleibt, fällt zurück. Weiterbildung bietet:

- Höheres Gehalt (oft 20-50% mehr)
- Mehr Verantwortung
- Bessere Jobsicherheit
- Neue Karrierewege

## Die wichtigsten Aufstiegsfortbildungen

### Meister (Handwerk)

Der klassische Weg im Handwerk. Als Meister darfst du:
- Ausbilden
- Einen eigenen Betrieb führen
- Bestimmte Gewerke ausüben

**Dauer:** 1-3 Jahre (Vollzeit/Teilzeit)
**Kosten:** 4.000-10.000 € (förderfähig!)
**DQR-Niveau:** 6 (= Bachelor)

### Fachwirt (Kaufmännisch)

Das Äquivalent zum Meister für kaufmännische Berufe:
- Wirtschaftsfachwirt
- Handelsfachwirt
- Industriefachwirt
- und viele weitere

**Dauer:** 1-2 Jahre (meist berufsbegleitend)
**Kosten:** 3.000-6.000 €
**DQR-Niveau:** 6 (= Bachelor)

### Techniker (Industrie)

Für technische Ausbildungsberufe:
- Staatlich geprüfter Techniker
- Verschiedene Fachrichtungen

**Dauer:** 2-4 Jahre (Voll-/Teilzeit)
**Kosten:** 0-10.000 € (staatliche Schulen oft kostenlos)
**DQR-Niveau:** 6 (= Bachelor)

### Betriebswirt

Die höchste kaufmännische Qualifikation nach der Ausbildung:
- Geprüfter Betriebswirt (IHK)

**Dauer:** 2-3 Jahre (nach Fachwirt)
**Kosten:** 4.000-8.000 €
**DQR-Niveau:** 7 (= Master)

## Studium ohne Abitur

Mit Ausbildung und Berufserfahrung kannst du auch studieren:

- **3 Jahre Berufserfahrung:** Fachgebundenes Studium möglich
- **Meister/Fachwirt:** Allgemeine Hochschulreife

Viele Hochschulen bieten berufsbegleitende Studiengänge an.

## So finanzierst du deine Weiterbildung

### Aufstiegs-BAföG (AFBG)
- Bis zu 75% Zuschuss für Lehrgangs- und Prüfungsgebühren
- Zinsgünstiges Darlehen für den Rest
- Zusätzlich: Unterhaltsförderung möglich
- Unabhängig vom Einkommen!

### Bildungsgutschein
- Von der Arbeitsagentur
- Für Arbeitslose und von Arbeitslosigkeit Bedrohte
- Kann 100% der Kosten übernehmen

### Weiterbildungsstipendium
- Für besonders begabte Fachkräfte unter 25
- Bis zu 8.100 € über 3 Jahre
- Bewerbung über die IHK/HWK

### Arbeitgeber
- Viele Betriebe unterstützen Weiterbildung
- Fragen lohnt sich!
- Oft: Kostenübernahme gegen Bindung

## Welche Weiterbildung passt zu mir?

Frage dich:
1. Was interessiert mich wirklich?
2. Wohin will ich langfristig?
3. Was ist in meiner Branche gefragt?
4. Wie viel Zeit und Geld kann ich investieren?

**Tipp:** Sprich mit Menschen, die den Weg schon gegangen sind.

## Fazit

Nach der Ausbildung hast du alle Möglichkeiten. Ob Meister, Fachwirt, Techniker oder Studium – wähle den Weg, der zu dir passt. Die Investition in dich selbst zahlt sich immer aus.
    `
  },
  {
    id: '10',
    slug: 'lern-apps-auszubildende-2024',
    title: 'Die besten Lern-Apps für Auszubildende 2024',
    excerpt: 'Lernen mit dem Smartphone? Mit den richtigen Apps geht das effektiver als du denkst. Unsere Top-Empfehlungen.',
    category: 'Lerntipps',
    author: 'Tim Schulz',
    publishedAt: '2024-03-20',
    readingTime: 6,
    tags: ['Lern-Apps', 'Digital Lernen', 'Lerntipps'],
    content: `
# Die besten Lern-Apps für Auszubildende 2024

Das Smartphone ist eh immer dabei – warum nicht auch zum Lernen nutzen? Wir haben die besten Apps für Azubis getestet und bewertet.

## Karteikarten-Apps

### Anki (kostenlos / iOS kostenpflichtig)
Der Klassiker unter den Karteikarten-Apps:
- Wissenschaftlich fundierter Wiederholalgorithmus
- Riesige Bibliothek fertiger Karteikarten
- Offline nutzbar
- Sehr anpassbar

**Für wen:** Wer bereit ist, etwas Einarbeitungszeit zu investieren.

### Quizlet (kostenlos mit Premium-Option)
Benutzerfreundlicher als Anki:
- Einfache Kartenerstellung
- Fertige Lernsets für viele Berufe
- Lernspiele machen Spaß
- Gruppenfeatures für Lerngruppen

**Für wen:** Wer schnell loslegen will ohne viel Einrichtung.

## Fokus & Produktivität

### Forest (kostenpflichtig)
Gamification gegen Ablenkung:
- Pflanze einen virtuellen Baum
- Er wächst, solange du nicht ans Handy gehst
- Bei Ablenkung stirbt er
- Macht erstaunlich süchtig (im positiven Sinn)

**Für wen:** Wer zu oft auf Instagram statt Lernstoff schaut.

### Todoist (kostenlos mit Premium)
Aufgabenmanagement, das funktioniert:
- Lernziele als Tasks anlegen
- Wiederkehrende Aufgaben
- Projekte und Labels
- Plattformübergreifend

**Für wen:** Wer Struktur in den Lernalltag bringen will.

## Fachspezifische Apps

### Prozubi (kostenpflichtig)
Speziell für kaufmännische Azubis:
- Lernvideos zu allen Themen
- Übungsaufgaben im Prüfungsformat
- Abgestimmt auf IHK-Prüfungen

**Für wen:** Kaufmännische Azubis, die visuell lernen.

### Azubiworld (kostenlos mit In-App-Käufen)
Prüfungsvorbereitung für verschiedene Berufe:
- Prüfungsfragen zum Üben
- Lernstatistiken
- Community-Features

**Für wen:** Azubis verschiedener Berufe für die Prüfungsvorbereitung.

## Zeitmanagement

### Pomodoro Timer
Die Pomodoro-Technik digital:
- 25 Minuten Fokus, 5 Minuten Pause
- Statistiken über Lernzeit
- Anpassbare Intervalle

Empfehlung: „Focus To-Do" kombiniert Pomodoro mit Aufgabenliste.

## Tipps für effektives App-Lernen

1. **Weniger ist mehr** – Nutze 2-3 Apps konsequent statt 10 sporadisch
2. **Offline speichern** – Lerne auch ohne Internet (Bahn, Wartezimmer)
3. **Benachrichtigungen an** – Tägliche Erinnerungen helfen bei Gewohnheitsbildung
4. **Smartphone-freie Zeiten** – Nicht alles muss digital sein

## Fazit

Apps sind großartige Lernhelfer, aber kein Ersatz für konzentriertes Lernen. Nutze sie als Ergänzung – für unterwegs, für Wiederholungen, für Motivation. Die beste App ist die, die du wirklich nutzt.
    `
  },
  {
    id: '11',
    slug: 'work-life-balance-ausbildung',
    title: 'Work-Life-Balance in der Ausbildung',
    excerpt: 'Arbeit, Berufsschule, Lernen, Privatleben – wie schaffst du alles unter einen Hut, ohne auszubrennen?',
    category: 'Ausbildung',
    author: 'Laura Fischer',
    publishedAt: '2024-06-12',
    readingTime: 7,
    tags: ['Work-Life-Balance', 'Ausbildung', 'Mental Health'],
    content: `
# Work-Life-Balance in der Ausbildung

Betrieb, Berufsschule, Lernen, vielleicht noch Nebenjob – und dann soll auch noch Zeit für Freunde, Hobbys und Entspannung bleiben? Viele Azubis fühlen sich überfordert. Hier sind realistische Tipps für mehr Balance.

## Warum Balance so wichtig ist

Wer immer nur schuftet, brennt aus. Und wer ausgebrannt ist, lernt schlechter, macht mehr Fehler und ist anfälliger für Krankheiten. Balance ist kein Luxus – sie ist notwendig für langfristigen Erfolg.

## Die großen Zeitfresser identifizieren

Bevor du optimierst, musst du wissen, wo die Zeit hingeht:

- Tracke eine Woche lang jede Stunde
- Sei ehrlich bei „Doomscrolling" und Ablenkung
- Unterscheide produktive und unproduktive Zeit

Oft ist das Ergebnis überraschend.

## Realistische Planung

### Feste Zeiten, feste Grenzen

- **Lernzeiten** definieren und einhalten (nicht mehr!)
- **Feierabend** bedeutet Feierabend
- **Schlaf** ist nicht verhandelbar (7-8 Stunden)
- **Ein freier Tag** pro Woche ohne Lernstress

### Puffer einplanen

Nichts läuft perfekt. Plane Puffer ein für:
- Unvorhergesehene Aufgaben im Betrieb
- Prüfungsphasen mit mehr Lernbedarf
- Krankheit oder schlechte Tage

## Effektiver lernen statt länger lernen

Statt 4 Stunden halbherzig zu lernen, sind 2 Stunden konzentriert effektiver:

- **Pomodoro-Technik** nutzen (25 Min. fokussiert, 5 Min. Pause)
- **Ablenkungen eliminieren** (Handy weg, App-Blocker)
- **Aktiv lernen** (Aufgaben lösen, erklären, nicht nur lesen)

## Nein sagen lernen

Du musst nicht jeden Dienst tauschen, jede Bitte erfüllen, jeden Termin wahrnehmen. Übe, freundlich aber bestimmt zu sagen:

- „Das schaffe ich diese Woche zeitlich nicht."
- „Kann ich nächste Woche darauf zurückkommen?"
- „Das liegt gerade nicht in meiner Priorität."

## Regeneration aktiv planen

Erholung passiert nicht nebenbei. Plane sie ein:

- **Sport** (baut Stress ab, macht den Kopf frei)
- **Soziale Kontakte** (Freunde, Familie – Quality Time)
- **Hobbys** (Dinge, die nur Spaß machen)
- **Nichtstun** (Ja, auch das ist erlaubt!)

## Warnsignale ernst nehmen

Achte auf diese Zeichen von Überlastung:

- Ständige Müdigkeit trotz Schlaf
- Gereiztheit und Motivationslosigkeit
- Körperliche Beschwerden (Kopfschmerzen, Verspannungen)
- Schlafprobleme
- Rückzug von Freunden

Bei anhaltenden Symptomen: Hilfe suchen! Das ist keine Schwäche.

## Fazit

Die Ausbildung ist eine intensive Zeit, aber sie sollte dich nicht kaputtmachen. Mit bewusster Planung, klaren Grenzen und echten Pausen schaffst du es, gut durch diese Phase zu kommen. Dein Wohlbefinden ist die Basis für deinen Erfolg.
    `
  },
  {
    id: '12',
    slug: 'digitalisierung-ausbildungsberufe-veraenderung',
    title: 'Digitalisierung: Wie sich Ausbildungsberufe verändern',
    excerpt: 'KI, Automatisierung, digitale Tools – die Arbeitswelt wandelt sich. Was bedeutet das für deine Ausbildung?',
    category: 'Zukunft',
    author: 'Prof. Dr. Klaus Weber',
    publishedAt: '2024-09-08',
    readingTime: 8,
    tags: ['Digitalisierung', 'Zukunft', 'Industrie 4.0'],
    content: `
# Digitalisierung: Wie sich Ausbildungsberufe verändern

ChatGPT, Roboter in der Fertigung, automatisierte Lagersysteme – die Digitalisierung verändert die Arbeitswelt fundamental. Was bedeutet das für Auszubildende von heute?

## Die große Sorge: Nimmt mir der Roboter den Job weg?

Die kurze Antwort: Wahrscheinlich nicht komplett, aber er verändert deinen Job.

Studien zeigen:
- **14%** der Jobs könnten vollständig automatisiert werden
- **32%** werden sich stark verändern
- **54%** bleiben weitgehend wie bisher

Aber: Neue Jobs entstehen auch.

## Berufe im Wandel: Beispiele

### Kaufmännische Berufe
- **Früher:** Viel manuelle Dateneingabe, Ablage, Routine
- **Heute:** Mehr Analyse, Kundenberatung, Projektarbeit
- **Skills gefragt:** Digital Tools, Datenanalyse, Kommunikation

### Handwerk
- **Früher:** Rein handwerkliche Arbeit
- **Heute:** Digitale Auftragsplanung, Smart-Home-Integration, CNC-Steuerung
- **Skills gefragt:** IT-Grundlagen, digitale Messgeräte, Vernetzung

### Industrie
- **Früher:** Einzelne Maschinen bedienen
- **Heute:** Komplexe Anlagen überwachen, Roboter programmieren
- **Skills gefragt:** Systemdenken, Programmiergrundlagen, Fehleranalyse

### Logistik
- **Früher:** Manuelles Kommissionieren, Papierdokumentation
- **Heute:** Warehouse-Management-Systeme, automatisierte Lager
- **Skills gefragt:** IT-Systeme, Datenauswertung, Prozessoptimierung

## Was bleibt wichtig?

Manche Fähigkeiten kann keine KI ersetzen:

### Soziale Kompetenz
- Kunden beraten und überzeugen
- Teams führen und motivieren
- Konflikte lösen

### Kreativität und Problemlösung
- Unbekannte Situationen meistern
- Neue Ideen entwickeln
- Querdenken

### Komplexes Handwerk
- Feinmotorische Arbeiten
- Vor-Ort-Diagnosen
- Individuelle Anpassungen

### Verantwortung und Ethik
- Entscheidungen treffen
- Konsequenzen abschätzen
- Qualität sichern

## Wie du dich vorbereitest

### 1. Digitale Grundlagen lernen
- Sicherer Umgang mit Office-Programmen
- Verständnis für Datenbanken
- Grundlagen der IT-Sicherheit

### 2. Lebenslanges Lernen akzeptieren
Die Ausbildung ist erst der Anfang. Sei bereit, dich kontinuierlich weiterzubilden.

### 3. Anpassungsfähigkeit entwickeln
Veränderung ist normal. Wer flexibel bleibt, hat Vorteile.

### 4. Mensch-Maschine-Zusammenarbeit verstehen
Lerne, wie du mit digitalen Tools effektiv zusammenarbeitest – nicht gegen sie.

## Die gute Nachricht

Fachkräfte werden gebraucht – mehr denn je. Die Kombination aus solidem Fachwissen und digitaler Kompetenz macht dich wertvoll. Wer heute eine gute Ausbildung absolviert und offen für Neues bleibt, hat exzellente Zukunftschancen.

## Fazit

Die Digitalisierung ist kein Grund zur Panik, sondern eine Chance. Sie macht viele Berufe interessanter, weniger körperlich belastend und bietet neue Möglichkeiten. Bereite dich vor, bleibe neugierig – und nutze die Chancen.
    `
  },
  {
    id: '13',
    slug: 'pruefungsvorbereitung-30-tage-plan',
    title: 'Prüfungsvorbereitung in 30 Tagen: Der ultimative Plan',
    excerpt: 'Nur noch ein Monat bis zur Prüfung? Keine Panik! Mit diesem strukturierten Plan holst du das Maximum raus.',
    category: 'Prüfungsvorbereitung',
    author: 'Sarah Müller',
    publishedAt: '2025-01-20',
    readingTime: 12,
    tags: ['Prüfungsvorbereitung', 'Lernplan', '30-Tage-Challenge'],
    featured: true,
    content: `
# Prüfungsvorbereitung in 30 Tagen: Der ultimative Plan

Die Prüfung rückt näher und du hast das Gefühl, noch nicht genug gelernt zu haben? 30 Tage sind mehr, als du denkst – wenn du sie richtig nutzt.

## Die Grundregeln

Bevor wir in den Plan einsteigen, einige wichtige Prinzipien:

1. **Qualität vor Quantität** – Besser 4 Stunden konzentriert als 8 Stunden halbherzig
2. **Keine Nachtschichten** – Schlaf ist entscheidend für die Gedächtnisbildung
3. **Pausen sind Pflicht** – Dein Gehirn braucht Erholung
4. **Praxis schlägt Theorie** – Üben ist wichtiger als nur lesen

## Der 30-Tage-Plan

### Woche 1: Überblick und Grundlagen (Tag 1-7)

**Tag 1-2: Bestandsaufnahme**
- Prüfungsthemen auflisten
- Eigenen Wissensstand ehrlich einschätzen
- Schwerpunkte identifizieren (wo sind die Lücken?)

**Tag 3-4: Materialien sammeln**
- Alle Unterlagen sortieren
- Alte Prüfungen besorgen
- Lerngruppe organisieren (falls gewünscht)

**Tag 5-7: Basiswissen auffrischen**
- Die wichtigsten Grundlagen wiederholen
- Formelsammlungen erstellen
- Begriffslisten anlegen

### Woche 2: Kernthemen intensiv (Tag 8-14)

**Tag 8-10: Schwachstellen angreifen**
- Die schwierigsten Themen zuerst
- Ausführlich und gründlich durcharbeiten
- Bei Unklarheiten: Hilfe holen!

**Tag 11-12: Übungsphase 1**
- Erste Übungsaufgaben lösen
- Ohne Zeitdruck, dafür gründlich
- Lösungswege verstehen, nicht nur Ergebnisse

**Tag 13-14: Wiederholung + Pause**
- Gelerntes wiederholen
- Tag 14: Bewusst entspannen, leichte Aktivität

### Woche 3: Prüfungssimulation (Tag 15-21)

**Tag 15-17: Praxistraining**
- Echte Prüfungsaufgaben unter Zeitdruck
- Prüfungssituation simulieren
- Fehler analysieren und verstehen

**Tag 18-19: Lücken schließen**
- Aus Fehlern der Simulation lernen
- Gezielt nacharbeiten
- Schwachstellen erneut üben

**Tag 20-21: Zweite Simulation**
- Wieder unter realen Bedingungen üben
- Zeitmanagement optimieren
- Routine entwickeln

### Woche 4: Feinschliff (Tag 22-28)

**Tag 22-24: Wiederholen, nicht neu lernen**
- Keine neuen Themen mehr anfangen!
- Bekanntes festigen
- Überblickswissen stärken

**Tag 25-26: Mündliche Vorbereitung**
- Wenn relevant: Präsentation üben
- Laut erklären und argumentieren
- Kritische Fragen durchspielen

**Tag 27-28: Mentale Vorbereitung**
- Entspannungstechniken üben
- Positive Visualisierung
- Prüfungsablauf mental durchgehen

### Die letzten Tage (Tag 29-30)

**Tag 29: Leichte Wiederholung**
- Nur noch überfliegen
- Selbstvertrauen aufbauen
- Früh schlafen gehen!

**Tag 30: Der Prüfungstag**
- Gesundes Frühstück
- Früh genug da sein
- Atemübungen gegen Nervosität
- Du schaffst das!

## Tagesstruktur (empfohlen)

| Uhrzeit | Aktivität |
|---------|-----------|
| 08:00-10:00 | Intensive Lernphase 1 |
| 10:00-10:30 | Pause (Bewegung!) |
| 10:30-12:00 | Lernphase 2 |
| 12:00-13:00 | Mittagspause |
| 13:00-14:30 | Übungen/Praxis |
| 14:30-15:00 | Pause |
| 15:00-16:30 | Wiederholung |
| 16:30+ | Freizeit! |

## Notfallplan bei Panik

- **Atmen:** 4 Sekunden ein, 7 halten, 8 aus
- **Priorisieren:** Was bringt die meisten Punkte?
- **Hilfe holen:** Lerngruppe, Ausbilder, Online-Tutorials
- **Realismus:** Du musst nicht alles perfekt können

## Fazit

30 Tage sind genug Zeit für eine solide Vorbereitung – wenn du sie konsequent nutzt. Halte dich an den Plan, gönne dir aber auch Pausen. Und denk daran: Du hast in deiner Ausbildung schon so viel gelernt. Jetzt geht es nur noch darum, dieses Wissen abzurufen.

**Du bist bereit. Viel Erfolg!**
    `
  }
];

export const getBlogCategories = () => {
  const categories = [...new Set(blogArticles.map(a => a.category))];
  return categories;
};

export const getFeaturedArticles = () => {
  return blogArticles.filter(a => a.featured);
};

export const getArticlesByCategory = (category: string) => {
  return blogArticles.filter(a => a.category === category);
};

export const getArticleBySlug = (slug: string) => {
  return blogArticles.find(a => a.slug === slug);
};

export const getRelatedArticles = (currentSlug: string, limit = 3) => {
  const current = getArticleBySlug(currentSlug);
  if (!current) return [];
  
  return blogArticles
    .filter(a => a.slug !== currentSlug)
    .filter(a => a.category === current.category || a.tags.some(t => current.tags.includes(t)))
    .slice(0, limit);
};
