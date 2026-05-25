import { Link } from "react-router-dom";
import { SEOHead } from "@/components/seo/SEOHead";
import { ArrowRight, Brain, Workflow, FileText, Network, ShieldCheck, Bot, GraduationCap, Briefcase, Sparkles } from "lucide-react";
import "@/components/vibeos/vibeos-theme.css";

/**
 * VibeOS — Masterbrand Landingpage.
 * Positionierung: AI-native Operating System for Workforces.
 * Strukturierte Produktlinien: ExamFit (Learning OS) + Berufs-KI (Workforce OS).
 */
export default function VibeOSLandingPage() {
  return (
    <div className="vibeos min-h-screen">
      <SEOHead
        title="VibeOS — AI-native Operating Systems for Workforces"
        description="Die Plattform-Infrastruktur für Lernen, Arbeit, Agenten, Workflows und Berufsprozesse. Mit ExamFit (Learning OS) und Berufs-KI (Workforce OS)."
        path="/vibeos"
      />

      {/* Top Nav */}
      <header className="border-b vibeos-hairline">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(var(--vibe-accent))] to-[hsl(var(--vibe-accent-2))]" />
            <span className="font-semibold tracking-tight">VibeOS</span>
            <span className="vibeos-text-dim text-xs ml-2 hidden sm:inline">Workforce Intelligence Platform</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm vibeos-text-dim">
            <a href="#products" className="hover:text-white">Produkte</a>
            <a href="#runtime" className="hover:text-white">Runtime</a>
            <a href="#graph" className="hover:text-white">Knowledge Graph</a>
            <a href="#industries" className="hover:text-white">Branchen</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/" className="vibeos-btn-ghost px-3 py-2 text-sm hidden sm:inline-block">ExamFit</Link>
            <Link to="/berufs-ki" className="vibeos-btn-primary px-4 py-2 text-sm">Berufs-KI starten</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="vibeos-grid-bg">
        <div className="max-w-7xl mx-auto px-6 pt-24 pb-28">
          <span className="vibeos-chip"><span className="dot" />AI-native Platform · v1</span>
          <h1 className="mt-6 text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
            <span className="vibeos-gradient-text">AI-native Operating Systems</span><br />
            for Workforces.
          </h1>
          <p className="mt-6 max-w-2xl text-lg vibeos-text-dim leading-relaxed">
            VibeOS verbindet Lernen, Arbeit, Agenten, Workflows, Dokumente, Governance und Kompetenzsysteme
            in einer zentralen Plattform-Infrastruktur — mit Berufslogik als Burggraben.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/berufs-ki" className="vibeos-btn-primary px-6 py-3 inline-flex items-center gap-2">
              Plattform entdecken <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/" className="vibeos-btn-ghost px-6 py-3">ExamFit Learning OS</Link>
            <Link to="/berufs-ki" className="vibeos-btn-ghost px-6 py-3">Berufs-KI Workforce OS</Link>
          </div>

          {/* Trust strip */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-px bg-[hsl(var(--vibe-border))] border vibeos-hairline rounded-2xl overflow-hidden">
            {[
              ["Kompetenz-SSOT", "geprüfte Berufslogik"],
              ["Governance-Layer", "Audit · RLS · Approval"],
              ["Agent Runtime", "deterministisch + auditierbar"],
              ["Knowledge Graph", "Berufe · Skills · Prozesse"],
            ].map(([t, s]) => (
              <div key={t} className="bg-[hsl(var(--vibe-bg-elev))] p-5">
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs vibeos-text-dim mt-1">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="products" className="max-w-7xl mx-auto px-6 py-24">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
          <div>
            <span className="vibeos-chip"><span className="dot" />Produkte</span>
            <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight">
              Zwei spezialisierte Operating Systems. Eine Infrastruktur.
            </h2>
          </div>
          <p className="vibeos-text-dim max-w-md">
            ExamFit für Prüfungserfolg. Berufs-KI für echte Arbeitsprozesse. Beide auf demselben Kompetenz-SSOT.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* ExamFit Card */}
          <Link to="/" className="vibeos-card p-8 block group">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[hsl(var(--vibe-accent)/0.15)] border border-[hsl(var(--vibe-accent)/0.3)] grid place-items-center">
                <GraduationCap className="w-5 h-5 text-[hsl(var(--vibe-accent))]" />
              </div>
              <div>
                <div className="text-xs vibeos-text-dim tracking-widest uppercase">Learning OS</div>
                <div className="text-2xl font-semibold">ExamFit</div>
              </div>
            </div>
            <p className="vibeos-text-dim mb-6">
              Das Learning OS für Prüfungserfolg. Echte Prüfungssimulation, Lernpläne, AI-Tutor,
              Kompetenzanalyse und Readiness Score — für Ausbildung, Weiterbildung & Zertifizierung.
            </p>
            <ul className="space-y-2 text-sm mb-8">
              {["Prüfungssimulation mit IHK/HWK-Logik", "Adaptive Lernpfade & Readiness Score", "AI-Tutor mit Strict-RAG-Citations"].map(i => (
                <li key={i} className="flex gap-2"><span className="text-[hsl(var(--vibe-accent))]">▸</span>{i}</li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-2 text-[hsl(var(--vibe-accent))] text-sm font-medium group-hover:gap-3 transition-all">
              Prüfung starten <ArrowRight className="w-4 h-4" />
            </span>
          </Link>

          {/* Berufs-KI Card */}
          <Link to="/berufs-ki" className="vibeos-card p-8 block group">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[hsl(var(--vibe-accent-2)/0.15)] border border-[hsl(var(--vibe-accent-2)/0.3)] grid place-items-center">
                <Briefcase className="w-5 h-5 text-[hsl(var(--vibe-accent-2))]" />
              </div>
              <div>
                <div className="text-xs vibeos-text-dim tracking-widest uppercase">Workforce OS</div>
                <div className="text-2xl font-semibold">Berufs-KI</div>
              </div>
            </div>
            <p className="vibeos-text-dim mb-6">
              Das Workforce OS für echte Arbeitsprozesse. AI-Agenten, Dokumenten-Engine, Workflow-Runtime
              und SOP-System — mit lizenzierter Berufslogik und Governance.
            </p>
            <ul className="space-y-2 text-sm mb-8">
              {["Dokumenten-Agent mit Branding & Approval", "Workflow & SOP Runtime pro Berufsfeld", "Profession-License & Governance-Gates"].map(i => (
                <li key={i} className="flex gap-2"><span className="text-[hsl(var(--vibe-accent-2))]">▸</span>{i}</li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-2 text-[hsl(var(--vibe-accent-2))] text-sm font-medium group-hover:gap-3 transition-all">
              Berufs-KI testen <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </section>

      {/* Runtime Stack */}
      <section id="runtime" className="border-y vibeos-hairline bg-[hsl(var(--vibe-bg-elev))]">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <span className="vibeos-chip"><span className="dot" />Plattform-Layer</span>
          <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight max-w-2xl">
            Eine Runtime. Sechs Layer. Ein gemeinsamer Burggraben.
          </h2>

          <div className="mt-12 grid md:grid-cols-3 gap-4">
            {[
              { i: Bot, t: "Agent Runtime", d: "Deterministische Berufs-Agenten mit Profession-License-Gate." },
              { i: Workflow, t: "Workflow Runtime", d: "Multi-Step Prozesse, Chains, Tickets, Audit." },
              { i: FileText, t: "Document OS", d: "Branded PDF/DOCX-Engine mit Approval & Compliance." },
              { i: Network, t: "Knowledge Graph", d: "Berufe · Kompetenzen · Prozesse · Dokumente vernetzt." },
              { i: ShieldCheck, t: "Governance Layer", d: "RLS, Approval, Audit, Suppression — by design." },
              { i: Brain, t: "Kompetenz-SSOT", d: "Eine Wahrheit für Berufslogik über alle Produkte." },
            ].map(({ i: Icon, t, d }) => (
              <div key={t} className="vibeos-card p-6">
                <Icon className="w-6 h-6 text-[hsl(var(--vibe-accent))] mb-4" />
                <div className="font-medium mb-1">{t}</div>
                <div className="text-sm vibeos-text-dim">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="max-w-7xl mx-auto px-6 py-24">
        <span className="vibeos-chip"><span className="dot" />Industry Modules</span>
        <h2 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight max-w-2xl">
          Branchenmodule auf gemeinsamer Plattform.
        </h2>
        <p className="mt-3 vibeos-text-dim max-w-2xl">
          Jedes Modul erbt Runtime, Governance und Knowledge Graph — und ergänzt branchenspezifische Berufslogik.
        </p>

        <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {["Bildung","Handwerk","Hausverwaltung","Immobilien","Recruiting","Healthcare"].map(b => (
            <div key={b} className="vibeos-card p-5 text-center text-sm">
              <Sparkles className="w-4 h-4 mx-auto mb-2 text-[hsl(var(--vibe-accent))]" />
              {b}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="vibeos-grid-bg border-t vibeos-hairline">
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight">
            <span className="vibeos-gradient-text">Bau auf der Plattform,</span><br />
            die Berufe wirklich versteht.
          </h2>
          <p className="mt-5 vibeos-text-dim max-w-xl mx-auto">
            VibeOS ist kein Chatbot und kein Promptsystem. Es ist die AI-native Workforce Intelligence Platform.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/berufs-ki" className="vibeos-btn-primary px-6 py-3 inline-flex items-center gap-2">
              Berufs-KI starten <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/" className="vibeos-btn-ghost px-6 py-3">ExamFit ansehen</Link>
          </div>
        </div>
      </section>

      <footer className="border-t vibeos-hairline">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-xs vibeos-text-dim">
          <div>© {new Date().getFullYear()} VibeOS — Workforce Intelligence Platform</div>
          <div className="flex gap-5">
            <Link to="/">ExamFit</Link>
            <Link to="/berufs-ki">Berufs-KI</Link>
            <Link to="/enterprise-demo">Enterprise</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
