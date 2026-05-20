import { describe, expect, it } from "vitest";
import {
  assertNoSearchFeedbackLeak,
  computeCtr,
  deriveSemanticSearchRecommendedAction,
  deriveSemanticSearchState,
  isValidWissenRoute,
  normalizeSearchMetricMetadata,
  parseWissenRoute,
} from "@/lib/semantic/searchFeedback";

describe("P7 — route parsing and import contract", () => {
  it("accepts canonical wissen routes", () => {
    expect(parseWissenRoute("/wissen/beruf/industriekaufmann")).toEqual({
      routePath: "/wissen/beruf/industriekaufmann",
      routeKind: "beruf",
      routeKey: "industriekaufmann",
    });
    expect(isValidWissenRoute("/wissen/kompetenz/lf-01-kundenorientierung")).toBe(true);
    expect(isValidWissenRoute("/wissen/pruefung/fachinformatiker-anwendungsentwicklung")).toBe(true);
  });

  it("rejects non-wissen and malformed routes", () => {
    expect(isValidWissenRoute("/blog/semantic-seo")).toBe(false);
    expect(isValidWissenRoute("/wissen/unknown/foo")).toBe(false);
    expect(isValidWissenRoute("/wissen/beruf/foo/bar")).toBe(false);
    expect(isValidWissenRoute("https://examfit.de/wissen/beruf/foo")).toBe(false);
  });
});

describe("P7 — search state classification", () => {
  it("performing when a sitemap-backed graph route has clicks", () => {
    const state = deriveSemanticSearchState({ isInPublishedGraph: true, isInSitemap: true, impressions28d: 100, clicks28d: 4, daysSinceFirstSeen: 8 });
    expect(state).toBe("performing");
    expect(deriveSemanticSearchRecommendedAction(state)).toBe("none");
  });

  it("impressions_no_clicks when impressions exist without clicks", () => {
    const state = deriveSemanticSearchState({ isInPublishedGraph: true, isInSitemap: true, impressions28d: 88, clicks28d: 0, daysSinceFirstSeen: 14 });
    expect(state).toBe("impressions_no_clicks");
    expect(deriveSemanticSearchRecommendedAction(state)).toBe("improve_snippet");
  });

  it("no_search_signal when route is old enough but has no impressions", () => {
    const state = deriveSemanticSearchState({ isInPublishedGraph: true, isInSitemap: true, impressions28d: 0, clicks28d: 0, daysSinceFirstSeen: null, snapshotAgeMinutes: 2880 });
    expect(state).toBe("no_search_signal");
    expect(deriveSemanticSearchRecommendedAction(state)).toBe("wait_for_indexing");
  });

  it("needs_observation for very new graph routes without signal", () => {
    const state = deriveSemanticSearchState({ isInPublishedGraph: true, isInSitemap: true, impressions28d: 0, clicks28d: 0, daysSinceFirstSeen: null, snapshotAgeMinutes: 60 });
    expect(state).toBe("needs_observation");
    expect(deriveSemanticSearchRecommendedAction(state)).toBe("wait_for_indexing");
  });

  it("not_in_sitemap wins over metric states", () => {
    const state = deriveSemanticSearchState({ isInPublishedGraph: true, isInSitemap: false, impressions28d: 10, clicks28d: 1, daysSinceFirstSeen: 2 });
    expect(state).toBe("not_in_sitemap");
    expect(deriveSemanticSearchRecommendedAction(state)).toBe("check_sitemap");
  });

  it("not_in_graph wins over sitemap and metric states", () => {
    const state = deriveSemanticSearchState({ isInPublishedGraph: false, isInSitemap: true, impressions28d: 10, clicks28d: 1, daysSinceFirstSeen: 2 });
    expect(state).toBe("not_in_graph");
    expect(deriveSemanticSearchRecommendedAction(state)).toBe("check_graph_route");
  });
});

describe("P7 — metrics and safety helpers", () => {
  it("computes ctr safely", () => {
    expect(computeCtr(5, 100)).toBe(0.05);
    expect(computeCtr(5, 0)).toBe(0);
    expect(computeCtr(-5, 100)).toBe(0);
  });

  it("rejects raw query dumps", () => {
    expect(() => assertNoSearchFeedbackLeak({ query: "sample search phrase" })).toThrow("raw_query_dump_detected");
    expect(() => assertNoSearchFeedbackLeak({ nested: { raw_queries: ["sample"] } })).toThrow("raw_query_dump_detected");
  });

  it("rejects credential-shaped metadata keys", () => {
    expect(() => assertNoSearchFeedbackLeak({ token: "redacted-fixture" })).toThrow("secret_leak_risk");
    expect(() => assertNoSearchFeedbackLeak({ nested: { credential: "redacted-fixture" } })).toThrow("secret_leak_risk");
  });

  it("normalizes metadata to primitive PII-safe values only", () => {
    expect(normalizeSearchMetricMetadata({ importer: "manual", rows: 12, ok: true, ignored: { a: 1 } })).toEqual({ importer: "manual", rows: 12, ok: true });
  });
});
