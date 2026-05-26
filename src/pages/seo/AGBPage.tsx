import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { BerufOSHeader } from "@/components/berufos/BerufOSHeader";
import { BerufOSFooter } from "@/components/berufos/BerufOSFooter";
import { AGB_CLAUSES, LEGAL_LAST_UPDATED } from "@/lib/legal/legal-copy";
import { BERUFOS } from "@/lib/berufos/brand";

import "@/components/berufos/berufos-theme.css";

export default function AGBPage() {
  const canonical = `${BERUFOS.domain}/agb`;

  return (
    <div className="berufos min-h-screen bg-background">
      <Helmet>
        <title>AGB — BerufOS</title>
        <meta
          name="description"
          content="Allgemeine Geschäftsbedingungen der Plattform BerufOS. DSGVO- & EU-AI-Act-konform, mit transparenten Hinweisen zu KI-gestützten Leistungen."
        />
        <meta name="robots" content="index,follow" />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content="AGB — BerufOS" />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
      </Helmet>

      <BerufOSHeader />

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-xs berufos-text-dim uppercase tracking-wider mb-3">
          Rechtliches
        </div>
        <h1 className="text-4xl font-semibold tracking-tight mb-2">
          Allgemeine Geschäftsbedingungen
        </h1>
        <p className="text-sm berufos-text-faint mb-12">
          BerufOS – Diana Keil Einzelunternehmen · Stand {LEGAL_LAST_UPDATED}
        </p>

        {AGB_CLAUSES.map((clause) => {
          const bulletsAfter = clause.bulletsAfterIndex ?? clause.paragraphs.length - 1;
          return (
            <section key={clause.number} className="mb-10">
              <h2 className="text-lg font-semibold mb-4">
                {clause.number}. {clause.title}
              </h2>
              {clause.paragraphs.map((p, i) => (
                <div key={i}>
                  <p className="text-sm berufos-text-dim leading-relaxed mb-3">{p}</p>
                  {clause.bullets && i === bulletsAfter ? (
                    <ul className="text-sm berufos-text-dim list-disc pl-5 space-y-1 mb-4">
                      {clause.bullets.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </section>
          );
        })}

        <div className="border-t berufos-hairline pt-6 text-sm">
          <Link to="/impressum" className="berufos-text-dim hover:text-foreground">
            Impressum →
          </Link>
        </div>
      </main>

      <BerufOSFooter />
    </div>
  );
}
