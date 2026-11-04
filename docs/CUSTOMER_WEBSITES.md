# Kundenwebseiten: bestehende Anbieter und SMA-Seiten

Stand: 4. November 2026. Beide Wege bleiben im Delta-Modul erhalten. Der neue Erstellungsweg ersetzt weder die vorhandene Kundenwebseite noch ihre Verbindungsvorbereitung.

Ergänzung: [Gemeinsame Firmendaten](COMPANY_PROFILE.md) verbindet Dashboard und SMA-Webseitenentwurf mit einer zentralen Bearbeitung von Firma, Firmensitz, Kontakten und Registerangaben. Bei vorhandenem Profil werden die gemeinsamen Felder im Webseiteneditor automatisch übernommen. Eine öffentliche Webseite verwendet den ausdrücklich veröffentlichten Firmen-Snapshot; spätere Profiländerungen bleiben zunächst im Entwurf.

## Bedienung

Unter „Webseite & Domain“ → „Webseite einrichten“:

- **Ich habe bereits eine Webseite:** Adresse speichern und den vorhandenen WordPress-Verbindungsweg öffnen. Bestehender Anbieter und Inhalte bleiben erhalten. Weitere Anbieter benötigen eigene, geprüfte Anschlüsse; eine universelle automatische Synchronisierung wird nicht behauptet. Nach bestätigter WordPress-Verbindung ist der [dauerhafte Produktentwurfsauftrag](WORDPRESS_DRAFT_SYNC.md) mit Erstellungsbutton und Wiederaufnahme angeschlossen. Eine echte externe Testseite steht weiterhin aus.
- **Ich benötige eine Webseite:** „Webseite erzeugen / bearbeiten“ öffnet einen eigenen Arbeitsbereich mit derselben SMA-Anmeldung. Ein Knopfdruck erzeugt genau einen privaten Entwurf. Bearbeitbar sind Name, Überschrift, Vorstellung, Über-uns-Text, drei Leistungen, öffentliche Kontaktdaten und Seitenangaben. Die Übersicht im Dashboard behält drei Einträge.

Jede SMA-Seite erhält eine dauerhafte Adresse `app/website.html?site=<uuid>`. Die Vorschau unter `?preview=1` ist an die angemeldete Person gebunden. Speichern verändert ausschließlich den privaten Entwurf. Ein eigener Button veröffentlicht den gespeicherten Stand oder nimmt die Seite wieder offline; spätere Änderungen bleiben bis zur nächsten ausdrücklichen Veröffentlichung privat. Im anschließenden [angemeldeten Kundentest](CUSTOMER_WEBSITE_E2E.md) wurde genau ein privater Entwurf mit klar gekennzeichneten, fiktiven SHK-Testdaten erzeugt. Die Seite wurde nicht veröffentlicht.

Eine bereits geöffnete private Vorschau übernimmt gespeicherte Änderungen beim Zurückwechseln automatisch. Gleich gebliebene Inhalte bleiben im bestehenden Seitenaufbau erhalten. Gleichzeitige Fokus-/Sichtbarkeitsereignisse werden zusammengefasst und laufende Leseanfragen nicht parallel gestartet. Bei Kontowechsel wird die Vorschau geleert; verspätete Antworten dürfen keine alten Kundendaten wieder anzeigen. Öffentliche Seiten bleiben beim veröffentlichten Snapshot und erhalten keine privaten Profilabfragen.

Der aktuelle öffentliche Shop wird serverseitig aus dem Kundenkonto zugeordnet. Produkte, Preise und Verfügbarkeit werden beim Seitenaufruf über die bestehende Katalogschnittstelle geladen, ohne HTML-Kopieren oder doppelte Produktpflege. Der Katalog bietet zusätzlich „Aktualisieren“. Das ist keine Echtzeit-Bestell-, Checkout- oder Fremdanbieter-Synchronisierung. Ist der Shop nicht öffentlich, erscheint keine Produktliste. Ein Shop-Wechsel verwendet ausschließlich die aktuelle eigene Zuordnung.

