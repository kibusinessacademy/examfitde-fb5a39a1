# ExamFit Growth Operating System (GOS) v1

> Canonical SSOT für jede Marketing-, SEO-, Content-, UI- und Conversion-Entscheidung.
> Vor jedem Feature, das eine User-facing-Seite, einen Funnel-Schritt, einen Content-Asset oder eine Admin-Card berührt, **muss** dieses Dokument referenziert werden.
> Lovable-Agenten lesen die Kurzfassung über `mem://constraints/growth-os-framework-v1`.

## 0. Zielbild
Maximale **SERP-Fläche** + maximale **LLM-Sichtbarkeit** + maximale **Funnel-Kohärenz** + auditierbare **Admin-Leitstelle** — als ein durchgängiges System, nicht als Sammlung isolierter Seiten.

---

## 1. Die 7 System-Layer

### L1 · Market Domination
Jede Query wird klassifiziert in: `awareness | problem | comparison | exam_prep | purchase | b2b | institutional`.
SSOT: `growth.search_intents` (Tabelle, persona × intent × query_cluster).

### L2 · Content Graph
Kein Artikel ohne Cluster-Eintrag. Jeder Asset hat genau einen `cluster_id` + N `links_to[]` zu Money-Page, Demo, Pricing oder Lead-Magnet.
SSOT: `growth.content_graph_nodes` + `growth.content_graph_edges`.
Asset-Typen: `money_page | seo_cluster | llm_visibility | conversion_asset`.

### L3 · Sales Psychology Engine
Persona-Matrix:
| Persona | Emotion | Primary CTA |
|---|---|---|
| Azubi | Prüfungsangst, Struktur fehlt | „Starte Prüfungssimulation" |
| Betrieb | Durchfallkosten, Qualität | „Bestehensquoten erhöhen" |
| Institution | Neutralität, Ergänzung | „Vorbereitung systematisch ergänzen" |

SSOT: `growth.persona_overlays` (existiert bereits — nicht duplizieren).

### L4 · Programmatic SEO
Variablen-Matrix `(beruf × pruefungsteil × kompetenz × region × persona)` → templated Landingpages mit garantiert eindeutigem H1/Title/Intro-Block (Anti-Cannibalization-Hash).
SSOT: `growth.programmatic_templates` + Cannibalization-Guard `scripts/guards/seo-cannibalization-guard.mjs` (TBD).

### L5 · LLM Visibility
Pflichtbausteine je Asset: `definition_block`, `tldr_block`, `numbered_list`, `faq_block`, `entity_table`.
Messung: bestehender `LlmVisibilityCard` (10 Queries × 3 Modelle, weekly) — nicht neu bauen.

### L6 · Conversion Loop
Jede Seite: `funnel_stage` + `next_action_id` + `tracking_event_id`. Niemals Sackgasse.
SSOT: `conversion_events` v2 (existiert) + neue Spalte `growth.content_graph_nodes.next_action_node_id`.

### L7 · Content Quality Governance
- Keyword-SSOT: `growth.keyword_registry` (unique slug, owner_node_id) — verhindert Cannibalization.
- Persona-SSOT: `growth.persona_overlays`.
- Funnel-SSOT: `conversion_events.event_type`-Enum.
- Refresh-Detection: `growth.content_graph_nodes.last_audited_at` + cron.

---

## 2. Pflicht-Checkliste vor JEDEM Content-/Page-PR

```
[ ] cluster_id + persona + funnel_stage gesetzt
[ ] keyword_slug in growth.keyword_registry registriert (kein Duplikat)
[ ] Primary CTA above-the-fold, persona-spezifisch
[ ] FAQ-Block + structured data (FAQPage)
[ ] LLM-Bausteine (TL;DR, Definition, Liste)
[ ] >=3 interne Links zu Cluster-Geschwistern + 1 Money-Page
[ ] Tracking-Event mit package_id (falls Produktbezug)
[ ] SEOHead mit Title <60ch + Meta <160ch + Canonical
[ ] Mobile Hero geprüft (411px Viewport)
[ ] Core Web Vitals Budget eingehalten (Lazy für sekundär)
```

---

## 3. Admin UI = Leitstelle (nicht Dashboard)

