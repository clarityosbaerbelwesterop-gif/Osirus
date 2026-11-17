# Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO) — Vorlage

> **Vorlage, Stand 17. November 2026.** Vor dem ersten Einsatz juristisch
> prüfen lassen. Platzhalter in eckigen Klammern ausfüllen.

zwischen **[Kunde, Anschrift]** („Verantwortlicher") und **ClarityCompassAI,
Inhaberin Bärbel Westerop, Drinhausstraße 22, 47447 Moers-Kapellen**
(„Auftragsverarbeiter").

## § 1 Gegenstand und Dauer

1. Der Auftragsverarbeiter erbringt für den Verantwortlichen den Dienst Osirus
   nach dem Hauptvertrag vom [Datum] (AGB, gewählter Plan). Dabei verarbeitet er
   personenbezogene Daten, die der Verantwortliche oder seine Nutzer in Osirus
   eingeben, hochladen oder über Verbindungen bereitstellen.
2. Der Vertrag gilt für die Dauer des Hauptvertrags.

## § 2 Art, Zweck, Daten und Betroffene (Art. 28 Abs. 3 Satz 1)

|                               |                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Art der Verarbeitung          | Speichern, Auslesen, Übermitteln an Modellanbieter zur Beantwortung, Ausführen von Aufträgen, Löschen                                                              |
| Zweck                         | Bereitstellung von Chat, Rouge Agent, Code, Bots, Automationen und Verbindungen                                                                                    |
| Datenarten                    | Inhalte von Nachrichten, Dateien und Aufträgen; Namen und E-Mail-Adressen der Nutzer; Repository- und Projektinhalte verbundener Dienste; Protokolle von Freigaben |
| Betroffene                    | Nutzer des Verantwortlichen (Beschäftigte), in Inhalten genannte Personen (Kunden, Ansprechpartner, Dritte)                                                        |
| Besondere Kategorien (Art. 9) | nicht vorgesehen; der Verantwortliche sorgt dafür, dass keine eingegeben werden, oder vereinbart dies gesondert                                                    |

## § 3 Weisungen

1. Der Auftragsverarbeiter verarbeitet die Daten nur auf dokumentierte Weisung
   des Verantwortlichen, auch bei Übermittlungen in Drittländer, es sei denn,
   eine Rechtspflicht verlangt etwas anderes; dann informiert er vorher, soweit
   zulässig (Art. 28 Abs. 3 lit. a).
2. Weisungen sind der Hauptvertrag, dieser Vertrag und die Einstellungen und
   Freigaben, die Nutzer in Osirus vornehmen.
3. Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, weist er
   unverzüglich darauf hin (Art. 28 Abs. 3 Satz 3).

## § 4 Vertraulichkeit

Zur Verarbeitung befugte Personen sind zur Vertraulichkeit verpflichtet oder
unterliegen einer gesetzlichen Verschwiegenheitspflicht (lit. b).

## § 5 Technische und organisatorische Maßnahmen

Es gelten die Maßnahmen in Anlage 1 (`docs/dsgvo/tom.md`) (lit. c, Art. 32).
Sie dürfen weiterentwickelt werden, solange das Schutzniveau nicht sinkt.

## § 6 Unterauftragsverarbeiter

1. Der Verantwortliche genehmigt die Unterauftragsverarbeiter in Anlage 2
   (lit. d, Art. 28 Abs. 2 und 4).
2. Über beabsichtigte Änderungen informiert der Auftragsverarbeiter mindestens
   30 Tage vorher per E-Mail; der Verantwortliche kann aus wichtigem
   datenschutzrechtlichem Grund widersprechen und den Hauptvertrag dann
   kündigen.
3. Den Unterauftragsverarbeitern werden dieselben Datenschutzpflichten
   auferlegt.

## § 7 Unterstützung

1. Betroffenenrechte (lit. e): Auskunft (Export als JSON) und Löschung stehen
   als Self-Service bereit; darüber hinaus unterstützt der Auftragsverarbeiter
   auf Anfrage unverzüglich.
2. Art. 32 bis 36 (lit. f): Der Auftragsverarbeiter unterstützt bei Sicherheit,
   Meldung von Verletzungen, Datenschutz-Folgenabschätzung (Anlage 3,
   `docs/dsgvo/dsfa.md`) und vorheriger Konsultation.
3. Verletzungen des Schutzes personenbezogener Daten meldet der
   Auftragsverarbeiter unverzüglich, spätestens innerhalb von 24 Stunden nach
   Kenntnis, mit den Angaben nach Art. 33 Abs. 3, soweit bekannt.

## § 8 Löschung und Rückgabe

Nach Ende der Leistungen löscht der Auftragsverarbeiter alle Daten des
Verantwortlichen nach dessen Wahl oder gibt sie (Export) zurück, sofern keine
Pflicht zur Speicherung besteht (lit. g). Löschfristen und Verfahren:
`docs/dsgvo/loeschkonzept.md`.

## § 9 Nachweise und Überprüfungen

Der Auftragsverarbeiter stellt alle Informationen zum Nachweis der Pflichten
bereit und ermöglicht Überprüfungen, auch Inspektionen, durch den
Verantwortlichen oder einen beauftragten Prüfer, nach Vorankündigung von
mindestens 14 Tagen und während der Geschäftszeiten (lit. h).

## § 10 Schlussbestimmungen

Es gilt deutsches Recht. Bei Widersprüchen geht dieser Vertrag dem Hauptvertrag
in Fragen des Datenschutzes vor.

---

## Anlage 2: Unterauftragsverarbeiter (Stand 17. November 2026)

| Unternehmen                                                                                                                | Leistung                                                                                | Ort / Garantie                                            |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Vercel Inc., San Francisco                                                                                                 | Hosting (Region Frankfurt), Sandbox für Code                                            | USA / EU-US DPF                                           |
| Neon, LLC (Databricks, Inc.)                                                                                               | Datenbank und Anmeldung, Region eu-central-1                                            | EU-Rechenzentrum; Konzern USA / DPF                       |
| Zoho Corporation B.V. (Utrecht, NL)                                                                                        | Versand von Pflichtmitteilungen (Zoho Mail)                                             | EU; Unterauftragsverarbeiter außerhalb der EU nur mit SCC |
| OpenRouter, Inc.; NVIDIA Corporation (NIM); UNOROUTER; Bytez, Inc.; Lightning AI, Inc.; Kunya AI; B.AI; AIHubMix; ShortAPI | Bereitstellung von Sprachmodellen, je nach gewähltem oder automatisch bestimmtem Modell | USA u. a. / DPF, SCC oder Art. 49 Abs. 1 lit. b           |

Dienste, die Nutzer selbst verbinden (GitHub, Vercel, Neon, Supabase,
MCP-Server), sowie Suchdienste (Wikimedia, Google News, ggf. Tavily, Exa,
Firecrawl) erhalten Daten auf Weisung im Einzelfall und sind eigenständig
verantwortlich.