SMA-Seiten verwenden die vorhandene Infrastruktur und eine SMA-Adresse. Es wird kein Hostingvertrag abgeschlossen, keine eigene Domain gekauft und kein DNS-Eintrag geschrieben. Eigene Domains bleiben ein weiterer Schritt. Die [individuelle Gestaltung mit Akzentfarbe und Startseitenmotiv](CUSTOMER_WEBSITE_DESIGN.md) ist über PR #71 live. Der angemeldete Speichertest ist abgeschlossen; der private SHK-Testentwurf wurde anschließend auf Blau mit Hausmotiv zurückgestellt. Die neue Vorlage verwendet Inter mit den bestehenden System-Fallbacks; die genehmigte Dashboard-Schrift und geschützte n8n-Workflows bleiben unverändert.

## Eigene Bilder

[Eigene Firmenlogos und Startseitenbilder](CUSTOMER_WEBSITE_IMAGES.md) sind über **PR #72 live** und im angemeldeten privaten Kundenablauf geprüft. Der Kunde wählt sie im bestehenden zugeklappten Gestaltungsbereich und übernimmt sie mit „Änderungen speichern“. Ein eigener privater Speicherweg hält Bilder an den Besitzer und den getrennten veröffentlichten Stand gebunden. 381 Node-Tests, zehn neue Bild-DOM-Szenarien sowie bestehende DOM-/SQL-Prüfungen bestanden. Datenbank, geschützter Bild-Endpunkt und Oberfläche sind freigegeben und bereitgestellt. Ein echter PNG-/WebP-Upload mit privatem Speichern und Wiederaufruf war erfolgreich; anonyme Abrufe bleiben gesperrt. Der SHK-Testentwurf ist danach wieder Blau mit Hausmotiv und ohne eigene Bildauswahl (Revision 6). Der Produktbildspeicher und PR #69/#57 bleiben davon getrennt.

## Eigene Domain

Der [Domainnachweis für neue SMA-Webseiten](CUSTOMER_WEBSITE_DOMAIN_PROOF.md) ist als nächster Kundenschritt implementiert und lokal geprüft, aber noch nicht live. Er verwendet die gespeicherte eigene Domain im neuen Erstellungsweg und ergänzt einen Direktbutton zur bestehenden Nachweisansicht. Ein bestätigter TXT-Eintrag ist ausdrücklich noch keine Domain-Verknüpfung. DNS, Hosting und Kundendaten wurden für diese Erweiterung nicht verändert.

## SHK-Vorschau

`app/website-preview-shk.html` zeigt einen fiktiven Sanitär-, Heizungs- und Klimabetrieb mit Desktop-/Handy-Umschaltung. `app/website-example-shk.html` öffnet die Beispielseite direkt. Sie nutzt denselben Renderer und dieselben Styles wie die Kundenwebseite. Produktzeichnungen und Texte sind Beispiele; es werden keine Preise, Lagerbestände, Bestellungen oder Kontaktübermittlungen vorgetäuscht. Die Vorschau benötigt keine Anmeldung und ist für Suchmaschinen als `noindex,nofollow` markiert.

## Speicherung und Zugriff

Migration `customer_websites_v1` installiert `sma_private.customer_websites_v1` mit RLS und vollständig entzogenen Direktrechten. Öffentliche Wrapper sind `SECURITY INVOKER`; interne Definer mit leerem Suchpfad prüfen auf jedem privaten Aufruf `auth.uid()`, eine eindeutige aktuelle Kundenzuordnung und den gespeicherten Besitzer. Schreiben/Veröffentlichen erfordert aktiven Delta-Zugang oder die vorhandene Delta-Demo. Eigentümer können nach Ablauf ihren Stand lesen und die Seite offline nehmen. Anonyme Aufrufe sehen ausschließlich den ausdrücklich veröffentlichten Snapshot, sofern Besitzer und Zugang weiterhin passen.

