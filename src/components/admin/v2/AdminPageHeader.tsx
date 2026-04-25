/**
 * AdminPageHeader — Unified Admin Header
 * ──────────────────────────────────────
 * SSOT-Header für alle Admin-Seiten. Erzwingt konsistentes Layout:
 *   • Icon-Badge (primary tint)
 *   • Titel + optionale Beschreibung
 *   • Optionale Actions rechts
 *   • Optionale Status-Badges (Fallback-Modus, SSOT, etc.)
 *
 * Verwendung:
 *   <AdminPageHeader
 *     icon={ListChecks}
 *     title="Queue Cockpit"
 *     description="SSOT für Live-Jobs, Heal, Stuck-Steps…"
 *     actions={<Button …>Settings</Button>}
 *   />
 */
import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { Helmet } from "react-helmet-async";

interface AdminPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  badges?: ReactNode;
  /** Optional: setzt document.title via react-helmet-async */
  documentTitle?: string;
  /** Optional: meta description */
  metaDescription?: string;
}

export function AdminPageHeader({
  icon: Icon,
  title,
  description,
  actions,
  badges,
  documentTitle,
  metaDescription,
}: AdminPageHeaderProps) {
  return (
    <>
      {documentTitle && (
        <Helmet>
          <title>{documentTitle}</title>
          {metaDescription && <meta name="description" content={metaDescription} />}
        </Helmet>
      )}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-md bg-primary/10 p-2 text-primary shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground leading-tight">
                {title}
              </h1>
              {badges}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </header>
    </>
  );
}
