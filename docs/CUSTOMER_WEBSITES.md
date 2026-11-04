# Kundenwebseiten: bestehende Anbieter und SMA-Seiten

Stand: 4. November 2026. Beide Wege bleiben im Delta-Modul erhalten. Der neue Erstellungsweg ersetzt weder die vorhandene Kundenwebseite noch ihre Verbindungsvorbereitung.

Ergänzung: [Gemeinsame Firmendaten](COMPANY_PROFILE.md) verbindet Dashboard und SMA-Webseitenentwurf mit einer zentralen Bearbeitung von Firma, Firmensitz, Kontakten und Registerangaben. Bei vorhandenem Profil werden die gemeinsamen Felder im Webseiteneditor automatisch übernommen. Eine öffentliche Webseite verwendet den ausdrücklich veröffentlichten Firmen-Snapshot; spätere Profiländerungen bleiben zunächst im Entwurf.

## Bedienung

Unter „Webseite & Domain“ → „Webseite einrichten“:

- **Ich habe bereits eine Webseite:** Adresse speichern und den vorhandenen WordPress-Verbindungsweg öffnen. Bestehender Anbieter und Inhalte bleiben erhalten. Weitere Anbieter benötigen eigene, geprüfte Anschlüsse; eine universelle automatische Synchronisierung wird nicht behauptet. Der aktuelle WordPress-Endpoint prüft den Lesezugriff; der dauerhafte Entwurfs-Synchronisierungsauftrag und eine echte externe Testseite stehen weiterhin aus.
- **Ich benötige eine Webseite:** „Webseite erzeugen / bearbeiten“ öffnet einen eigenen Arbeitsbereich mit derselben SMA-Anmeldung. Ein Knopfdruck erzeugt genau einen privaten Entwurf. Bearbeitbar sind Name, Überschrift, Vorstellung, Über-uns-Text, drei Leistungen, öffentliche Kontaktdaten und Seitenangaben. Die Übersicht im Dashboard behält drei Einträge.

Jede SMA-Seite erhält eine dauerhafte Adresse `app/website.html?site=<uuid>`. Die Vorschau unter `?preview=1` ist an die angemeldete Person gebunden. Speichern verändert ausschließlich den privaten Entwurf. Ein eigener Button veröffentlicht den gespeicherten Stand oder nimmt die Seite wieder offline; spätere Änderungen bleiben bis zur nächsten ausdrücklichen Veröffentlichung privat. In diesem Entwicklungsschritt wurde keine echte Kundenseite erzeugt oder veröffentlicht.

Der aktuelle öffentliche Shop wird serverseitig aus dem Kundenkonto zugeordnet. Produkte, Preise und Verfügbarkeit werden beim Seitenaufruf über die bestehende Katalogschnittstelle geladen, ohne HTML-Kopieren oder doppelte Produktpflege. Der Katalog bietet zusätzlich „Aktualisieren“. Das ist keine Echtzeit-Bestell-, Checkout- oder Fremdanbieter-Synchronisierung. Ist der Shop nicht öffentlich, erscheint keine Produktliste. Ein Shop-Wechsel verwendet ausschließlich die aktuelle eigene Zuordnung.

SMA-Seiten verwenden die vorhandene Infrastruktur und eine SMA-Adresse. Es wird kein Hostingvertrag abgeschlossen, keine eigene Domain gekauft und kein DNS-Eintrag geschrieben. Eigene Domains und individuelle zusätzliche Gestaltung bleiben weitere Schritte. Die neue Vorlage verwendet Inter mit den bestehenden System-Fallbacks; die genehmigte Dashboard-Schrift und geschützte n8n-Workflows bleiben unverändert.

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
- Migration installiert; native Prüfung weist einen sitzungslosen privaten Aufruf mit `AUTH_REQUIRED` ab. Die neue private Tabelle erzeugt lediglich den beabsichtigten Advisor-INFO-Hinweis `rls_enabled_no_policy`, da direkte Tabellenrechte fehlen.

Ein authentifizierter Ende-zu-Ende-Lauf mit einem realen Kunden wurde nicht durchgeführt; es wurden keine realen Kundendaten für die Vorschau übernommen. Freigabe, Erstellung und Darstellung müssen für eine echte Kundenwebseite anhand ihrer eigenen Angaben abgenommen werden.

```sh
node --test tests/*.test.cjs
node tests/run-customer-websites-sql.mjs
node tests/run-customer-website-dom.mjs
node tests/run-company-profile-dom.mjs
node tests/run-wordpress-dom.mjs
```
