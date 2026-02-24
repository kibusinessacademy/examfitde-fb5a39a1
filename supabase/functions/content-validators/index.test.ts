import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";

// Import validators directly
import {
  validateWiederholen,
  validateMiniCheck,
  validateEinstieg,
  type MiniCheckQuestion,
} from "../_shared/content-validators.ts";

// ─── hasTable Regex Tests ───────────────────────────────────────────────────

Deno.test("hasTable: detects <table> tag", () => {
  const result = validateWiederholen(`
    <p>Leitfrage: Was ist der Unterschied zwischen A und B?</p>
    <p>Wie hängt X mit Y zusammen? Welche Abgrenzung gibt es?</p>
    <table><tr><td>A</td><td>B</td></tr></table>
  `);
  const hasTable = result.metrics.hasTable;
  assertEquals(hasTable, true, "Should detect <table> tag");
});

Deno.test("hasTable: detects <table class=...>", () => {
  const result = validateWiederholen(`
    <p>Was ist der Unterschied zwischen Brutto und Netto?</p>
    <p>Abgrenzung: Wie hängt das zusammen?</p>
    <table class="comparison"><tr><td>X</td></tr></table>
  `);
  assertEquals(result.metrics.hasTable, true);
});

Deno.test("hasTable: does NOT match bare ]", () => {
  const result = validateWiederholen(`
    <p>Was ist der Unterschied? [Link] zur Abgrenzung</p>
    <p>Verwechslung: Wie hängt das zusammen?</p>
    <p>Daten: {"items": [1,2,3]}</p>
  `);
  assertEquals(result.metrics.hasTable, false, "Bare ] must NOT count as table");
});

Deno.test("hasTable: does NOT match random brackets", () => {
  const result = validateWiederholen(`
    <p>Siehe [Kapitel 3] für Details. Abgrenzung?</p>
    <p>Array: a[0], b[1]. Unterschied? Zusammen?</p>
  `);
  assertEquals(result.metrics.hasTable, false);
});

// ─── MiniCheck Validator Tests ──────────────────────────────────────────────

function makeQuestion(overrides: Partial<MiniCheckQuestion> = {}): MiniCheckQuestion {
  return {
    question: "Frau Müller, Filialleiterin, muss 1.500 € Warenbestand bewerten. Welche Option wählt sie?",
    options: ["Option A", "Option B", "Option C", "Option D"],
    correct_answer: 0,
    explanation: "Option A ist korrekt, weil die Bewertung so erfolgt. Option B klingt richtig und ist verlockend, aber falsch weil der Ansatz nicht zutreffend ist.",
    difficulty: "mittel",
    bloom_level: "apply",
    trap_type: "",
    ...overrides,
  };
}

Deno.test("MiniCheck: valid 7-item set passes", () => {
  const questions: MiniCheckQuestion[] = [
    makeQuestion({ difficulty: "leicht", bloom_level: "remember" }),
    makeQuestion({ difficulty: "leicht", bloom_level: "understand" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply", trap_type: "Normverwechslung (falscher Paragraph)" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "transfer" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "analyze" }),
  ];
  const result = validateMiniCheck(questions);
  assert(result.passes, `Should pass but got failures: ${JSON.stringify(result.failures)}`);
});

Deno.test("MiniCheck: rejects 4 items as hard_fail", () => {
  const questions = Array.from({ length: 4 }, () => makeQuestion());
  const result = validateMiniCheck(questions);
  assert(!result.passes);
  assert(result.failures.some(f => f.rule === "MC_ITEM_COUNT"));
});

Deno.test("MiniCheck: generic trap_type (<8 chars) = hard_fail", () => {
  const questions: MiniCheckQuestion[] = [
    makeQuestion({ difficulty: "leicht", bloom_level: "remember" }),
    makeQuestion({ difficulty: "leicht", bloom_level: "understand" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply", trap_type: "Trap" }), // too short!
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "transfer" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "analyze" }),
  ];
  const result = validateMiniCheck(questions);
  assert(result.failures.some(f => f.rule === "MC_GENERIC_TRAP"), "Short trap_type should be flagged");
});

Deno.test("MiniCheck: missing bloom_level = hard_fail", () => {
  const questions: MiniCheckQuestion[] = [
    makeQuestion({ difficulty: "leicht", bloom_level: undefined }),
    makeQuestion({ difficulty: "leicht", bloom_level: "understand" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply", trap_type: "Normverwechslung (falscher Paragraph)" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "transfer" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "analyze" }),
  ];
  const result = validateMiniCheck(questions);
  assert(result.failures.some(f => f.rule === "MC_MISSING_BLOOM"));
});

Deno.test("MiniCheck: pure 'Was ist...' without scenario = counted as definition", () => {
  const questions: MiniCheckQuestion[] = [
    makeQuestion({ question: "Was ist ein Kaufvertrag?", difficulty: "leicht", bloom_level: "remember" }),
    makeQuestion({ question: "Was bedeutet AGB?", difficulty: "leicht", bloom_level: "remember" }),
    makeQuestion({ question: "Was versteht man unter Compliance?", difficulty: "mittel", bloom_level: "understand" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply", trap_type: "Normverwechslung (falscher Paragraph)" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "transfer" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "analyze" }),
  ];
  const result = validateMiniCheck(questions);
  assert(result.failures.some(f => f.rule === "MC_TOO_MANY_DEFINITIONS"));
});

Deno.test("MiniCheck: 'Was ist der nächste Schritt?' WITH scenario = NOT pure definition", () => {
  const questions: MiniCheckQuestion[] = [
    makeQuestion({ question: "Was ist in dieser Situation mit 2.500 € Warenbestand der nächste Schritt für Frau Müller?", difficulty: "leicht", bloom_level: "remember" }),
    makeQuestion({ question: "Was ist bei der Inventur mit 180 Artikeln die korrekte Vorgehensweise laut Teamleiter Schmidt?", difficulty: "leicht", bloom_level: "understand" }),
    makeQuestion({ question: "Was bedeutet diese Abweichung von 350 € für die Filialleiterin?", difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply" }),
    makeQuestion({ difficulty: "mittel", bloom_level: "apply", trap_type: "Normverwechslung (falscher Paragraph)" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "transfer" }),
    makeQuestion({ difficulty: "anspruchsvoll", bloom_level: "analyze" }),
  ];
  const result = validateMiniCheck(questions);
  assert(!result.failures.some(f => f.rule === "MC_TOO_MANY_DEFINITIONS"), "Scenario-embedded 'Was ist' should NOT count as pure definition");
});
