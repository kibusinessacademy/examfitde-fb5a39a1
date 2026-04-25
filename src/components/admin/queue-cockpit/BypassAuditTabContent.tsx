/**
 * BypassAuditTabContent — Inhalt für Queue-Cockpit Tab "Audit"
 */
import { BypassAuditPanel } from "@/components/admin/heal/BypassAuditPanel";

export function BypassAuditTabContent() {
  return (
    <div className="space-y-4">
      <BypassAuditPanel />
    </div>
  );
}
