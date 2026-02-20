#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
      walk(p, files);
    } else {
      files.push(p);
    }
  }
  return files;
}

const files = walk(ROOT);
let failed = false;

for (const file of files) {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx") && !file.endsWith(".js")) continue;
  const content = fs.readFileSync(file, "utf8");

  if (content.includes("placeholder") || content.includes("mock data")) {
    console.error(`❌ Placeholder detected in ${file}`);
    failed = true;
  }

  if (content.includes(".from(") && file.includes("src/")) {
    console.error(`❌ Direct Supabase .from() usage detected in client: ${file}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("✅ SSOT Guard passed");
