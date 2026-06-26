#!/usr/bin/env node
/**
 * ESLint config smoke test.
 *
 * Fails loudly with actionable messages when:
 *  - eslint.config.js cannot be loaded (CJS/ESM interop bugs etc.)
 *  - any custom rule plugin fails to expose a `create` function
 *  - the registered admin-routing/no-new-admin-routes rule is missing
 *
 * Run via `node scripts/lint-config-smoke.mjs`.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const CONFIG_PATH = resolve(process.cwd(), "eslint.config.js");

function fail(code, msg, hint) {
  console.error(`\n::error::ESLint config smoke FAILED [${code}]`);
  console.error(msg);
  if (hint) console.error(`Hint: ${hint}`);
  process.exit(1);
}

let configMod;
try {
  configMod = await import(pathToFileURL(CONFIG_PATH).href);
} catch (err) {
  fail(
    "CONFIG_LOAD",
    `Could not import ${CONFIG_PATH}: ${err?.message ?? err}`,
    "Most common cause: a custom rule file uses CommonJS (module.exports) " +
      "while package.json has \"type\": \"module\". Convert to `export default { ... }`."
  );
}

const config = configMod.default;
if (!Array.isArray(config)) {
  fail("CONFIG_SHAPE", "eslint.config.js default export must be an array (flat config).");
}

// Walk every plugin rule and confirm it is a real ESLint rule object.
let pluginsChecked = 0;
let rulesChecked = 0;
const missingCreate = [];
for (const entry of config) {
  const plugins = entry?.plugins;
  if (!plugins || typeof plugins !== "object") continue;
  for (const [pluginName, plugin] of Object.entries(plugins)) {
    pluginsChecked++;
    const rules = plugin?.rules ?? {};
    for (const [ruleName, rule] of Object.entries(rules)) {
      rulesChecked++;
      if (!rule || typeof rule.create !== "function") {
        missingCreate.push(`${pluginName}/${ruleName}`);
      }
    }
  }
}

if (missingCreate.length > 0) {
  fail(
    "RULE_INTEROP",
    `Custom rules missing a .create() function: ${missingCreate.join(", ")}`,
    "This usually means the rule file is CommonJS but the project loads ESM. " +
      "Use `export default { meta, create() {} }` in eslint-rules/*.js."
  );
}

// Spot-check the admin-routing rule we rely on.
const adminRule = config
  .flatMap((c) => Object.entries(c?.plugins ?? {}))
  .find(([name]) => name === "admin-routing")?.[1]?.rules?.["no-new-admin-routes"];

if (!adminRule || typeof adminRule.create !== "function") {
  fail(
    "ADMIN_ROUTING_RULE_MISSING",
    "admin-routing/no-new-admin-routes is not registered or is not a valid rule object.",
    "Check eslint-rules/no-new-admin-routes.js exports a default rule object."
  );
}

console.log(
  `✓ ESLint config smoke OK — plugins=${pluginsChecked}, rules=${rulesChecked}, admin-routing rule present.`
);
