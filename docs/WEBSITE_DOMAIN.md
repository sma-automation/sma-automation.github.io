# Webseite & Domain – kostenfreie Vorbereitung

Stand: 4. November 2026. Arbeitsbranch `website-domain-preparation`, Ziel `website-v1`. **Speicherung installiert und geprüft; lokale Browserabnahme abgeschlossen. Frontend-Freigabe und Live-Abnahme werden in PR #58 protokolliert.**

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

Der bestehende Dashboard-HTML-Workflow wird nicht verändert. Der äußere Wrapper ersetzt ausschließlich den Platzhalter im vorhandenen Modul und stellt ihn beim Entfernen der Erweiterung wieder her; Navigation, bestehende Überschrift, Schrift und übrige Portalbereiche bleiben erhalten. Die neue Gestaltung erbt die Dashboard-Schrift. Es werden keine externen Schriften, Bilder, Analyse- oder Websiteanbieter eingebunden.

## Zugriff und Speichern

- Der öffentliche RPC `sma_website_preparation_v1` ist `SECURITY INVOKER` und nur für `authenticated` ausführbar. Er ruft eine private Funktion mit leerem `search_path` auf.
- Die private Funktion prüft `auth.uid()`, eine eindeutige aktuelle Kundenzuordnung, aktiven Zugang sowie bezahltes Delta oder aktive Delta-Demo. Der Client kann weder Nutzer-/Kunden-ID noch Paket, Shopadresse oder Verbindungsstatus übergeben.
- Die Tabelle `sma_private.website_preparations_v1` hat RLS; direkte Tabellenrechte für öffentliche, Kunden- und Service-Rollen sind entzogen. Eine Kundenzuordnung, die nachträglich einen anderen Besitzer erhält, gibt dessen alten Entwurf nicht frei.
- Die Kundenzeile und der Entwurf werden beim Zugriff gesperrt. `expected_revision` verhindert stilles Überschreiben durch ein anderes Fenster. Eine identische Anfrage mit derselben UUID liefert nach einer verlorenen Antwort den bereits gespeicherten Stand zurück.
- Der Client prüft den angemeldeten Benutzer vor und nach Requests. Die Dashboard-Anfrage verwendet den zum ursprünglichen Benutzer gehörenden Session-Token; Abmelden entfernt das Modul und seine Daten. Zugangsdaten werden nicht gespeichert.
- Adressen sind nur Eingaben. Der Server ruft sie nicht ab. HTTPS, gültige ASCII-Domainnamen, begrenzte Längen und fehlende Zugangsdaten/Ports/Suchparameter/Anker werden geprüft; lokale Namen und IP-Literale sind ausgeschlossen. Internationalisierte Domains benötigen zunächst ihre ASCII-Schreibweise.
- Die Anzahl gespeicherter Vorbereitungen ist auf eine pro Kunde begrenzt. Es gibt keinen Scheduler, kostenpflichtigen Prüfdienst, Registraraufruf, DNS-Schreibzugriff, automatischen Seitenbau oder Social-Media-Aufruf.

## Prüfstand

