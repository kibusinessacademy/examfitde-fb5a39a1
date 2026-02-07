# Single Source of Truth (SSOT) Dokumentation

## Grundprinzip

**Ein Datum, eine Quelle, eine Wahrheit.**

Jede Information im System hat genau eine autoritative Quelle. Alle anderen Stellen leiten davon ab.

---

## SSOT-Definitionen

### 1. Curriculum (Rahmenlehrplan)

**Quelle:** `curricula` Tabelle + `learning_fields` + `competencies`

```
curricula (FROZEN)
    └── learning_fields
            └── competencies
```

**Regeln:**
- Ein Curriculum durchläuft: `draft` → `extracting` → `normalizing` → `frozen`
- Nach `frozen`: **KEINE Änderungen mehr erlaubt**
- `frozen_at` Timestamp dokumentiert den Freeze-Zeitpunkt
- Alle abhängigen Entitäten (Kurse, Fragen) referenzieren das gefrorene Curriculum

**Warum:**
- Kurse und Prüfungsfragen basieren auf Kompetenzen
- Nachträgliche Änderungen würden Inkonsistenzen erzeugen
- Audit-Trail bleibt intakt

---

### 2. Kurse & Module

**Quelle:** `courses` → `modules` → `lessons`

```
courses
    └── modules (1 pro learning_field)
            └── lessons (5 pro competency)
```

**Regeln:**
- Ein Kurs gehört zu genau einem Curriculum (`curriculum_id`)
- Module referenzieren Learning Fields (`learning_field_id`)
- Lessons referenzieren Competencies (`competency_id`)
- Lesson-Steps folgen der 5-Schritte-Didaktik

**5-Schritte-Didaktik (SSOT):**
```typescript
const LESSON_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'];
```

---

### 3. Prüfungsfragen

**Quelle:** `exam_questions` Tabelle

**Regeln:**
- Jede Frage gehört zu einem Curriculum (`curriculum_id`)
- Optional: Zuordnung zu Learning Field und/oder Competency
- Status-Workflow: `draft` → `review` → `approved` | `rejected`
- Nur `approved` Fragen erscheinen im Prüfungstrainer

**Schwierigkeitsgrade (SSOT):**
```typescript
const DIFFICULTIES = ['easy', 'medium', 'hard'];
```

---

### 4. User & Rollen

**Quelle:** `auth.users` (Supabase Auth) + `user_roles` + `profiles`

```
auth.users (managed by Supabase)
    └── user_roles (role assignment)
    └── profiles (additional user data)
```

**Regeln:**
- `auth.users` wird von Supabase verwaltet - niemals direkt ändern
- `profiles` speichert UI-relevante Daten (Name, Avatar)
- `user_roles` definiert Berechtigungen

**Rollen (SSOT):**
```typescript
const ROLES = ['admin', 'teacher', 'learner'];
```

---

### 5. Lernfortschritt

**Quelle:** `learning_progress` + `course_enrollments` + `exam_attempts`

**Regeln:**
- `course_enrollments`: User → Kurs Zuordnung
- `learning_progress`: Fortschritt pro Lesson
- `exam_attempts`: Prüfungsversuche mit Antworten

---

## Datenfluss-Diagramm

```
┌──────────────────┐
│  PDF/Dokument    │  ← Upload
└────────┬─────────┘
         ▼
┌──────────────────┐
│  extract-curriculum │  ← AI-Extraktion
└────────┬─────────┘
         ▼
┌──────────────────┐
│  curricula       │  ← SSOT (nach Freeze)
│  (frozen)        │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌───────────┐
│courses│  │exam_questions│
└───────┘  └───────────┘
```

---

## Änderungs-Protokoll

| Datum      | Änderung                          | Autor  |
|------------|-----------------------------------|--------|
| 2025-02-07 | Initiale SSOT-Dokumentation       | System |

---

## Anti-Patterns (VERBOTEN)

❌ Curriculum-Daten nach Freeze ändern
❌ Lesson-Steps außerhalb der 5-Schritte-Didaktik
❌ Fragen ohne Curriculum-Referenz
❌ Direkte Manipulation von `auth.users`
❌ Hardcoded IDs statt Referenzen
❌ Duplizierte Wahrheiten (z.B. Kompetenz-Titel in Lesson kopieren)