Schreibvorgänge sperren zuerst das Kundenkonto, dann Firmenprofil und Seite. Revision und Request-UUID verhindern verlorene Updates und doppelte Erzeugung. Speichern/Veröffentlichen prüft zusätzlich die geladene Profilrevision. Wiederholungen mit gleicher Absicht liefern denselben Stand; andere Absicht, alte Revision oder Besitzerwechsel werden abgewiesen. Die öffentliche Ausgabe enthält keine Konto-IDs oder ungefragten Profil-Kontaktdaten. Nur vom Kunden eingegebene und ausdrücklich veröffentlichte Texte werden ausgegeben. Kundeninhalte werden mit `textContent` dargestellt; keine HTML-, JavaScript- oder beliebigen URL-Felder. Die Kontaktadresse wird syntaktisch begrenzt, bevor ein `mailto:`-Link entsteht.

## Prüfungen

- 350 Node-Tests bestanden, einschließlich Text-/E-Mail-Grenzen, sichere Seitenadressen, Wiederaufnahme, Kontowechsel und gemeinsame Profilrevision.
- Lokale PostgreSQL-Fälle: Rollen, fremde Kunden, Paketgrenze, genau eine Seite, Wiederholung, Konflikte, private Änderungen nach Veröffentlichung, Offline-Schaltung nach Zugangsablauf und Besitzerwechsel. Alle Fixtures zurückgerollt. Die bestehende externe Webseiten-Vorbereitung bleibt bei Erzeugung unverändert.
- DOM-Prüfungen: Text statt HTML-Ausführung, ausgeblendete leere Bereiche, separate Vorschau, kein implizites Veröffentlichen, Sperre bei ungespeicherten Änderungen und Leeren bei Kontowechsel. Bisherige WordPress-/Dashboard-DOM-Prüfungen bestanden.
- Browserprüfung der SHK-Vorschau auf Desktop und im 390-Pixel-Handyrahmen; kein horizontaler Überlauf in der Handyansicht. Produkt- und Kontaktbereiche sowie Navigation geprüft.
- Automatische private Vorschau: zwölf zusätzliche DOM-Szenarien für Aktualisierung, unveränderte Inhalte, laufende Anfragen, Kontowechsel, Ladefehler, Browsernavigation und öffentliche Trennung; 359 bestehende Node-Tests bestanden. Lokale Browserprüfung mit fiktiven Daten und simuliertem Speicherweg in zwei 390-Pixel-Rahmen: Änderung speichern, Fokus zur offenen Vorschau wechseln, neue Adresse und Ansprechperson sichtbar. [Nachweis und Grenzen](CUSTOMER_WEBSITE_E2E.md#ergänzung-offene-private-vorschau).
- Migration installiert; native Prüfung weist einen sitzungslosen privaten Aufruf mit `AUTH_REQUIRED` ab. Die neue private Tabelle erzeugt lediglich den beabsichtigten Advisor-INFO-Hinweis `rls_enabled_no_policy`, da direkte Tabellenrechte fehlen.

Der [authentifizierte Browserlauf im bestehenden Delta-Demo-Testkonto](CUSTOMER_WEBSITE_E2E.md) wurde am 4. November 2026 mit fiktiven Firmendaten erfolgreich durchgeführt: zentrale Speicherung, Entwurfserzeugung, Textbearbeitung, Übernahme einer späteren Adressänderung, Wiederaufruf, Produktanzeige und anonyme Zugriffssperre. Echte Kundendaten und eine Veröffentlichung sind weiterhin nicht abgenommen.

```sh
node --test tests/*.test.cjs
node tests/run-customer-websites-sql.mjs
node tests/run-customer-website-dom.mjs
node tests/run-customer-website-refresh-dom.mjs
node tests/run-company-profile-dom.mjs
node tests/run-wordpress-dom.mjs
```
