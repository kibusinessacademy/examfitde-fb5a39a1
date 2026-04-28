# E2E-Tests (Playwright)

Validiert die zwei kritischen Flows gegen den Lovable-Preview:

1. **Sales-Flow**: `/shop` → Buy-Click ⇒ `POST /functions/v1/create-checkout` → 200
2. **AI-Tutor**: `/drill` → Floating-Bot ⇒ `POST /functions/v1/ai-tutor` → 200

## Setup (einmalig)

```bash
bun add -D @playwright/test
bunx playwright install chromium
```

## Ausführen

```bash
E2E_BASE_URL="https://id-preview--ad51e8f9-6cff-41cf-9723-b4e49dbcd9db.lovable.app" \
E2E_USER="<deine-email>" \
E2E_PASS="<dein-passwort>" \
E2E_CURRICULUM="<optional curriculum-uuid>" \
bunx playwright test e2e/sales-and-tutor.spec.ts
```

Ohne `E2E_USER` / `E2E_PASS` wird der Test übersprungen (kein CI-Bruch).