Jede Admin-Card MUSS beantworten:
1. **Was ist kaputt?** (Status-Badge)
2. **Warum?** (Root-Cause-Hint)
3. **Wie kritisch?** (P0 / P1 / P2 / OK)
4. **Was ist die sichere nächste Aktion?** (Primary CTA mit Reason-Prompt)
5. **Wurde geheilt?** (Last-Action mit Audit-Link auf `auto_heal_log`)
6. **Trend?** (24h / 7d Sparkline oder Delta)
7. **Drilldown?** (zu betroffenen Paketen)
8. **Rollback-Hinweis** wenn destruktiv.

**Verboten:** reine Daten-Tabellen ohne Entscheidungslogik, Mutations ohne Reason+Audit+Toast+`invalidateQueries`.

Guard: `scripts/guards/admin-ui-leitstelle-guard.mjs` (siehe §6).

---

## 4. Shop UI = Conversion-System (nicht Produktseite)

Pflicht je Produktseite:
- Hero mit Persona + Prüfungsziel + Nutzen + Primary CTA above-the-fold
- Primary CTA = **„Prüfungssimulation starten"** (nicht „Jetzt kaufen")
- Trust-Block (Bestehensquote / Blueprint-Hinweis)
- Einwandbehandlung (3–5 Top-Einwände)
- FAQ + `FAQPage` schema.org
- Pricing transparent
- >=3 interne Links (verwandte Prüfung, Lernplan, Ratgeber)
- Mobile Hero <100kb critical CSS
- Tracking: `product_viewed` mit `{package_id, persona, source}` SSOT-konform

Guard: `scripts/guards/shop-ui-conversion-guard.mjs` (siehe §6).

---

## 5. Pre-Implementation Brief (Pflicht für jede UI-Story)

```
1. UI-Ziel
2. Nutzerrolle
3. Wichtigste Entscheidung
4. Benötigte Daten (RPC/View)
5. Risiko bei Fehlbedienung
6. Sichere Aktion (mit Audit?)
7. Empty / 8. Loading / 9. Error / 10. Success State
11. Mobile Verhalten
12. Performance-Risiko
13. Tracking-Events
14. Akzeptanzkriterien
```
Erst danach Code.

---

## 6. Geplante Guards (statisch, CI)

| Guard | Zweck |
|---|---|
| `seo-cannibalization-guard.mjs` | keyword_slug nur 1× owner_node |
| `content-graph-orphan-guard.mjs` | jede Page hat cluster + ≥1 inbound link |
| `admin-ui-leitstelle-guard.mjs` | Admin-Cards: Status+Severity+Action+Audit Props vorhanden |
| `shop-ui-conversion-guard.mjs` | Produktseiten: SEOHead+FAQ+PrimaryCTA+structuredData |
| `cta-persona-parity-guard.mjs` | CTA-Text matched Persona-Matrix |

Implementierungs-Reihenfolge: zuerst Memory + Doc (dieser PR), dann Guards inkrementell — **nie** alle auf einmal (siehe Migration-Discipline v1).

---

## 7. Anti-Patterns (hart verboten)
- „Schreibe einen Blogartikel" ohne cluster_id → reject
- Produktseite ohne Primary CTA above-the-fold → reject
- Admin-Card mit Mutation ohne Reason+Audit → reject
- Direct client read auf `growth.*` SSOT-Tabellen → nur via RPC mit `has_role`
- Duplicate keyword_slug → reject
- Persona-Mismatch CTA (z.B. Azubi-Page mit B2B-CTA) → reject
- Neue AI-Calls aus dem Client → immer via Edge Function + Lovable AI Gateway

---

## 8. Evolutionsstufen (Roadmap)
1. **Phase 1 (jetzt):** Doc + Memory + Pre-Brief-Pflicht.
2. **Phase 2:** `growth.*` SSOT-Tabellen + Cannibalization-Guard.
3. **Phase 3:** Programmatic-Template-Engine + Refresh-Detection-Cron.
4. **Phase 4:** Revenue-Attribution-Layer (content_node → order).
5. **Phase 5:** AI Visibility Tracking pro Cluster.

---

**Querverweise:** `docs/SHOP_STRATEGY.md`, `docs/SYSTEM_RULES.md`, `mem://architektur/marketing/*`, `mem://architektur/seo/*`.
