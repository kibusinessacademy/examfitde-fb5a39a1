import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL } from '@/lib/seo';

export default function ImpressumPage() {
  return (
    <>
      <SEOHead
        title="Impressum | ExamFit"
        description="Impressum von ExamFit – Angaben gemäß § 5 TMG. Kontaktdaten, Verantwortliche und rechtliche Hinweise."
        canonical={`${SITE_URL}/impressum`}
        noindex={false}
      />

      <div className="min-h-screen py-12">
        <div className="container max-w-4xl">
          <Breadcrumbs
            items={[{ label: 'Impressum' }]}
            className="mb-8"
          />

          <h1 className="text-3xl md:text-4xl font-display font-bold mb-8">
            Impressum
          </h1>

          <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">

            {/* Angaben gemäß § 5 TMG */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Angaben gemäß § 5 TMG</h2>
              <p className="text-muted-foreground mb-3">
                ExamFit.de<br />
                [Vollständiger Name des Betreibers/Unternehmens]<br />
                [Straße und Hausnummer]<br />
                [PLZ und Stadt]<br />
                Deutschland
              </p>
            </section>

            {/* Kontakt */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Kontakt</h2>
              <p className="text-muted-foreground">
                E-Mail: kontakt@examfit.de<br />
                Website:{' '}
                <a href="https://examfit.de" className="text-primary hover:underline">
                  https://examfit.de
                </a>
              </p>
            </section>

            {/* Vertreten durch */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Vertreten durch</h2>
              <p className="text-muted-foreground">
                [Name des Geschäftsführers / Inhabers]
              </p>
            </section>

            {/* Handelsregister (falls zutreffend) */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Registereintrag</h2>
              <p className="text-muted-foreground">
                [Falls zutreffend:]<br />
                Handelsregister: [Amtsgericht]<br />
                Registernummer: [HRB-Nummer]
              </p>
            </section>

            {/* Umsatzsteuer-ID */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Umsatzsteuer-ID</h2>
              <p className="text-muted-foreground">
                Umsatzsteuer-Identifikationsnummer gemäß §27a Umsatzsteuergesetz:<br />
                DE[XXXXXXXXX]
              </p>
            </section>

            {/* Verantwortlich für Inhalt */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Redaktionell verantwortlich</h2>
              <p className="text-muted-foreground">
                [Name]<br />
                [Adresse]
              </p>
            </section>

            {/* EU-Streitschlichtung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">EU-Streitschlichtung</h2>
              <p className="text-muted-foreground mb-3">
                Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
                <a 
                  href="https://ec.europa.eu/consumers/odr" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  https://ec.europa.eu/consumers/odr
                </a>
              </p>
              <p className="text-muted-foreground">
                Unsere E-Mail-Adresse finden Sie oben im Impressum.
              </p>
            </section>

            {/* Verbraucherstreitbeilegung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Verbraucherstreitbeilegung / Universalschlichtungsstelle</h2>
              <p className="text-muted-foreground">
                Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer 
                Verbraucherschlichtungsstelle teilzunehmen.
              </p>
            </section>

            {/* Haftungsausschluss */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Haftung für Inhalte</h2>
              <p className="text-muted-foreground mb-3">
                Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen 
                Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir 
                als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte 
                fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine 
                rechtswidrige Tätigkeit hinweisen.
              </p>
              <p className="text-muted-foreground">
                Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach 
                den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung 
                ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung 
                möglich. Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese 
                Inhalte umgehend entfernen.
              </p>
            </section>

            {/* Haftung für Links */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Haftung für Links</h2>
              <p className="text-muted-foreground">
                Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir 
                keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine 
                Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige 
                Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden 
                zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige 
                Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar. Eine permanente 
                inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne konkrete Anhaltspunkte 
                einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen 
                werden wir derartige Links umgehend entfernen.
              </p>
            </section>

            {/* Urheberrecht */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Urheberrecht</h2>
              <p className="text-muted-foreground mb-3">
                Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten 
                unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, 
                Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes 
                bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
              </p>
              <p className="text-muted-foreground">
                Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen 
                Gebrauch gestattet. Soweit die Inhalte auf dieser Seite nicht vom Betreiber 
                erstellt wurden, werden die Urheberrechte Dritter beachtet. Insbesondere werden 
                Inhalte Dritter als solche gekennzeichnet. Sollten Sie trotzdem auf eine 
                Urheberrechtsverletzung aufmerksam werden, bitten wir um einen entsprechenden 
                Hinweis. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Inhalte 
                umgehend entfernen.
              </p>
            </section>

          </div>
        </div>
      </div>
    </>
  );
}
