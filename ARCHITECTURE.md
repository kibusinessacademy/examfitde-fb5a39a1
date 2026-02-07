# Architektur-Dokumentation

## Übersicht

Diese Plattform ist eine produktive Lern- & Prüfungsplattform mit:
- **H5P-Integration** für interaktive Lerninhalte
- **AI-gestützte Generierung** von Kursen und Prüfungsfragen
- **Curriculum-SSOT** als zentrale Datenquelle
- **Admin-Dashboards** für Content-Management
- **Prüfungstrainer** mit adaptiver Logik

## Tech Stack

```
Frontend:        React + Vite + TypeScript + Tailwind CSS + shadcn/ui
Backend:         Lovable Cloud (Supabase)
Database:        PostgreSQL
Edge Functions:  Deno (Supabase Edge Functions)
AI Gateway:      Lovable AI Gateway
Authentication:  Supabase Auth (Email + Roles)
Storage:         Supabase Storage (H5P-Content, Uploads)
```

## Architektur-Prinzipien

### 1. GitHub = Single Source of Truth (Code)
- **Alle Code-Änderungen müssen committed sein**
- Lovable darf UI bauen, aber Architekturentscheidungen werden explizit dokumentiert
- Rollbacks erfolgen über Git-History

### 2. Datenbank-Änderungen nur via Migrations
- Alle Schema-Änderungen über `supabase/migrations/`
- Keine "magischen" DB-Änderungen ohne Review
- Migrations sind versioniert und rollback-fähig

### 3. Edge Functions für Business-Logik
- AI-intensive Aufgaben in Edge Functions
- Keine sensible Logik im Frontend
- Alle Functions in `supabase/functions/`

### 4. Strikte Trennung: UI vs. Business-Logik
- Frontend: Präsentation + User Interaction
- Backend: Validierung + Geschäftsregeln + AI-Calls
- UI liest Daten, manipuliert sie nicht direkt

## Systemkomponenten

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
├─────────────────────────────────────────────────────────────┤
│  Public Pages    │  Learner Area      │  Admin Area         │
│  - Home          │  - Dashboard       │  - Curricula        │
│  - Courses       │  - Lesson Player   │  - Courses          │
│  - Auth          │  - Exam Trainer    │  - Questions        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTIONS                            │
├─────────────────────────────────────────────────────────────┤
│  extract-curriculum  │  generate-course  │  generate-questions│
│  unzip-file          │  (future jobs)    │                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      DATABASE                                │
├─────────────────────────────────────────────────────────────┤
│  curricula          │  courses           │  exam_questions   │
│  learning_fields    │  modules           │  exam_attempts    │
│  competencies       │  lessons           │  learning_progress│
│  profiles           │  user_roles        │  course_enrollments│
└─────────────────────────────────────────────────────────────┘
```

## Rollen & Berechtigungen

| Rolle    | Beschreibung                              |
|----------|-------------------------------------------|
| admin    | Vollzugriff auf alle Admin-Funktionen     |
| teacher  | Kurs-Management, Fragen-Review            |
| learner  | Kurse belegen, Prüfungen absolvieren      |

## Ordnerstruktur

```
/
├── src/
│   ├── components/       # UI-Komponenten
│   │   ├── ui/          # shadcn/ui Basis-Komponenten
│   │   ├── layout/      # Layout-Komponenten
│   │   ├── lesson/      # Lesson Player Komponenten
│   │   └── auth/        # Auth-bezogene Komponenten
│   ├── pages/           # Seiten-Komponenten
│   │   └── admin/       # Admin-Bereich
│   ├── routes/          # Routing-Konfiguration
│   ├── hooks/           # Custom React Hooks
│   ├── lib/             # Utilities
│   └── integrations/    # Externe Integrationen (auto-generated)
├── supabase/
│   ├── functions/       # Edge Functions
│   ├── migrations/      # SQL Migrations (READ-ONLY)
│   └── config.toml      # Supabase Config
├── ARCHITECTURE.md      # Diese Datei
├── SSOT.md             # Single Source of Truth Dokumentation
└── JOB_MODEL.md        # Job/Queue Modell
```

## Entwicklungs-Workflow

1. **Feature-Planung**: Architektur-Impact prüfen
2. **Lovable**: UI-Entwicklung + kontrollierte Edge Functions
3. **GitHub**: Review + Commit + Versionierung
4. **Testing**: Preview-Umgebung validieren
5. **Deploy**: Publish nach Freigabe

## Sicherheits-Richtlinien

- RLS-Policies auf allen Tabellen mit User-Daten
- JWT-Validierung in Edge Functions
- Keine API-Keys im Frontend-Code
- Secrets nur über Lovable Cloud Secrets
