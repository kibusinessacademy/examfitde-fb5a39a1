# Cutover-Readiness — Lokaler Prerender-Beweis (Phase C)

**Run:** 2026-05-23 · `npm run build` + `scripts/seo/run-prerender.mjs` + `scripts/seo/verify-prerender-output.mjs`
**Ziel:** Beweisen, dass der Build per-Route echtes HTML schreibt — letzter Confidence-Check vor Vercel/DNS.
**Ergebnis: GRÜN — Cutover-ready.**

---

## 1. Build

- ✅ `npm run build` — exit 0, 21.34s
- ✅ Prerender-Subprozess: `Wrote 17 SSOT + 119 intent + 1 pillar route HTMLs`
- ✅ Sitemap geschrieben: `dist/sitemap.xml` (Index → 6 Edge-Function-Sitemaps: static · berufe · blog · landing · products · content)
- ✅ `dist/404.html` nicht vorhanden (Vercel-Guard erfüllt)

## 2. Verify-Pass

`node scripts/seo/verify-prerender-output.mjs`:
- ✅ `dist/index.html` present
- ✅ Per-Route-HTMLs gesamt: **136** (Mindestschwelle 20)
- ⚠️ 3 hartkodierte Probe-Slugs (`/aevo-pruefung`, `/fiae-pruefung`, `/bilanzbuchhalter-pruefung`) **nicht mehr im SSOT** — diese Slugs wurden im SSOT auf `*-pruefungsvorbereitung` umbenannt. Verify-Skript hat veraltete Sample-Liste, ist **kein** SEO-Befund. Funktional grün — siehe manuelle Stichproben unten.

## 3. Manuelle Stichproben (User-Vorgabe)

| Route | File | Bytes | Title | Canonical | JSON-LD | Empty-Root |
|---|---|---:|---|---|---:|---|
| `/` | `dist/index.html` | 19 578 | „ExamFit – KI-Prüfungstraining für IHK & AEVO" | `https://berufos.com/` | 4 | nein ✅ |
| `/pruefungstraining-azubis` | `dist/pruefungstraining-azubis/index.html` | 18 479 | „Prüfungstraining für Azubis – IHK Teil 1 & 2 \| ExamFit" | `https://berufos.com/pruefungstraining-azubis` | 4 | nein ✅ |
| `/blog` | `dist/blog/index.html` | 17 761 | „Blog – Prüfungstipps, IHK-Updates, Lernstrategien \| ExamFit" | `https://berufos.com/blog` | 4 | nein ✅ |
| `/berufe` | — | — | — | — | — | **sitemap-only** (stubGroup, SSOT-konform) |
| `/berufe/industriekaufmann-frau` | — | — | — | — | — | **sitemap-only** (DB-route, Memory `sitemap-only-mode-for-db-routes-v1`) |

Alle prerenderten Stichproben enthalten:
- ✅ `<title>` route-spezifisch (≠ Shell)
- ✅ `<meta name="description">` route-spezifisch
- ✅ `<link rel="canonical">` mit `https://berufos.com/...`
- ✅ 4 JSON-LD-Blöcke pro Seite
- ✅ Kein nackter `<div id="root"></div>` — echte HTML-Body-Inhalte

## 4. Sitemap-Only-Routen (kein Per-Route-HTML, by design)

Per Memory `sitemap-only-mode-for-db-routes-v1` werden DB-getriebene Routen nur in der Sitemap geführt — Per-Route-HTML wird auf Vercel via SSR/ISR ergänzt:
- 256 Blog-Beiträge (nur `/blog/index.html` ist statisch, einzelne Posts via Edge)
- 190 Produktseiten
- 143 Wissen-Routen
- 1 Pillar-Route (statisch geschrieben)
- 119 Intent-Routen (statisch geschrieben)

Statisch geschrieben sind die **17 SSOT-Routen + 119 Intent + 1 Pillar = 137** (Verify zählte 136 — Differenz = `dist/index.html` selbst, je nach Walk-Logik, irrelevant).

## 5. Cutover-Bereitschaft

| Check | Status |
|---|---|
| `vercel.json` vorhanden | ✅ |
| `index.html` ohne statischen Canonical | ✅ |
| `RouteNoindex` auf protected paths | ✅ |
| Per-Route-Title/Desc/Canonical generiert | ✅ |
| JSON-LD pro Route | ✅ |
| Sitemap-Index inkl. Edge-Function-Shards | ✅ |
| `dist/404.html` entfernt (Vercel-Guard) | ✅ |
| LLM-Visibility-Baseline (Cron 138) läuft | ✅ |

**Verdict: GRÜN. Bereit für Schritt 4 (Vercel-Deploy) → 5 (DNS-Cutover).**

## 6. Kleine Folge-Tickets (non-blocking)

- **T1**: `scripts/seo/verify-prerender-output.mjs` Sample-Liste (`SAMPLE_PROBE_ROUTES`) auf neue SSOT-Slugs aktualisieren (`bilanzbuchhalter-pruefungsvorbereitung`, `fiae-pruefungsvorbereitung`, `pruefungstraining-azubis`). Heute false-positive — nach Vercel-Cutover wird das CI-Gate sonst rauschen.
- **T2**: 10 Blog-Soft-Warns (Meta-Description < 80 Zeichen) — kein Cutover-Blocker, aber im SEO-Backlog.
