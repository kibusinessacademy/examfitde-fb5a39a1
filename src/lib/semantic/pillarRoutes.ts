/**
 * Phase P4 — Pillar / Satellite route helpers (SSOT).
 *
 * Single source of truth for URL paths to Pillar and Satellite pages.
 * UI MUST NOT hand-write `/wissen/<kind>/<key>` strings — call
 * `pillarPath(entity)` or `pillarPathByKind(kind, key)` instead.
 * Enforced by `scripts/guards/pillar-routes-orphan-guard.mjs`.
 */

import type { EntityKind, SemanticEntity } from "./types";

/** Entity kinds that have a public Pillar/Satellite page. */
export const ROUTED_ENTITY_KINDS = ["beruf", "kompetenz", "pruefung"] as const;

export type RoutedEntityKind = (typeof ROUTED_ENTITY_KINDS)[number];

export function isRoutedEntityKind(k: EntityKind): k is RoutedEntityKind {
  return (ROUTED_ENTITY_KINDS as ReadonlyArray<EntityKind>).includes(k);
}

/** Build a relative URL for a routed entity. */
export function pillarPathByKind(kind: RoutedEntityKind, key: string): string {
  return `/wissen/${kind}/${encodeURIComponent(key)}`;
}

export function pillarPath(entity: Pick<SemanticEntity, "kind" | "key">): string | null {
  if (!isRoutedEntityKind(entity.kind)) return null;
  return pillarPathByKind(entity.kind, entity.key);
}

/** Absolute URL (for canonical, og:url, sitemap entries). */
export function pillarAbsoluteUrl(
  baseUrl: string,
  entity: Pick<SemanticEntity, "kind" | "key">,
): string | null {
  const p = pillarPath(entity);
  if (!p) return null;
  return `${baseUrl.replace(/\/+$/, "")}${p}`;
}
