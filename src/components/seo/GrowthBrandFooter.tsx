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
  const ctaUrl = `/pruefungscheck?utm_source=${utmSource}&utm_medium=growth_page&utm_campaign=brand_footer`;

  if (variant === "minimal") {
    return (
      <footer className="text-center py-4 border-t border-border/40 mt-8">
        <p className="text-xs text-muted-foreground">
          © {BRAND.name} – Intelligentes Prüfungstraining ·{" "}
          <Link to="/" className="underline hover:text-foreground transition-colors">
            berufos.com
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
            Prüfungsreife-Check starten →
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
    <footer className="mt-10 pt-8 border-t border-border/40 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-sm font-bold">E</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{BRAND.name}</p>
          <p className="text-xs text-muted-foreground">Intelligentes Prüfungstraining · berufos.com</p>
        </div>
      </div>

      {/* Topic-Map: siteweite Pillar-Verlinkung für Crawlability + LLM-Discovery */}
      <nav aria-label="Themen-Übersicht" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        <div>
          <p className="font-semibold text-foreground mb-2">IHK-Prüfungen</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><Link to="/ihk-pruefungsvorbereitung" className="hover:text-foreground hover:underline">IHK-Vorbereitung</Link></li>
            <li><Link to="/ihk-pruefungsfragen" className="hover:text-foreground hover:underline">Prüfungsfragen</Link></li>
            <li><Link to="/ihk-fachgespraech" className="hover:text-foreground hover:underline">Fachgespräch</Link></li>
            <li><Link to="/ihk-probepruefung" className="hover:text-foreground hover:underline">Probeprüfung</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-2">AEVO</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><Link to="/aevo-pruefungsvorbereitung" className="hover:text-foreground hover:underline">AEVO-Vorbereitung</Link></li>
            <li><Link to="/aevo-schriftliche-pruefung" className="hover:text-foreground hover:underline">Schriftlich</Link></li>
            <li><Link to="/aevo-praktische-pruefung" className="hover:text-foreground hover:underline">Praktisch</Link></li>
            <li><Link to="/aevo-fachgespraech" className="hover:text-foreground hover:underline">Fachgespräch</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-2">Mündliche Prüfung & Methoden</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><Link to="/muendliche-pruefung" className="hover:text-foreground hover:underline">Mündliche Prüfung</Link></li>
            <li><Link to="/lernplan-pruefung" className="hover:text-foreground hover:underline">Lernplan</Link></li>
            <li><Link to="/themen" className="hover:text-foreground hover:underline">Häufige Fehler</Link></li>
            <li><Link to="/themen" className="hover:text-foreground hover:underline font-medium">Alle Themen →</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-foreground mb-2">Berufe & Cluster</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><Link to="/bilanzbuchhalter-pruefungsvorbereitung" className="hover:text-foreground hover:underline">Bilanzbuchhalter</Link></li>
            <li><Link to="/fachinformatiker-ae-pruefungsvorbereitung" className="hover:text-foreground hover:underline">Fachinformatiker AE</Link></li>
            <li><Link to="/ausbildung" className="hover:text-foreground hover:underline">Alle Ausbildungen</Link></li>
            <li><Link to="/berufe" className="hover:text-foreground hover:underline">Berufe-Übersicht</Link></li>
          </ul>
        </div>
      </nav>
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
