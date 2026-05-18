---
name: ExamFit Category Claim, Market Gap, Rollout Sequence & Anti-Drift Guardrails
description: Strategic SSOT after S1 Recon (2026-05-18). Locks the product category, the validated market gap, the hard rollout sequence R1→R4 before any S2/S3 intelligence layer, and the anti-drift topic blocklist. Binding for product, funnel, SEO, B2B and growth roadmap.
type: feature
---

## Why this memory exists

Phase S1 Recon (read-only Semrush, competitor funnel deep-dive 2026-05-18) produced three findings strong enough to act as **strategic guardrails** — not operational details:

1. ExamFit is structurally a different category than Plakos / Ausbildungspark / Testhelden / Prozubi / U-Form.
2. The IHK final-exam segment is funnel-weak in the market — a real window exists.
3. Building S2/S3 (Semrush persistence, Opportunity Score, adaptive E3e signal) **before** R1–R4 are live = building intelligence on top of a domain that doesn't exist to external systems.

These are now hard rules. They protect against the typical drift modes observed in the recon competitors:
vorschnelles S2/S3, generische SEO-Expansion, falsche Konkurrenzvergleiche, „mehr Content"-Bias, Funnel-Verwässerung, Off-Topic-Traffic-Jagd, Brand-Entity-Drift.

---

## 1) Category Claim (binding)

> ExamFit is **not** another *Test-Trainer* or *Prüfungsfragen-Portal*.
> ExamFit is the **first adaptive funnel for IHK-Abschlussprüfungen**:
> SSOT-Lernarchitektur + AI-Tutor (Strict-RAG) + adaptive Simulation +
> Persona-Routing + Readiness-Scoring + B2B Multi-Seat.

- **Peer group (binding)**: Duolingo · UWorld · Brilliant · DataCamp.
- **NOT the peer group**: Plakos · Ausbildungspark · Testhelden · Prozubi · U-Form · Stark · simpleclub.
- **Optimization axes (in this order)**: diagnostische Präzision → Lernfortschritt → Prüfungsreife → adaptive Konversion → Wiederkehr. Reichweite, Content-Menge und generische Brand-Awareness sind **nachgelagert**.

Every product, funnel, SEO, B2B and growth decision MUST be checked against this claim. If a feature only makes sense for the *Plakos peer group*, it does not belong in ExamFit.

---

## 2) Market-Gap Thesis (validated 2026-05-18)

- Core IHK head terms show surprisingly **low KDI** (Semrush 2026-05-18):
  `fachinformatiker prüfung` KDI 8, `aevo prüfungsfragen` KDI 16,
  `mündliche prüfung ihk` KDI 25.
- Funnel-strong competitors (Plakos/Ausbildungspark/Testhelden) **dominate pre-Ausbildung**
  (IQ-Tests, Eignungstests, Bewerbung, Bundeswehr/Polizei) — and have **<2–5% presence**
  in the IHK final-exam segment.
- Funnel-weak competitors (Prozubi/U-Form) carry 40–72% brand traffic, no real funnel,
  no adaptivity, no SSOT, no Tutor, no Readiness.
- ExamFit ships the structurally superior model
  (SSOT + Tutor + Simulation + Persona + Readiness + B2B).

→ **Window**: dominant niche-platform position in IHK-Abschlussprüfungen, B2C + B2B,
**provided the rollout order below is respected**.

---

## 3) Rollout Sequence (HARD — architecture-validated)

This is no longer a suggestion. It is an **architecture dependency**:
each phase produces the substrate the next phase needs to measure itself.
Skipping ahead = persisting noise as SSOT.

```text
R1  Existenz / Infrastruktur
    └─ Custom Domain live (examfit.de canonical, www → apex 301)
    └─ Per-Route HTML (CF Pages / Vercel — Lovable SPA-fallback blocks indexing)
    └─ robots.txt + sitemap.xml + canonical drift = 0
    └─ GSC + Bing WMT property verified, sitemap submitted
    └─ Indexierbarkeit messbar (initial-html-smoke green)

R2  Funnel Entrypoints
    └─ Notenrechner, Mini-Simulation, Year-Pages, Themen-PDFs
    └─ Tool-as-Magnet, Quiz-with-Email-Wall, persona-routed CTAs
    └─ jeder Asset MUSS cluster_id + persona + funnel_stage tragen

R3  Adaptive Conversion Engine
    └─ Persona × Curriculum × Readiness → CTA-Personalisierung
    └─ Email-Sequenzen B + CRM-Lead-Scoring vollständig verkabelt
    └─ Conversion-Events.v2 als alleinige Funnel-SSOT

R4  B2B Dominanz
    └─ Multi-Seat-Templates (channel_policy_json), Org-Onboarding,
       Reporting für Ausbildungsleitung, Track-Bundling (AUSBILDUNG_VOLL)

────────── HARD GATE ──────────
Erst wenn R1–R4 live + messbar:

S2  Semrush-SSOT-Persistenz (growth_semrush_keyword_metrics, sync-edge-fn)
S3  Opportunity Score → adaptive E3e Signal, Competitive Intelligence Layer
```

