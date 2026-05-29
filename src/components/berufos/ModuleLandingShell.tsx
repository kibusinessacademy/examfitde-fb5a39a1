import { useState } from "react";
import { ArrowRight, ExternalLink, Check, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { SEOHead } from "@/components/seo/SEOHead";
import { supabase } from "@/integrations/supabase/client";
// keep import for invoke()
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { BERUFOS, statusLabel } from "@/lib/berufos/brand";
import type { BerufosModule } from "@/lib/berufos/modules";
import { BerufOSHeader } from "./BerufOSHeader";
import { BerufOSFooter } from "./BerufOSFooter";
import "./berufos-theme.css";


interface Props {
  module: BerufosModule;
}

export function ModuleLandingShell({ module }: Props) {
  const Icon = module.icon;
  const accentClass = `berufos-accent-${module.accent}`;

  return (
    <div className={`berufos min-h-screen ${accentClass}`}>
      <SEOHead
        title={`${module.name} — ${module.category} · ${BERUFOS.name}`}
        description={module.promise}
        canonical={`/berufos/${module.slug}`}
      />
      <BerufOSHeader />

      {/* Hero */}
      <section className="berufos-grid-bg border-b berufos-hairline">
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-24">
          <div className="flex items-center gap-3 mb-6">
            <Icon className="w-8 h-8 berufos-mod-icon" />
            <span className="berufos-chip">
              <span className="dot" />
              {module.category}
            </span>
            <span className={`berufos-chip berufos-status-${module.status}`}>
              {statusLabel(module.status)}
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
            <span className="berufos-gradient-text">{module.name}</span> — {module.tagline}
          </h1>
          <p className="mt-6 max-w-2xl text-lg berufos-text-dim leading-relaxed">
            {module.promise}
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <PrimaryCta module={module} />
            <Link to="/berufos" className="berufos-btn-ghost px-6 py-3">
              Alle Module ansehen
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="mb-12">
          <div className="berufos-text-dim text-sm uppercase tracking-widest mb-2">
            Was {module.name} kann
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Berufslogik. Strukturiert. Auditierbar.
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {module.features.map((f) => (
            <div key={f.title} className="berufos-card p-6">
              <div className="flex items-center gap-2 mb-3">
                <Check className="w-4 h-4 berufos-mod-icon" />
                <div className="font-medium">{f.title}</div>
              </div>
              <p className="text-sm berufos-text-dim leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="max-w-7xl mx-auto px-6 pb-24">
        <div className="berufos-card p-10 md:p-14 text-center">
          {module.status === "planned" || (module.status === "preview" && !module.href) ? (
            <PlannedWaitlist module={module} />
          ) : (
            <>
              <h3 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3">
                Bereit für {module.name}?
              </h3>
              <p className="berufos-text-dim max-w-xl mx-auto mb-6">{module.promise}</p>
              <PrimaryCta module={module} large />
            </>
          )}
        </div>
      </section>


      <BerufOSFooter />
    </div>
  );
}
function PrimaryCta({ module, large = false }: { module: BerufosModule; large?: boolean }) {
  const size = large ? "px-8 py-4 text-base" : "px-6 py-3";
  // Planned OR preview-without-href → Waitlist (D4 fix: kein toter Hero ohne CTA)
  if (module.status === "planned" || (module.status === "preview" && !module.href)) {
    const label = module.status === "planned" ? "Auf die Warteliste" : "Frühen Zugang anfragen";
    return (
      <a href="#waitlist" className={`berufos-btn-primary inline-flex items-center gap-2 ${size}`}>
        {label} <ArrowRight className="w-4 h-4" />
      </a>
    );
  }
  const isExternal = module.href?.startsWith("http");
  const Icon = isExternal ? ExternalLink : ArrowRight;
  const label = module.status === "live" ? `${module.name} öffnen` : `${module.name} Preview ansehen`;
  if (!module.href) return null;
  if (isExternal) {
    return (
      <a
        href={module.href}
        className={`berufos-btn-primary inline-flex items-center gap-2 ${size}`}
        rel="noopener"
      >
        {label} <Icon className="w-4 h-4" />
      </a>
    );
  }
  return (
    <Link to={module.href} className={`berufos-btn-primary inline-flex items-center gap-2 ${size}`}>
      {label} <Icon className="w-4 h-4" />
    </Link>
  );
}



function PlannedWaitlist({ module }: { module: BerufosModule }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      toast.error("Bitte gültige E-Mail eingeben.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("berufos-waitlist", {
        body: { email, module_slug: module.slug },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast.error(`Anmeldung fehlgeschlagen: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <>
        <h3 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3">
          Du bist auf der Liste.
        </h3>
        <p className="berufos-text-dim max-w-xl mx-auto">
          Wir melden uns, sobald {module.name} startet.
        </p>
      </>
    );
  }

  return (
    <form id="waitlist" onSubmit={submit}>
      <h3 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3">
        {module.name} kommt bald.
      </h3>
      <p className="berufos-text-dim max-w-xl mx-auto mb-6">
        Trag dich ein und erhalte als Erste:r Zugang, sobald wir live gehen.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
        <input
          type="email"
          required
          placeholder="dein@beruf.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 px-4 py-3 rounded-xl bg-[hsl(var(--bos-surface))] border berufos-hairline text-foreground placeholder:text-[hsl(var(--bos-text-dim))] focus:outline-none focus:border-[hsl(var(--bos-accent))]"
        />
        <button
          type="submit"
          disabled={loading}
          className="berufos-btn-primary px-6 py-3 disabled:opacity-50"
        >
          {loading ? "Wird gesendet..." : "Eintragen"}
        </button>
      </div>
    </form>
  );
}
