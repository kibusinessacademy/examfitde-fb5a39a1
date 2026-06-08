/**
 * ProductScope registry — Hard brand separation for the production build.
 *
 * berufos.com (and www) may only expose `examfit` and `berufos` public surfaces.
 * VibeOS / App-Builder / AvatarOS surfaces are forbidden on this host and must
 * never appear in the eagerly-loaded entry chunk or initial HTML.
 *
 * `admin` scope is host-agnostic but always gated by auth.
 */
export type ProductScope = "examfit" | "berufos" | "vibeos" | "admin";

export const HOST_ALLOWLIST: Record<string, ReadonlyArray<ProductScope>> = {
  "berufos.com": ["berufos", "examfit", "admin"],
  "www.berufos.com": ["berufos", "examfit", "admin"],
  "examfitde.lovable.app": ["berufos", "examfit", "admin"],
};

/** Forbidden identifiers in the initial HTML / entry chunk for berufos.com builds. */
export const FORBIDDEN_PUBLIC_IDENTIFIERS = [
  "VibeOSLandingPage",
  "AvatarOS",
  "RuntimeCommandCenter",
  "BackgroundAgentRuntime",
] as const;

/** Forbidden public route prefixes on berufos.com. */
export const FORBIDDEN_PUBLIC_ROUTES = [
  "/vibeos",
  "/platform",
  "/avatar",
  "/runtime",
  "/apps/new",
] as const;

export function isAllowedScope(host: string | undefined | null, scope: ProductScope): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase().replace(/:\d+$/, "");
  const allowed = HOST_ALLOWLIST[normalized];
  if (!allowed) return scope === "admin"; // unknown host: only admin tooling
  return allowed.includes(scope);
}
