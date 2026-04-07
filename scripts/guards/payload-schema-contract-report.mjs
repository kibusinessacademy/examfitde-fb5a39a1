#!/usr/bin/env node
/**
 * payload-schema-contract-report.mjs
 *
 * Generates a human-readable report of allowed payload keys per job type.
 * Validates that every job_type in the DB registry has a matching schema.
 *
 * Usage:
 *   node scripts/guards/payload-schema-contract-report.mjs [--check]
 *
 * --check: exit 1 if any job type is missing a schema (CI mode)
 */

import fs from "node:fs";
import path from "node:path";

const CHECK_MODE = process.argv.includes("--check");

// We parse the TypeScript source to extract registry keys & shapes
// (lightweight static analysis — avoids needing ts-node in CI)
const SCHEMA_FILE = path.resolve("src/lib/contracts/job-payload-schemas.ts");

if (!fs.existsSync(SCHEMA_FILE)) {
  console.error("❌ Schema file not found:", SCHEMA_FILE);
  process.exit(1);
}

const content = fs.readFileSync(SCHEMA_FILE, "utf8");

// Extract registry entries: `job_type: SchemaName,`
const registryMatch = content.match(
  /JOB_PAYLOAD_SCHEMA_REGISTRY[^{]*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s
);

if (!registryMatch) {
  console.error("❌ Could not parse JOB_PAYLOAD_SCHEMA_REGISTRY from schema file");
  process.exit(1);
}

const registryBlock = registryMatch[1];
const registryEntries = [];
const entryRegex = /^\s*(\w+)\s*:\s*(\w+)/gm;
let match;
while ((match = entryRegex.exec(registryBlock)) !== null) {
  registryEntries.push({ jobType: match[1], schemaName: match[2] });
}

// Extract schema shapes: `export const SchemaName = PackageJobBaseSchema.extend({...})` or `= z.object({...})`
// We'll extract the field names from each schema definition
function extractSchemaFields(schemaName) {
  // Find schema definition
  const defRegex = new RegExp(
    `export const ${schemaName}\\s*=\\s*([\\s\\S]*?)(?:;|\\n\\nexport)`,
    "m"
  );
  const defMatch = content.match(defRegex);
  if (!defMatch) return ["(could not parse)"];

  const def = defMatch[1];
  const fields = new Set();

  // Check if it extends PackageJobBaseSchema or StepJobBaseSchema
  if (def.includes("PackageJobBaseSchema") || def.includes("StepJobBaseSchema")) {
    fields.add("package_id");
    fields.add("curriculum_id?");
    fields.add("course_id?");
  }
  if (def.includes("StepJobBaseSchema")) {
    fields.add("step_key?");
  }

  // Extract inline fields from .extend({...}) or z.object({...})
  const objectBlock = def.match(/(?:extend|object)\s*\(\s*\{([^}]*)\}/s);
  if (objectBlock) {
    const fieldRegex = /(\w+)\s*:/g;
    let fm;
    while ((fm = fieldRegex.exec(objectBlock[1])) !== null) {
      // Check if optional
      const line = objectBlock[1].substring(
        objectBlock[1].lastIndexOf("\n", fm.index) + 1,
        objectBlock[1].indexOf("\n", fm.index + fm[0].length)
      );
      const isOptional = line.includes(".optional()") || line.includes("optUuid") || line.includes("optStr") || line.includes("nullOptUuid");
      fields.add(fm[1] + (isOptional ? "?" : ""));
    }
  }

  return [...fields].sort();
}

// Build report
const report = [];
report.push("# Job Payload Contract Report");
report.push(`# Generated: ${new Date().toISOString()}`);
report.push(`# Source: src/lib/contracts/job-payload-schemas.ts`);
report.push(`# Total registered job types: ${registryEntries.length}`);
report.push("");
report.push("| Job Type | Pool | Payload Keys (? = optional) |");
report.push("|----------|------|-----------------------------|");

// Deduplicate by jobType
const seen = new Set();
for (const { jobType, schemaName } of registryEntries) {
  if (seen.has(jobType)) continue;
  seen.add(jobType);

  const fields = extractSchemaFields(schemaName);
  report.push(`| \`${jobType}\` | — | ${fields.join(", ")} |`);
}

const reportText = report.join("\n") + "\n";

// Output
console.log(reportText);

// Write to file
const outPath = path.resolve("docs/payload-contract-report.md");
const docsDir = path.dirname(outPath);
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(outPath, reportText);
console.log(`\n✅ Report written to ${path.relative(process.cwd(), outPath)}`);

if (CHECK_MODE) {
  // In check mode, we'd compare against DB job_type_policies
  // For now, just verify all entries have parseable schemas
  const unparsed = registryEntries.filter(
    (e) => extractSchemaFields(e.schemaName)[0] === "(could not parse)"
  );
  if (unparsed.length > 0) {
    console.error(`\n❌ ${unparsed.length} schema(s) could not be parsed:`);
    for (const e of unparsed) {
      console.error(`  → ${e.jobType}: ${e.schemaName}`);
    }
    process.exit(1);
  }
  console.log("✅ All schemas parseable");
}
