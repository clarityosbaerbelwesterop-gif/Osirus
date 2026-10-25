import Link from "next/link";
import { PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "AGB",
  description:
    "Allgemeine Geschäftsbedingungen für Osirus: Abos, Kontingente, Kündigung und Widerruf.",
};

export default function TermsPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Allgemeine Geschäftsbedingungen</h1>
      <p>
        Diese Bedingungen gelten für die Nutzung von Osirus zwischen dir und{" "}
        {OPERATOR.name}, Inhaberin {OPERATOR.owner}, {OPERATOR.street},{" "}
        {OPERATOR.city}, {OPERATOR.country}. Kontakt:{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>, Telefon{" "}
        <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>.
      </p>

      <h2>1. Leistung</h2>
      <p>
        Osirus ist ein Workspace mit einem Assistenten. Du beschreibst einen
        Auftrag. Aktionen nach außen, etwa ein Push in ein verbundenes
        Repository, warten auf deine Freigabe. Modelle werden über UNOROUTER
        aufgerufen. Ein getrenntes Prüfermodell, eigene Bots mit festem Modell,
        Deploy und Gruppenchats sind noch nicht verfügbar.
      </p>
      <p>
        Antworten von Sprachmodellen können falsch sein. Osirus ist keine
        Rechts-, Steuer- oder Medizinberatung. Prüfe Ergebnisse, bevor du sie
        verwendest.
      </p>

      <h2>2. Konto</h2>
      <p>
        Für den Workspace brauchst du ein Konto, per E-Mail und Passwort oder
        über GitHub. Du bist für die Zugangsdaten und für das verantwortlich,
        was unter deinem Konto geschieht. Die Registrierung setzt voraus, dass
        du diese AGB und die <Link href="/legal/eula">EULA</Link> akzeptierst
        und die <Link href="/legal/privacy">Datenschutzerklärung</Link> gelesen
        hast.
      </p>

      <h2>3. Abos und Preise</h2>
      <p>
        Es kann ein begrenztes kostenloses Kontingent geben. Seinen Umfang zeigt
        die App. Konkrete Mengen stehen hier nicht. Die Preise der Abos stehen
        in der Planübersicht in der App und werden vor Vertragsschluss im
        Checkout angezeigt. Es sind Endpreise. {PRICE_TAX_NOTE} Die Abrechnung
        läuft über Stripe, sobald die Buchung freigeschaltet ist. Bis dahin ist
        die Zahlung noch nicht verfügbar.
      </p>
      <h2>4. Kontingente</h2>
      <p>
        Jedes Abo hat zwei Fenster: ein 5-Stunden-Kontingent und ein
        Wochenkontingent. Die Größe der Fenster wird mit dem Abo festgelegt.
        Konkrete Mengen stehen hier nicht, weil sie noch nicht veröffentlicht
        sind. Ist ein Fenster aufgebraucht, wartet die weitere Nutzung, bis sich
        dieses Fenster wieder füllt. Zusätzliches Guthaben kann nicht
        dazugekauft werden. Ein erschöpftes Fenster schaltet nicht still auf ein
        anderes Modell um.
      </p>

      <h2>5. Zulässige Nutzung</h2>
      <ul>
        <li>
          Nutze den Dienst nicht, um Gesetze oder Rechte anderer zu brechen.
        </li>
        <li>
          Greife den Dienst, andere Mandanten oder die Infrastruktur nicht an.
        </li>
        <li>
          Nutze den Assistenten nicht für rechtswidrige Inhalte und nicht, um
          Sperren der Modellanbieter zu umgehen.
        </li>
      </ul>

      <h2>6. Laufzeit und Kündigung</h2>
      <p>
        Ein gebuchtes Abo läuft bis zum Ende der laufenden Abrechnungsperiode
        und verlängert sich, bis du kündigst. Du kannst zum Periodenende
        kündigen, sobald die Buchung verfügbar ist, über das Kundenportal von
        Stripe oder per E-Mail an {OPERATOR.email}. Nach dem Periodenende endet
        das Abo. Das Konto kannst du unabhängig davon löschen lassen. Wir können
        ein Konto sperren, das Abschnitt 5 verletzt, nach Möglichkeit mit
        vorherigem Hinweis.
      </p>

      <h2>7. Widerruf</h2>
      <p>
        Wenn du Verbraucher im Sinne von § 13 BGB bist, kannst du den Vertrag
        innerhalb von 14 Tagen ohne Angabe von Gründen widerrufen. Die Frist
        beginnt mit dem Vertragsschluss. Um das Widerrufsrecht auszuüben,
        informiere uns mit einer eindeutigen Erklärung, etwa per E-Mail an{" "}
        {OPERATOR.email} oder per Post an die oben genannte Anschrift. Du kannst
        dafür das folgende Muster verwenden, musst es aber nicht.
      </p>
      <p>
        Hast du verlangt, dass wir vor Ablauf der Widerrufsfrist beginnen, und
        ist die Leistung vollständig erbracht, erlischt das Widerrufsrecht.
        Wurde die Leistung teilweise erbracht, zahlst du einen angemessenen
        Betrag für das bis zum Widerruf Geleistete.
      </p>
      <h3>Muster-Widerrufsformular</h3>
      <p>
        (Wenn du den Vertrag widerrufen willst, fülle dieses Formular aus und
        sende es zurück.)
      </p>
      <p>
        An {OPERATOR.name}, Inhaberin {OPERATOR.owner}, {OPERATOR.street},{" "}
        {OPERATOR.city}, {OPERATOR.country}, E-Mail {OPERATOR.email}:
      </p>
      <ul>
        <li>
          Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die
          Erbringung der folgenden Dienstleistung: Osirus.
        </li>
        <li>Bestellt am / erhalten am:</li>
        <li>Name der Verbraucherin oder des Verbrauchers:</li>
        <li>Anschrift:</li>
        <li>Datum:</li>
        <li>Unterschrift (nur bei Mitteilung auf Papier):</li>
      </ul>

      <h2>8. Haftung</h2>
      <p>
        Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei
        Verletzung von Leben, Körper oder Gesundheit und nach dem
        Produkthaftungsgesetz. Bei einfacher Fahrlässigkeit haften wir nur bei
        Verletzung einer wesentlichen Vertragspflicht, also einer Pflicht, deren
        Erfüllung die Durchführung des Vertrags erst ermöglicht, und nur für den
        vorhersehbaren, typischerweise eintretenden Schaden. Die Haftung für
        Datenverlust ist auf den Aufwand begrenzt, der entsteht, wenn du
        angemessene Sicherungen vorhältst. Zwingende gesetzliche Haftung bleibt
        unberührt.
      </p>

      <h2>9. Recht</h2>
      <p>
        Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des
        UN-Kaufrechts. Wenn du Verbraucher bist, bleiben zwingende Vorschriften
        des Staates, in dem du deinen gewöhnlichen Aufenthalt hast, unberührt.
        Für Kaufleute ist Gerichtsstand Moers, soweit zulässig.
      </p>

      <h2>10. Änderung der Bedingungen</h2>
      <p>
        Wir können diese Bedingungen mit einem angemessenen Vorlauf ändern und
        dich in der Anwendung oder per E-Mail informieren. Widersprichst du
        nicht bis zum Wirksamwerden, gelten die neuen Bedingungen. Auf diese
        Folge weisen wir im Hinweis hin. Kündigst du zum Änderungstermin, gelten
        die bisherigen Bedingungen bis zum Vertragsende.
      </p>
    </article>
  );
}
