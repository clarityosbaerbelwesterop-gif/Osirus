# Datenschutz-Dokumentation

| Dokument                                                                             | Pflicht                       | Inhalt                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| [verzeichnis-verarbeitungstaetigkeiten.md](verzeichnis-verarbeitungstaetigkeiten.md) | Art. 30 DSGVO                 | 17 Verarbeitungstätigkeiten mit Zweck, Rechtsgrundlage, Empfängern, Drittland, Löschung |
| [tom.md](tom.md)                                                                     | Art. 32 DSGVO                 | Maßnahmen mit Code-Stelle und Test                                                      |
| [loeschkonzept.md](loeschkonzept.md)                                                 | Art. 5 Abs. 1 lit. e, Art. 17 | Fristen, Auslöser, Umsetzung                                                            |
| `/legal/privacy`                                                                     | Art. 13, 14                   | Datenschutzerklärung (Quelle: `src/app/legal/privacy/page.tsx`)                         |

## Pflege

Wer einen Datenfluss ändert (neuer Dienst, neue Tabelle mit Personenbezug, neue
Frist), aktualisiert im selben Pull Request:

1. die Datenschutzerklärung (Empfänger, Zweck, Frist),
2. dieses Verzeichnis und das Löschkonzept,
3. den Export (`EXPORT_TABLES` in `src/lib/privacy/account.ts`); der Test
   `tests/privacy-export-schema.test.ts` liest jede Tabelle gegen das echte Schema.

## Offene Punkte der Betreiberin (nicht im Code lösbar)

1. **Auftragsverarbeitungsverträge** (Art. 28) annehmen bzw. abschließen und
   ablegen: Vercel (DPA im Dashboard), Neon/Databricks, Stripe, Resend,
   OpenRouter und die übrigen Modellanbieter.
2. **E-Mail-Versand aktivieren** (Resend): ohne ihn gibt es keine
   Kündigungsbestätigung per E-Mail (§ 312k BGB).
3. **Schwellwertanalyse zur Datenschutz-Folgenabschätzung** (Art. 35):
   dokumentieren, ob die KI-Verarbeitung von Kundeninhalten ein hohes Risiko
   darstellt (Muss-Liste der DSK prüfen).
4. **AV-Vertrag für Geschäftskunden**: Für Unternehmen, die Osirus mit
   personenbezogenen Daten Dritter nutzen, ist Osirus Auftragsverarbeiter;
   eine AVV-Vorlage muss juristisch erstellt werden.
5. **Juristische Prüfung** der Rechtstexte vor dem Entfernen der Entwurfshinweise
   (`docs/LEGAL_STATUS.md`).
