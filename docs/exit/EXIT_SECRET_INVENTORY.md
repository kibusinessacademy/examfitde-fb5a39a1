# EXIT_SECRET_INVENTORY

35 Secrets live. Bewertung für Lovable-Exit.

| Secret | Verwendet in | Pflicht? | Ersetzbar? |
|---|---|---|---|
| **LOVABLE_API_KEY** | `_shared/ai-client.ts` (Gateway-Route OpenAI/Google) + ~60 Edge Functions + Connector Gateway | JA | JA → eigener Gateway (VIBEOS_AI_GATEWAY) oder Direct-Keys OPENAI/ANTHROPIC/GOOGLE |
| EDGE_INTERNAL_SHARED_SECRET | `_shared/edgeAuthContract.ts` (alle assertAdmin-Edges) | JA | JA (selbst generiert, projektintern, kein Lovable-Lock-in) |
| E2E_HELPER_TOKEN | `tests/e2e/helpers/service-key.ts`, `e2e-test-helper` Edge | NEIN (Test-only) | JA (selbst generiert) |
| SRK_E2E | E2E-Helper Fallback (service-role alias) | NEIN | JA |
| E2E_BASE_URL / E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD | Playwright Specs | NEIN (CI only) | JA |
| OPENAI_API_KEY | direkt (falls Gateway umgangen) | NEIN (heute via Gateway) | bereits eigener Key |
| ANTHROPIC_API_KEY | `_shared/anthropic-batch.ts`, `ai-client.ts` Direct-Pfad | NEIN | bereits eigener Key |
| DEEPSEEK_API_KEY | optional Provider | NEIN | eigener Key |
| ELEVENLABS_API_KEY | Oral-Trainer (per Memory: no-elevenlabs Guard aktiv) | NEIN | eigener Key |
| TAVILY_API_KEY | Websearch Edges | NEIN | eigener Key |
| FIRECRAWL_API_KEY | connector-managed | NEIN | Direct-Key + eigene Auth |
| RESEND_API_KEY / RESEND_API_KEY_1 | Email-Worker | JA (Email) | Direct-Key (Resend selbst) |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | Checkout, Webhooks | JA (Payments) | Direct (Stripe selbst, nicht Lovable-Lock-in) |
| CRON_SECRET / BACKUP_JOB_SECRET / REWORK_CRON_SECRET | Cron-Endpoints Auth | JA | JA (selbst generiert) |
| CLOUDFLARE_API_TOKEN / ACCOUNT_ID / ZONE_ID | DNS/Cache Edges | NEIN | bereits eigener Account |
| GITHUB_TOKEN / GITHUB_E2E_TOKEN / GITHUB_OWNER / GITHUB_REPO | CI Dispatch | NEIN | bereits eigener Account |
| GOOGLE_SEARCH_CONSOLE_API_KEY | connector-managed | NEIN | OAuth-Re-Auth nach Exit |
| VAPID_PRIVATE_KEY / PUBLIC_KEY / SUBJECT | Web Push | NEIN | selbst generiert (kein Lock-in) |
| VERCEL_DEPLOY_HOOK_URL | Vercel-Cutover Migration | NEIN | bereits eigener Vercel |
| VIBEOS_WEBHOOK_SECRET | VibeOS Bridge | NEIN | bereits selbst |
| ORG_PSEUDO_SALT | RLS Hash-Salt | JA | selbst generiert |
| ENVIRONMENT | Mode-Flag | NEIN | trivial |

## Exit-kritisch (Hard Lock-in)
1. **LOVABLE_API_KEY** — einziger echter Lovable-spezifischer Secret. Rotation nur via `lovable_api_key--rotate_lovable_api_key`. Ohne Ersatz brechen alle AI-Edge-Functions.
2. Lovable Cloud Postgres (`VITE_SUPABASE_*` + Service-Role unsichtbar) — kein Secret-Problem, aber Plattform-Lock.

## Exit-neutral
Alle anderen Secrets sind 3rd-party Direct-Keys (OpenAI, Anthropic, Stripe, Resend, Cloudflare, GitHub, Vercel) → portabel.
