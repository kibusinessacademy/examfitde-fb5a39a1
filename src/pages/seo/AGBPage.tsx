import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { SITE_URL } from '@/lib/seo';

export default function AGBPage() {
  const currentDate = new Date().toLocaleDateString('de-DE', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <>
      <SEOHead
        title="Allgemeine Geschäftsbedingungen (AGB) | ExamFit"
        description="Allgemeine Geschäftsbedingungen für die Nutzung der ExamFit Lernplattform und des Onlineshops. Gültig für alle Käufe und Nutzungsverträge."
        canonical={`${SITE_URL}/agb`}
        noindex={false}
      />

      <div className="min-h-screen py-12">
        <div className="container max-w-4xl">
          <Breadcrumbs
            items={[{ label: 'AGB' }]}
            className="mb-8"
          />

          <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
            Allgemeine Geschäftsbedingungen (AGB)
          </h1>
          <p className="text-muted-foreground mb-8">Stand: {currentDate}</p>

          <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">
            
            {/* §1 Geltungsbereich */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 1 Geltungsbereich und Anbieter</h2>
              <p className="text-muted-foreground mb-3">
                (1) Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen 
                ExamFit.de (nachfolgend "Anbieter") und dem Kunden (nachfolgend "Nutzer") über die 
                Nutzung der Lernplattform und den Kauf digitaler Produkte über den Onlineshop.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Abweichende Bedingungen des Nutzers werden nicht anerkannt, es sei denn, der 
                Anbieter stimmt ihrer Geltung ausdrücklich schriftlich zu.
              </p>
              <p className="text-muted-foreground">
                (3) Das Angebot richtet sich ausschließlich an Verbraucher und Unternehmer im Sinne 
                des deutschen Rechts mit Sitz in Deutschland, Österreich oder der Schweiz.
              </p>
            </section>

            {/* §2 Vertragsgegenstand */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 2 Vertragsgegenstand</h2>
              <p className="text-muted-foreground mb-3">
                (1) Der Anbieter stellt dem Nutzer digitale Lerninhalte zur Vorbereitung auf 
                IHK-Abschlussprüfungen zur Verfügung. Dies umfasst:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>Prüfungstraining mit prüfungsrelevantem Wissen</li>
                <li>Prüfungstrainer mit Übungsfragen und Prüfungssimulationen</li>
                <li>KI-gestützte mündliche Prüfungssimulation</li>
                <li>Zusätzliche Lernwerkzeuge und -funktionen</li>
              </ul>
              <p className="text-muted-foreground">
                (2) Die konkreten Leistungsmerkmale ergeben sich aus der jeweiligen Produktbeschreibung 
                zum Zeitpunkt des Kaufs.
              </p>
            </section>

            {/* §3 Vertragsschluss */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 3 Vertragsschluss und Registrierung</h2>
              <p className="text-muted-foreground mb-3">
                (1) Die Darstellung der Produkte im Onlineshop stellt kein rechtlich bindendes 
                Angebot, sondern eine Aufforderung zur Bestellung dar.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Der Nutzer gibt durch Klicken des Buttons "Jetzt kaufen" ein verbindliches 
                Kaufangebot ab. Der Vertrag kommt mit der Annahme durch den Anbieter zustande, 
                die durch eine Bestellbestätigung per E-Mail erklärt wird.
              </p>
              <p className="text-muted-foreground mb-3">
                (3) Für die Nutzung der Plattform ist eine Registrierung mit gültiger E-Mail-Adresse 
                erforderlich. Der Nutzer ist verpflichtet, wahrheitsgemäße Angaben zu machen und 
                seine Zugangsdaten geheim zu halten.
              </p>
              <p className="text-muted-foreground">
                (4) Jeder Nutzer darf nur ein Konto anlegen. Die Weitergabe von Zugangsdaten an 
                Dritte ist nicht gestattet.
              </p>
            </section>

            {/* §4 Preise und Zahlung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 4 Preise und Zahlungsbedingungen</h2>
              <p className="text-muted-foreground mb-3">
                (1) Alle angegebenen Preise sind Endpreise und verstehen sich inklusive der 
                gesetzlichen Mehrwertsteuer.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Die Zahlung erfolgt einmalig vor Freischaltung des Produkts. Es handelt sich 
                nicht um ein Abonnement; eine automatische Verlängerung oder wiederkehrende 
                Zahlungen finden nicht statt.
              </p>
              <p className="text-muted-foreground mb-3">
                (3) Der Anbieter akzeptiert folgende Zahlungsmethoden: Kreditkarte, PayPal, 
                SEPA-Lastschrift sowie auf Anfrage Überweisung für B2B-Kunden.
              </p>
              <p className="text-muted-foreground">
                (4) Bei Zahlungsverzug ist der Anbieter berechtigt, den Zugang zur Plattform zu 
                sperren und Verzugszinsen in gesetzlicher Höhe zu berechnen.
              </p>
            </section>

            {/* §5 Nutzungsrecht und Lizenzen */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 5 Nutzungsrecht und Lizenzen</h2>
              <p className="text-muted-foreground mb-3">
                (1) Mit vollständiger Zahlung erhält der Nutzer ein einfaches, nicht übertragbares, 
                zeitlich auf die Laufzeit begrenztes Nutzungsrecht an den erworbenen Inhalten.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Die Standardlaufzeit beträgt 12 Monate ab Kaufdatum, sofern nicht anders 
                vereinbart.
              </p>
              <p className="text-muted-foreground mb-3">
                (3) Die Nutzungsrechte gelten ausschließlich für den persönlichen Gebrauch. 
                Untersagt ist:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>Die Vervielfältigung, Verbreitung oder öffentliche Zugänglichmachung der Inhalte</li>
                <li>Die Weitergabe des Zugangs an Dritte</li>
                <li>Die kommerzielle Verwertung der Inhalte</li>
                <li>Das Aufzeichnen, Herunterladen oder Speichern von Inhalten (soweit nicht ausdrücklich erlaubt)</li>
              </ul>
              <p className="text-muted-foreground">
                (4) Sämtliche Urheberrechte, Markenrechte und sonstigen Schutzrechte an den Inhalten 
                verbleiben beim Anbieter oder den jeweiligen Rechteinhabern.
              </p>
            </section>

            {/* §6 Widerrufsrecht */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 6 Widerrufsrecht für Verbraucher</h2>
              <p className="text-muted-foreground mb-3">
                <strong>Widerrufsbelehrung:</strong>
              </p>
              <p className="text-muted-foreground mb-3">
                Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag 
                zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des 
                Vertragsschlusses.
              </p>
              <p className="text-muted-foreground mb-3">
                Um Ihr Widerrufsrecht auszuüben, müssen Sie uns mittels einer eindeutigen Erklärung 
                (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen 
                Vertrag zu widerrufen, informieren. Sie können hierfür das beigefügte 
                Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.
              </p>
              <p className="text-muted-foreground mb-3">
                <strong>Besondere Hinweise:</strong> Das Widerrufsrecht erlischt bei einem Vertrag 
                zur Lieferung digitaler Inhalte, die nicht auf einem körperlichen Datenträger 
                geliefert werden, wenn der Anbieter mit der Ausführung des Vertrags begonnen hat, 
                nachdem der Verbraucher
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>ausdrücklich zugestimmt hat, dass der Anbieter mit der Ausführung des Vertrags 
                vor Ablauf der Widerrufsfrist beginnt, und</li>
                <li>seine Kenntnis davon bestätigt hat, dass er durch seine Zustimmung mit Beginn 
                der Ausführung des Vertrags sein Widerrufsrecht verliert.</li>
              </ul>
              <p className="text-muted-foreground">
                Diese Zustimmung wird im Rahmen des Bestellprozesses eingeholt.
              </p>
            </section>

            {/* §7 Verfügbarkeit und Gewährleistung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 7 Verfügbarkeit, Aktualität und Gewährleistung</h2>
              <p className="text-muted-foreground mb-3">
                (1) Der Anbieter bemüht sich um eine hohe Verfügbarkeit der Plattform, übernimmt 
                jedoch keine Garantie für eine unterbrechungsfreie Nutzung. Wartungsarbeiten 
                werden nach Möglichkeit vorab angekündigt.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Die digitalen Inhalte entsprechen den vereinbarten Beschreibungen zum 
                Zeitpunkt des Kaufs. Der Anbieter behält sich vor, Inhalte zu aktualisieren 
                oder zu verbessern, sofern der Nutzungszweck nicht wesentlich eingeschränkt wird.
              </p>
              <p className="text-muted-foreground mb-3">
                (3) Die Lerninhalte dienen der Prüfungsvorbereitung. Der Anbieter garantiert 
                nicht das Bestehen einer Prüfung.
              </p>
              <p className="text-muted-foreground mb-3">
                (4) Die Inhalte werden mit größter Sorgfalt erstellt und regelmäßig aktualisiert.
                Aufgrund von Gesetzesänderungen, Prüfungsanpassungen und externen Einflüssen
                kann jedoch keine Gewähr für die jederzeitige Aktualität, Vollständigkeit oder
                Richtigkeit übernommen werden. Jeder Kurs zeigt den Stand der letzten
                inhaltlichen Überprüfung an.
              </p>
              <p className="text-muted-foreground mb-3">
                (5) Die Inhalte ersetzen keine individuelle Beratung durch qualifizierte
                Fachpersonen (z.&nbsp;B. Steuerberater, Rechtsanwälte oder Finanzberater).
                Die Nutzung der bereitgestellten Inhalte erfolgt auf eigene Verantwortung
                des Nutzers.
              </p>
              <p className="text-muted-foreground">
                (6) Teile der Lerninhalte werden mithilfe von KI-Technologie erstellt und
                durchlaufen ein mehrstufiges Qualitätssicherungsverfahren. Der Anbieter
                übernimmt die redaktionelle Verantwortung für alle veröffentlichten Inhalte.
              </p>
            </section>

            {/* §7a Unabhängigkeit */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 7a Unabhängigkeit</h2>
              <p className="text-muted-foreground">
                ExamFit ist ein unabhängiger Anbieter von Lernmaterialien zur
                Prüfungsvorbereitung. Es besteht keine Zusammenarbeit, Partnerschaft oder
                offizielle Verbindung mit der Industrie- und Handelskammer (IHK), der
                Handwerkskammer (HWK) oder der Bundesanstalt für Finanzdienstleistungsaufsicht
                (BaFin). Alle Inhalte basieren auf öffentlich zugänglichen Rahmenlehrplänen,
                Prüfungsordnungen und Gesetzestexten.
              </p>
            </section>

            {/* §8 Haftung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 8 Haftungsbeschränkung</h2>
              <p className="text-muted-foreground mb-3">
                (1) Der Anbieter haftet unbeschränkt für Schäden aus der Verletzung des Lebens, 
                des Körpers oder der Gesundheit sowie für vorsätzlich oder grob fahrlässig 
                verursachte Schäden.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Bei leichter Fahrlässigkeit haftet der Anbieter nur bei Verletzung wesentlicher 
                Vertragspflichten (Kardinalpflichten) und begrenzt auf den vorhersehbaren, 
                vertragstypischen Schaden.
              </p>
              <p className="text-muted-foreground mb-3">
                (3) Für Schäden aus dem Verlust von Daten haftet der Anbieter nur, soweit diese 
                durch angemessene Datensicherungsmaßnahmen des Nutzers nicht vermeidbar gewesen wären.
              </p>
              <p className="text-muted-foreground">
                (4) Die Haftung nach dem Produkthaftungsgesetz bleibt unberührt.
              </p>
            </section>

            {/* §9 B2B / Unternehmerkunden */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 9 Besondere Bestimmungen für Unternehmer</h2>
              <p className="text-muted-foreground mb-3">
                (1) Für Verträge mit Unternehmern im Sinne des § 14 BGB gelten ergänzend die 
                nachfolgenden Bestimmungen.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Das Widerrufsrecht nach § 6 dieser AGB gilt nicht für Unternehmer.
              </p>
              <p className="text-muted-foreground mb-3">
                (3) Bei Volumenkäufen (ab 5 Lizenzen) können individuelle Vereinbarungen 
                getroffen werden. Mengenrabatte werden automatisch im Checkout berechnet.
              </p>
              <p className="text-muted-foreground">
                (4) Erfüllungsort und Gerichtsstand für alle Streitigkeiten aus dem 
                Vertragsverhältnis ist der Sitz des Anbieters.
              </p>
            </section>

            {/* §10 Kündigung und Sperrung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 10 Vertragslaufzeit und Beendigung</h2>
              <p className="text-muted-foreground mb-3">
                (1) Der Nutzungsvertrag endet automatisch mit Ablauf der erworbenen Laufzeit 
                ohne dass es einer Kündigung bedarf.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Der Anbieter ist berechtigt, den Zugang zur Plattform bei schwerwiegenden 
                Verstößen gegen diese AGB mit sofortiger Wirkung zu sperren, insbesondere bei:
              </p>
              <ul className="list-disc list-inside text-muted-foreground mb-3 ml-4 space-y-1">
                <li>Weitergabe von Zugangsdaten an Dritte</li>
                <li>Unberechtigte Vervielfältigung oder Verbreitung von Inhalten</li>
                <li>Manipulation der Plattform oder ihrer Inhalte</li>
                <li>Verstoß gegen geltendes Recht</li>
              </ul>
              <p className="text-muted-foreground">
                (3) Im Falle einer berechtigten Sperrung besteht kein Anspruch auf Rückerstattung 
                bereits gezahlter Beträge.
              </p>
            </section>

            {/* §11 Datenschutz */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 11 Datenschutz</h2>
              <p className="text-muted-foreground">
                Die Erhebung, Verarbeitung und Nutzung personenbezogener Daten erfolgt gemäß 
                unserer Datenschutzerklärung, die unter{' '}
                <a href="/datenschutz" className="text-primary hover:underline">/datenschutz</a>{' '}
                einsehbar ist.
              </p>
            </section>

            {/* §12 Streitbeilegung */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 12 Online-Streitbeilegung</h2>
              <p className="text-muted-foreground mb-3">
                Die EU-Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
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
                Der Anbieter ist weder bereit noch verpflichtet, an Streitbeilegungsverfahren 
                vor einer Verbraucherschlichtungsstelle teilzunehmen.
              </p>
            </section>

            {/* §13 Schlussbestimmungen */}
            <section>
              <h2 className="text-xl font-semibold mb-4">§ 13 Schlussbestimmungen</h2>
              <p className="text-muted-foreground mb-3">
                (1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des 
                UN-Kaufrechts.
              </p>
              <p className="text-muted-foreground mb-3">
                (2) Sollten einzelne Bestimmungen dieser AGB unwirksam sein oder werden, bleibt 
                die Wirksamkeit der übrigen Bestimmungen unberührt. Anstelle der unwirksamen 
                Bestimmung gilt eine dem wirtschaftlichen Zweck möglichst nahekommende Regelung.
              </p>
              <p className="text-muted-foreground">
                (3) Der Anbieter behält sich vor, diese AGB jederzeit mit Wirkung für die Zukunft 
                zu ändern. Über wesentliche Änderungen werden registrierte Nutzer per E-Mail 
                informiert.
              </p>
            </section>

          </div>
        </div>
      </div>
    </>
  );
}
