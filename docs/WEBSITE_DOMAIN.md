# Webseite & Domain – kostenfreie Vorbereitung

Stand: 4. November 2026. Ziel `website-v1`. **Vorbereitung aus PR #58, Shop-Button aus PR #59 und Domainnachweis aus PR #60 sind veröffentlicht.** Der öffentliche Klickweg zur Shopseite wurde zusätzlich im Browser des Nutzers anhand seiner Screenshots bestätigt. Der [kundengebundene DNS-Domainnachweis](DOMAIN_VERIFICATION.md) ist angeschlossen.

Der Nutzer hat die kostenfreie Vorbereitung vorgezogen, während Sightengine-Zahlung, Videoprüfung und echter Social-Media-Uploadtest offen bleiben. PR #57 bleibt davon getrennt und ungemergt. Es gibt keinen Auftrag zu Domainkauf, Hostingwechsel, Tarifänderung oder Veröffentlichung einer Kundenwebseite.

## Umfang

Das vorhandene Delta-Modul `#page-website` erhält ein Formular für „Ich habe bereits eine Webseite“ oder „Ich benötige eine Webseite“, eine bestehende HTTPS-Webadresse und optional eine Wunschdomain. Neue Webseiten bleiben individuell abgestimmte Projekte. Die Vorbereitung enthält keinen Baukasten.

Der Entwurf speichert nur vorbereitende Angaben. Domainverfügbarkeit, Inhaberschaft, DNS, TLS, Erreichbarkeit und externe Anbindung werden nicht als geprüft dargestellt. Alle Ergebnisse bleiben `state:preparation`, `domain_verified:false`, `website_connected:false` und `can_publish:false`.

Eine öffentliche SMA-Shopadresse wird ausschließlich aus der aktuellen Kundenzeile zusammengesetzt. Der Kunde kann die Adresse oder einen fertigen HTML-Button kopieren und dessen Ziel in einer separaten Prüfansicht ausprobieren. Dieser Link ist keine automatische Produkt-/Bestellsynchronisierung mit einer externen Webseite.

## Umsetzung

| Bestandteil | Datei |
| --- | --- |
| Bestehendes Modul ergänzen | `app/dashboard.html` |
| Formular, Fehlermeldungen, Laden/Speichern/Kopieren | `app/assets/website-domain.mjs` |
| Adressen, Ergebnisvertrag, Wiederholung und Revision | `app/assets/website-domain-model.mjs` |
| Auf das neue Modul begrenzte Gestaltung | `app/assets/website-domain.css` |
| Validierter öffentlicher Link und portabler HTML-Button | `app/assets/shop-button.mjs` |
| Öffentliche Prüfansicht mit Kopierhilfe | `app/website-connection-test.html`, `app/assets/website-connection-test.mjs` |
| Private Speicherung und authentifizierter RPC | `supabase/sql/website-domain-preparation.sql` |

Der bestehende Dashboard-HTML-Workflow wird nicht verändert. Der äußere Wrapper ersetzt ausschließlich den Platzhalter im vorhandenen Modul und stellt ihn beim Entfernen der Erweiterung wieder her; Die äußere Navigation, Schrift und übrigen Portalbereiche bleiben erhalten. Die Modulüberschrift und Paketinformation stehen in der Übersicht; während einer Arbeitsansicht machen sie Platz für die gewählte Aufgabe. Die neue Gestaltung erbt die Dashboard-Schrift. Es werden keine externen Schriften, Bilder, Analyse- oder Websiteanbieter eingebunden.

## Kompakter Arbeitsbereich

Die Übersicht zeigt drei Einstiege: „Webseite einrichten“, „Shop-Button einbauen“ und „Eigene Domain nachweisen“. Nur die gewählte Aufgabe wird geöffnet. Ein Zurück-Button führt zur Übersicht; der Fokus folgt der geöffneten Ansicht beziehungsweise dem zuletzt verwendeten Einstieg. Die bisherigen drei rein informativen Paketkacheln werden in diesem Modul durch die drei Einstiege ersetzt.

