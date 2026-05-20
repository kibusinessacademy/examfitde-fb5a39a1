/**
 * Phase P3 — Schema.org SSOT contract assertions.
 *
 * Pure validators used in tests + CI to ensure every JSON-LD node
 * emitted by the SSOT layer is grounded, addressed, and free of
 * marketing copy.
 */

import type { JsonLdObject } from "./types";

export interface SchemaContractReport {
  ok: boolean;
  violations: ReadonlyArray<string>;
}

const FORBIDDEN_PHRASES = /\b(garantiert|sicher bestehen|100 ?%|beste(?:r|s|n)? )/i;

function visit(node: unknown, push: (v: string) => void, path = "$"): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => visit(v, push, `${path}[${i}]`));
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("@type" in obj && typeof obj["@type"] === "string") {
      const t = obj["@type"];
      if (
        ("@id" in obj === false) &&
        (t === "WebPage" || t === "Course" || t === "DefinedTermSet" || t === "QAPage" || t === "EducationEvent")
      ) {
        push(`${path}.${t}_missing_id`);
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && FORBIDDEN_PHRASES.test(v)) {
        push(`${path}.${k}_marketing_phrase`);
      }
      visit(v, push, `${path}.${k}`);
    }
  }
}

export function assertSchemaContract(node: JsonLdObject): SchemaContractReport {
  const v: string[] = [];
  if (node["@context"] !== "https://schema.org") v.push("missing_context");
  if (!node["@type"]) v.push("missing_type");
  visit(node, (x) => v.push(x));
  return { ok: v.length === 0, violations: v };
}
