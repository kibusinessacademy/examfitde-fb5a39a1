# Plan — Occupational Intelligence Bridge v1

**Strategischer Cut:** Curricula sind nicht Lerncontent, sondern strukturierte Berufs-DNA. Wir bauen **keine** neue SSOT — wir verbrücken die fünf bereits existierenden Schichten zu den 11 Verticals.

## Recon-Befund (entscheidend für die Architektur)

Die Plattform hat bereits zwei tiefe, aber **entkoppelte** Schichten:

```text
Lern-SSOT:   curricula → learning_fields → competencies → exam_questions
                ↑
                beruf_id → berufe (BIBB)
                ↑
             certification_catalog (slug, chamber_type, recognition_type)

Vertikal-SSOT: vertical_dna (industry_key, roles[], kpis, risks, sops, pain_points)
               vertical_subscriptions (vertical_slug — free text, kein FK)
               verticals.ts (11 Slugs, reiner Marketing-Content)
```

**5 strukturelle Lücken** (Detail im Recon):
1. `verticals.ts`-Slugs ≠ `vertical_dna.industry_key` (z.B. `verwaltung` vs. `public_admin`)
2. `vertical_dna` fehlen 3 Verticals komplett: `steuer`, `notar`, `kanzlei`
3. Kein Mapping `certification_catalog ↔ vertical_slug` (heute nur implizit im Slug)
4. `vertical_subscriptions.vertical_slug` ohne CHECK/FK — Drift-Risiko
5. `curricula → vertical` Pfad existiert nicht (auch nicht transitiv)

## Anti-Drift-Leitplanken (aus Architectural Continuity Guard)

- **EXTEND_EXISTING**: erweitern via Spalten/JSON, nicht via neue Tabellen.
- **BRIDGE_DONT_FORK**: Aggregation in **View + RPC**, niemals zweite Wahrheit.
- **NO_PARALLEL_SYSTEMS**: `verticals.ts` bleibt Marketing-Content; die Wahrheit lebt in DB.
- **SSOT_FIRST**: `vertical_dna` ist und bleibt die DNA-SSOT; `certification_catalog` bleibt Zertifikats-SSOT.

## Cut-Scope (eine Migration = ein Concern, gestaffelt)

### Migration 1 — SSOT-Normalisierung
- `vertical_dna`: Spalte `vertical_slug TEXT` hinzufügen + Backfill aus `industry_key` über deterministisches Mapping. Trigger immutable. Unique-Index.
- 3 fehlende Verticals seeden: `steuer`, `notar`, `kanzlei` mit `roles[]`/`kpis`/`risks`/`sops`/`pain_points` (Recon-Vorlage).
- `vertical_subscriptions`: CHECK-Constraint `vertical_slug IN (...11 known slugs)` — Schutz vor Free-Text-Drift.
- `certification_catalog`: Spalte `vertical_slugs TEXT[]` hinzufügen (mehrere Verticals pro Cert möglich, z.B. SHK-Meister → handwerk).
- Backfill `vertical_slugs` aus bestehenden `slug`-Patterns (deterministisches Mapping).

### Migration 2 — Bridge-View + RPC (read-only, SECURITY DEFINER)
- View `v_vertical_occupational_intelligence`:
  ```text
  per vertical_slug:
    dna_roles[], dna_kpis, dna_risks, dna_sops, dna_pain_points
    cert_count, cert_slugs[]
    curricula_count
    learning_fields_count
    competencies_count
    blueprint_count
    coverage_score (deterministisch aus oben)
  ```
- RPC `get_vertical_occupational_dna(vertical_slug TEXT)`:
  - returns `JSONB` mit allen 5 Schichten (DNA + Certs + Curricula + Learning Fields + Competencies sample)
  - SECURITY DEFINER, public-readable (Marketing-Page-Use-Case)
  - Aggregiert max 200 Kompetenzen für UI-Snapshot.
- Governance-SSOT-Eintrag: `vertical_dna`, `certification_catalog`, `curricula` in `known-systems.ts` als SSOT registrieren (fehlten — Recon-Befund).

### Migration 3 — Audit-Contract
- `ops_audit_contract` Eintrag: `occupational_intelligence_view_accessed` für spätere Telemetry (jetzt noch nicht aktiv genutzt).

