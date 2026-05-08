# ExamFit Funnel Events — SSOT Dokumentation

**Schema:** [`funnel-events.schema.json`](./funnel-events.schema.json)
**Container:** `GTM-K39CL625`
**Architektur:** [GTM DataLayer-First v1](../../.lovable/memory/architektur/marketing/gtm-datalayer-first-v1.md)

## Architektur-Prinzip

```
React (trackFunnel) ──► track_conversion_event_v2 RPC ──► Supabase (SSOT)
                  └──► gtmEmitFunnel ──► window.dataLayer ──► GTM ──► GA4 / Ads / Meta / Matomo
```

GTM ist **Fan-out-Schicht**, nicht SSOT. Supabase bleibt Wahrheit.

## Pflichtfelder (jeder Funnel-DataLayer-Push)

Alle Pushes via `gtmEmitFunnel(...)` enthalten **immer** diese Top-Level-Felder
(Wert darf `null` sein, Schlüssel muss vorhanden sein):

| Feld            | Beschreibung                                              |
|-----------------|-----------------------------------------------------------|
| `event`         | Kanonischer GA4-Eventname (siehe Tabelle)                 |
| `funnel_event`  | Interner FunnelEventType (Audit-Trail)                    |
| `package_id`    | UUID des `course_packages`-Pakets                         |
| `persona`       | `azubi` / `betrieb` / `umschulung` / …                    |
| `curriculum_id` | UUID des Curriculums                                      |
| `source_page`   | Canonical Pfad, von dem das Event ausgelöst wurde         |
| `page_path`     | Aktueller `window.location.pathname`                      |

Strict-Events (`strict: true` im Schema) erzwingen `package_id` **serverseitig** —
fehlt es, wirft die RPC `22023`. Im DEV-Build warnt der Client zusätzlich in der Console.

## Event-Mapping (Auszug)

| FunnelEventType            | GA4-Event             | Strict | GA4-Conversion |
|----------------------------|-----------------------|:------:|:--------------:|
| `page_view`                | `landing_view`        |        |                |
| `hero_cta_click`           | `cta_clicked`         |        |                |
| `cta_clicked`              | `cta_clicked`         |        |                |
| `quiz_started`             | `quiz_started`        |   ✓    |                |
| `quiz_completed`           | `quiz_completed`      |   ✓    |       ✓        |
| `lead_capture_submitted`   | `lead_captured`       |   ✓    |                |
| `checkout_start`           | `checkout_started`    |   ✓    |       ✓        |
| `checkout_complete`        | `purchase_completed`  |   ✓    |       ✓        |

Vollständige Liste: siehe [`funnel-events.schema.json`](./funnel-events.schema.json).

## GA4 Conversions

Im GA4-Property als Conversion markieren:

- `quiz_completed`
- `checkout_started`
- `purchase_completed`

## Tooling

| Werkzeug                                                              | Zweck                                                  |
|-----------------------------------------------------------------------|--------------------------------------------------------|
| `scripts/guards/gtm-event-mapping-guard.mjs`                          | CI: jedes FunnelEventType ist gemappt + Pflichtfelder  |
| `scripts/analytics/validate-events.mjs`                               | CLI: validiert exportierte DataLayer-Events vs. Schema |
| `/admin/analytics/event-inspector` (UI)                               | Klickbarer Preview-Mode-Check für die 5 Kern-Events    |
| `docs/runbooks/ga4-gtm-debug.md`                                      | Runbook für GTM-Preview & GA4-Realtime-Verify          |

## Neuen Funnel-Event hinzufügen

1. Eintrag im Schema (`docs/analytics/funnel-events.schema.json`).
2. `FunnelEventType`-Union in `src/lib/conversionTracking.ts` ergänzen.
3. `FUNNEL_TO_GTM_EVENT` in `src/lib/gtm.ts` ergänzen.
4. CI-Guard läuft grün → mergen.
5. Im GTM-Container: GA4-Event-Tag + Trigger anlegen.
