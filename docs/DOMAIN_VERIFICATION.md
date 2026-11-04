# Domainnachweis für das Kundenmodul

Stand: 4. November 2026. Arbeitsbranch `website-domain-verification`, Ziel `website-v1`.

Der Nutzer überlässt die nächste technische Fortsetzung nach dem bestätigten öffentlichen Shop-Klickweg der Umsetzung. Ergänzt wird das Kundenmodul, ohne einen Testshop auf der SMA-Hauptseite zu bewerben. Neue Webseiten bleiben manuelle Projekte; es entsteht kein Baukasten.

## Verhalten

Unter „Webseite & Domain“ steht die zunächst geschlossene Anleitung „Eigene Domain nachweisen“. Für eine gespeicherte bestehende Webadresse kann der Kunde einen TXT-Prüfeintrag erstellen und Name/Wert kopieren. Die eigentliche DNS-Abfrage erfolgt erst mit „Domainnachweis prüfen“.

SMA prüft ausschließlich den Eintrag `_sma-verification.<gespeicherter Hostname>`. Wunschdomains werden nicht abgefragt. Der öffentliche Shop-Button bleibt unabhängig vom Nachweis nutzbar. Die Domain muss nicht erneut gekauft oder zu einem anderen Anbieter umgezogen werden. Die Anwendung ändert selbst keine DNS-Einträge.

Ein erfolgreicher Nachweis belegt die Kontrolle des DNS-Eintrags **zum angezeigten Zeitpunkt**, nicht die rechtliche Inhaberschaft, den Einbau des Buttons oder laufende Verfügbarkeit. Er schaltet weder Publishing, Checkout, Hosting noch fremde Kundendaten frei. Der bisherige Vorbereitungskontrakt mit `website_connected:false` und `can_publish:false` bleibt erhalten. Der neue Nachweisstatus wird getrennt geladen.

## Zugriff und Speicherung

- Private Tabelle `sma_private.website_domain_checks_v1`: eine Zeile pro Kunde, RLS aktiv, keine direkten Rechte für `anon`, `authenticated` oder `service_role`.
- `public.sma_website_domain_check_v1(text)` ist ein `SECURITY INVOKER`-Wrapper. Die private Implementierung prüft `auth.uid()`, eindeutige aktuelle Kundenzuordnung, aktiven Delta-/Demo-Zugang und den Besitzer der gespeicherten Vorbereitung. Konten mit falschem Paket oder inaktivem Zugang erhalten keine Challenge.
- Domain, Revision und Benutzer stammen ausschließlich aus der gespeicherten Vorbereitung. Kunden können keinen fremden Nutzer, Hostnamen oder Bestätigungsstatus einsenden. Zwei zufällige UUIDs bilden den öffentlichen, nicht als Zugangsdaten verwendbaren Challengewert.
- Wiederholtes Erstellen für dieselbe Revision liefert denselben Wert. Jede neue Vorbereitungsrevision verlangt einen neuen Nachweis. Bei Änderung im Formular wird der bisherige Nachweis sofort aus der Ansicht entfernt.
- Vor jeder DNS-Abfrage wird eine atomar gesperrte Prüfkennung vergeben; höchstens ein Beginn pro 60 Sekunden und Kunde. Eine ältere parallele Anfrage oder ein Ergebnis nach mehr als zwei Minuten kann den Status nicht überschreiben.
- Nur der Service-Wrapper `public.sma_website_domain_check_finish_v1(uuid,uuid,text)` darf das Ergebnis speichern. Die Edge Function bezieht die Nutzer-ID aus Supabase Auth. Abschluss prüft erneut Kundenzuordnung, Zugangsrecht, Revision, Hostname und Prüfkennung.
- Ein fehlender Eintrag entfernt eine bisherige Bestätigung. Ein technischer DNS-Ausfall erzeugt keine neue Bestätigung und zeigt einen vorhandenen früheren Zeitstempel ausdrücklich als letzten bekannten Nachweis. Eine verlorene Browserantwort kann durch erneutes Laden des gespeicherten Standes aufgeholt werden.

## Dienst und Netzwerk

`sma-website-domain-check`, Version 1, ist mit `verify_jwt:true` installiert. Zusätzlich validiert `/auth/v1/user` die Identität. Der Dienst verwendet native Fetch-/Deno-Funktionen ohne zusätzliche Pakete. Service-Schlüssel bleiben ausschließlich in der vorhandenen Serverumgebung.

