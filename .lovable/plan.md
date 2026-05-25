## Ziel

Berufs-KI wird **eigenständige Produktlinie** neben ExamFit. Kein „Prompt-Sammlung", kein Chatbot — sondern **berufsspezifische KI-Workflows** auf bestehender ExamFit-SSOT (Curricula · Lernfelder · Kompetenzen · Blueprints).

Positionierung: **„Die KI kennt deinen Beruf."**

---

## Bestandsaufnahme (was bereits existiert — wird wiederverwendet)

- `/work/*` Surface (`WorkHomePage`, `WorkBuyPage`, `WorkCorporatePage`, `WorkSuccessPage`) — bestehender Public-Funnel.
- `src/pages/berufski/Berufs**KI**…Page.tsx` (Buy / Bundle / Corporate / Success) — Checkout-Stubs gegen `berufski-checkout` Edge.
- `/berufski/*` ist 410 Gone (Legacy-Redirect via `WorkGonePage`).
- Brand-SSOT (`src/lib/brand/ssot.ts`) erkennt schon `berufski` / `examfit@work`.
- **Riesiges Asset**: `course_packages`, `learning_fields`, `competencies`, `blueprint_*` (15+ Tabellen) — vollständige berufsspezifische Wissensbasis.
- Lovable AI Gateway ist verfügbar (kein Custom-Key).

**Lücke**: Es gibt **kein eigenständiges Berufs-KI-Produkt**. Die `berufski/*`-Pages sind reine Checkouts ohne Produkterlebnis. Das Wissen aus Lernfeldern/Kompetenzen wird nicht in Workflows transformiert.

---

## Strategische Entscheidungen

1. **Naming-Cleanup**: alles User-Facing als „Berufs-KI". Code-Identifier `berufski` (legacy, in `WorkGonePage`-Trail) bleiben aus Stabilität — nur sichtbarer Text + neue Module nutzen `berufs-ki` / `BerufsKI`.
2. **Eigene URL-Spine**: `/berufs-ki` (Marketing-Hub) und `/berufs-ki/app` (Workbench). `/work/*` bleibt B2B-Sales-Funnel — Brücke setzen, nicht ersetzen.
3. **SSOT-Bridge statt Parallel-Welt**: Workflows referenzieren `curriculum_id` + `learning_field_id` + `competency_id` (FK auf bestehende Tabellen). Keine neue Berufs-Taxonomie.
4. **Workflow ≠ Prompt**: jeder Workflow hat strukturierte Inputs → strukturierter Output (Executive Summary · Analyse · Risiken · Folgeaktionen).
5. **Server-side AI**: alle Calls über Edge-Function `berufs-ki-run` → Lovable AI Gateway. Niemals Client-side.

---

## Phasen

### Phase 1 — Foundation & SSOT (DIESER CUT)

**Datenbank** (1 Migration):
- `berufs_ki_workflow_definitions` — SSOT Workflow-Katalog
  - `id`, `slug` (unique), `title`, `description`, `category` (kommunikation/analyse/dokumentation/organisation/fach), `subcategory`
  - `curriculum_id` (FK `course_packages` nullable), `learning_field_id` (nullable), `competency_ids` (uuid[]), `blueprint_refs` (jsonb)
  - `target_roles` (text[]: azubi/fachkraft/ausbilder/teamleiter)
  - `input_schema` (jsonb — Pflicht/Optional + Typen), `output_schema` (jsonb — strukturierte Sektionen)
  - `system_prompt` (text), `user_prompt_template` (text), `model_recommendation` (text default `google/gemini-2.5-pro`)
  - `compliance_level` (enum: standard/sensitive/regulated), `risk_level` (low/medium/high)
  - `tier_required` (enum: free/pro/business), `is_active` (bool), `version` (int)
  - Audit/Timestamps. RLS: public select where `is_active=true`; admin write only via `has_role`.
- `berufs_ki_workflow_runs` — Run-Audit
  - `id`, `workflow_id`, `user_id`, `inputs` (jsonb redacted), `output_text`, `output_structured` (jsonb)
  - `model_used`, `tokens_in`, `tokens_out`, `latency_ms`, `tier_at_run`, `status` (ok/error/blocked), `error_reason`
  - RLS: Owner-only read (`auth.uid() = user_id`); insert via Edge service-role.
- 6 Seed-Workflows als Beweis (1 pro Kategorie, je auf existierendes Curriculum gebunden).

**Edge Function**: `berufs-ki-run`
- Auth via JWT, ownership/tier-gate, ruft Lovable AI Gateway mit `system_prompt` + interpoliertem `user_prompt_template`.
- Rate-Limit (in-DB-Counter pro user/day), 402/429 Pass-Through, Audit-Insert in `berufs_ki_workflow_runs`.

