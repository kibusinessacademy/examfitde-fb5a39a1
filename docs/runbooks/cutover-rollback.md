# Cutover & Rollback Runbook — Vercel Migration

**Status:** ACTIVE · **Last Updated:** 2026-05-24
**Scope:** berufos.com Frontend-Hosting Lovable → Vercel
**Backend:** Lovable Cloud / Supabase (unverändert)

> Dieses Runbook ist die SSOT-Handlungsanweisung für den DNS-Cutover und den
> Rollback. Es wird im Admin-Cockpit unter `Command → Cutover` direkt
> verlinkt und gerendert.

---

## 0. Pre-Cutover Gates (alle GRÜN Pflicht)

| Gate | Quelle | Status |
|------|--------|--------|
| C — Per-Route Prerender lokal | `docs/runbooks/cutover-readiness-prerender-proof.md` | ✅ |
| A — GSC Site-Verification (META-Tag) | `index.html` `google-site-verification` | ✅ |
| B — Discovery-Layer (`robots.txt`, `llms.txt`, `examfit-indexnow-key-2026.txt`) | `public/` | ✅ |

Wenn ein Gate rot ist: **NICHT** mit Cutover starten.

---

## 1. Cutover-Sequenz (operativ)

### 1.1 Vercel-Projekt verbinden
1. https://vercel.com → New Project → GitHub Repo `examfit`
2. Framework: **Vite** (auto-detected)
3. Build Command: `npm run build`
4. Output Directory: `dist`

### 1.2 Environment-Variablen
Aus Lovable `.env` 1:1 in Vercel → Settings → Environment Variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

### 1.3 Vercel-Test-Deploy verifizieren (PFLICHT vor DNS)
```bash
curl -sI https://examfit.vercel.app/aevo-pruefung | head -3
curl -s  https://examfit.vercel.app/aevo-pruefung | grep -E '<title|canonical' | head
diff <(curl -s https://examfit.vercel.app/) <(curl -s https://examfit.vercel.app/aevo-pruefung) | head
```
**Erwartung:** unterschiedliche Titel + canonical pro Route, KEIN reines `<div id="root"></div>`.

### 1.4 DNS-Cutover bei Cloudflare
| Record | Name | Wert |
|--------|------|------|
| A      | `@`  | `76.76.21.21` |
| CNAME  | `www`| `cname.vercel-dns.com` |

**TTL** auf 5 min vor dem Switch absenken.

### 1.5 SSL warten
Vercel provisioniert Let's Encrypt automatisch (1–10 min). Nicht weiter, bevor `https://berufos.com` 200 liefert.

### 1.6 Lovable Custom Domain entkoppeln
**ERST NACH** Schritt 1.5. Lovable → Project Settings → Domains → entfernen.

### 1.7 Post-Cutover-Smoke
Im Admin-Cockpit (`/admin/command` → Tab **Cutover**):
- Button **"Post-Cutover Smoke ausführen"** → läuft gegen `https://berufos.com`
- Verdict muss **GO** sein.
- Audit-Log: `auto_heal_log.action_type='cutover_route_html_smoke'`

CLI-Pendant:
```bash
node scripts/seo/post-cutover-smoke.mjs
node scripts/seo/route-html-verify.mjs --host=https://berufos.com
```

### 1.8 GSC-Sitemap einreichen
Im Admin-Cockpit (`/admin/command` → Tab **Cutover**):
- Button **"Sitemap an GSC senden"**
- Audit-Log: `auto_heal_log.action_type='cutover_gsc_sitemap_submit'`

---

## 2. Rollback (Notfall)

**Trigger:**
- Post-Cutover-Smoke `verdict=BLOCKED` mit ≥2 fehlerhaften Routen
- SSL bleibt > 30 min ungültig
- 5xx-Rate auf berufos.com > 5 % über > 10 min

### 2.1 DNS zurück auf Lovable
| Record | Name | Wert |
|--------|------|------|
| A      | `@`  | `185.158.133.1` |
| A      | `www`| `185.158.133.1` |

### 2.2 Lovable Custom Domain re-connect
Lovable → Project Settings → Domains → `berufos.com` und `berufos.com` hinzufügen, DNS-Verifikation abwarten.

### 2.3 Vercel-Domain entfernen
Vercel → Project → Settings → Domains → `berufos.com` removen, sonst 308-Loop möglich.

### 2.4 Validierung Rollback
```bash
curl -sI https://berufos.com | grep -i server
node scripts/seo/post-cutover-smoke.mjs
```
- `verdict=GO` gegen Lovable-Hosting reicht für „Rollback erfolgreich".
- Per-Route-HTML wird unter Lovable wieder vom SPA-Fallback überschrieben — das ist **erwartet** und nicht Teil der Rollback-Erfolgskriterien.

---

## 3. Post-Cutover-Validierung (nach erfolgreichem GO)

| Check | Tool | Erfolgskriterium |
|-------|------|------------------|
| Per-Route HTML | `route-html-verify.mjs` | Title + Canonical + JSON-LD pro Route |
| www → apex | `post-cutover-smoke.mjs` | 301/308 nach `berufos.com` |
| Sitemap erreichbar | `curl -sI /sitemap.xml` | 200 |
| robots.txt | `curl -s /robots.txt` | enthält `Sitemap:` und `Host:` |
| GSC-Sitemap-Status | Admin → Cutover Tab | `lastSubmitted` aktuell, 0 errors |
| LLM-Visibility-Baseline | Cron 138 (weekly) | Pre/Post-Vergleich nach 7 Tagen |

---

## 4. Audit-SSOT

Alle Cutover-Aktionen schreiben nach `auto_heal_log`:
- `cutover_gsc_sitemap_submit`
- `cutover_route_html_smoke`
- `cutover_control_error`

Query-Beispiel:
```sql
select created_at, action_type, result_status, details
from auto_heal_log
where action_type like 'cutover_%'
order by created_at desc
limit 50;
```

---

## 5. Verantwortlichkeiten

| Phase | Owner | Backup |
|-------|-------|--------|
| Pre-Gates | Platform | — |
| DNS Switch | Platform | DevOps |
| Smoke + GSC Submit | Admin (UI) | Platform (CLI) |
| Rollback | Platform | DevOps |
