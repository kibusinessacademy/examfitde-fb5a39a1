---
name: FördermittelOS Cut 5 — SEO Authority Engine + EU AI Act Transparency
description: Cluster-Builder SSOT (state/topic/industry/combination/antrag/aktuell) + Authority-Score + Gap-Detection + Internal-Link-Engine + EU AI Act Transparenz-Registry abgeleitet aus TrustOS-Contracts.
type: feature
---

## SSOT

`src/lib/foerdermittel/seoAuthority.ts` — pure, deterministisch, client-safe.

- Cluster-Typen: state · topic · industry · size · combination · antrag · aktuell
- Builder: buildStateCluster · buildTopicCluster · buildIndustryCluster · buildCombinationCluster · buildAntragChecklistCluster · buildAktuellCluster
- Scoring: computeSeoAuthorityScore (Programmanzahl × Active-Share × Fresh-Share × Authority-Diversity × Topic-Breadth, clamp 0..100)
- Governance: isThin (≥1 Programm Pflicht, stale-only single = thin), buildClusterMeta gibt robots="noindex,follow" für thin
- Gap-Detection: detectClusterGaps über alle States/Industries/Combinations
- Internal-Link-Engine: recommendInternalLinks (Programme + Topics + States + Industries + Combinations + Antrag-Fallback, dedupe)
- FAQs: buildSeoFaqs (sichtbar im UI, NICHT als JSON-LD — vermeidet GroundedFaqItem-Citation-Contract der Schema-SSOT)
- COMBINATIONS: 3 kuratierte Kombinations-Cluster (digitalisierung-bund-land, energie-beratung-investition, ausbildung-und-weiterbildung)

## EU AI Act Transparenz

`src/lib/foerdermittel/euAiAct.ts` — abgeleitet aus bestehenden Registries:
- 3 AI-Systeme registriert: Fördermittel-CoPilot (limited, LLM), Matching-Engine (minimal, Heuristic), Freshness-Classifier (minimal, Heuristic)
- Jedes System: Modell · Risiko-Tier · Zweckbindungen · Verbotene Nutzungen · Human Oversight · Grounding-Sources · Output-Disclosure · TrustOS-Anker
- summarizeAiAct() für KPI-Strip
- UI: `EuAiActTransparencyCard` auf jeder ClusterPage gemountet

## Routen (additiv, keine Replacements)

- `/foerdermittel/bundesland/:state` (16 Bundesländer + DE/EU)
- `/foerdermittel/branche/:industry` (8 Branchen, INDUSTRY_TOPIC_MAP)
- `/foerdermittel/kombination/:slug`
- `/foerdermittel/antrag/checkliste`
- `/foerdermittel/aktuell`
- Bestehende `/foerdermittel/thema/:topic` bleibt unverändert

## Schema.org

- BreadcrumbList via `@/lib/seo/schema` SSOT-Builder (eingebunden via `JsonLdHead`)
- FAQ nur als sichtbares UI — keine JSON-LD-Injection (vermeidet Citation-Contract der Grounding-Schicht)
- GovernmentService auf Programmseiten bleibt unangetastet
- Kein hand-rolled JSON-LD → `seo-schema-ssot.mjs` Guard grün

## Premium UX

`src/components/foerdermittel/ClusterPage.tsx` — shared:
- Hero + Authority-Score + Programmanzahl
- "Warum relevant?" Block
- FörderRadar Freshness Strip (wiederverwendet FoerderRadarCard)
- Matching CTA · Antrag CTA · CoPilot CTA Block
- Programme als ProgramCard-Grid
- Interne Links Grid
- Sichtbare FAQ Cards
- EuAiActTransparencyCard
- Footer-Disclaimer "ersetzt keine Förderberatung"

## Tests

`src/test/foerdermittel/seoAuthority.test.ts` — 16 Tests:
Cluster-Building (6) · Scoring & Gaps (3) · Meta+FAQ+Internal-Links inkl. Duplicate-Title-Guard (5) · EU AI Act Registry (2). 
Gesamt FördermittelOS: **71/71 grün** (Matching + Freshness + Execution + CoPilot + SEO Authority).

## Anti-Drift

- Keine neue Tabelle, kein RPC, keine Edge Function
- Keine Mock-AI, keine Crawler, kein hand-rolled JSON-LD
- Thin-Cluster-Gate verhindert SEO-Junk (mind. 1 Programm + nicht stale-only)
- CoPilot-Inhalte bleiben noindex via bestehender RouteNoindex / Edge-Function-Boundary
- Hub-Page Themen-Cluster-Grid ersetzt das alte 4-Tile-Set durch 11 Cluster-Tiles (Themen + Bundesländer + Branchen + Kombinationen + Aktualität + Antrag)
