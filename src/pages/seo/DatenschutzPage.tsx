import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL } from '@/lib/seo';

export default function DatenschutzPage() {
  const currentDate = new Date().toLocaleDateString('de-DE', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <>
      <SEOHead
        title="Datenschutzerklärung | ExamFit"
        description="Datenschutzerklärung von ExamFit: Informationen zur Erhebung, Verarbeitung und Nutzung personenbezogener Daten gemäß DSGVO."
        canonical={`${SITE_URL}/datenschutz`}
        noindex={false}
      />

      <div className="min-h-screen py-12">
        <div className="container max-w-4xl">
          <Breadcrumbs
            items={[{ label: 'Datenschutz' }]}
            className="mb-8"
          />

          <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
            Datenschutzerklärung
          </h1>
          <p className="text-muted-foreground mb-8">Stand: {currentDate}</p>

          <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">

            {/* Einleitung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">1. Verantwortlicher</h2>
              <p className="text-muted-foreground mb-3">
                Verantwortlich für die Datenverarbeitung auf dieser Website ist:
              </p>
              <p className="text-muted-foreground mb-3">
                ExamFit.de<br />
                [Vollständige Adresse einfügen]<br />
                E-Mail: datenschutz@berufos.com
              </p>
            </section>

            {/* Datenerfassung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">2. Erhebung und Verarbeitung personenbezogener Daten</h2>
              
              <h3 className="text-lg font-medium mb-3">2.1 Beim Besuch der Website</h3>
              <p className="text-muted-foreground mb-3">
                Bei jedem Aufruf unserer Website erfasst unser System automatisiert Daten und 
                Informationen vom Computersystem des aufrufenden Rechners:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>IP-Adresse (anonymisiert)</li>
                <li>Datum und Uhrzeit der Anfrage</li>
                <li>Browsertyp und -version</li>
                <li>Verwendetes Betriebssystem</li>
                <li>Referrer URL</li>
              </ul>
              <p className="text-muted-foreground mb-3">
                <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse 
                an der technischen Bereitstellung und Sicherheit der Website).
              </p>

              <h3 className="text-lg font-medium mb-3">2.2 Bei der Registrierung</h3>
              <p className="text-muted-foreground mb-3">
                Bei der Registrierung erheben wir folgende Daten:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>E-Mail-Adresse (erforderlich)</li>
                <li>Name (optional)</li>
                <li>Passwort (verschlüsselt gespeichert)</li>
              </ul>
              <p className="text-muted-foreground mb-3">
                <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).
              </p>

              <h3 className="text-lg font-medium mb-3">2.3 Beim Kauf</h3>
              <p className="text-muted-foreground mb-3">
                Beim Kauf erheben wir zusätzlich:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>Rechnungsadresse (für B2B-Kunden)</li>
                <li>Zahlungsinformationen (werden nicht bei uns gespeichert, sondern direkt bei Stripe verarbeitet)</li>
              </ul>
            </section>

            {/* Prüfungsfortschritt */}
            <section>
              <h2 className="text-xl font-semibold mb-4">3. Verarbeitung von Prüfungsfortschrittsdaten</h2>
              <p className="text-muted-foreground mb-3">
                Zur Bereitstellung unseres Prüfungstrainings verarbeiten wir:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>Antworten auf Übungsfragen und deren Korrektheit</li>
                <li>Fortschritt im Prüfungstraining</li>
                <li>Zeitpunkte der Nutzung</li>
                <li>Ergebnisse von Prüfungssimulationen</li>
              </ul>
              <p className="text-muted-foreground mb-3">
                Diese Daten werden zur Personalisierung des Lernerlebnisses und zur Bereitstellung 
                adaptiver Lernfunktionen verwendet.
              </p>
              <p className="text-muted-foreground">
                <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).
              </p>
            </section>

            {/* Drittanbieter */}
            <section>
              <h2 className="text-xl font-semibold mb-4">4. Drittanbieter und Auftragsverarbeiter</h2>
              
              <h3 className="text-lg font-medium mb-3">4.1 Supabase (Hosting & Datenbank)</h3>
              <p className="text-muted-foreground mb-3">
                Wir nutzen Supabase für das Hosting unserer Anwendung und Datenbank. 
                Server-Standort: Europäische Union. Ein Auftragsverarbeitungsvertrag liegt vor.
              </p>

              <h3 className="text-lg font-medium mb-3">4.2 Stripe (Zahlungsabwicklung)</h3>
              <p className="text-muted-foreground mb-3">
                Die Zahlungsabwicklung erfolgt über Stripe Payments Europe, Ltd. Zahlungsdaten werden 
                direkt an Stripe übermittelt und dort verarbeitet. Stripe ist PCI DSS zertifiziert.
              </p>
              <p className="text-muted-foreground mb-3">
                Datenschutzerklärung von Stripe:{' '}
                <a 
                  href="https://stripe.com/de/privacy" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  https://stripe.com/de/privacy
                </a>
              </p>

              <h3 className="text-lg font-medium mb-3">4.3 KI-Dienste</h3>
              <p className="text-muted-foreground mb-3">
                Für unsere KI-Funktionen (KI-Tutor, mündliche Prüfungssimulation) nutzen wir 
                Sprachmodelle. Dabei werden nur die für die jeweilige Anfrage notwendigen Daten 
                übermittelt, keine personenbezogenen Daten.
              </p>
            </section>

            {/* Cookies */}
            <section>
              <h2 className="text-xl font-semibold mb-4">5. Cookies und lokale Speicherung</h2>
              <p className="text-muted-foreground mb-3">
                Wir verwenden technisch notwendige Cookies für:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>Session-Management (Login-Status)</li>
                <li>Sicherheitsfunktionen (CSRF-Schutz)</li>
                <li>Benutzereinstellungen (z.B. Dark Mode)</li>
              </ul>
              <p className="text-muted-foreground mb-3">
                Wir verwenden <strong>keine</strong> Tracking-Cookies oder Werbe-Cookies.
              </p>
              <p className="text-muted-foreground">
                <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse 
                an der Funktionalität der Website).
              </p>
            </section>

            {/* Betroffenenrechte */}
            <section>
              <h2 className="text-xl font-semibold mb-4">6. Ihre Rechte</h2>
              <p className="text-muted-foreground mb-3">
                Sie haben folgende Rechte bezüglich Ihrer personenbezogenen Daten:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li><strong>Auskunftsrecht (Art. 15 DSGVO):</strong> Sie können Auskunft über Ihre 
                verarbeiteten Daten verlangen.</li>
                <li><strong>Berichtigungsrecht (Art. 16 DSGVO):</strong> Sie können die Berichtigung 
                unrichtiger Daten verlangen.</li>
                <li><strong>Löschungsrecht (Art. 17 DSGVO):</strong> Sie können die Löschung Ihrer 
                Daten verlangen, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</li>
                <li><strong>Einschränkung der Verarbeitung (Art. 18 DSGVO):</strong> Sie können 
                die Einschränkung der Verarbeitung verlangen.</li>
                <li><strong>Datenübertragbarkeit (Art. 20 DSGVO):</strong> Sie können Ihre Daten 
                in einem maschinenlesbaren Format erhalten.</li>
                <li><strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Sie können der Verarbeitung 
                widersprechen.</li>
              </ul>
              <p className="text-muted-foreground">
                Zur Ausübung Ihrer Rechte kontaktieren Sie uns unter: datenschutz@berufos.com
              </p>
            </section>

            {/* Speicherdauer */}
            <section>
              <h2 className="text-xl font-semibold mb-4">7. Speicherdauer</h2>
              <p className="text-muted-foreground mb-3">
                Wir speichern personenbezogene Daten nur so lange, wie es für die jeweiligen 
                Zwecke erforderlich ist:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li><strong>Kontodaten:</strong> Bis zur Löschung des Kontos durch den Nutzer</li>
                <li><strong>Lernfortschrittsdaten:</strong> Während der Vertragslaufzeit und 
                6 Monate danach</li>
                <li><strong>Rechnungsdaten:</strong> 10 Jahre (gesetzliche Aufbewahrungspflicht)</li>
                <li><strong>Server-Logs:</strong> 7 Tage</li>
              </ul>
            </section>

            {/* Datensicherheit */}
            <section>
              <h2 className="text-xl font-semibold mb-4">8. Datensicherheit</h2>
              <p className="text-muted-foreground mb-3">
                Wir setzen technische und organisatorische Sicherheitsmaßnahmen ein:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>SSL/TLS-Verschlüsselung aller Datenübertragungen</li>
                <li>Verschlüsselte Speicherung von Passwörtern</li>
                <li>Row Level Security für Datenbankzugriffe</li>
                <li>Regelmäßige Sicherheitsupdates</li>
              </ul>
            </section>

            {/* Beschwerderecht */}
            <section>
              <h2 className="text-xl font-semibold mb-4">9. Beschwerderecht</h2>
              <p className="text-muted-foreground">
                Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, 
                wenn Sie der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten 
                gegen die DSGVO verstößt.
              </p>
            </section>

            {/* Änderungen */}
            <section>
              <h2 className="text-xl font-semibold mb-4">10. Änderungen dieser Datenschutzerklärung</h2>
              <p className="text-muted-foreground">
                Wir behalten uns vor, diese Datenschutzerklärung anzupassen, um sie an geänderte 
                Rechtslagen oder bei Änderungen der Datenverarbeitung anzupassen. Die aktuelle 
                Version ist stets auf unserer Website verfügbar.
              </p>
            </section>

          </div>
        </div>
      </div>
    </>
  );
}
