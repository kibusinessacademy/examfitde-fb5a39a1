export type SemanticRouteKind = "beruf" | "kompetenz" | "pruefung";

export type SemanticSearchState =
  | "performing"
  | "impressions_no_clicks"
  | "no_search_signal"
  | "not_in_sitemap"
  | "not_in_graph"
  | "needs_observation";

export type SemanticSearchRecommendedAction =
  | "none"
  | "improve_snippet"
  | "wait_for_indexing"
  | "check_sitemap"
  | "check_graph_route"
  | "review_search_intent";

export interface SemanticRouteSearchInput {
  isInPublishedGraph: boolean;
  isInSitemap: boolean;
  impressions28d: number;
  clicks28d: number;
  daysSinceFirstSeen: number | null;
  snapshotAgeMinutes?: number | null;
}

export interface ParsedWissenRoute {
  routePath: string;
  routeKind: SemanticRouteKind;
  routeKey: string;
}

const WISSEN_ROUTE_RE = /^\/wissen\/(beruf|kompetenz|pruefung)\/([^/?#]+)$/;
const RAW_QUERY_KEYS = new Set(["query", "queries", "search_query", "raw_query", "raw_queries", "gsc_query"]);
const SECRET_KEY_RE = /(secret|token|api[_-]?key|authorization|credential|password)/i;

export function parseWissenRoute(routePath: string): ParsedWissenRoute | null {
  const clean = String(routePath || "").trim();
  const match = clean.match(WISSEN_ROUTE_RE);
  if (!match) return null;
  return {
    routePath: clean,
    routeKind: match[1] as SemanticRouteKind,
    routeKey: match[2],
  };
}

export function isValidWissenRoute(routePath: string): boolean {
  return parseWissenRoute(routePath) !== null;
}

export function deriveSemanticSearchState(input: SemanticRouteSearchInput): SemanticSearchState {
  if (!input.isInPublishedGraph) return "not_in_graph";
  if (!input.isInSitemap) return "not_in_sitemap";

  const impressions = Math.max(0, Number(input.impressions28d) || 0);
  const clicks = Math.max(0, Number(input.clicks28d) || 0);
  const age = input.snapshotAgeMinutes ?? null;

  if (impressions === 0) {
    if (input.daysSinceFirstSeen == null && age != null && age < 1440) {
      return "needs_observation";
    }
    return "no_search_signal";
  }

  if (clicks === 0) return "impressions_no_clicks";
  return "performing";
}

export function deriveSemanticSearchRecommendedAction(state: SemanticSearchState): SemanticSearchRecommendedAction {
  switch (state) {
    case "performing":
      return "none";
    case "impressions_no_clicks":
      return "improve_snippet";
    case "no_search_signal":
      return "wait_for_indexing";
    case "not_in_sitemap":
      return "check_sitemap";
    case "not_in_graph":
      return "check_graph_route";
    case "needs_observation":
      return "wait_for_indexing";
    default:
      return "none";
  }
}

export function computeCtr(clicks: number, impressions: number): number {
  const safeImpressions = Math.max(0, Number(impressions) || 0);
  if (safeImpressions === 0) return 0;
  return Math.max(0, Number(clicks) || 0) / safeImpressions;
}

export function assertNoSearchFeedbackLeak(value: unknown, path = "metadata"): void {
  if (value == null) return;

  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSearchFeedbackLeak(item, `${path}[${index}]`));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (RAW_QUERY_KEYS.has(normalized)) {
      throw new Error(`raw_query_dump_detected:${path}.${key}`);
    }
    if (SECRET_KEY_RE.test(normalized)) {
      throw new Error(`secret_leak_risk:${path}.${key}`);
    }
    assertNoSearchFeedbackLeak(nested, `${path}.${key}`);
  }
}

export function normalizeSearchMetricMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  assertNoSearchFeedbackLeak(metadata);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value.slice(0, 160);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}
