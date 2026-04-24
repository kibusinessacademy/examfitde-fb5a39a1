/**
 * findingSchema
 * ─────────────
 * Zod-Schema zur Validierung von Finding-JSON-Importen.
 * Akzeptiert sowohl die rohe Lovable-Scanner-Form als auch verschachtelte
 * Snapshots `{ findings: [...] }` oder `{ scanners: [{ findings:[...] }] }`.
 */
import { z } from "zod";

export const RawFindingSchema = z.object({
  id: z.string().optional(),
  internal_id: z.string().optional(),
  scanner_name: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  details: z.string().optional(),
  level: z.union([z.literal("info"), z.literal("warn"), z.literal("error"), z.string()]).optional(),
  link: z.string().optional(),
  ignore: z.boolean().optional(),
  ignore_reason: z.string().optional(),
}).passthrough();

export type RawFindingInput = z.infer<typeof RawFindingSchema>;

const ScannerBlockSchema = z.object({
  scanner_name: z.string().optional(),
  findings: z.array(RawFindingSchema).optional(),
}).passthrough();

const SnapshotSchema = z.union([
  z.array(RawFindingSchema),
  z.object({ findings: z.array(RawFindingSchema) }).passthrough(),
  z.object({ scanners: z.array(ScannerBlockSchema) }).passthrough(),
  RawFindingSchema,
]);

export interface ParseResult {
  ok: boolean;
  findings: RawFindingInput[];
  errors: string[];
  warnings: string[];
}

export function parseFindingsJson(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      findings: [],
      errors: [`Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`],
      warnings: [],
    };
  }

  const validated = SnapshotSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      findings: [],
      errors: validated.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`),
      warnings: [],
    };
  }

  let findings: RawFindingInput[] = [];
  const v = validated.data as unknown;
  if (Array.isArray(v)) {
    findings = v as RawFindingInput[];
  } else if (v && typeof v === "object" && Array.isArray((v as { findings?: unknown }).findings)) {
    findings = (v as { findings: RawFindingInput[] }).findings;
  } else if (v && typeof v === "object" && Array.isArray((v as { scanners?: unknown }).scanners)) {
    const scanners = (v as { scanners: Array<{ scanner_name?: string; findings?: RawFindingInput[] }> }).scanners;
    findings = scanners.flatMap((s) =>
      (s.findings ?? []).map((f) => ({ scanner_name: s.scanner_name, ...f })),
    );
  } else {
    findings = [v as RawFindingInput];
  }

  // Warnings für unvollständige Datensätze
  findings.forEach((f, i) => {
    if (!f.id && !f.internal_id) {
      warnings.push(`Finding #${i}: weder "id" noch "internal_id" gesetzt — wird mit Index-Key verarbeitet.`);
    }
    if (!f.scanner_name) {
      warnings.push(`Finding #${i}: "scanner_name" fehlt — Exception-Persistenz benötigt diesen Wert.`);
    }
  });

  return { ok: true, findings, errors, warnings };
}
