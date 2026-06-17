
## Befund — Edge Function Sprawl

| Kennzahl | Wert |
|---|---|
| Edge Functions gesamt | **562** |
| TypeScript LOC | **194.171** |
| Aktiv per Cron getriggert | **67** (Hot Path) |
| Manuell/HTTP-aufgerufen | ~495 (Cold Tail) |
| Größte Datei | `package-generate-exam-pool/index.ts` (**153 KB**) |
| Top-10 Monster | >50 KB pro `index.ts`, zusammen ~890 KB |

### Cluster (nach Prefix)
- `admin-*` 41, `package-*` 35, `generate-*` 28, `seo-*` 20, `curriculum-*` 16, `kimi-*` 11, `berufski-*` 11, `qualification-*` 12, `ops-*` 11, `pipeline-*` 10, `system-*` 9, `control-*` 9, `validate-*` 8, `executive-*` 6, `distribution-*` 6 …

### Laufzeit-Signale (letzte 24h)
- **1 Funktion mit 100% 5xx** — 2/2 Aufrufe Timeout @ 150s (function_id `def3f108…`)
- **2 Funktionen knapp am Limit**: avg 94s + 118s pro Call (Cold-Start oder ineffizient)
- 4xx-Aufkommen unauffällig, dominiert von einzelnen Functions

### Architektur-Freeze
Core (`safe-tool`, Clustering, Memory Bridge, Council DAG, Job Runner) ist **FROZEN** → EXTEND_ONLY. Wir konsolidieren um den Kern herum, ohne ihn umzubauen.

## Plan

### Phase A — Diagnose-First (read-only, 1 Schritt, sofort)
Wir bauen einen Auto-Audit, **bevor** wir konsolidieren — sonst arbeiten wir blind.

1. **Neue Read-Only Edge-Function `admin-edge-fn-inventory`**
   - Listet alle 562 Functions mit:
     - LOC, Bytes, exists-in-cron, exists-in-job-map, last-modified
     - 24h-Aufrufe, p95-Latenz, 5xx-Rate (aus `function_edge_logs`)
     - Markiert: Cold (0 Calls/7d), Slow (>30s p95), Failing (>10% 5xx), Huge (>30KB)
   - Admin-Karte `/admin/governance/edge-fn-health` mit Triage-Tabelle und CSV-Export
   - **Kein Code wird gelöscht** — nur Sichtbarkeit
   - Aufwand: 1 Function + 1 Page

### Phase B — Hot-Path Reparatur (gezielt, hoher Impact)
Nur die Functions anfassen, die laut Logs *jetzt* Probleme verursachen:

1. **Timeout-Function (def3f108…) identifizieren und fixen** — Name via Inventory aus Phase A
2. **94s/118s-Functions** — Performance-Audit: typischerweise N+1 Supabase-Calls, fehlende `select(...)` Filter, oder synchronously waiting on AI
3. **Top-10 Monster** auf Quick-Wins prüfen:
   - Reduzierter Output (kein `select('*')`)
   - Streaming statt Buffer für AI Calls
   - Prompt-Trimming (Tokens), max_tokens runter, JSON-Mode statt Free-Text
   - Shared Helpers in `_shared/` extrahieren (kein Logic-Rewrite)

### Phase C — Prompt & Output Audit (KI-Functions)
Scope: nur Functions die `LOVABLE_API_KEY`/AI-Gateway nutzen.
Pro Function:
- System-Prompt: Länge messen, redundanten Boilerplate entfernen
- Response-Format: free-text → strict JSON schema wo möglich
- Model-Choice: `gemini-3-flash` als Default; `gemini-3-pro` nur wo nötig
- max_tokens cap, temperature explizit setzen
- Token-Budget-Audit ins `ai_invocation_log` (falls vorhanden) schreiben

### Phase D — Cold-Tail Konsolidierung (vorsichtig)
Functions mit **0 Aufrufen in 30 Tagen** und keiner Cron/Job-Map-Bindung:
- Generierter Vorschlag pro Cluster (z.B. 5–10 verwandte `seo-*` Helper)
- Pro Vorschlag: separater PR/Migration, einzeln approven
- **Niemals Bulk-Delete** — Architecture Freeze respektieren
- Audit in `auto_heal_log` Action `edge_fn_consolidation`

### Leitplanken
- Phase A bringt Daten — danach entscheidet der User pro Cluster
- Kein Architektur-Umbau in Core-Functions (`job-runner`, `content-runner`, `_shared/*`)
- Jede gelöschte/zusammengelegte Function: Migration-Audit + Cron-Map-Update
- Prompt-Änderungen: A/B per Feature-Flag wenn Endkunden-sichtbar

## Empfohlene Reihenfolge

1. **Sofort:** Phase A (Inventory & Health-Card) — gibt Entscheidungsgrundlage
2. **Nach Review:** Phase B (3–5 Hot-Path-Fixes) — schnellster ROI, stoppt aktive 5xx
3. **Separat freigeben:** Phase C (KI-Prompt-Audit, batchweise)
4. **Optional, langfristig:** Phase D (Cold-Tail-Konsolidierung in kleinen Wellen)

## Frage
**562 Functions können nicht in einem Schritt "konsolidiert" werden.** Empfehlung: ich baue jetzt **Phase A** (Inventory + Health-Karte), dann entscheidest du anhand realer Daten welche Cluster wir in Phase B–D anpacken.

Alternative: wenn du einen konkreten Cluster sofort meinst (z.B. `kimi-*` zusammenlegen, `seo-*` aufräumen), nenn ihn — dann skippen wir Phase A und gehen direkt rein.
