import Link from "next/link";
import { PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "AGB",
  description:
    "Allgemeine Geschäftsbedingungen für Osirus: Leistungen, KI-Hinweise, Freigaben, Abos, Testphase, Kontingente, Kündigung, Widerruf, Haftung.",
};

export default function TermsPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Allgemeine Geschäftsbedingungen</h1>
      <p>Stand: 29. Oktober 2026</p>

      <h2>§ 1 Geltungsbereich und Anbieterin</h2>
      <p>
        (1) Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle
        Verträge über die Nutzung von Osirus zwischen dir und {OPERATOR.name},
        Inhaberin {OPERATOR.owner}, {OPERATOR.street}, {OPERATOR.city},{" "}
        {OPERATOR.country} (im Folgenden „wir“). Kontakt:{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>, Telefon{" "}
        <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>.
      </p>
      <p>
        (2) Ergänzend gelten die{" "}
        <Link href="/legal/eula">Endnutzer-Lizenz (EULA)</Link> und, zur
        Information, die <Link href="/legal/privacy">Datenschutzerklärung</Link>
        . Abweichende Bedingungen von Nutzern gelten nur, wenn wir ihnen
        ausdrücklich in Textform zustimmen.
      </p>
      <p>
        (3) Verbraucher im Sinne dieser AGB ist jede natürliche Person, die den
        Vertrag zu Zwecken abschließt, die überwiegend weder ihrer gewerblichen
        noch ihrer selbständigen beruflichen Tätigkeit zugerechnet werden können
        (§ 13 BGB). Unternehmer ist jede Person, die bei Abschluss in Ausübung
        ihrer gewerblichen oder selbständigen beruflichen Tätigkeit handelt (§
        14 BGB). Regelungen, die nur für Verbraucher oder nur für Unternehmer
        gelten, sind als solche gekennzeichnet.
      </p>

      <h2>§ 2 Leistungsbeschreibung</h2>
      <p>
        (1) Osirus ist ein webbasierter KI-Workspace. Der Funktionsumfang
        umfasst insbesondere:
      </p>
      <ul>
        <li>
          <strong>Agents:</strong> Chat mit automatischer Wahl eines passenden
          Sprachmodells, Dateien, Websuche mit Quellenangaben und Teilen-Links;
        </li>
        <li>
          <strong>Bots:</strong> eigene Assistenten mit Rolle, eigenem Raum,
          Gedächtnis früherer Unterhaltungen, Gruppenchats sowie optionalem
          Diktieren und Vorlesen über den Browser;
        </li>
        <li>
          <strong>Rouge Agent:</strong> Aufträge, die in mehreren Schritten
          selbständig geplant und ausgeführt werden, mit Werkzeugen wie
          Websuche, Berechnungen, Zugriff auf verbundene Dienste, Befragung der
          eigenen Bots und Übergabe an Code;
        </li>
        <li>
          <strong>Code:</strong> Arbeit an einem verbundenen GitHub-Repository
          in einer abgeschotteten Sandbox, mit Prüfungen und Zurückschreiben nur
          nach Freigabe;
        </li>
        <li>
          <strong>Automationen, Inbox und Verbindungen</strong> zu GitHub,
          Vercel, Neon, Supabase und MCP-Servern.
        </li>
      </ul>
      <p>
        (2) Der jeweils aktuelle Funktionsumfang ergibt sich aus der Anwendung
        und der Planübersicht. Ein Anspruch auf bestimmte Sprachmodelle oder
        Anbieter besteht nicht; wir wählen die Modelle nach Verfügbarkeit,
        Eignung und Tarif und können sie austauschen, wenn die vereinbarte
        Leistung dadurch nicht wesentlich verschlechtert wird.
      </p>
      <p>
        (3) Wir stellen Osirus mit der im Verkehr erforderlichen Sorgfalt bereit
        und streben eine hohe Verfügbarkeit an. Eine bestimmte Verfügbarkeit
        schulden wir nur, wenn sie ausdrücklich vereinbart ist. Wartungen,
        Störungen bei Dritten (etwa Modellanbietern, Hosting, GitHub) und
        Ereignisse außerhalb unseres Einflussbereichs können die Nutzung
        vorübergehend einschränken.
      </p>

      <h2>§ 3 Besondere Hinweise zu KI-Ergebnissen</h2>
      <p>
        (1) Antworten, Code, Pläne und sonstige Ergebnisse werden durch
        KI-Systeme erzeugt (Art. 50 KI-Verordnung). Sie können trotz Prüfung
        durch ein getrenntes Prüfermodell und automatische Tests unvollständig,
        veraltet oder falsch sein.
      </p>
      <p>
        (2) Osirus ersetzt keine Rechts-, Steuer-, Finanz-, Medizin- oder
        sonstige Fachberatung. Du prüfst Ergebnisse eigenverantwortlich, bevor
        du sie verwendest, veröffentlichst oder auf ihrer Grundlage
        Entscheidungen triffst.
      </p>
      <p>
        (3) Aktionen mit Wirkung nach außen (etwa einen Push, einen Pull
        Request, ein neues Repository oder den Aufruf eines MCP-Werkzeugs) führt
        Osirus nur nach deiner ausdrücklichen Freigabe für die konkrete Aktion
        aus. Mit der Freigabe veranlasst du die Aktion selbst und trägst die
        Verantwortung für ihre Folgen in dem verbundenen System. Wählst du in
        Code „Änderungen ohne Rückfrage“, gelten Dateiänderungen in der Sandbox
        als im Voraus freigegeben; das Zurückschreiben in dein Repository
        braucht weiterhin deine Freigabe.
      </p>

      <h2>§ 4 Registrierung und Konto</h2>
      <p>
        (1) Die Nutzung setzt ein Konto voraus, per E-Mail und Passwort oder
        über GitHub. Osirus richtet sich an Personen ab 18 Jahren. Die Angaben
        bei der Registrierung müssen zutreffen.
      </p>
      <p>
        (2) Du hältst deine Zugangsdaten geheim und informierst uns
        unverzüglich, wenn du einen Missbrauch vermutest. Für Handlungen unter
        deinem Konto bist du verantwortlich, soweit du sie zu vertreten hast.
      </p>
      <p>
        (3) Mit dem Abschluss der Registrierung kommt ein unentgeltlicher
        Nutzungsvertrag über das kostenlose Kontingent zustande. Voraussetzung
        ist, dass du diese AGB und die EULA akzeptierst und die
        Datenschutzerklärung zur Kenntnis nimmst.
      </p>

      <h2>§ 5 Vertragsschluss bei Abonnements</h2>
      <p>
        (1) Die Darstellung der Tarife in der Anwendung ist kein bindendes
        Angebot. Mit dem Abschluss des Bezahlvorgangs im Checkout (Schaltfläche
        mit eindeutiger Zahlungspflicht) gibst du ein verbindliches Angebot ab.
        Der Vertrag kommt zustande, wenn wir die Buchung bestätigen, spätestens
        mit der Freischaltung des Tarifs.
      </p>
      <p>
        (2) Vor Abschluss siehst du im Checkout Tarif, Preis, Laufzeit, eine
        etwaige Testphase und die Zahlungsart und kannst Eingabefehler
        korrigieren. Vertragssprache ist Deutsch. Den Vertragstext (diese AGB)
        kannst du jederzeit unter dieser Adresse abrufen und speichern; die
        Bestelldaten erhältst du per E-Mail von unserem Zahlungsdienstleister.
      </p>

      <h2>§ 6 Preise, Zahlung und Testphase</h2>
      <p>
        (1) Es steht ein begrenztes kostenloses Kontingent zur Verfügung, dessen
        aktuellen Stand die Anwendung anzeigt. Die Preise der kostenpflichtigen
        Tarife stehen in der Planübersicht und werden vor Vertragsschluss im
        Checkout ausgewiesen. Es sind Endpreise. {PRICE_TAX_NOTE}
      </p>
      <p>
        (2) Die Zahlung wickelt Stripe ab. Das Entgelt wird monatlich im Voraus
        fällig und über das im Checkout gewählte Zahlungsmittel eingezogen.
      </p>
      <p>
        (3) Beim ersten Pro-Abonnement eines Kontos kann eine kostenlose
        Testphase gelten; ihre Dauer wird im Checkout angezeigt. Kündigst du
        nicht vor ihrem Ende, geht die Testphase in das kostenpflichtige
        Abonnement über, und die erste Zahlung wird fällig. Eine Testphase steht
        je Person nur einmal zu.
      </p>
      <p>
        (4) Schlägt eine Zahlung fehl, können wir den Tarif nach erfolgloser
        Zahlungserinnerung bis zum Ausgleich auf das kostenlose Kontingent
        zurückstufen. Weitergehende Rechte bleiben unberührt.
      </p>

      <h2>§ 7 Kontingente</h2>
      <p>
        (1) Jeder Tarif hat zwei rollierende Nutzungsfenster: ein
        5-Stunden-Kontingent und ein Wochenkontingent. Den Verbrauch zeigt die
        Anwendung an.
      </p>
      <p>
        (2) Ist ein Fenster aufgebraucht, pausiert die weitere Modellnutzung,
        bis es sich wieder auffüllt, oder du wechselst in einen höheren Tarif.
        Zusätzliches Einzelguthaben kann nicht nachgekauft werden. Nicht
        verbrauchte Kontingente verfallen mit dem Ablauf des jeweiligen Fensters
        und werden nicht erstattet.
      </p>

      <h2>§ 8 Pflichten bei der Nutzung</h2>
      <p>Bei der Nutzung von Osirus ist es insbesondere untersagt,</p>
      <ul>
        <li>
          Gesetze oder Rechte Dritter zu verletzen, etwa Urheber-, Marken-,
          Persönlichkeits- oder Datenschutzrechte;
        </li>
        <li>
          rechtswidrige, jugendgefährdende, beleidigende oder volksverhetzende
          Inhalte zu erzeugen oder zu verbreiten;
        </li>
        <li>
          Schadsoftware, Phishing, Spam oder Angriffe auf fremde Systeme zu
          erstellen oder vorzubereiten;
        </li>
        <li>
          den Dienst, andere Workspaces, Sicherheitsgrenzen, die Sandbox oder
          die Infrastruktur anzugreifen oder zu überlasten;
        </li>
        <li>
          Kontingente, Bezahlschranken oder Anfragebegrenzungen zu umgehen oder
          Konten zu diesem Zweck mehrfach anzulegen;
        </li>
        <li>
          Sicherheitsfilter der Modellanbieter zu umgehen oder deren
          Nutzungsrichtlinien zu verletzen;
        </li>
        <li>
          Daten Dritter einzugeben oder zu verbinden, für deren Verarbeitung du
          keine Rechtsgrundlage hast.
        </li>
      </ul>

      <h2>§ 9 Inhalte und Rechte</h2>
      <p>
        (1) Deine Eingaben, Dateien und Repositories bleiben deine. Du räumst
        uns die Rechte ein, die nötig sind, um sie zur Erbringung der Leistung
        zu speichern, zu verarbeiten und an die eingesetzten Modellanbieter und
        verbundenen Dienste zu übermitteln. Wir nutzen deine Inhalte nicht zum
        Training eigener Modelle.
      </p>
      <p>
        (2) Ergebnisse, die Osirus für dich erzeugt, darfst du im Rahmen der
        EULA frei verwenden. Wir übernehmen keine Gewähr dafür, dass Ergebnisse
        frei von Rechten Dritter sind; prüfe das vor dem Einsatz, besonders bei
        Code, Texten und Bildern zur Veröffentlichung.
      </p>
      <p>
        (3) Teilen-Links machen einen Chat für jeden mit dem Link lesbar. Du
        entscheidest, was du teilst, und kannst den Link jederzeit deaktivieren.
      </p>

      <h2>§ 10 Verbundene Dienste Dritter</h2>
      <p>
        Verbindest du Dienste wie GitHub, Vercel, Neon, Supabase oder einen
        MCP-Server, gelten für deren Nutzung zusätzlich die Bedingungen dieser
        Anbieter. Du stellst sicher, dass du zur Verbindung und zu den
        freigegebenen Aktionen berechtigt bist. Für Verfügbarkeit, Inhalte und
        Verhalten dieser Dienste sind wir nicht verantwortlich.
      </p>

      <h2>§ 11 Laufzeit und Kündigung</h2>
      <p>
        (1) Ein Abonnement läuft jeweils einen Monat und verlängert sich
        automatisch um einen weiteren Monat, wenn du es nicht vor Ablauf der
        laufenden Abrechnungsperiode kündigst. Die Kündigung ist jederzeit zum
        Ende der laufenden Periode möglich.
      </p>
      <p>
        (2) Du kündigst über die Schaltfläche „Verträge hier kündigen“ auf
        unserer Website (<Link href="/kuendigen">Kündigungsseite</Link>, ohne
        Anmeldung erreichbar), in der Anwendung unter Einstellungen über das
        Kundenportal, per E-Mail an{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> oder in
        Textform an die oben genannte Anschrift. Eine Kündigung über die
        Kündigungsseite bestätigen wir dir sofort mit Datum und Uhrzeit des
        Eingangs und dem Zeitpunkt, zu dem der Vertrag endet (§ 312k BGB).
        Nennst du keinen Zeitpunkt, wirkt die Kündigung zum nächstmöglichen
        Termin. Nach dem Ende der Periode gilt wieder das kostenlose Kontingent;
        dein Konto und deine Inhalte bleiben erhalten.
      </p>
      <p>
        (3) Das kostenlose Nutzungsverhältnis kannst du jederzeit beenden, indem
        du die Löschung deines Kontos verlangst. Wir können es mit einer Frist
        von vier Wochen in Textform kündigen.
      </p>
      <p>
        (4) Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt
        unberührt. Ein wichtiger Grund liegt für uns insbesondere bei schweren
        oder trotz Abmahnung fortgesetzten Verstößen gegen § 8 vor. In diesen
        Fällen können wir das Konto auch vorübergehend sperren.
      </p>

      <h2>§ 12 Widerrufsrecht für Verbraucher</h2>
      <h3>Widerrufsbelehrung</h3>
      <p>
        <strong>Widerrufsrecht.</strong> Du hast das Recht, binnen vierzehn
        Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die
        Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschlusses.
        Um dein Widerrufsrecht auszuüben, musst du uns ({OPERATOR.name},
        Inhaberin {OPERATOR.owner}, {OPERATOR.street}, {OPERATOR.city},{" "}
        {OPERATOR.country}, Telefon {OPERATOR.phoneDisplay}, E-Mail{" "}
        {OPERATOR.email}) mittels einer eindeutigen Erklärung (etwa ein Brief
        oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen,
        informieren. Du kannst dafür das beigefügte Muster-Widerrufsformular
        verwenden, das jedoch nicht vorgeschrieben ist. Zur Wahrung der
        Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung
        des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.
      </p>
      <p>
        <strong>Folgen des Widerrufs.</strong> Wenn du diesen Vertrag
        widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten
        haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag
        zurückzuzahlen, an dem die Mitteilung über deinen Widerruf bei uns
        eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe
        Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt
        hast, es sei denn, mit dir wurde ausdrücklich etwas anderes vereinbart;
        in keinem Fall werden dir wegen dieser Rückzahlung Entgelte berechnet.
        Hast du verlangt, dass die Dienstleistung während der Widerrufsfrist
        beginnen soll, so hast du uns einen angemessenen Betrag zu zahlen, der
        dem Anteil der bis zu dem Zeitpunkt, zu dem du uns von der Ausübung des
        Widerrufsrechts unterrichtest, bereits erbrachten Leistungen im
        Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Leistungen
        entspricht.
      </p>
      <p>
        <strong>Erlöschen.</strong> Das Widerrufsrecht erlischt bei einem
        Vertrag zur Erbringung von Dienstleistungen, wenn wir die Leistung
        vollständig erbracht haben und mit der Ausführung erst begonnen haben,
        nachdem du dazu deine ausdrückliche Zustimmung gegeben und gleichzeitig
        deine Kenntnis davon bestätigt hast, dass du dein Widerrufsrecht bei
        vollständiger Vertragserfüllung verlierst.
      </p>
      <p>Ende der Widerrufsbelehrung.</p>
      <h3>Muster-Widerrufsformular</h3>
      <p>
        (Wenn du den Vertrag widerrufen willst, fülle bitte dieses Formular aus
        und sende es zurück.)
      </p>
      <p>
        An {OPERATOR.name}, Inhaberin {OPERATOR.owner}, {OPERATOR.street},{" "}
        {OPERATOR.city}, {OPERATOR.country}, E-Mail {OPERATOR.email}:
      </p>
      <ul>
        <li>
          Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen
          Vertrag über die Erbringung der folgenden Dienstleistung: Osirus,
          Tarif: ______
        </li>
        <li>Bestellt am (*) / erhalten am (*):</li>
        <li>Name des/der Verbraucher(s):</li>
        <li>Anschrift des/der Verbraucher(s):</li>
        <li>
          Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier):
        </li>
        <li>Datum:</li>
      </ul>
      <p>(*) Unzutreffendes streichen.</p>

      <h2>§ 13 Gewährleistung</h2>
      <p>
        (1) Für Verbraucher gelten die gesetzlichen Vorschriften über digitale
        Produkte (§§ 327 ff. BGB). Wir stellen die für den Erhalt der
        Vertragsmäßigkeit erforderlichen Aktualisierungen bereit.
      </p>
      <p>
        (2) Dass KI-Ergebnisse im Einzelfall fehlerhaft sein können (§ 3), ist
        eine Eigenschaft der vereinbarten Leistung und für sich genommen kein
        Mangel, solange der Dienst im Übrigen wie beschrieben funktioniert.
      </p>
      <p>
        (3) Gegenüber Unternehmern beträgt die Verjährungsfrist für
        Mängelansprüche ein Jahr; dies gilt nicht für Ansprüche nach § 14 Abs.
        1.
      </p>

      <h2>§ 14 Haftung</h2>
      <p>
        (1) Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei
        der Verletzung von Leben, Körper oder Gesundheit, nach dem
        Produkthaftungsgesetz und im Umfang einer übernommenen Garantie.
      </p>
      <p>
        (2) Bei einfacher Fahrlässigkeit haften wir nur bei Verletzung einer
        wesentlichen Vertragspflicht, also einer Pflicht, deren Erfüllung die
        ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und
        auf deren Einhaltung du regelmäßig vertrauen darfst, und begrenzt auf
        den vorhersehbaren, vertragstypischen Schaden.
      </p>
      <p>
        (3) Für den Verlust von Daten haften wir nur in Höhe des Aufwands, der
        bei regelmäßiger und angemessener Datensicherung durch dich zu ihrer
        Wiederherstellung angefallen wäre. Repositories sicherst du über deinen
        Git-Anbieter.
      </p>
      <p>
        (4) Für Folgen von Aktionen, die du nach § 3 Abs. 3 freigegeben hast,
        und für die Verwendung von KI-Ergebnissen ohne eigene Prüfung haften wir
        nur nach Absatz 1 und 2.
      </p>
      <p>
        (5) Die Haftungsbeschränkungen gelten auch für unsere
        Erfüllungsgehilfen. Zwingende gesetzliche Haftung bleibt unberührt.
      </p>

      <h2>§ 15 Freistellung durch Unternehmer</h2>
      <p>
        Unternehmer stellen uns von Ansprüchen Dritter frei, die auf einer von
        ihnen zu vertretenden, rechtswidrigen Nutzung von Osirus beruhen,
        einschließlich angemessener Kosten der Rechtsverteidigung.
      </p>

      <h2>§ 16 Datenschutz</h2>
      <p>
        Wie wir personenbezogene Daten verarbeiten, beschreibt die{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link>. Nutzt ein
        Unternehmer Osirus für personenbezogene Daten Dritter, für die er
        verantwortlich ist, schließen wir auf Anfrage eine Vereinbarung zur
        Auftragsverarbeitung nach Art. 28 DSGVO.
      </p>

      <h2>§ 17 Änderungen der Leistung und der AGB</h2>
      <p>
        (1) Wir können Osirus weiterentwickeln und Funktionen ändern, wenn ein
        triftiger Grund besteht (etwa neue Modelle, technische oder rechtliche
        Anforderungen, Sicherheit) und die Änderung für dich zumutbar ist.
        Beeinträchtigt eine Änderung deinen Zugang oder die Nutzbarkeit mehr als
        unerheblich, informieren wir dich vorab; Verbraucher können den Vertrag
        dann nach § 327r BGB innerhalb von 30 Tagen unentgeltlich beenden.
      </p>
      <p>
        (2) Änderungen dieser AGB teilen wir dir mindestens vier Wochen vor
        ihrem Inkrafttreten in der Anwendung oder per E-Mail mit. Wesentliche
        Änderungen werden nur wirksam, wenn du ihnen in der Anwendung
        ausdrücklich zustimmst; bis dahin gilt die bisherige Fassung, und wir
        können den Vertrag zum nächsten möglichen Termin kündigen, wenn eine
        Fortführung zu den alten Bedingungen unzumutbar ist.
      </p>

      <h2>§ 18 Streitbeilegung</h2>
      <p>
        Wir sind nicht verpflichtet und nicht bereit, an einem
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
        teilzunehmen (§ 36 VSBG).
      </p>

      <h2>§ 19 Schlussbestimmungen</h2>
      <p>
        (1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss
        des UN-Kaufrechts. Bist du Verbraucher, bleiben zwingende Vorschriften
        des Staates, in dem du deinen gewöhnlichen Aufenthalt hast, unberührt.
      </p>
      <p>
        (2) Ist der Nutzer Kaufmann, juristische Person des öffentlichen Rechts
        oder öffentlich-rechtliches Sondervermögen, ist Gerichtsstand Moers,
        soweit gesetzlich zulässig.
      </p>
      <p>
        (3) Sollte eine Bestimmung dieser AGB unwirksam sein, bleibt die
        Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der
        unwirksamen Bestimmung tritt die gesetzliche Regelung.
      </p>
    </article>
  );
}