**Begründung**: Solange Phase R1 nicht abgeschlossen ist, sieht Semrush 0 Keywords für ExamFit (AS=52 = Lovable-Pool-Noise). Eine S2-Schicht würde Rauschen als Wahrheit persistieren. Cross-Ref: `mem://constraints/custom-domain-prerequisite-for-seo-intelligence-v1`.

---

## 4) Anti-Drift Topic Blocklist (binding until R4 abgeschlossen)

Diese Themen sind in **Content, SEO-Clustern, Funnel-Entrypoints, Bridges, Pillar/Spoke, Tutor-Antworten, Marketing-Copy** verboten — sie würden exakt die Brand-Verwässerung erzeugen, die wir bei Plakos/Ausbildungspark sehen:

| Verboten | Warum |
|---|---|
| IQ-Tests / Eignungstests | Pre-Ausbildung-Markt, falsche Peer-Group |
| Bundeswehr / Polizei / Zoll / Feuerwehr | Off-Topic, Brand-Drift, falscher Funnel |
| Bewerbung / Anschreiben / Vorstellungsgespräch | Pre-Ausbildung, kein IHK-Prüfungsbezug |
| Generische Listicles („Die 10 besten Lern-Apps") | Brand-Entity-Drift, AI-Citation-Verwässerung |
| Breit gestreute Utility-SEO (Notenschlüssel-allgemein, Schulnoten) | nur erlaubt wenn IHK-Kontextualisiert |
| Schüler-Hilfen, Abi-Vorbereitung, Studienwahl | falsche Persona, falsche Stage |
| Allgemeine Mathematik/Deutsch-Trainer | nicht Prüfungs-spezifisch |

Ausnahme nur, wenn ein Asset **explizit IHK-Abschlussprüfungs-kontextualisiert** ist UND `cluster_id + persona + funnel_stage` führt UND eine direkte Brücke in einen R2/R3-Entrypoint besteht.

---

## 5) What this memory enforces in practice

- **Produktentscheidungen**: Features werden gegen die Peer-Group Duolingo/UWorld/Brilliant geprüft, nicht gegen Plakos/Prozubi.
- **Funnel-Strategie**: R2-Entrypoints sind diagnostisch (Mini-Sim, Readiness-Probe), nicht volumengetrieben (IQ-Quiz).
- **SEO-Roadmap**: Keine neuen Cluster außerhalb IHK-Abschlussprüfungen. Bridge-/Pillar-Promotion respektiert Anti-Drift-Liste.
- **B2B-Priorisierung**: Track 6 (B2B) kommt nach R1–R3, aber **vor** S2/S3-Intelligence-Layer.
- **Growth-Mechaniken**: Habit-Loops, Streaks, Re-Entry orientieren sich an Duolingo-Mechanik, nicht an Plakos-Reichweiten-Mechanik.

---

## Cross-Refs

- S1 Recon Report: `/mnt/documents/s1-semrush-recon-2026-05-18.md`
- Competitor Deep-Dive: `/mnt/documents/s1-competitor-funnel-deepdive-2026-05-18.md`
- External-SEO-Intelligence Gate: `mem://constraints/custom-domain-prerequisite-for-seo-intelligence-v1`
- Hosting-Constraint: `mem://architektur/seo/hosting-spa-fallback-blocks-prerender-v1`
- Sitemap-Only-Mode: `mem://architektur/seo/sitemap-only-mode-for-db-routes-v1`
- Production Architecture v2: `mem://architektur/seo/production-architecture-v2-vercel-prerender-llm-visibility`
- Architecture Freeze (Tracks 1–6): `mem://constraints/architecture-freeze-post-bridge-16-v1`
- Growth-OS Framework: `mem://constraints/growth-os-framework-v1`
- Migration runbooks: `docs/runbooks/cloudflare-pages-migration.md`, `docs/runbooks/vercel-migration.md`