Die Formularfelder bleiben beim Wechsel im DOM, sodass ungespeicherte Eingaben erhalten bleiben. Beim Wechsel in ein anderes Dashboard-Modul wird die Übersicht wiederhergestellt. Entfernen der Erweiterung stellt den ursprünglichen Platzhalter und die ursprünglichen Modulklassen wieder her. Die Domainprüfung erhält eine eigene Ansicht ohne zusätzliche aufzuklappende Ebene; ihre Speicherung und Zugangsprüfungen bleiben unverändert.

## Shop-Button und Prüfansicht

Unter „Webseite & Domain“ → „Shop-Button einbauen“ stehen „Shop-Button testen“ und die aufklappbare Einbauhilfe bereit. Der Einbaucode ist ein normaler HTML-Link ohne JavaScript, iframe, Tracking oder Zugangsdaten. Er erbt die Schrift der einbindenden Webseite. Webseitenprogramme ohne HTML-Baustein können dieselbe öffentliche Adresse als gewöhnliches Linkziel verwenden.

`/app/website-connection-test.html?shop=<slug>` zeigt den Button, sein exaktes Ziel und denselben kopierbaren Code. Die Seite akzeptiert ausschließlich einen gültigen öffentlichen Shop-Slug; zusätzliche oder doppelte Parameter werden abgelehnt. Ziel-Origin und Shop-Pfad sind fest vorgegeben. Ohne gültigen Parameter erscheint eine Anleitung zum Öffnen über das Dashboard, kein aktiver Shop-Button. Die Prüfansicht ruft keine Kunden-API auf und speichert nichts. Bei gesperrter Zwischenablage wird der Code für manuelles Kopieren markiert.

Die SMA-Hauptseite und `CNAME` bleiben unverändert. Die Prüfansicht weist den Klickweg zum Shop nach; sie bestätigt weder Domaininhaberschaft noch den Einbau auf einer externen Webseite. Checkout und Bestellfreigaben bleiben Aufgaben des bestehenden Shops. Neue SQL-Migrationen oder n8n-Änderungen sind für diese Ergänzung nicht nötig.

## Zugriff und Speichern

- Der öffentliche RPC `sma_website_preparation_v1` ist `SECURITY INVOKER` und nur für `authenticated` ausführbar. Er ruft eine private Funktion mit leerem `search_path` auf.
- Die private Funktion prüft `auth.uid()`, eine eindeutige aktuelle Kundenzuordnung, aktiven Zugang sowie bezahltes Delta oder aktive Delta-Demo. Der Client kann weder Nutzer-/Kunden-ID noch Paket, Shopadresse oder Verbindungsstatus übergeben.
- Die Tabelle `sma_private.website_preparations_v1` hat RLS; direkte Tabellenrechte für öffentliche, Kunden- und Service-Rollen sind entzogen. Eine Kundenzuordnung, die nachträglich einen anderen Besitzer erhält, gibt dessen alten Entwurf nicht frei.
- Die Kundenzeile und der Entwurf werden beim Zugriff gesperrt. `expected_revision` verhindert stilles Überschreiben durch ein anderes Fenster. Eine identische Anfrage mit derselben UUID liefert nach einer verlorenen Antwort den bereits gespeicherten Stand zurück.
- Der Client prüft den angemeldeten Benutzer vor und nach Requests. Die Dashboard-Anfrage verwendet den zum ursprünglichen Benutzer gehörenden Session-Token; Abmelden entfernt das Modul und seine Daten. Zugangsdaten werden nicht gespeichert.
- Adressen sind nur Eingaben. Der Server ruft sie nicht ab. HTTPS, gültige ASCII-Domainnamen, begrenzte Längen und fehlende Zugangsdaten/Ports/Suchparameter/Anker werden geprüft; lokale Namen und IP-Literale sind ausgeschlossen. Internationalisierte Domains benötigen zunächst ihre ASCII-Schreibweise.
- Die Anzahl gespeicherter Vorbereitungen ist auf eine pro Kunde begrenzt. Es gibt keinen Scheduler, kostenpflichtigen Prüfdienst, Registraraufruf, DNS-Schreibzugriff, automatischen Seitenbau oder Social-Media-Aufruf.

