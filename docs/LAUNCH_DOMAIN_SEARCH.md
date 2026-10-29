# Eigene Domain, Bestätigungs-E-Mails und Google Search

Stand: 29. Oktober 2026. Der Code ist vorbereitet. Was hier steht, sind
Einstellungen außerhalb des Repositories, in dieser Reihenfolge. Schlüssel
gehören nur in GitHub-Secrets oder Vercel, nie in Chat, Commit oder Datei.

## 1. Domain an Vercel

1. Vercel → Projekt `osirus` → Settings → Domains → die Domain hinzufügen,
   zum Beispiel `osirus.de` und `www.osirus.de`.
2. Die DNS-Einträge setzen, die Vercel anzeigt (A-Record für die Hauptdomain,
   CNAME für `www`). Bei Domains, die bei Vercel gekauft werden, entfällt das.
3. Eine Variante als Hauptadresse wählen, die andere mit 308 dorthin
   weiterleiten. `osirus-ai.vercel.app` ebenfalls per 308 auf die Hauptadresse
   umleiten, damit Google nur eine Adresse indexiert.

## 2. Osirus auf die Domain umstellen

1. GitHub → Repository → Settings → Variables → `NEXT_PUBLIC_SITE_URL` =
   `https://<domain>` (nur Origin, ohne Pfad).
2. Actions → „Sync runtime configuration“ starten mit `redeploy` und
   `stripe` an. Der Lauf setzt in Vercel `NEXT_PUBLIC_SITE_URL` und
   `OSIRUS_PUBLIC_URL`, legt den Stripe-Webhook für die Domain an (sein
   Signaturschlüssel geht als `STRIPE_WEBHOOK_SECRET_MANAGED` nach Vercel),
   stellt die Rücksprung-Adressen von Checkout und Kundenportal um und baut
   neu.
3. Im Stripe-Dashboard danach den alten Webhook-Endpunkt auf
   `osirus-ai.vercel.app` deaktivieren: Stripe folgt keinen Weiterleitungen,
   der alte Endpunkt würde nur noch Fehlversuche sammeln.
4. Danach zeigen Canonical, `sitemap.xml`, `robots.txt`, OpenGraph, die
   Kündigungsbestätigung und die Production journey auf die Domain.

## 3. Anmeldung auf der Domain

- Neon Auth: die Domain als vertrauenswürdige Domain eintragen
  (Neon Console → Auth → Trusted domains, oder per Neon-Werkzeug
  `add_auth_trusted_domain`). Ohne diesen Schritt schlägt die Anmeldung auf
  der neuen Adresse fehl.
- GitHub-Anmeldung: Läuft sie über eine eigene GitHub-OAuth-App, dort die
  Homepage-URL auf die Domain setzen. Die Rücksprungadresse bleibt die von
  Neon Auth.

## 4. Bestätigungs-E-Mails (§ 312k Abs. 4 BGB)

Die Kündigungsseite speichert jede Erklärung, setzt das Abo-Ende in Stripe,
zeigt die Bestätigung zum Speichern und meldet sie in der Inbox der
Betreiberin. Die E-Mail-Bestätigung geht automatisch erst mit Resend raus:

1. Konto bei Resend anlegen, die Domain verifizieren (SPF- und DKIM-Einträge
   in deren DNS), den Auftragsverarbeitungsvertrag (DPA) von Resend annehmen.
2. GitHub-Secret `RESEND_API_KEY` anlegen, GitHub-Variable
   `OSIRUS_MAIL_FROM` = `Osirus <kuendigung@<domain>>`.
3. „Sync runtime configuration“ mit `redeploy` starten.

Bis dahin bestätigt die Betreiberin eingehende Kündigungen per E-Mail von
Hand; die Inbox zeigt jede Kündigung mit Vorgangsnummer und Status.

## 5. Google Search Console

1. search.google.com/search-console → Property hinzufügen → **Domain**
   (empfohlen) → den angezeigten TXT-Eintrag im DNS der Domain setzen →
   Bestätigen. Diese Methode braucht keinen Code.
   Alternativ Property **URL-Präfix** mit Methode „HTML-Tag“: den Wert aus
   `content="…"` als GitHub-Variable `GOOGLE_SITE_VERIFICATION` setzen und
   synchronisieren; Osirus gibt dann das Meta-Tag aus.
2. Sitemaps → `https://<domain>/sitemap.xml` einreichen.
3. URL-Prüfung für `https://<domain>/` und `https://<domain>/kuendigen` →
   „Indexierung beantragen“.
4. Der Produktbereich (`/app`, `/api`, `/auth`) ist per `robots.txt` und
   `noindex` ausgeschlossen; geteilte Chats (`/s/…`) sind `noindex`.

## 6. Abnahme nach der Umstellung

- Actions → „Production journey“ starten: Anmeldung, Chat, Kontingent, MCP
  und der Weg über „Verträge hier kündigen“ laufen gegen die Domain.
- `https://<domain>/robots.txt` und `/sitemap.xml` nennen nur die Domain.
- Eine Test-Kündigung mit einer eigenen Adresse ohne Abo: Bestätigung auf der
  Seite, E-Mail kommt an (nach Schritt 4), Eintrag in der Inbox.
