# GA4 / GTM Debug & Verification

**Container:** `GTM-K39CL625`
**Helper:** `src/lib/gtm.ts` (alle Pushes laufen hier durch)
**Consent Mode v2 Default** wird in `index.html` VOR dem GTM-Script gesetzt
(Default = denied, Region = DE/AT/CH/EU). Banner: `CookieConsentBanner.tsx`.

---

## 1. Debug-Modus aktivieren (lokal)

Zwei Wege — beide aktivieren `console.log("[GTM]", payload)` für jeden Push:

| Methode | Wann nutzen |
|---|---|
| URL-Parameter `?gtm_debug=1` an beliebige Route hängen | One-shot Debugging im Live-Preview |
| `localStorage.setItem('ef_gtm_debug','1')` in DevTools | Persistent über mehrere Routenwechsel |

Deaktivieren: `localStorage.removeItem('ef_gtm_debug')`.

---

## 2. GTM Preview/Debug (Tag Assistant)

1. https://tagmanager.google.com → Container `GTM-K39CL625` öffnen
2. Rechts oben **Vorschau** klicken
3. Ziel-URL eingeben: `https://berufos.com/?gtm_debug=1` (oder Preview-URL)
4. Tag Assistant öffnet sich → Tab **Summary** zeigt jeden `dataLayer`-Push live
5. Wichtige Events zum Verifizieren:

| Event | Wann | Erwartete Felder |
|---|---|---|
| `gtm.js` | Erste Seite | — |
| `consent_update` | Nach Banner-Klick | `consent_analytics`, `consent_ad` |
| `spa_pageview` | Jeder Routenwechsel | `page_path`, `page_location`, `page_title` |
| `h5p_started` | H5P-Inhalt geladen | `h5p_content_id`, `curriculum_id` |
| `h5p_answered` | Antwort gegeben | + `score`, `max_score`, `success` |
| `h5p_completed` | Abschluss | + `progress_pct` |
| `pruefung_begonnen` | Exam gestartet | `blueprint_id`, `exam_mode`, `exam_session_id` |
| `pruefung_abgeschlossen` | Exam beendet | + `score_percentage`, `passed`, `total_questions` |
| `bestanden` / `nicht_bestanden` | Direkt nach Abschluss | `exam_session_id`, `score_percentage` |

---

## 3. GA4 Realtime + DebugView

1. **Realtime:** GA4 → Berichte → **Echtzeit** — sollte deinen Aufruf binnen ≤30s zeigen.
2. **DebugView (empfohlen):**
   - Browser-Extension *Google Analytics Debugger* installieren ODER
   - In GTM einen GA4-Tag mit Field `debug_mode = true` für Preview-Modus konfigurieren
   - GA4 → Verwaltung → **DebugView** zeigt jedes Event mit allen Parametern

Pro Custom-Event sollten in GA4 die folgenden **Custom Dimensions** angelegt werden
(Verwaltung → Benutzerdefinierte Definitionen):

| Parameter | Scope | Empfohlener Name |
|---|---|---|
| `page_path` | Event | Pfad |
| `curriculum_id` | Event | Curriculum |
| `exam_mode` | Event | Prüfungsmodus |
| `passed` | Event | Bestanden |
| `score_percentage` | Event | Score % |
| `h5p_content_id` | Event | H5P-Inhalt |

**Conversion markieren:** GA4 → Verwaltung → Ereignisse → `bestanden`,
`nicht_bestanden`, `pruefung_abgeschlossen` als **Schlüsselereignisse** markieren.

---

## 4. Consent Mode prüfen

Im DevTools-Console ausführen:

```js
window.dataLayer.filter(e => e[0] === 'consent')
```

Erwartet:
- 1× `default` (denied bei erstem Besuch ohne gespeicherte Entscheidung)
- 1× `update` nach Banner-Klick (granted oder denied je nach Wahl)

Banner zurücksetzen für Tests: `localStorage.removeItem('ef_consent_v1')` → Reload.

---

## 5. Häufige Fehler

| Symptom | Ursache | Fix |
|---|---|---|
| Keine `spa_pageview` bei Routenwechsel | `useGtmPageView` nicht in `<BrowserRouter>` gemountet | siehe `App.tsx → AppChrome` |
| `analytics_storage` bleibt denied trotz Zustimmung | Banner-Klick triggert nicht `setConsent` | DevTools → `localStorage.getItem('ef_consent_v1')` prüfen |
| GTM lädt nicht (CSP-Fehler) | CSP-Whitelist fehlt | `index.html` CSP enthält `googletagmanager.com` + `google-analytics.com` |
| H5P-Events fehlen | `postMessage` von H5P-iframe blockiert | Console auf xAPI-Logs prüfen, Container muss `data-context: 'h5p'` empfangen |
