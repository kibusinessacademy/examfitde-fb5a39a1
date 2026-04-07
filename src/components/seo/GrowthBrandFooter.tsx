import { Link } from "react-router-dom";
import { BRAND } from "@/lib/brand/ssot";

interface GrowthBrandFooterProps {
  /** Content fingerprint ID for tracking */
  contentId?: string;
  /** UTM source for link tracking */
  utmSource?: string;
  /** Show full CTA or compact */
  variant?: "full" | "compact" | "minimal";
}

/**
 * Unified brand footer for all Growth Engine SEO pages.
 * Provides consistent branding, content fingerprint, and CTA.
 */
export function GrowthBrandFooter({
  contentId,
  utmSource = "seo",
  variant = "compact",
}: GrowthBrandFooterProps) {
  const ctaUrl = `/pruefungsreife-check?utm_source=${utmSource}&utm_medium=growth_page&utm_campaign=brand_footer`;

  if (variant === "minimal") {
    return (
      <footer className="text-center py-4 border-t border-border/40 mt-8">
        <p className="text-xs text-muted-foreground">
          © {BRAND.name} – Intelligentes Prüfungstraining ·{" "}
          <Link to="/" className="underline hover:text-foreground transition-colors">
            examfit.de
          </Link>
        </p>
        {contentId && (
          <span className="sr-only" data-content-id={contentId} aria-hidden="true">
            {contentId}
          </span>
        )}
      </footer>
    );
  }

  if (variant === "compact") {
    return (
      <footer className="mt-8 pt-6 border-t border-border/40">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">E</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{BRAND.name}</span>
            <span className="text-xs text-muted-foreground">· Intelligentes Prüfungstraining</span>
          </div>
          <Link
            to={ctaUrl}
            className="text-xs font-medium text-primary hover:underline"
          >
            Prüfungsreife kostenlos testen →
          </Link>
        </div>
        {contentId && (
          <span className="sr-only" data-content-id={contentId} aria-hidden="true">
            {contentId}
          </span>
        )}
      </footer>
    );
  }

  // Full variant
  return (
    <footer className="mt-10 pt-8 border-t border-border/40 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-sm font-bold">E</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{BRAND.name}</p>
          <p className="text-xs text-muted-foreground">Intelligentes Prüfungstraining · examfit.de</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Bereitgestellt von {BRAND.name} – dem KI-gestützten Prüfungstrainings-System für IHK-Abschlussprüfungen.
        Alle Inhalte basieren auf prüfungsnahen Fragen und werden redaktionell geprüft.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Link
          to={ctaUrl}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Prüfungsreife kostenlos testen
        </Link>
        <Link
          to={`/shop?utm_source=${utmSource}&utm_medium=growth_page`}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          Prüfungstraining ansehen
        </Link>
      </div>
      {contentId && (
        <span className="sr-only" data-content-id={contentId} aria-hidden="true">
          {contentId}
        </span>
      )}
    </footer>
  );
}