- `node --test tests/*.test.cjs`: **298 bestanden, 0 fehlgeschlagen** auf dem Website-Zweig (290 vorhandene + 8 neue Modellfälle). Die 314 Tests aus PR #57 gehören zu dessen separatem Publishing-Zweig und sind nicht Bestandteil dieses Zielbranchs.
- `node tests/run-website-domain-sql.mjs`: lokale PGlite-Prüfreihe bestanden. Abgedeckt: Demo/Delta, inaktiver Zugang, falsches Paket, Eigentümerwechsel, doppelte Kundenbindung, direkte Rollenrechte, Replay, Konflikte und ungültige Eingaben.
- Migration **`20261103234313_website_domain_preparation_v1`** über die Datenbank-Migrationsschnittstelle installiert. Die identische Definition ist unter `supabase/migrations/20261103234313_website_domain_preparation_v1.sql` eingecheckt.
- Der installierte RPC wurde als Rolle `authenticated` mit synthetischen Kunden innerhalb einer zurückgerollten Transaktion geprüft: Speichern, identisches Wiederholen, erneutes Laden, neue Revision, Konflikte, Kontowechsel sowie Paket-/Zugangssperren bestanden. Danach **0 Testkunden und 0 gespeicherte Vorbereitungen** verblieben.
- In der Live-Datenbank verhindert zusätzlich der eindeutige Index `sma_kunden_user_id_key` doppelte Nutzerzuordnungen. Der erste Live-Fixturelauf wurde beim absichtlichen Duplikat durch diesen Index abgebrochen und vollständig zurückgerollt. Der anschließende Live-Lauf ohne dieses künstliche Duplikat bestand. Die lokale Fixture ohne diesen Index prüft zusätzlich die defensive Ablehnung durch den RPC selbst.
- Rollenprüfung live: kein anonymer RPC-Aufruf, kein direkter Tabellenzugriff für Kunden; öffentlicher Wrapper bleibt `SECURITY INVOKER`.
- Security-Advisors: keine neue Warnung. Ein zusätzlicher Hinweis [RLS ohne Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) entspricht der beabsichtigten Sperre aller direkten Tabellenzugriffe. Die schon vorher bestehenden Hinweise/Warnungen anderer Tabellen, Funktionen und Auth-Einstellungen wurden nicht verändert.
- Browserabnahme am 4. November 2026 mit synthetischen Daten bestanden: Formular ersetzt den Platzhalter, Pflichtfeldmeldung, Speichern/Neuladen bestehender und neuer Webseiten, Normalisierung der Adresse, verlorene Antwort und identische Wiederholung ohne zweite Änderung, Ladefehler mit erfolgreichem Wiederholen, exakter kopierter Shop-Link, Zugriffsentzug mit geleerten/gesperrten Feldern und entferntem Shop-Link, Entfernen des Moduls mit Wiederherstellung des ursprünglichen Platzhalters.
- Mobilprüfung in einem 390-Pixel-Frame (375 Pixel nutzbare Breite mit Scrollleiste): kein horizontaler Überlauf, gestapelte Aktionen und erfolgreicher Speichervorgang. Der lokale HTTP-Prüfaufbau nutzt synthetische Anfrage-UUIDs; das Produkt verwendet `crypto.randomUUID()` auf der bestehenden HTTPS-Domain.
- Der zwischenzeitliche Ausfall der Browsersteuerung ist behoben. Die lokale Prüfung simuliert die API; die zuvor bestandene SQL-Prüfung deckt die installierte Speicherung ab. Beides zusammen ersetzt nicht die abschließende authentifizierte Einbettung nach dem Deployment.
- PR #57 und alle n8n-Originalworkflows bleiben unverändert. Keine Tarif-, Registrar-, DNS-, Hosting- oder Social-Media-Aktion.

## Freigabe und Betrieb

Die Migration ist bereits installiert und wird nicht erneut angewendet. PR #58 führt das Frontend nach Vergleich des aktuellen Zielbranchs über den bestehenden GitHub-Pages-Deploymentweg ein. Der abschließende Deployment- und Live-Prüfstand steht in der PR-Beschreibung.

Im echten Delta-Dashboard wird Laden und Navigation geprüft. Einen echten Kundeneintrag nur mit zutreffenden Kundenangaben speichern; die erfolgreiche SQL-Fixture und lokale Vorschau werden nicht als bereits erfolgter Live-UI-Speichervorgang ausgegeben.

```sh
node --test tests/*.test.cjs
npm ci --prefix tests/sql-runtime --ignore-scripts
node tests/run-website-domain-sql.mjs
```

Ein späterer Schritt muss Inhaberschaft und konkrete Art der externen Anbindung nachweisen. Domainregistrierung, Kauf, Hosting, DNS-Änderungen und automatischer Datenabgleich sind nicht Bestandteil dieser Vorbereitung. Sightengine bleibt `VIDEO_PLAN_REQUIRED`; ein echter Uploadtest benötigt weiterhin eine ausdrückliche Freigabe.