**Frontend SSOT**:
- `src/lib/berufs-ki/types.ts` — `WorkflowDefinition`, `WorkflowInput`, `WorkflowOutput`, `RunResult`.
- `src/lib/berufs-ki/api.ts` — `listWorkflows({ curriculum, role, category })`, `runWorkflow(slug, inputs)`.
- `src/lib/berufs-ki/copy.ts` — SSOT-Tone (analog `os-copy.ts` Muster): Headlines, CTAs, Kategorie-Labels.

**Naming-Cleanup** (User-Facing only):
- Alle sichtbaren „BerufsKI" / „Berufski" → „Berufs-KI" (mit Bindestrich) in: `WorkHomePage`, `BerufsKI*Page` Buttons/Headings, Brand-SSOT `BRAND.name` Display-Variante. Code-Identifier bleiben.

### Phase 2 — Workbench UI (`/berufs-ki/app`)

- `BerufsKIHubPage` (`/berufs-ki`) — Marketing/USP, „Was möchtest du erledigen?"-Einstieg.
- `BerufsKIWorkbenchPage` (`/berufs-ki/app`) — 3-Spalten Layout:
  1. **Beruf-Switcher** (nutzt `useOsBeruf` — bestehende OS-Spine!).
  2. **Workflow-Katalog** gefiltert auf Beruf (Kategorien-Akkordeon).
  3. **Run-Panel**: dynamisches Input-Form aus `input_schema` → strukturierter Output mit Sektionen (Executive Summary, Analyse, Risiken, Folgeaktionen, KPIs).
- `WorkflowRunner` Component (DRY, von Hub + Workbench genutzt).
- History-Drawer (letzte 10 Runs des Users).
- OS-Spine-Integration: `OSCompanionBar` zeigt „Ich öffne deinen Berufs-KI Modus für {Beruf}".

### Phase 3 — Catalog Build-Out

- 30 Workflow-Definitions seeded, gemappt auf Top-10 Curricula:
  - Industriekaufmann · FIAE · FISI · Verkäufer · Mechatroniker · Steuerfachangestellte · AEVO · Bilanzbuchhalter · Hausverwaltung · Vertrieb.
- Pro Beruf 3 Kategorien × ~3 Workflows.
- Admin-UI `/admin/berufs-ki/workflows` (CRUD, hinter `has_role('admin')`).

### Phase 4 — Brücke zu ExamFit & Monetarisierung

- Cross-Sell: nach Prüfungs-Pass → CTA „Weiter mit Berufs-KI im Berufsalltag".
- Tier-Gating an bestehende `entitlements`/`learner_course_grants` koppeln (Bridge, kein Fork).
- B2B Team-Workflows + Corporate-Templates (nutzt `/work/corporate`-Funnel).

---

## Architektur-Diagramm (Phase 1)

```text
            ┌────────────────────────────────────────┐
            │  ExamFit SSOT (existing)               │
            │  course_packages · learning_fields ·   │
            │  competencies · blueprint_*            │
            └────────────────┬───────────────────────┘
                             │ FK references
            ┌────────────────▼───────────────────────┐
            │  berufs_ki_workflow_definitions (NEW)  │
            │  + berufs_ki_workflow_runs (NEW)       │
            └────────────────┬───────────────────────┘
                             │
           ┌─────────────────┴──────────────────┐
           │                                    │
   src/lib/berufs-ki/             supabase/functions/
   (types, api, copy)              berufs-ki-run/
           │                                    │
           └────────────┬───────────────────────┘
                        │
              /berufs-ki  +  /berufs-ki/app
              (Phase 2 UI)
```

---

## Was diese Iteration NICHT macht

- Keine Workbench-UI (Phase 2).
- Keine Memory/Agents/Chains (Phase 3+).
- Keine Tier-Enforcement (Phase 4 — erstmal nur Felder vorbereiten).
- Keine Migration der Legacy-`berufski`-Identifier im Code (Risiko zu hoch, kein User-Nutzen).

---

## Frage an dich

**Phase 1 jetzt durchziehen** (DB-Migration + Edge-Function + Frontend-SSOT + 6 Seed-Workflows + User-Facing-Rename), und Phase 2 (Workbench-UI) im direkten Folge-Cut?

Oder lieber **Phase 1 + 2 in einem Cut** (deutlich größer, ~12 Dateien neu, ~4 geändert, plus Migration + Edge), damit du sofort eine sichtbare Workbench hast?
