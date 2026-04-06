import { Helmet } from 'react-helmet-async';

export default function AGB() {
  return (
    <>
      <Helmet>
        <title>AGB – Allgemeine Geschäftsbedingungen | ExamFit</title>
        <meta name="description" content="Allgemeine Geschäftsbedingungen der Plattform ExamFit für digitale Prüfungsvorbereitung." />
      </Helmet>

      <div className="max-w-3xl mx-auto px-4 py-12 prose prose-sm dark:prose-invert">
        <h1>Allgemeine Geschäftsbedingungen (AGB)</h1>
        <p className="text-muted-foreground text-xs">Stand: April 2026</p>

        <h2>§ 1 Leistungsbeschreibung</h2>
        <p>
          Die Plattform ExamFit stellt digitale Lern- und Prüfungstrainings zur Verfügung.
          Die Inhalte dienen der Vorbereitung auf Prüfungen, stellen jedoch keine rechtliche,
          steuerliche oder berufliche Beratung dar.
        </p>

        <h2>§ 2 Keine Erfolgsgarantie</h2>
        <p>
          Eine Garantie für das Bestehen einer Prüfung wird nicht übernommen.
          Der Lernerfolg hängt maßgeblich vom individuellen Einsatz des Nutzers ab.
        </p>

        <h2>§ 3 Aktualität der Inhalte</h2>
        <p>
          Die Inhalte werden mit größter Sorgfalt erstellt und regelmäßig aktualisiert.
          Aufgrund von Gesetzesänderungen, Prüfungsanpassungen und externen Einflüssen
          kann jedoch keine Gewähr für die jederzeitige Aktualität, Vollständigkeit oder
          Richtigkeit übernommen werden.
        </p>
        <p>
          Jeder Kurs zeigt den Stand der letzten inhaltlichen Überprüfung an.
          Bei erkannten regulatorischen Änderungen werden betroffene Inhalte
          unverzüglich überprüft und gegebenenfalls aktualisiert.
        </p>

        <h2>§ 4 Haftungsbeschränkung</h2>
        <p>
          Die Haftung von ExamFit ist ausgeschlossen für einfache Fahrlässigkeit,
          soweit keine wesentlichen Vertragspflichten (Kardinalpflichten) verletzt werden.
        </p>
        <p>
          Bei Verletzung wesentlicher Vertragspflichten ist die Haftung auf den
          vorhersehbaren, typischen Schaden begrenzt.
        </p>
        <p>
          Die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder
          der Gesundheit sowie nach dem Produkthaftungsgesetz bleibt unberührt.
        </p>

        <h2>§ 5 Keine Beratung</h2>
        <p>
          Die Inhalte ersetzen keine individuelle Beratung durch qualifizierte
          Fachpersonen (z.&nbsp;B. Steuerberater, Rechtsanwälte oder Finanzberater).
        </p>

        <h2>§ 6 Nutzung auf eigene Verantwortung</h2>
        <p>
          Die Nutzung der bereitgestellten Inhalte erfolgt auf eigene Verantwortung
          des Nutzers.
        </p>

        <h2>§ 7 Änderungsvorbehalt</h2>
        <p>
          ExamFit behält sich vor, Inhalte, Funktionen und Preise jederzeit anzupassen,
          sofern dies für den Nutzer zumutbar ist. Wesentliche Änderungen werden den
          Nutzern rechtzeitig mitgeteilt.
        </p>

        <h2>§ 8 Unabhängigkeit</h2>
        <p>
          ExamFit ist ein unabhängiger Anbieter von Lernmaterialien zur
          Prüfungsvorbereitung. Es besteht keine Zusammenarbeit, Partnerschaft oder
          offizielle Verbindung mit der Industrie- und Handelskammer (IHK) oder der
          Handwerkskammer (HWK). Alle Inhalte basieren auf öffentlich zugänglichen
          Rahmenlehrplänen und Prüfungsordnungen.
        </p>

        <h2>§ 9 Schlussbestimmungen</h2>
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland. Sollten einzelne
          Bestimmungen dieser AGB unwirksam sein, bleibt die Wirksamkeit der
          übrigen Bestimmungen davon unberührt.
        </p>
      </div>
    </>
  );
}