## Prüfstand

Kompakter Arbeitsbereich (4. November 2026): **308 Tests bestanden**. Browserprüfung mit synthetischen Daten: Übersicht und getrennte Ansichten, Fokus und Zurück-Navigation, Erhalt ungespeicherter Eingaben beim Wechsel, Speichern/Neuladen, Shop-Einbaucode und Kopiermeldung, Domainprüfung mit gespeichertem Ergebnis, Verknüpfung zum Formular bei fehlenden/ungespeicherten Angaben, geleerte Felder und entfernte Shopziele nach Zugriffsentzug sowie Wiederherstellung des ursprünglichen Moduls beim Entfernen. Desktop mit Seitenleiste und mobile Ansicht mit 390 Pixel Nutzbreite geprüft; kein horizontaler Überlauf, Zurück-Button einzeilig und 48 Pixel hoch. Bestehende Datenbank- und Edge-Funktionen werden von dieser Layoutänderung nicht verändert.

Vorherige Funktionsabnahmen:

- `node --test tests/*.test.cjs`: **301 bestanden, 0 fehlgeschlagen** auf dem Website-Zweig (298 aus PR #58 + 3 neue Fälle für den Shop-Button). Die neuen Fälle prüfen das genaue Ziel, scriptfreien Code, abgewiesene fremde/unsichere Adressen und ungültige/doppelte Queryparameter. Die 314 Tests aus PR #57 gehören zu dessen separatem Publishing-Zweig und sind nicht Bestandteil dieses Zielbranchs.
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
- Browserprüfung der Einbauhilfe: Dashboard-Erweiterung geöffnet, Code und Ziel geprüft; Zugriffsentzug entfernt Code und Vorschauziel. Die eigenständige Prüfansicht öffnete per echtem Klick den vorhandenen öffentlichen Shop mit drei Produkten; die Kasse blieb gesperrt. Browser-Zurück, exakter Clipboard-Inhalt und Ansicht ohne Shop-Parameter geprüft. Dashboard-Hilfe und Prüfansicht in einem 390-Pixel-Frame (375 Pixel nutzbar) mit geöffneter Anleitung ohne horizontalen Überlauf; Schrift wird geerbt, Buttonhöhe 45 Pixel. Diese Prüfung nutzte den lokalen Build und das bestehende öffentliche Shopziel; sie ist kein Kauf, externer Einbau oder Uploadtest.

## Freigabe und Betrieb

Die Migration ist bereits installiert und wird nicht erneut angewendet. PR #58 wurde als `277d68bcfa646349a55d6108865fdd16fdde830c` nach `website-v1` zusammengeführt; GitHub-Pages-Lauf `41743933195` war erfolgreich. Die authentifizierte Frontend-Abnahme steht in PR #58. Die Shop-Button-Ergänzung verwendet denselben Deploymentweg; ihr abschließender Live-Prüfstand steht im zugehörigen PR.

Im echten Delta-Dashboard wird Laden und Navigation geprüft. Einen echten Kundeneintrag nur mit zutreffenden Kundenangaben speichern; die erfolgreiche SQL-Fixture und lokale Vorschau werden nicht als bereits erfolgter Live-UI-Speichervorgang ausgegeben.

```sh
node --test tests/*.test.cjs
npm ci --prefix tests/sql-runtime --ignore-scripts
node tests/run-website-domain-sql.mjs
```

Der neue [Domainnachweis](DOMAIN_VERIFICATION.md) ergänzt eine Prüfung der DNS-Kontrolle für gespeicherte bestehende Webseiten. Der reale Nachweis verlangt einen TXT-Eintrag beim Domainanbieter. Der tatsächliche Button-Einbau auf einer Kundenwebseite ist damit noch nicht geprüft. Domainregistrierung, Kauf, Hostingwechsel, automatisches Ändern von DNS-Einträgen und automatischer Produkt-/Bestellabgleich sind nicht Bestandteil dieser Vorbereitung. Sightengine bleibt `VIDEO_PLAN_REQUIRED`; ein echter Uploadtest benötigt weiterhin eine ausdrückliche Freigabe.
