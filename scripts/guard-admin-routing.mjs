#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const allowedRouteFiles = new Set([
  "src/pages/admin/LeitstellePage.tsx",
  "src/pages/admin/KursePage.tsx",
  "src/pages/admin/QueuePage.tsx",
  "src/pages/admin/CourseWorkspace.tsx",
  "src/pages/admin/AdminDeactivatedPage.tsx",
]);

const forbiddenAdminDirs = [
  "src/pages/admin/v4",
  "src/pages/admin/control",
  "src/pages/admin/factory",
  "src/pages/admin/intake",
  "src/pages/admin/b2b",
  "src/pages/admin/workspace",
];

const suspiciousRoutePatterns = [
  /path\s*:\s*["'`]\/admin\/(?!command\b|studio\b|queue\b|\*|$)[^"'`]+["'`]/g,
  /to\s*=\s*["'`]\/admin\/(?!command\b|studio\b|queue\b)[^"'`]+["'`]/g,
  /navigate\s*\(\s*["'`]\/admin\/(?!command\b|studio\b|queue\b)[^"'`]+["'`]\s*\)/g,
  /redirect\s*\(\s*["'`]\/admin\/(?!command\b|studio\b|queue\b)[^"'`]+["'`]\s*\)/g,
];

const suspiciousImportPatterns = [
  /from\s+["'`](.*\/pages\/admin\/v4\/.*)["'`]/g,
  /from\s+["'`](.*\/pages\/admin\/control\/.*)["'`]/g,
  /from\s+["'`](.*\/pages\/admin\/factory\/.*)["'`]/g,
  /from\s+["'`](.*\/pages\/admin\/intake\/.*)["'`]/g,
  /from\s+["'`](.*\/pages\/admin\/b2b\/.*)["'`]/g,
  /from\s+["'`](.*\/pages\/admin\/workspace\/.*)["'`]/g,
];

const violations = [];

main();

function main() {
  scanForbiddenDirs();
  scanAdminPagesRoot();
  scanSourceFiles();

  if (violations.length > 0) {
    console.error("\n❌ Admin routing guard failed:\n");
    for (const v of violations) {
      console.error(`- ${v}`);
    }
    console.error("\nFix the violations before merging.\n");
    process.exit(1);
  }

  console.log("✅ Admin routing guard passed.");
}

function scanForbiddenDirs() {
  for (const dir of forbiddenAdminDirs) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;

    const files = listFiles(abs).filter(isCodeFile);
    if (files.length > 0) {
      // Phase 1: warn only for existing legacy dirs
      console.warn(
        `⚠ Legacy admin directory still contains code: ${dir} (${files.length} file(s))`
      );
    }
  }
}

function scanAdminPagesRoot() {
  const adminRoot = path.join(ROOT, "src/pages/admin");
  if (!fs.existsSync(adminRoot)) return;

  const files = fs.readdirSync(adminRoot, { withFileTypes: true });

  for (const entry of files) {
    if (entry.isDirectory()) continue;

    if (entry.isFile() && isCodeFile(entry.name)) {
      const full = normalize(path.join("src/pages/admin", entry.name));
      if (!allowedRouteFiles.has(full)) {
        // Phase 1: warn for unexpected root-level admin pages
        console.warn(`⚠ Unexpected admin page file at root: ${full}`);
      }
    }
  }
}

// Legacy files that are already deactivated — skip route scanning for them
const legacyExcludePrefixes = [
  "src/pages/admin/v4/",
  "src/pages/admin/control/",
  "src/pages/admin/factory/",
  "src/pages/admin/intake/",
  "src/pages/admin/b2b/",
  "src/pages/admin/workspace/",
];

function isLegacyFile(relPath) {
  if (legacyExcludePrefixes.some((p) => relPath.startsWith(p))) return true;
  // Deactivated root-level admin pages
  if (relPath.startsWith("src/pages/admin/") && !allowedRouteFiles.has(relPath)) {
    const depth = relPath.replace("src/pages/admin/", "").split("/").length;
    if (depth === 1) return true; // root-level legacy page
  }
  return false;
}

function scanSourceFiles() {
  const srcRoot = path.join(ROOT, "src");
  if (!fs.existsSync(srcRoot)) return;

  for (const file of listFiles(srcRoot)) {
    if (!isCodeFile(file)) continue;

    const rel = normalize(path.relative(ROOT, file));

    // Skip deactivated legacy pages — they'll be deleted later
    if (isLegacyFile(rel)) continue;

    const content = fs.readFileSync(file, "utf8");

    for (const pattern of suspiciousRoutePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        violations.push(`Suspicious admin route in ${rel}: ${match[0]}`);
      }
    }

    for (const pattern of suspiciousImportPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        violations.push(`Forbidden legacy admin import in ${rel}: ${match[0]}`);
      }
    }
  }
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isCodeFile(file) {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(String(file));
}

function normalize(p) {
  return p.split(path.sep).join("/");
}
