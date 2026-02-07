# Job-Modell Dokumentation

## Übersicht

Dieses Dokument definiert das Modell für asynchrone Jobs (Edge Functions) im System.

---

## Aktuelle Edge Functions

### 1. `extract-curriculum`

**Zweck:** Extrahiert strukturierte Daten aus Curriculum-Dokumenten via AI

**Trigger:** Manuell (Admin-UI)

**Input-Schema:**
```typescript
interface ExtractCurriculumInput {
  curriculumId: string;      // UUID - Pflicht
  fileContent: string;       // Text-Inhalt des Dokuments - Pflicht
  fileName: string;          // Original-Dateiname
}
```

**Output-Schema:**
```typescript
interface ExtractCurriculumOutput {
  success: boolean;
  extractedData: {
    title: string;
    description: string;
    version: string;
    learningFields: Array<{
      code: string;
      title: string;
      description: string;
      hours: number;
      competencies: Array<{
        code: string;
        title: string;
        description: string;
        taxonomyLevel: string;
      }>;
    }>;
  };
  curriculumId: string;
}
```

**Fehler-Codes:**
- `400`: Fehlende Pflichtfelder
- `402`: Payment required (Credits)
- `429`: Rate limit exceeded
- `500`: AI-Fehler oder Parse-Fehler

---

### 2. `generate-course`

**Zweck:** Generiert kompletten Kurs mit Modulen und Lessons aus Curriculum

**Trigger:** Manuell (Admin-UI bei Kurs-Erstellung)

**Input-Schema:**
```typescript
interface GenerateCourseInput {
  courseId: string;          // UUID - Pflicht
  curriculumId: string;      // UUID - Pflicht
  title: string;
  description: string;
}
```

**Prozess:**
1. Kurs-Status → `generating`
2. Lade Learning Fields + Competencies
3. Erstelle Module (1 pro Learning Field)
4. Erstelle Lessons (5 pro Competency, je Step)
5. Generiere AI-Content für jede Lesson
6. Kurs-Status → `draft`

**Output-Schema:**
```typescript
interface GenerateCourseOutput {
  success: boolean;
  courseId: string;
  modulesCreated: number;
  totalDuration: number;      // in Minuten
}
```

---

### 3. `generate-questions`

**Zweck:** Generiert Prüfungsfragen für eine Kompetenz via AI

**Trigger:** Manuell (Admin-UI)

**Input-Schema:**
```typescript
interface GenerateQuestionsInput {
  competencyId: string;           // UUID - Pflicht
  competencyTitle: string;        // Pflicht
  competencyDescription?: string;
  learningFieldTitle: string;     // Pflicht
  count?: number;                 // Default: 3
  difficulty?: 'easy' | 'medium' | 'hard';  // Default: 'medium'
}
```

**Output-Schema:**
```typescript
interface GenerateQuestionsOutput {
  success: boolean;
  questions: Array<{
    question_text: string;
    options: string[];           // Genau 4 Optionen
    correct_answer: number;      // Index 0-3
    explanation: string;
    difficulty: string;
    competency_id: string;
    ai_generated: boolean;
    status: 'draft';
  }>;
}
```

---

### 4. `unzip-file`

**Zweck:** Entpackt ZIP-Dateien (z.B. H5P-Pakete)

**Trigger:** Nach File-Upload

**Input-Schema:**
```typescript
interface UnzipFileInput {
  bucket: string;
  path: string;
  destinationPath: string;
}
```

---

## Job-Status-Tracking

### Curriculum-Status
```typescript
type CurriculumStatus = 'draft' | 'extracting' | 'normalizing' | 'frozen';
```

### Kurs-Status
```typescript
type CourseStatus = 'draft' | 'generating' | 'published' | 'archived';
```

### Fragen-Status
```typescript
type QuestionStatus = 'draft' | 'review' | 'approved' | 'rejected';
```

---

## Error-Handling-Konventionen

### Standard-Response bei Erfolg:
```json
{
  "success": true,
  "data": { ... }
}
```

### Standard-Response bei Fehler:
```json
{
  "error": "Beschreibung des Fehlers"
}
```

### HTTP Status Codes:
| Code | Bedeutung                    |
|------|------------------------------|
| 200  | Erfolg                       |
| 400  | Validierungsfehler           |
| 401  | Nicht authentifiziert        |
| 402  | Credits/Payment erforderlich |
| 429  | Rate Limit erreicht          |
| 500  | Server-/AI-Fehler            |

---

## Geplante Erweiterungen

### Future: Job-Queue-System
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Job Queue  │ ──► │   Worker    │ ──► │   Result    │
│  (Tabelle)  │     │  (Function) │     │  (Callback) │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Geplante Tabelle:**
```sql
CREATE TABLE job_queue (
  id UUID PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

---

## Contract-Tests (Empfohlen)

Für jeden Job sollten Contract-Tests existieren:

```typescript
// Beispiel: generate-questions.contract.test.ts
describe('generate-questions contract', () => {
  it('should require competencyId', () => {
    const input = { /* missing competencyId */ };
    expect(validateInput(input)).toThrow();
  });
  
  it('should return exactly 4 options per question', () => {
    const output = mockGenerateQuestions(validInput);
    output.questions.forEach(q => {
      expect(q.options).toHaveLength(4);
    });
  });
});
```

---

## Änderungs-Protokoll

| Datum      | Änderung                        | Autor  |
|------------|---------------------------------|--------|
| 2025-02-07 | Initiale Job-Dokumentation      | System |
