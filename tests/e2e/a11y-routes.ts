/**
 * SSOT: public a11y smoke routes.
 *
 * Add new public routes here — both `tests/e2e/a11y-smoke.spec.ts` and the
 * route-coverage check in CI consume this file. Keep paths public-only
 * (no auth required); auth-gated pages are covered by separate suites.
 */
export type SmokeRoute = { name: string; path: string };

export const PUBLIC_A11Y_SMOKE_ROUTES: SmokeRoute[] = [
  { name: "home", path: "/" },
  { name: "kurse", path: "/kurse" },
  { name: "trainer-start", path: "/trainer-start" },
  { name: "dashboard", path: "/dashboard" },
  { name: "lead-quiz", path: "/quiz" },
  { name: "shop", path: "/shop" },
  { name: "preise", path: "/preise" },
  { name: "unternehmen", path: "/unternehmen" },
  { name: "karriere", path: "/karriere" },
  { name: "blog", path: "/blog" },
  { name: "install", path: "/install" },
  { name: "auth", path: "/auth" },
];
