/**
 * SecurityFindingsPage
 * ────────────────────
 * Vollbild-Wrapper für SecurityFindingsClassifier.
 * Route: /admin/security/findings
 */
import { SecurityFindingsClassifier } from "@/components/admin/security/SecurityFindingsClassifier";

export default function SecurityFindingsPage() {
  return (
    <div className="p-4 md:p-6">
      <SecurityFindingsClassifier />
    </div>
  );
}
