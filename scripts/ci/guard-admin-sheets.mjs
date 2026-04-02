/**
 * CI Guard: Prevents raw Sheet usage in admin files.
 * All admin code must use AdminSheet wrapper from @/components/admin/AdminSheet.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const offenders = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");

      // Only check admin-related files
      const isAdminFile =
        full.includes("/admin/") ||
        /Leitstelle|FinancePanel|CrmPanel|SupportPanel|Compliance|Growth|NotificationBell/.test(entry.name);

      if (!isAdminFile) continue;

      // Skip the wrapper itself
      if (entry.name === "AdminSheet.tsx") continue;

      const importsRawSheet =
        code.includes('from "@/components/ui/sheet"') ||
        code.includes("from '@/components/ui/sheet'");

      if (importsRawSheet) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  }
}

walk(ROOT);

if (offenders.length) {
  console.error("\n[guard-admin-sheets] ❌ Raw Sheet import found in admin files:");
  console.error("Use AdminSheet from '@/components/admin/AdminSheet' instead.\n");
  offenders.forEach((f) => console.error(` - src/${f}`));
  console.error("");
  process.exit(1);
}

console.log("[guard-admin-sheets] ✅ OK — no raw Sheet imports in admin files");
