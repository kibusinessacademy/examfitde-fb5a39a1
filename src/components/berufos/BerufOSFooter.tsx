import { Link } from "react-router-dom";
import { BERUFOS } from "@/lib/berufos/brand";
import { BERUFOS_MODULES } from "@/lib/berufos/modules";

export function BerufOSFooter() {
  return (
    <footer className="border-t berufos-hairline mt-24">
      <div className="max-w-7xl mx-auto px-6 py-12 grid gap-8 md:grid-cols-4 text-sm">
        <div>
          <div className="font-semibold mb-2">{BERUFOS.name}</div>
          <p className="berufos-text-dim leading-relaxed">{BERUFOS.tagline}</p>
        </div>
        <div>
          <div className="font-medium mb-3">Produktlinien</div>
          <ul className="space-y-2 berufos-text-dim">
            <li><a href={BERUFOS.subBrands.examfit.domain}>ExamFit · LearningOS</a></li>
            <li><Link to="/berufs-ki">Berufs-KI · WorkforceOS</Link></li>
            <li><Link to="/suites">Produkt-Suiten</Link></li>
            <li><Link to="/demo">Live-Demo</Link></li>
            <li><Link to="/hr/fristenrechner-kuendigung">HR Deadline OS</Link></li>
            <li><Link to="/authority">Authority Hub</Link></li>
            <li><Link to="/offer-comparison">AngebotsvergleichOS</Link></li>
            <li><Link to="/foerdermittel">FördermittelOS</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-medium mb-3">Plattform-Module</div>
          <ul className="space-y-2 berufos-text-dim">
            {BERUFOS_MODULES.slice(2, 7).map((m) => (
              <li key={m.slug}>
                <Link to={`/berufos/${m.slug}`}>{m.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-medium mb-3">Weitere</div>
          <ul className="space-y-2 berufos-text-dim">
            {BERUFOS_MODULES.slice(7).map((m) => (
              <li key={m.slug}>
                <Link to={`/berufos/${m.slug}`}>{m.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 pb-8 flex flex-wrap gap-x-6 gap-y-2 berufos-text-faint text-xs">
        <span>© {new Date().getFullYear()} {BERUFOS.name} — Workforce Intelligence Platform</span>
        <Link to="/produkte" className="hover:text-foreground">Produkte</Link>
        <Link to="/impressum" className="hover:text-foreground">Impressum</Link>
        <Link to="/agb" className="hover:text-foreground">AGB</Link>
        <Link to="/datenschutz" className="hover:text-foreground">Datenschutz</Link>
      </div>
    </footer>
  );
}
    </footer>
  );
}