Erlaubte Aktionen: `get`, `prepare`, `verify`; der Request enthält nur `{ "action": "…" }`. Die browserseitige Origin ist auf `https://sma-automation.com` beschränkt. Kontowechsel während einer Anfrage sowie verspätete UI-Antworten werden verworfen. Zugriffsentzug leert auch die Shop- und Domainangaben.

DNS-Abfragen gehen ausschließlich an `https://dns.google/resolve` mit TXT-Typ, aktivierter DNSSEC-Prüfung und `edns_client_subnet=0.0.0.0/0`. Es werden keine vom Kunden vorgegebenen Webseiten oder internen IP-Adressen abgerufen. Weiterleitungen sind abgelehnt; DNS-Zeitlimit acht Sekunden, Antwortlimit 64 KiB. Nur ein exakt passender TXT-Wert unter dem angefragten Namen zählt. Unvollständige Antworten, DNS-Fehler, falscher Name, Typ oder Wert zählen nicht als Erfolg. Keine geplanten Abfragen, Registraraufrufe oder Tarifänderungen.

## Prüfstand und Betrieb

- `node --test tests/*.test.cjs`: **308 bestanden**, keine Fehler (301 bisherige und 7 neue Fälle).
- `node tests/run-domain-verification-sql.mjs`: lokale Rollen-/Zustandsprüfung bestanden. Zusätzlich geprüfte Fälle umfassen neue Prüfkennung vor alter Antwort, abgelaufene Prüfkennung sowie Zugriffsentzug während einer Abfrage.
- Migration `20261104095446_website_domain_verification_v1` installiert; SQL-Definition identisch in `supabase/sql/website-domain-verification.sql` und im Migrationsverzeichnis. Die Supabase-CLI ist in dieser Umgebung nicht installiert; die tatsächliche Versionsnummer wurde nach der Migration über den Connector ausgelesen.
- Live-SQL-Prüfung mit synthetischen Kunden in einer vollständig zurückgerollten Transaktion bestanden: Erstellen/Wiederholung, Bestätigen/Laden, unzulässige Rollen, Kundentrennung, Prüfungstakt, fehlender Eintrag, geänderte Revision und Kontowechsel. Auch neuere/abgelaufene Prüfkennungen, DNS-Ausfall und Zugriffsentzug während einer laufenden Prüfung sind live bestanden. Keine echten Kundenangaben verändert.
- Security-Advisors: keine neue Warnung. Ein zusätzlicher INFO-Eintrag [RLS ohne Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) ist die beabsichtigte Sperre aller direkten Tabellenzugriffe.
- Browser mit synthetischer API: fehlender Nachweis, Erstellen, markierter Clipboard-Fallback, Erfolg, Neuladen, DNS-Ausfall mit altem Zeitstempel, Adresswechsel, neue Zuordnung und Zugriffsentzug geprüft. Mobile Ansicht mit 390 Pixel Frame / 375 Pixel Nutzbreite ohne horizontalen Überlauf; vorhandene Schrift geerbt. Keine Änderung des bestehenden Stylesheets erforderlich.
- Ein echter positiver DNS-Nachweis für eine Kundendomain wurde nicht behauptet oder vorgetäuscht: Er benötigt den kundenspezifischen TXT-Eintrag beim Domainanbieter. In dieser Sitzung wurden keine DNS-Einträge gesetzt. Die separate authentifizierte Live-Dashboard-Abnahme bleibt wegen der getrennten Browsersitzung offen; keine weitere Login-Aufforderung an den bereits angemeldeten Nutzer.

Die Hauptseite, CNAME, n8n-Originalworkflows, PR #57, Social-Media-Freigaben und Checkout-Gates bleiben unverändert. Deployment und abschließende Veröffentlichung werden im zugehörigen PR festgehalten.

## Referenzen

- [Supabase: Edge-Authentifizierung](https://supabase.com/docs/guides/functions/auth), geprüft am 4. November 2026.
- [Google Public DNS: DoH JSON-Vertrag](https://developers.google.com/speed/public-dns/docs/doh/json), geprüft am 4. November 2026.

```sh
node --test tests/*.test.cjs
npm ci --prefix tests/sql-runtime --ignore-scripts
node tests/run-domain-verification-sql.mjs
```
