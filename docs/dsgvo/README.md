# Datenschutz-Dokumentation

| Dokument                                                                             | Pflicht                       | Inhalt                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [verzeichnis-verarbeitungstaetigkeiten.md](verzeichnis-verarbeitungstaetigkeiten.md) | Art. 30 DSGVO                 | 17 Verarbeitungstätigkeiten mit Zweck, Rechtsgrundlage, Empfängern, Drittland, Löschung                                                                |
| [tom.md](tom.md)                                                                     | Art. 32 DSGVO                 | Maßnahmen mit Code-Stelle und Test                                                                                                                     |
| [loeschkonzept.md](loeschkonzept.md)                                                 | Art. 5 Abs. 1 lit. e, Art. 17 | Fristen, Auslöser, Umsetzung                                                                                                                           |
| [dsfa.md](dsfa.md)                                                                   | Art. 35 DSGVO                 | Schwellwertanalyse (DSK-Muss-Liste Nr. 11 einschlägig) und Folgenabschätzung: Ergebnis kein hohes Restrisiko, Freigabe durch die Verantwortliche offen |
| [avv-vorlage.md](avv-vorlage.md)                                                     | Art. 28 Abs. 3 DSGVO          | Vertrag zur Auftragsverarbeitung für Geschäftskunden mit Liste der Unterauftragsverarbeiter (Vorlage)                                                  |
| `/legal/privacy`                                                                     | Art. 13, 14                   | Datenschutzerklärung (Quelle: `src/app/legal/privacy/page.tsx`)                                                                                        |

## Pflege

Wer einen Datenfluss ändert (neuer Dienst, neue Tabelle mit Personenbezug, neue
Frist), aktualisiert im selben Pull Request:

1. die Datenschutzerklärung (Empfänger, Zweck, Frist),
2. dieses Verzeichnis und das Löschkonzept,
3. den Export (`EXPORT_TABLES` in `src/lib/privacy/account.ts`); der Test
   `tests/privacy-export-schema.test.ts` liest jede Tabelle gegen das echte Schema.

## Offene Punkte der Betreiberin (nicht im Code lösbar)

1. **Auftragsverarbeitungsverträge** (Art. 28), Stand 17.11.2026 geprüft:
   - Vercel, Neon, Stripe: AVV per Verweis Bestandteil der AGB, mit Annahme
     der AGB geschlossen. Nur noch die PDFs ablegen.
   - Zoho Mail: einmalig unterschreiben (Zoho Accounts → Datenschutz →
     „Initiate Now“, Unterschrift über Zoho Sign; alternativ
     legal@zohocorp.com mit Angabe des EU-Rechenzentrums).
   - **Modellanbieter: offen und der wichtigste Punkt.** Die neun
     konfigurierten Aggregatoren (OpenRouter, NVIDIA, UnoRouter, Lightning,
     Bytez, Kunya, B.AI, AIHubMix, ShortAPI) bieten im Standardtarif keinen
     AVV; OpenRouter nur im Enterprise-Tarif. Technisch gilt bereits: an
     OpenRouter geht jede Anfrage mit `data_collection: deny` (keine
     Endpunkte, die Eingaben speichern oder damit trainieren). Für eine
     vollständige Art.-28-Kette entweder OpenRouter Enterprise abschließen
     oder Anbieter mit Standard-AVV anbinden (z. B. Mistral in der EU,
     Anthropic, OpenAI, Google Vertex) und die übrigen für Inhalte mit
     Personenbezug abschalten.
2. **E-Mail-Versand aktivieren** (Zoho Mail EU, für osirus-ai.com bereits
   eingerichtet): in Zoho ein Postfach oder einen Alias `kuendigung@` und ein
   anwendungsspezifisches Passwort anlegen (SMTP-Zugang ist im Gratistarif ggf. nicht enthalten,
   z. B. Mail Lite), dann in Vercel `SMTP_URL=smtps://kuendigung%40osirus-ai.com:<App-Passwort>@smtp.zoho.eu:465`
   und `OSIRUS_MAIL_FROM=Osirus <kuendigung@osirus-ai.com>` setzen. Ohne das
   gibt es keine Kündigungsbestätigung per E-Mail (§ 312k BGB).
3. **Datenschutz-Folgenabschätzung freigeben** (`dsfa.md`): durchgeführt,
   Ergebnis kein hohes Restrisiko; Unterschrift der Verantwortlichen fehlt.
4. **AVV-Vorlage für Geschäftskunden prüfen lassen** (`avv-vorlage.md`) und ab
   dem ersten Geschäftskunden verwenden.
5. **Juristische Prüfung** der Rechtstexte vor dem Entfernen der Entwurfshinweise
   (`docs/LEGAL_STATUS.md`).
