import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { BerufOSHeader } from "@/components/berufos/BerufOSHeader";
import { BerufOSFooter } from "@/components/berufos/BerufOSFooter";
import { IMPRESSUM, LEGAL_LAST_UPDATED } from "@/lib/legal/legal-copy";
import { BERUFOS } from "@/lib/berufos/brand";

import "@/components/berufos/berufos-theme.css";

export default function ImpressumPage() {
  const canonical = `${BERUFOS.domain}/impressum`;
  const { provider, contentResponsible, aiTransparency, liability, copyright, privacyShort } = IMPRESSUM;

  return (
    <div className="berufos min-h-screen bg-background">
      <Helmet>
        <title>Impressum — BerufOS</title>
        <meta
          name="description"
          content="Anbieterkennzeichnung gemäß § 5 TMG, KI-Transparenzhinweise nach EU AI Act, Haftungsausschluss und Urheberrecht für BerufOS."
        />
        <meta name="robots" content="index,follow" />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content="Impressum — BerufOS" />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
      </Helmet>

      <BerufOSHeader />

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3">
          Rechtliches
        </div>
        <h1 className="text-4xl font-semibold tracking-tight mb-2">
          Impressum
        </h1>
        <p className="text-sm berufos-text-faint mb-12">
          DSGVO- & EU-AI-Act-konform · Stand {LEGAL_LAST_UPDATED}
        </p>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-3">Anbieterkennzeichnung gemäß § 5 TMG</h2>
          <p className="text-sm berufos-text-dim leading-relaxed whitespace-pre-line">
            {provider.name}
            {"\n"}{provider.street}
            {"\n"}{provider.city}
            {"\n"}{provider.country}
            {"\n"}
            {"\n"}Telefon: {provider.phone}
            {"\n"}E-Mail: {provider.email}
            {"\n"}
            {"\n"}Inhaberin: {provider.owner}
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-3">
            Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
          </h2>
          <p className="text-sm berufos-text-dim leading-relaxed whitespace-pre-line">
            {contentResponsible.name}
            {"\n"}{contentResponsible.street}
            {"\n"}{contentResponsible.city}
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-3">
            Hinweise zur KI-Nutzung (EU AI Act Transparenz)
          </h2>
          <p className="text-sm berufos-text-dim leading-relaxed mb-3">
            {aiTransparency.intro}
          </p>
          <ul className="text-sm berufos-text-dim list-disc pl-5 space-y-1 mb-6">
            {aiTransparency.purposes.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="text-sm berufos-text-dim leading-relaxed mb-3">
            {aiTransparency.disclaimer}
          </p>
          <ul className="text-sm berufos-text-dim list-disc pl-5 space-y-1 mb-6">
            {aiTransparency.notReplacing.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="text-sm font-medium mb-6">
            {aiTransparency.closing}
          </p>
          <p className="text-sm berufos-text-dim leading-relaxed mb-3">
            {aiTransparency.principlesIntro}
          </p>
          <ul className="text-sm berufos-text-dim list-disc pl-5 space-y-1">
            {aiTransparency.principles.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-3">Haftungsausschluss</h2>
          {liability.map((p, i) => (
            <p key={i} className="text-sm berufos-text-dim leading-relaxed mb-3">{p}</p>
          ))}
        </section>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-3">Urheberrecht</h2>
          <p className="text-sm berufos-text-dim leading-relaxed">{copyright}</p>
        </section>

        <section className="mb-12">
          <h2 className="text-lg font-semibold mb-3">Datenschutz-Hinweis (Kurzfassung)</h2>
          <p className="text-sm berufos-text-dim leading-relaxed">{privacyShort}</p>
        </section>

        <div className="border-t berufos-hairline pt-6 text-sm">
          <Link to="/agb" className="berufos-text-dim hover:text-foreground">
            Allgemeine Geschäftsbedingungen →
          </Link>
        </div>
      </main>

      <BerufOSFooter />
    </div>
  );
}
