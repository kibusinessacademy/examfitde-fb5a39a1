import { Link } from "react-router-dom";
import { BERUFOS } from "@/lib/berufos/brand";

export function BerufOSHeader() {
  return (
    <header className="border-b berufos-hairline">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/berufos" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(var(--bos-accent))] to-[hsl(var(--bos-accent-2))]" />
          <span className="font-semibold tracking-tight">{BERUFOS.name}</span>
          <span className="berufos-text-dim text-xs ml-2 hidden sm:inline">
            AI-Betriebssystem für Berufe
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm berufos-text-dim">
          <Link to="/berufos#module" className="hover:text-foreground">Module</Link>
          <Link to="/berufos/skills" className="hover:text-foreground">SkillGraph</Link>
          <Link to="/berufos/governance" className="hover:text-foreground">Governance</Link>
          <Link to="/berufos/industry" className="hover:text-foreground">Branchen</Link>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={BERUFOS.subBrands.examfit.domain}
            className="berufos-btn-ghost px-3 py-2 text-sm hidden sm:inline-block"
          >
            ExamFit
          </a>
          <Link to="/berufs-ki" className="berufos-btn-primary px-4 py-2 text-sm">
            Berufs-KI starten
          </Link>
        </div>
      </div>
    </header>
  );
}
