import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL } from '@/lib/seo';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, ExternalLink, Mail, MapPin, User, Calendar } from 'lucide-react';

// Rechtliche Basis-Informationen (zentral gepflegt)
const LEGAL_INFO = {
  unternehmensform: 'Einzelunternehmen',
  inhaberin: 'Diana Keil',
  firmenname: 'ExamFit by Diana Keil',
  strasse: 'Elsa-Brandström-Str. 4',
  plz: '76676',
  ort: 'Graben-Neudorf',
  land: 'Deutschland',
  email: 'info@examfit.de',
  website: 'https://examfit.de',
  ustIdNr: null as string | null,
} as const;

// Automatische Aktualisierung: Rechtsstand-Datum
const RECHTSSTAND = new Date().toLocaleDateString('de-DE', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export default function ImpressumPage() {
  const currentYear = new Date().getFullYear();

  return (
    <>
      <SEOHead
        title="Impressum | ExamFit"
        description={`Impressum von ExamFit – Angaben gemäß § 5 TMG und § 18 Abs. 2 MStV. ${LEGAL_INFO.firmenname}, ${LEGAL_INFO.ort}.`}
        canonical={`${SITE_URL}/impressum`}
        noindex={false}
      />

      <div className="min-h-screen py-12">
        <div className="container max-w-4xl">
          <Breadcrumbs
            items={[{ label: 'Impressum' }]}
            className="mb-8"
          />

          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
            Impressum
          </h1>

          <p className="text-sm text-muted-foreground mb-8 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Rechtsstand: {RECHTSSTAND}
          </p>

          <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">

            {/* Angaben gemäß § 5 TMG / § 18 Abs. 2 MStV */}
            <section>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Angaben gemäß § 5 TMG und § 18 Abs. 2 MStV
              </h2>
              <Card className="bg-muted/30">
                <CardContent className="pt-6">
                  <address className="not-italic text-foreground leading-relaxed">
                    <strong className="text-lg">{LEGAL_INFO.firmenname}</strong><br />
                    {LEGAL_INFO.inhaberin}<br />
                    {LEGAL_INFO.strasse}<br />
                    {LEGAL_INFO.plz} {LEGAL_INFO.ort}<br />
                    {LEGAL_INFO.land}
                  </address>
                </CardContent>
              </Card>
            </section>

            {/* Kontakt */}
            <section>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Kontakt
              </h2>
              <p className="text-muted-foreground">
                E-Mail:{' '}
                <a 
                  href={`mailto:${LEGAL_INFO.email}`} 
                  className="text-primary hover:underline"
                >
                  {LEGAL_INFO.email}
                </a>
                <br />
                Website:{' '}
                <a 
                  href={LEGAL_INFO.website} 
                  className="text-primary hover:underline"
                >
                  {LEGAL_INFO.website}
                </a>
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                <em>
                  Hinweis: Gemäß § 5 Abs. 1 Nr. 2 TMG ist für Einzelunternehmen keine 
                  Telefonnummer zwingend erforderlich, sofern eine schnelle elektronische 
                  Kontaktaufnahme gewährleistet ist. Wir antworten auf E-Mails in der 
                  Regel innerhalb von 24 Stunden an Werktagen.
                </em>
              </p>
            </section>

            {/* Vertretung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Vertretungsberechtigte Person</h2>
              <p className="text-muted-foreground">
                {LEGAL_INFO.inhaberin} (Inhaberin)
              </p>
            </section>

            {/* Umsatzsteuer-Information */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Umsatzsteuer</h2>
              {LEGAL_INFO.ustIdNr ? (
                <p className="text-muted-foreground">
                  Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG:<br />
                  <strong>{LEGAL_INFO.ustIdNr}</strong>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Umsatzsteuer-Identifikationsnummer wird nach Erteilung ergänzt.
                </p>
              )}
            </section>

            {/* Hinweis: Kein Handelsregistereintrag */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Registereintrag</h2>
              <p className="text-muted-foreground">
                {LEGAL_INFO.firmenname} ist als Einzelunternehmen tätig. 
                Ein Eintrag im Handelsregister besteht nicht, da dies für 
                Einzelunternehmen ohne kaufmännischen Geschäftsbetrieb 
                gesetzlich nicht erforderlich ist.
              </p>
            </section>

            {/* Redaktionelle Verantwortung § 18 Abs. 2 MStV */}
            <section>
              <h2 className="text-xl font-semibold mb-4">
                Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
              </h2>
              <p className="text-muted-foreground">
                {LEGAL_INFO.inhaberin}<br />
                {LEGAL_INFO.strasse}<br />
                {LEGAL_INFO.plz} {LEGAL_INFO.ort}
              </p>
            </section>

            {/* EU-Streitschlichtung */}
            <section>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <ExternalLink className="h-5 w-5 text-primary" />
                EU-Streitschlichtung
              </h2>
              <p className="text-muted-foreground mb-3">
                Die Europäische Kommission stellt eine Plattform zur 
                Online-Streitbeilegung (OS) bereit:{' '}
                <a 
                  href="https://ec.europa.eu/consumers/odr" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  https://ec.europa.eu/consumers/odr
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <p className="text-muted-foreground">
                Unsere E-Mail-Adresse finden Sie oben im Impressum.
              </p>
            </section>

            {/* Verbraucherstreitbeilegung gemäß § 36 VSBG */}
            <section>
              <h2 className="text-xl font-semibold mb-4">
                Verbraucherstreitbeilegung (§ 36 VSBG)
              </h2>
              <p className="text-muted-foreground">
                Wir sind weder bereit noch verpflichtet, an Streitbeilegungsverfahren 
                vor einer Verbraucherschlichtungsstelle teilzunehmen.
              </p>
            </section>

            {/* Haftung für Inhalte */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Haftung für Inhalte</h2>
              <p className="text-muted-foreground mb-3">
                Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene 
                Inhalte auf diesen Seiten nach den allgemeinen Gesetzen 
                verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter 
                jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde 
                Informationen zu überwachen oder nach Umständen zu forschen, 
                die auf eine rechtswidrige Tätigkeit hinweisen.
              </p>
              <p className="text-muted-foreground">
                Verpflichtungen zur Entfernung oder Sperrung der Nutzung von 
                Informationen nach den allgemeinen Gesetzen bleiben hiervon 
                unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem 
                Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. 
                Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden 
                wir diese Inhalte umgehend entfernen.
              </p>
            </section>

            {/* Haftung für Links */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Haftung für Links</h2>
              <p className="text-muted-foreground">
                Unser Angebot enthält Links zu externen Websites Dritter, auf 
                deren Inhalte wir keinen Einfluss haben. Deshalb können wir für 
                diese fremden Inhalte auch keine Gewähr übernehmen. Für die 
                Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter 
                oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten 
                wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße 
                überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der 
                Verlinkung nicht erkennbar.
              </p>
              <p className="text-muted-foreground mt-3">
                Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist 
                jedoch ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht 
                zumutbar. Bei Bekanntwerden von Rechtsverletzungen werden wir 
                derartige Links umgehend entfernen.
              </p>
            </section>

            {/* Urheberrecht */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Urheberrecht</h2>
              <p className="text-muted-foreground mb-3">
                Die durch die Seitenbetreiber erstellten Inhalte und Werke auf 
                diesen Seiten unterliegen dem deutschen Urheberrecht. Die 
                Vervielfältigung, Bearbeitung, Verbreitung und jede Art der 
                Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen 
                der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
              </p>
              <p className="text-muted-foreground">
                Downloads und Kopien dieser Seite sind nur für den privaten, 
                nicht kommerziellen Gebrauch gestattet. Soweit die Inhalte auf 
                dieser Seite nicht vom Betreiber erstellt wurden, werden die 
                Urheberrechte Dritter beachtet. Insbesondere werden Inhalte 
                Dritter als solche gekennzeichnet. Sollten Sie trotzdem auf eine 
                Urheberrechtsverletzung aufmerksam werden, bitten wir um einen 
                entsprechenden Hinweis. Bei Bekanntwerden von Rechtsverletzungen 
                werden wir derartige Inhalte umgehend entfernen.
              </p>
            </section>

            {/* KI-generierte Inhalte */}
            <section>
              <h2 className="text-xl font-semibold mb-4">Hinweis zu KI-generierten Inhalten</h2>
              <p className="text-muted-foreground">
                Teile der Lerninhalte auf dieser Plattform werden unter Zuhilfenahme 
                von Künstlicher Intelligenz (KI) erstellt oder bearbeitet. Alle 
                KI-generierten Inhalte werden redaktionell geprüft und entsprechen 
                den geltenden Prüfungsordnungen und Rahmenlehrplänen. Für die 
                inhaltliche Richtigkeit übernehmen wir im Rahmen der gesetzlichen 
                Bestimmungen die Verantwortung.
              </p>
            </section>

            {/* IHK/HWK Disclaimer */}
            <section>
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-6">
                  <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-primary" />
                    Hinweis zur Unabhängigkeit
                  </h2>
                  <p className="text-muted-foreground">
                    ExamFit ist ein <strong>unabhängiger</strong> Anbieter von 
                    Lernmaterialien zur Prüfungsvorbereitung. Es besteht{' '}
                    <strong>keine</strong> Zusammenarbeit, Partnerschaft, 
                    Zertifizierung oder offizielle Verbindung mit:
                  </p>
                  <ul className="list-disc pl-6 mt-3 text-muted-foreground space-y-1">
                    <li>der Industrie- und Handelskammer (IHK)</li>
                    <li>der Handwerkskammer (HWK)</li>
                    <li>Landwirtschaftskammern oder anderen Prüfungskammern</li>
                    <li>dem Bundesinstitut für Berufsbildung (BIBB)</li>
                    <li>der Kultusministerkonferenz (KMK)</li>
                  </ul>
                  <p className="text-muted-foreground mt-4">
                    Sämtliche Verweise auf „IHK", „HWK" oder andere Kammern dienen 
                    ausschließlich der beschreibenden Bezugnahme auf die jeweiligen 
                    Prüfungsordnungen und -formate. Alle Lerninhalte basieren auf 
                    öffentlich zugänglichen Rahmenlehrplänen und Ausbildungsverordnungen.
                  </p>
                </CardContent>
              </Card>
            </section>

            {/* Quellen der Rechtstexte */}
            <section className="border-t pt-8 mt-8">
              <h2 className="text-lg font-semibold mb-4 text-muted-foreground">
                Rechtsquellen und Aktualisierung
              </h2>
              <p className="text-sm text-muted-foreground mb-3">
                Dieses Impressum basiert auf folgenden Rechtsgrundlagen:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-6">
                <li>§ 5 Telemediengesetz (TMG)</li>
                <li>§ 18 Abs. 2 Medienstaatsvertrag (MStV)</li>
                <li>§ 36 Verbraucherstreitbeilegungsgesetz (VSBG)</li>
                <li>Art. 13, 14 Verordnung (EU) Nr. 524/2013 (ODR-Verordnung)</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                Letzte Prüfung: {RECHTSSTAND}
                <br />
                <span className="italic">
                  Das Impressum wird bei Rechtsänderungen aktualisiert. 
                  Bei wesentlichen Änderungen wird das Datum der letzten 
                  Aktualisierung entsprechend angepasst.
                </span>
              </p>
            </section>

            {/* Copyright Footer */}
            <section className="text-center pt-8 border-t">
              <p className="text-sm text-muted-foreground">
                © {currentYear} {LEGAL_INFO.firmenname}. Alle Rechte vorbehalten.
              </p>
            </section>

          </div>
        </div>
      </div>
    </>
  );
}
