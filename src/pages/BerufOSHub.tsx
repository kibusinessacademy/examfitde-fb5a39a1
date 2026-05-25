import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";
import { SEOHead } from "@/components/seo/SEOHead";
import { BERUFOS, statusLabel } from "@/lib/berufos/brand";
import { BERUFOS_MODULES } from "@/lib/berufos/modules";
import {
  useBerufosModules,
  BERUFOS_PERSONA_LABELS,
  BERUFOS_PERSONA_ORDER,
} from "@/lib/berufos/useBerufosModules";
import type { BerufosPersona } from "@/lib/berufos/modules";
import { BerufOSHeader } from "@/components/berufos/BerufOSHeader";
import { BerufOSFooter } from "@/components/berufos/BerufOSFooter";
import "@/components/berufos/berufos-theme.css";

/**
 * BerufOS Plattform-Hub — Masterbrand-Landing.
 *
 * Ersetzt VibeOSLandingPage (Routes /vibeos und /platform redirecten hierher).
 * SSOT für Modul-Anzeige: BERUFOS_MODULES. Persona-Filter via useBerufosModules.
 */
export default function BerufOSHub() {
  const [persona, setPersona] = useState<BerufosPersona | null>(null);
  const filtered = useBerufosModules(persona);
  const live = filtered.filter((m) => m.status === "live");
  const preview = filtered.filter((m) => m.status === "preview");
  const planned = filtered.filter((m) => m.status === "planned");

  return (
    <div className="berufos min-h-screen">
      <SEOHead
        title={`${BERUFOS.name} — ${BERUFOS.tagline}`}
        description={BERUFOS.subline}
        canonical={BERUFOS.hubPath}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: BERUFOS.name,
          url: `${BERUFOS.domain}${BERUFOS.hubPath}`,
          description: BERUFOS.subline,
          subOrganization: [
            { "@type": "Organization", name: BERUFOS.subBrands.examfit.name, url: BERUFOS.subBrands.examfit.domain },
            { "@type": "Organization", name: BERUFOS.subBrands.berufsKi.name, url: BERUFOS.subBrands.berufsKi.domain },
          ],
        }}
      />
      <BerufOSHeader />

      {/* Hero */}
      <section className="berufos-grid-bg">
        <div className="max-w-7xl mx-auto px-6 pt-24 pb-28">
          <span className="berufos-chip">
            <span className="dot" />
            AI-native Workforce Platform · v1
          </span>
          <h1 className="mt-6 text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
            <span className="berufos-gradient-text">Das AI-Betriebssystem</span>
            <br />für Berufe.
          </h1>
          <p className="mt-6 max-w-2xl text-lg berufos-text-dim leading-relaxed">
            {BERUFOS.subline}
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={BERUFOS.subBrands.examfit.domain}
              className="berufos-btn-primary px-6 py-3 inline-flex items-center gap-2"
            >
              ExamFit starten <ExternalLink className="w-4 h-4" />
            </a>
            <Link to="/berufs-ki" className="berufos-btn-ghost px-6 py-3">
              Berufs-KI testen
            </Link>
            <a href="#module" className="berufos-btn-ghost px-6 py-3">
              Plattform entdecken
            </a>
          </div>

          {/* Trust strip */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-px bg-[hsl(var(--bos-border))] border berufos-hairline rounded-2xl overflow-hidden">
            {[
              ["Kompetenz-SSOT", "geprüfte Berufslogik"],
              ["Governance-Layer", "Audit · RLS · Approval"],
              ["Agent Runtime", "deterministisch + auditierbar"],
              ["Knowledge Graph", "Berufe · Skills · Prozesse"],
            ].map(([t, s]) => (
              <div key={t} className="bg-[hsl(var(--bos-bg-elev))] p-5">
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs berufos-text-dim mt-1">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules — live first */}
      <section id="module" className="max-w-7xl mx-auto px-6 py-24">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="berufos-text-dim text-sm uppercase tracking-widest mb-2">
              Plattform-Module
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              10 Module. Ein Betriebssystem.
            </h2>
            <p className="berufos-text-dim mt-2 max-w-2xl">
              Jeder Beruf nutzt nur die Module, die er braucht. Verbunden über
              den SkillGraph als zentralem Burggraben.
            </p>
          </div>
        </div>

        {/* Persona-Filter */}
        <div className="flex flex-wrap gap-2 mb-10" role="tablist" aria-label="Module nach Berufsfeld filtern">
          {BERUFOS_PERSONA_ORDER.map((p) => {
            const active = p === "all" ? persona === null : persona === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPersona(p === "all" ? null : (p as BerufosPersona))}
                className={`px-4 py-2 rounded-full text-xs font-medium tracking-wide transition-colors ${
                  active
                    ? "berufos-btn-primary"
                    : "berufos-btn-ghost"
                }`}
              >
                {BERUFOS_PERSONA_LABELS[p]}
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="berufos-card p-8 text-center berufos-text-dim">
            Keine Module für diese Persona. Wähle "Alle".
          </div>
        ) : (
          <>
            <ModuleGroup title="Live" modules={live} />
            <ModuleGroup title="Preview" modules={preview} className="mt-12" />
            <ModuleGroup title="In Entwicklung" modules={planned} className="mt-12" />
          </>
        )}
      </section>


      {/* Burggraben */}
      <section className="border-t berufos-hairline">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="berufos-text-dim text-sm uppercase tracking-widest mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Burggraben
              </div>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
                Knowledge Graph verbindet alles.
              </h2>
              <p className="mt-4 berufos-text-dim leading-relaxed">
                Kompetenzen ↔ Workflows ↔ Dokumente ↔ Agenten ↔ SOPs ↔ Karriere ↔ Recruiting ↔ Branchen.
                Jedes Modul speist und nutzt denselben Graphen — das ist, was
                BerufOS von ChatGPT-Wrappern unterscheidet.
              </p>
              <div className="mt-6 flex gap-3">
                <Link to="/berufos/skills" className="berufos-btn-primary px-5 py-2.5">
                  SkillGraph ansehen
                </Link>
                <Link to="/berufos/governance" className="berufos-btn-ghost px-5 py-2.5">
                  Governance-Layer
                </Link>
              </div>
            </div>
            <div className="berufos-card p-8 font-mono text-xs leading-relaxed berufos-text-dim">
              <div className="mb-3 text-[hsl(var(--bos-accent))]">// SkillGraph SSOT</div>
              <div>Kompetenz ─┐</div>
              <div>           ├── Lernfeld ── Frage ── AI-Tutor</div>
              <div>           ├── SOP ────── Workflow ── Agent</div>
              <div>           ├── Rolle ──── Karriere ── Recruit</div>
              <div>           └── Branche ── IndustryOS</div>
              <div className="mt-4 text-[hsl(var(--bos-accent-2))]">// 190+ Curricula · 4500+ Edges · 707 Nodes</div>
            </div>
          </div>
        </div>
      </section>

      <BerufOSFooter />
    </div>
  );
}

function ModuleGroup({
  title,
  modules,
  className = "",
}: {
  title: string;
  modules: typeof BERUFOS_MODULES;
  className?: string;
}) {
  if (modules.length === 0) return null;
  return (
    <div className={className}>
      <div className="berufos-text-dim text-xs uppercase tracking-widest mb-4">{title}</div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.slug}
              to={`/berufos/${m.slug}`}
              className={`berufos-card berufos-accent-${m.accent} p-6 group`}
            >
              <div className="flex items-start justify-between mb-4">
                <Icon className="w-7 h-7 berufos-mod-icon" />
                <span className={`berufos-chip berufos-status-${m.status} !text-[10px]`}>
                  {statusLabel(m.status)}
                </span>
              </div>
              <div className="text-lg font-semibold tracking-tight">{m.name}</div>
              <div className="text-xs berufos-text-dim mb-3 uppercase tracking-wider">
                {m.category}
              </div>
              <p className="text-sm berufos-text-dim leading-relaxed mb-4">{m.tagline}</p>
              <div className="text-xs font-medium text-[hsl(var(--bos-accent))] flex items-center gap-1 group-hover:gap-2 transition-all">
                Mehr erfahren <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
