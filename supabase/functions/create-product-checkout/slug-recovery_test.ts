import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSlug, recoverProductSlug, suggestClosestSlug } from "../_shared/slug-normalize.ts";

const ROWS = [
  { id: "p-anlagen", slug: "anlagenmechaniker-in-für-sanitär--heizungs--und-klimatechnik-ef7ba3bf" },
  { id: "p-industrie", slug: "industriekaufmann-frau-f5e3403b" },
  { id: "p-fisi", slug: "fachinformatiker-in-systemintegration-1234abcd" },
  { id: "p-fiae", slug: "fachinformatiker-in-anwendungsentwicklung-5678efab" },
  { id: "p-aevo", slug: "aevo-ausbildereignungspruefung-aabbccdd" },
];

Deno.test("normalizeSlug folds umlauts + drops uuid + drops gendered tail", () => {
  assertEquals(
    normalizeSlug("anlagenmechaniker-in-für-sanitär--heizungs--und-klimatechnik-ef7ba3bf"),
    "anlagenmechaniker-fuer-sanitaer-heizungs-und-klimatechnik",
  );
  assertEquals(normalizeSlug("Industriekaufmann-Frau"), "industriekaufmann");
  assertEquals(normalizeSlug("AEVO-Ausbildereignungsprüfung"), "aevo-ausbildereignungspruefung");
});

Deno.test("recover: exact match preferred", () => {
  const r = recoverProductSlug("industriekaufmann-frau-f5e3403b", ROWS);
  assertEquals(r.strategy, "exact");
  assertEquals(r.matched?.id, "p-industrie");
});

Deno.test("recover: anlagenmechaniker folded → DB slug with umlauts + uuid", () => {
  const r = recoverProductSlug(
    "anlagenmechaniker-in-fuer-sanitaer-heizungs-und-klimatechnik",
    ROWS,
  );
  assertEquals(r.matched?.id, "p-anlagen");
  assertEquals(r.strategy, "normalized");
});

Deno.test("recover: short slug industriekaufmann → industriekaufmann-frau", () => {
  const r = recoverProductSlug("industriekaufmann", ROWS);
  assertEquals(r.matched?.id, "p-industrie");
});

Deno.test("recover: ambiguous fachinformatiker fails closed", () => {
  const r = recoverProductSlug("fachinformatiker", ROWS);
  assertEquals(r.matched, null);
  assertEquals(r.strategy, "ambiguous");
});

Deno.test("recover: miss returns null with miss strategy", () => {
  const r = recoverProductSlug("astronaut-frau", ROWS);
  assertEquals(r.matched, null);
  assertEquals(r.strategy, "miss");
});

Deno.test("recover: empty input → miss", () => {
  const r = recoverProductSlug("", ROWS);
  assertEquals(r.strategy, "miss");
});

Deno.test("recover: uuid_suffix_strip strategy when input has no uuid", () => {
  const rows = [{ id: "x", slug: "kaufmann-im-einzelhandel-aabb1122" }];
  const r = recoverProductSlug("kaufmann-im-einzelhandel", rows);
  assertEquals(r.matched?.id, "x");
  assertEquals(r.strategy, "uuid_suffix_strip");
});

Deno.test("suggestClosestSlug: typo in beruf → nearest active product", () => {
  // Mehrere Beispielpakete: Empfehlung muss auf das tokenweise nächste fallen.
  const s = suggestClosestSlug("industriekauffrau-buero", ROWS);
  assertEquals(s?.id, "p-industrie");
});

Deno.test("suggestClosestSlug: short prefix match suggests fisi", () => {
  const s = suggestClosestSlug("fachinformatiker-system", ROWS);
  assertEquals(s?.id, "p-fisi");
});

Deno.test("suggestClosestSlug: garbage input → null (kein willkürlicher Treffer)", () => {
  const s = suggestClosestSlug("zzz", ROWS);
  assertEquals(s, null);
});

Deno.test("suggestClosestSlug: empty/null input → null", () => {
  assertEquals(suggestClosestSlug("", ROWS), null);
  assertEquals(suggestClosestSlug(null, ROWS), null);
});
