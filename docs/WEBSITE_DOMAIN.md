# Webseite & Domain – kostenfreie Vorbereitung

Stand: 4. November 2026. Arbeitsbranch `website-domain-preparation`, Ziel `website-v1`. **Prüfbarer Implementierungsentwurf, noch nicht live und noch nicht vollständig abgenommen.**

Der Nutzer hat die kostenfreie Vorbereitung vorgezogen, während Sightengine-Zahlung, Videoprüfung und echter Social-Media-Uploadtest offen bleiben. PR #57 bleibt davon getrennt und ungemergt. Es gibt keinen Auftrag zu Domainkauf, Hostingwechsel, Tarifänderung oder Veröffentlichung einer Kundenwebseite.

## Umfang

Das vorhandene Delta-Modul `#page-website` erhält ein Formular für „Ich habe bereits eine Webseite“ oder „Ich benötige eine Webseite“, eine bestehende HTTPS-Webadresse und optional eine Wunschdomain. Neue Webseiten bleiben individuell abgestimmte Projekte. Die Vorbereitung enthält keinen Baukasten.

Der Entwurf speichert nur vorbereitende Angaben. Domainverfügbarkeit, Inhaberschaft, DNS, TLS, Erreichbarkeit und externe Anbindung werden nicht als geprüft dargestellt. Alle Ergebnisse bleiben `state:preparation`, `domain_verified:false`, `website_connected:false` und `can_publish:false`.

Eine öffentliche SMA-Shopadresse wird ausschließlich aus der aktuellen Kundenzeile zusammengesetzt. Der Kunde kann sie für einen späteren Shop-Button kopieren. Dieser Link ist keine automatische Produkt-/Bestellsynchronisierung mit einer externen Webseite.

## Umsetzung

| Bestandteil | Datei |
| --- | --- |
| Bestehendes Modul ergänzen | `app/dashboard.html` |
| Formular, Fehlermeldungen, Laden/Speichern/Kopieren | `app/assets/website-domain.mjs` |
| Adressen, Ergebnisvertrag, Wiederholung und Revision | `app/assets/website-domain-model.mjs` |
| Auf das neue Modul begrenzte Gestaltung | `app/assets/website-domain.css` |
| Private Speicherung und authentifizierter RPC | `supabase/sql/website-domain-preparation.sql` |

Der bestehende Dashboard-HTML-Workflow wird nicht verändert. Der äußere Wrapper ergänzt das vorhandene Modul; Navigation, bestehende Überschrift, Schrift und übrige Portalbereiche bleiben erhalten. Die neue Gestaltung erbt die Dashboard-Schrift. Es werden keine externen Schriften, Bilder, Analyse- oder Websiteanbieter eingebunden.

## Zugriff und Speichern

- Der öffentliche RPC `sma_website_preparation_v1` ist `SECURITY INVOKER` und nur für `authenticated` ausführbar. Er ruft eine private Funktion mit leerem `search_path` auf.
- Die private Funktion prüft `auth.uid()`, eine eindeutige aktuelle Kundenzuordnung, aktiven Zugang sowie bezahltes Delta oder aktive Delta-Demo. Der Client kann weder Nutzer-/Kunden-ID noch Paket, Shopadresse oder Verbindungsstatus übergeben.
- Die Tabelle `sma_private.website_preparations_v1` hat RLS; direkte Tabellenrechte für öffentliche, Kunden- und Service-Rollen sind entzogen. Eine Kundenzuordnung, die nachträglich einen anderen Besitzer erhält, gibt dessen alten Entwurf nicht frei.
- Die Kundenzeile und der Entwurf werden beim Zugriff gesperrt. `expected_revision` verhindert stilles Überschreiben durch ein anderes Fenster. Eine identische Anfrage mit derselben UUID liefert nach einer verlorenen Antwort den bereits gespeicherten Stand zurück.
- Der Client prüft den angemeldeten Benutzer vor und nach Requests. Die Dashboard-Anfrage verwendet den zum ursprünglichen Benutzer gehörenden Session-Token; Abmelden entfernt das Modul und seine Daten. Zugangsdaten werden nicht gespeichert.
- Adressen sind nur Eingaben. Der Server ruft sie nicht ab. HTTPS, gültige ASCII-Domainnamen, begrenzte Längen und fehlende Zugangsdaten/Ports/Suchparameter/Anker werden geprüft; lokale Namen und IP-Literale sind ausgeschlossen. Internationalisierte Domains benötigen zunächst ihre ASCII-Schreibweise.
- Die Anzahl gespeicherter Vorbereitungen ist auf eine pro Kunde begrenzt. Es gibt keinen Scheduler, kostenpflichtigen Prüfdienst, Registraraufruf, DNS-Schreibzugriff, automatischen Seitenbau oder Social-Media-Aufruf.

## Prüfstand und Fortsetzung

Die Arbeitsumgebung und Browsersteuerung sind während der Bestandsaufnahme ausgefallen. Deshalb wurde nichts in die Live-Datenbank eingespielt, kein n8n-Workflow geändert und kein Frontend veröffentlicht. Der zuvor angelegte lokale Worktree ist nicht als Sicherung dieser später über GitHub vorbereiteten Dateien anzusehen; maßgeblich ist der Remote-Branch.

Bereits geprüft: acht reine JavaScript-Modellfälle in der verfügbaren V8-Laufzeit mit Assertion-Harness; zusätzlich Syntax der beiden Module und des ergänzten Dashboard-Scripts sowie ausgeglichene Formular-Tags. Abgedeckt sind ungültige Ziele, ausschließlich gültige SMA-Shoplinks, fremde Zustände, verlorene Speicherantworten, neue Revisionen, Kontoänderungen, Konflikte und parallele Speicheraufrufe. **Dies ersetzt weder den Node-Testlauf noch SQL- oder Browserprüfung.**

Noch auszuführen, sobald die Arbeitsumgebung wieder verfügbar ist:

1. Exakten Branch laden; vorhandene Node-Prüfreihen einschließlich `website-domain.test.cjs` ausführen.
2. Mit der vorhandenen festgeschriebenen PGlite-Abhängigkeit die neue SQL-Prüfreihe ausführen. Sie prüft Demo/Delta, inaktiven Zugang, falsches Paket, Eigentümerwechsel, doppelte Kundenbindung, direkte Rollenrechte, Replay, Konflikte und ungültige Eingaben in einer isolierten Datenbank.
3. Desktop-/Mobilansicht und Einbettung im bestehenden Dashboard prüfen; Ladefehler/erneutes Laden, Kopieren, Navigation und Abmeldung einbeziehen.
4. Erst nach diesen Prüfungen die additive Definition als versionierte Migration installieren, Rollenrechte und Security-Advisors prüfen und den Zugang authentifiziert testen. Den Zielbranch unmittelbar vor einem Merge erneut prüfen.
5. Erst dann die Dashboard-Erweiterung veröffentlichen und Speichern/erneutes Laden im echten Delta-Zugang abnehmen.

```sh
node --test tests/*.test.cjs
npm ci --prefix tests/sql-runtime --ignore-scripts
node tests/run-website-domain-sql.mjs
```

Ein späterer Schritt muss Inhaberschaft und konkrete Art der externen Anbindung nachweisen. Domainregistrierung, Kauf, Hosting, DNS-Änderungen und automatischer Datenabgleich sind nicht Bestandteil dieses Vorbereitungsentwurfs.
