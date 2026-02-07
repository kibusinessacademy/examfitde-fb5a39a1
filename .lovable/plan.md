
# Lernsystem Komplettierung - Priorisierter Umsetzungsplan

## Aktueller Stand (Analyse abgeschlossen)

### Was bereits funktioniert
- Dashboard Stats RPC (`get_user_dashboard_stats`) ist in Migration vorhanden und deployed
- Index.tsx nutzt `useDashboardStats` Hook korrekt 
- H5P Player nutzt Storage-first Ansatz (h5p-content Bucket) - Assets werden dynamisch geladen
- Lesson Outcomes und Progress Tracking RPCs sind implementiert
- Exam-Lesson Feedback Loop (P0.3) ist implementiert
- Prueefungstrainer mit Erklärungen (P0.4) ist implementiert

### Offene Blocker identifiziert

| Prioritaet | Problem | Status |
|------------|---------|--------|
| P0-A | H5P Runtime Assets fehlen (`/h5p/frame.bundle.js`, `/h5p/styles/h5p.css`) | BLOCKER |
| P0-B | Mini-Check Step ist nur Platzhalter (keine echte Quiz-UI) | BLOCKER |
| P1-A | Kurs-Navigation: Lessons nicht anklickbar in CourseDetailPage | Core UX fehlt |
| P1-B | Progress-Komponenten nicht integriert | Implementiert aber nicht eingebaut |

---

## Phase 1: H5P Runtime Fix (P0-A)

### Problem
`H5PPlayer.tsx` erwartet H5P-Runtime-Assets unter:
```
/h5p/frame.bundle.js
/h5p/styles/h5p.css
```
Aber `public/` enthaelt nur: `favicon.ico`, `placeholder.svg`, `robots.txt`

### Loesung: Storage-First komplett umsetzen
Da die H5P-Inhalte bereits aus dem Storage-Bucket (`h5p-content`) kommen, sollten auch die Runtime-Assets aus einer CDN/Storage-Quelle kommen.

### Umsetzung
1. Verzeichnis `public/h5p/` erstellen
2. H5P-Standalone Runtime-Assets hinzufuegen:
   - `frame.bundle.js` (aus h5p-standalone npm package)
   - `styles/h5p.css`
3. Alternative: Assets aus CDN laden (z.B. unpkg.com/h5p-standalone)

### Technische Details
```text
public/
  h5p/
    frame.bundle.js     <- von node_modules/h5p-standalone/dist/
    styles/
      h5p.css           <- von node_modules/h5p-standalone/dist/
```

Oder H5PPlayer.tsx anpassen fuer CDN-Pfade:
```typescript
const h5pInstance = new H5P(containerRef.current, {
  h5pJsonPath: contentUrl,
  frameJs: 'https://unpkg.com/h5p-standalone@3.8.0/dist/frame.bundle.js',
  frameCss: 'https://unpkg.com/h5p-standalone@3.8.0/dist/styles/h5p.css',
});
```

---

## Phase 2: Mini-Check Implementierung (P0-B)

### Aktueller Stand
`LessonContent.tsx` zeigt nur einen Platzhalter:
```typescript
if (contentData.type === 'quiz') {
  return (
    <div className="p-6 bg-muted/30 rounded-xl text-center">
      <ClipboardCheck className="..." />
      <p>Quiz-Komponente wird geladen...</p>
    </div>
  );
}
```

### Benoetigte Komponenten

1. **MiniCheckPlayer.tsx** - Hauptkomponente
   - Fragen aus `content.questions[]` laden
   - Single/Multiple Choice UI
   - Antwort-Validierung
   - Feedback mit Erklaerungen

2. **Datenformat fuer Lesson Content**
```typescript
interface MiniCheckContent {
  type: 'mini_check';
  questions: Array<{
    id: string;
    text: string;
    options: Array<{
      id: string;
      text: string;
      is_correct: boolean;
    }>;
    explanation_correct?: string;
    explanation_wrong?: string;
  }>;
  passing_score: number; // z.B. 70
}
```

3. **Persistenz**
   - Beim Abschluss: `update_lesson_outcome(lesson_id, score_percent)` aufrufen
   - Nutzt die bereits erstellte RPC

4. **UI-Flow**
```text
Frage 1/5
[Frage-Text]

[ ] Option A
[x] Option B  <- ausgewaehlt
[ ] Option C

[Antwort pruefen]

--- nach Antwort ---

[Richtig/Falsch Badge]
[Erklaerung]

[Naechste Frage] / [Ergebnis anzeigen]
```

---

## Phase 3: Kurs-Navigation (P1-A)

### Problem
In `CourseDetailPage.tsx` (Zeile 383-421) sind Lessons aufgelistet aber nicht anklickbar.

### Loesung
Lesson-Cards klickbar machen mit Navigation zu `/lesson/:id`:

```typescript
<div 
  key={lesson.id}
  onClick={() => !locked && navigate(`/lesson/${lesson.id}`)}
  className={`... ${!locked ? 'cursor-pointer' : ''}`}
>
```

Zusaetzlich: "Fortsetzen" Button mit naechster unvollstaendiger Lesson verknuepfen.

---

## Phase 4: Progress-Komponenten Integration (P1-B)

### Bereits erstellte Komponenten
- `CourseProgressBar.tsx`
- `LessonStatusBadge.tsx`
- `ContinueLearningCard.tsx`
- `LearningGoalFeedback.tsx`

### Integration in CourseDetailPage
- `CourseProgressBar` statt einfacher Progress-Anzeige
- `LessonStatusBadge` bei jeder Lesson
- `ContinueLearningCard` als Hero-Element fuer eingeschriebene Nutzer

### Integration in LessonPlayer
- `LearningGoalFeedback` nach Mini-Check Abschluss zeigen
- Kompetenz-Status visualisieren

---

## Umsetzungsreihenfolge

```text
Schritt 1: H5P Assets (CDN-Ansatz)
   |
   v
Schritt 2: MiniCheckPlayer Komponente
   |
   v
Schritt 3: CourseDetail Navigation
   |
   v
Schritt 4: Progress-Komponenten einbauen
   |
   v
Schritt 5: End-to-End Test
```

---

## Dateiaenderungen

| Datei | Aenderung |
|-------|-----------|
| `src/components/lesson/H5PPlayer.tsx` | CDN-Pfade fuer Runtime-Assets |
| `src/components/lesson/MiniCheckPlayer.tsx` | Neue Komponente |
| `src/components/lesson/LessonContent.tsx` | MiniCheckPlayer einbinden |
| `src/pages/CourseDetailPage.tsx` | Lesson-Klicks + Progress-Komponenten |
| `src/pages/LessonPlayer.tsx` | LearningGoalFeedback einbinden |

---

## Schaetzung

| Phase | Aufwand |
|-------|---------|
| H5P CDN Fix | 1 Nachricht |
| MiniCheck Player | 2-3 Nachrichten |
| Kurs-Navigation | 1 Nachricht |
| Progress-Integration | 1 Nachricht |
| **Gesamt** | **5-6 Nachrichten** |
