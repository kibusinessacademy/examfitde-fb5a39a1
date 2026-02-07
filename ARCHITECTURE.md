# H5P Learning Hub – Architecture

## Core Principles

- **GitHub is the Single Source of Truth (SSOT)** for all code
- **No implicit schema changes** – all DB changes via SQL migrations only
- **No business logic in UI** – Frontend is stateless, reads only
- **Jobs are state-driven** (`pending` → `processing` → `completed` | `failed`)
- **Lovable builds, but does not decide architecture**

---

## Frontend

| Aspect | Rule |
|--------|------|
| Framework | React / Vite / TypeScript |
| State | UI is stateless – no local business logic |
| Data | Reads via Supabase Client / Edge Functions |
| Writes | No direct DB writes for critical logic |
| Styling | Tailwind CSS + shadcn/ui + semantic tokens |

### Folder Structure
```
src/
├── components/       # UI components (stateless)
│   ├── ui/          # shadcn/ui base components
│   ├── layout/      # Layout wrappers
│   ├── lesson/      # Lesson Player components
│   └── auth/        # Auth components
├── pages/           # Route pages
│   └── admin/       # Admin area
├── routes/          # Routing config
├── hooks/           # React hooks (no business logic)
├── lib/             # Pure utilities
└── integrations/    # Auto-generated (DO NOT EDIT)
```

---

## Backend

| Aspect | Rule |
|--------|------|
| Database | PostgreSQL (Lovable Cloud) |
| Schema Changes | **Only via SQL migrations** in `supabase/migrations/` |
| Edge Functions | Thin orchestrators – validate, call AI, persist |
| Auth | Supabase Auth with RLS policies |
| Storage | Supabase Storage (curriculum-files, h5p-content, course-media) |

### Edge Functions
```
supabase/functions/
├── extract-curriculum/   # AI curriculum extraction
├── generate-course/      # AI course generation
├── generate-questions/   # AI question generation
└── unzip-file/          # ZIP extraction for H5P
```

---

## Job System

### Job Queue Schema (Authoritative)
```typescript
interface Job {
  id: string;              // UUID - mandatory
  job_type: string;        // e.g., 'extract_curriculum', 'generate_course'
  status: JobStatus;       // 'pending' | 'processing' | 'completed' | 'failed'
  payload: object;         // Validated JSON payload
  curriculum_id: string;   // UUID - MANDATORY (no slugs!)
  attempts: number;
  max_attempts: number;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
```

### Job State Machine
```
┌─────────┐     ┌────────────┐     ┌───────────┐
│ pending │ ──► │ processing │ ──► │ completed │
└─────────┘     └──────┬─────┘     └───────────┘
                       │
                       ▼
                 ┌──────────┐
                 │  failed  │
                 └──────────┘
```

---

## Data Model Hierarchy

```
curricula (FROZEN after approval)
    └── learning_fields
            └── competencies
                    ├── lessons (5-step didactic)
                    └── exam_questions
```

### Status Enums
```typescript
// Curriculum lifecycle
type CurriculumStatus = 'draft' | 'extracting' | 'normalizing' | 'frozen';

// Course lifecycle
type CourseStatus = 'draft' | 'generating' | 'published' | 'archived';

// Question review workflow
type QuestionStatus = 'draft' | 'review' | 'approved' | 'rejected';

// Lesson didactic steps (FIXED ORDER)
type LessonStep = 'einstieg' | 'verstehen' | 'anwenden' | 'wiederholen' | 'mini_check';
```

---

## Roles & Permissions

| Role | Access |
|------|--------|
| `admin` | Full access to all admin functions |
| `teacher` | Course management, question review |
| `learner` | Enroll courses, take exams, track progress |

---

## FORBIDDEN ❌

These patterns are **explicitly banned** and Lovable must never use them:

| Anti-Pattern | Reason |
|--------------|--------|
| `curriculum.slug` | Use `curriculum_id` (UUID) only |
| `profession_slug` in jobs | Jobs reference by UUID, not slugs |
| Direct DB writes in UI | All writes via Edge Functions or controlled mutations |
| Modifying `auth.users` | Managed by Supabase |
| Schema changes without migration | All changes via `supabase/migrations/` |
| Editing `src/integrations/supabase/*` | Auto-generated files |
| Editing `.env` directly | Managed by Lovable Cloud |
| Business logic in React components | Keep UI stateless |
| Hardcoded IDs | Use references and foreign keys |

---

## File Ownership

| File/Folder | Owner | Editable |
|-------------|-------|----------|
| `src/integrations/supabase/` | System | ❌ Never |
| `supabase/migrations/` | System | ❌ Read-only |
| `.env` | System | ❌ Never |
| `supabase/config.toml` | System | ❌ Never |
| `src/components/` | Developer | ✅ Yes |
| `src/pages/` | Developer | ✅ Yes |
| `supabase/functions/` | Developer | ✅ Yes |
| `ARCHITECTURE.md` | Developer | ✅ Yes |
| `SSOT.md` | Developer | ✅ Yes |
| `JOB_MODEL.md` | Developer | ✅ Yes |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-02-07 | Initial architecture documentation | System |
| 2025-02-07 | Added forbidden patterns and strict rules | System |