### Code-Layer (kein neuer Parallel-Pfad)
- `src/lib/berufs-ki/occupational-intelligence.ts`: dünner Reader, ruft NUR `get_vertical_occupational_dna` RPC. Kein Hardcode.
- `src/data/verticals.ts`: Marketing-Content bleibt, bekommt aber **`industryKey`-Feld** für Eindeutigkeit zur DB-DNA (Bridge-Identifier, kein Datenduplikat).
- `VerticalDetailPage` (`src/pages/verticals/VerticalDetailPage.tsx`): neue Sektion **"Strukturierte Berufs-DNA"** zwischen Pain Points und Workflows:
  - Rollen (aus DNA, fallback verticals.ts)
  - Lernfelder-Count + Kompetenzen-Count + Cert-Count (aus Bridge)
  - Top-5 typische Risiken (aus DNA)
  - Top-3 KPIs (aus DNA)
  - Badge: "Basiert auf X Curricula, Y Lernfeldern, Z Kompetenzen aus IHK/HWK-Lehrplänen"
- Sprache strikt: "Strukturierte Berufsintelligenz" — niemals "AI-powered" / "agents" / "unlimited".

### Smoke-Test-Erweiterung
- `scripts/berufos-vertical-packaging-smoke.mjs` erweitern (oder neuer `scripts/berufos-occupational-intelligence-smoke.mjs`):
  - View liefert für alle 11 Slugs Zeilen.
  - RPC für `praxis`, `steuer`, `handwerk` liefert non-null DNA.
  - Keine Slug-Drift zwischen `verticals.ts.industryKey` und `vertical_dna.vertical_slug`.
  - `vertical_subscriptions.vertical_slug` CHECK aktiv.
  - UX-Drift-Guard: Begriff "AI-powered/agents" weiterhin abwesend, aber **neu**: "strukturierte Berufsintelligenz" / "Lernfeld" / "Kompetenz" auf Detail-Page sichtbar.

### Memory-Freeze
- Neue Memory-Datei `mem://features/berufs-ki/occupational-intelligence-bridge-v1.md`
- Index aktualisieren mit FROZEN-Eintrag inkl. SSOT-Liste, Anti-Drift-Regeln, Bridge-Identifier-Vertrag.

## Was NICHT gebaut wird (explizit)

- ❌ Keine neue Tabelle `vertical_curriculum_map` (würde NO_PARALLEL_SYSTEMS verletzen).
- ❌ Keine Duplikation der DNA in `verticals.ts` (Marketing bleibt Marketing, DB bleibt Wahrheit).
- ❌ Keine AI-Generierung von DNA in diesem Cut — wir nutzen, was existiert. AI-Augmentation der DNA ist eigene Stufe.
- ❌ Keine Mutation an `curricula`/`learning_fields`/`competencies`/`exam_questions` — nur read-only Bridge.
- ❌ Keine neue Auth/RLS-Logik — Bridge ist public-read über RPC (Marketing-Use-Case).
- ❌ Kein neues Pricing, kein neues Stripe-Produkt, kein Touch an `vertical_subscriptions`-Logik (außer CHECK).

## DoD (Definition of Done)

- ✅ Migration 1 + 2 + 3 applied, lint clean.
- ✅ 11/11 Verticals haben `vertical_dna`-Row mit konsistentem `vertical_slug`.
- ✅ View liefert für alle 11 Slugs konsistente Counts.
- ✅ RPC liefert vollständige DNA-Bundle für jeden Slug.
- ✅ VerticalDetailPage zeigt echte Lernfeld-/Kompetenz-/Cert-Counts (kein Hardcode).
- ✅ Smoke-Test grün (Routes, DNA-Bridge, Slug-Konsistenz, UX-Sprache, CHECK).
- ✅ `known-systems.ts` enthält die 3 nachzutragenden SSOTs.
- ✅ Memory-Index + Memory-File FROZEN.

## Nach Freeze — explizit nicht jetzt

- **Stufe 2**: AI-Augmentation der DNA (Prozesse/Dokumente/Kommunikationsmuster aus Curricula extrahieren).
- **Stufe 3**: Persona Simulation auf echter DNA statt synthetischer Inputs.
- **Stufe 4**: Daily Brief + Outcome Intelligence ziehen DNA über die Bridge — kein Direct-Read auf curricula.

---

**Freigabe-Frage:** Soll ich genau in dieser Reihenfolge (Migration 1 → 2 → 3 → Code → Smoke → Memory) ausrollen, oder willst du den Scope vor Start noch enger ziehen (z.B. nur Migration 1 + View, RPC + UI später)?