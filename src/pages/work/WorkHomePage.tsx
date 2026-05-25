import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/brand/ssot';

export default function WorkHomePage() {
  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{BRAND.seo.title}</title>
        <meta name="description" content={BRAND.seo.desc} />
        <link rel="canonical" href={`${BRAND.appBase}/work`} />
      </Helmet>

      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight">{BRAND.name}</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          KI-Workflows, Copilot-Prompts &amp; Mini-SOPs – pro Beruf. Sofort nutzbar, praxisnah, DSGVO-sensibel.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link to="/berufs-ki/app" className="inline-flex items-center rounded-xl bg-primary px-6 py-3 text-primary-foreground font-medium hover:opacity-90">
            Berufs-KI öffnen
          </Link>
          <Link to="/berufe" className="inline-flex items-center rounded-xl border px-6 py-3 font-medium hover:bg-muted">
            Berufe ansehen
          </Link>
        </div>

        <div className="mt-16 text-left">
          <h2 className="text-xl font-semibold">Für wen?</h2>
          <ul className="mt-3 space-y-2 text-muted-foreground">
            <li>✔ Azubis (16–20) &amp; Ausbildungsbetriebe</li>
            <li>✔ Verwaltung, Handwerk, Gesundheit, Handel, Industrie</li>
            <li>✔ Teams, Schulen, Behörden (Corporate Lizenz)</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
