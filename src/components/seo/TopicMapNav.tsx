import { Link } from "react-router-dom";

/**
 * TopicMapNav — siteweite Pillar-Cluster-Verlinkung im Footer.
 * Zweck: interne Linkdichte, AI-Crawler-Discovery, thematische Abdeckung.
 * Wird in MainLayout + SEOLayout Footer eingebunden.
 */
export function TopicMapNav() {
  return (
    <nav
      aria-label="Themen-Übersicht"
      className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-sm pb-8 mb-8 border-b border-border/40"
    >
      <div>
        <p className="font-semibold text-foreground mb-3">IHK-Prüfungen</p>
        <ul className="space-y-1.5 text-muted-foreground">
          <li><Link to="/ihk-pruefungsvorbereitung" className="hover:text-foreground transition-colors">IHK-Prüfungsvorbereitung</Link></li>
          <li><Link to="/ihk-pruefungsfragen" className="hover:text-foreground transition-colors">IHK-Prüfungsfragen</Link></li>
          <li><Link to="/ihk-fachgespraech" className="hover:text-foreground transition-colors">IHK-Fachgespräch</Link></li>
          <li><Link to="/ihk-probepruefung" className="hover:text-foreground transition-colors">IHK-Probeprüfung</Link></li>
        </ul>
      </div>
      <div>
        <p className="font-semibold text-foreground mb-3">AEVO / Ausbildereignung</p>
        <ul className="space-y-1.5 text-muted-foreground">
          <li><Link to="/aevo-pruefungsvorbereitung" className="hover:text-foreground transition-colors">AEVO-Vorbereitung</Link></li>
          <li><Link to="/aevo-schriftliche-pruefung" className="hover:text-foreground transition-colors">Schriftliche Prüfung</Link></li>
          <li><Link to="/aevo-praktische-pruefung" className="hover:text-foreground transition-colors">Praktische Prüfung</Link></li>
          <li><Link to="/aevo-fachgespraech" className="hover:text-foreground transition-colors">AEVO-Fachgespräch</Link></li>
        </ul>
      </div>
      <div>
        <p className="font-semibold text-foreground mb-3">Mündlich & Methoden</p>
        <ul className="space-y-1.5 text-muted-foreground">
          <li><Link to="/muendliche-pruefung" className="hover:text-foreground transition-colors">Mündliche Prüfung</Link></li>
          <li><Link to="/lernplan-pruefung" className="hover:text-foreground transition-colors">Lernplan</Link></li>
          <li><Link to="/probepruefung" className="hover:text-foreground transition-colors">Probeprüfung</Link></li>
          <li><Link to="/themen" className="hover:text-foreground transition-colors">Häufige Fehler</Link></li>
        </ul>
      </div>
      <div>
        <p className="font-semibold text-foreground mb-3">Berufe & Cluster</p>
        <ul className="space-y-1.5 text-muted-foreground">
          <li><Link to="/bilanzbuchhalter-pruefungsvorbereitung" className="hover:text-foreground transition-colors">Bilanzbuchhalter</Link></li>
          <li><Link to="/fachinformatiker-ae-pruefungsvorbereitung" className="hover:text-foreground transition-colors">Fachinformatiker AE</Link></li>
          <li><Link to="/ausbildung" className="hover:text-foreground transition-colors">Alle Ausbildungen</Link></li>
          <li>
            <Link to="/themen" className="hover:text-foreground transition-colors font-medium text-primary">
              Alle Themen →
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}
