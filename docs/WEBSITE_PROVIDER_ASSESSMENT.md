# Anbieterprüfung für die automatische Webseiten-Anbindung

Stand: 4. November 2026. Zielbranch `website-v1`, geprüfter Stand nach PR #62: `2707b797073c2f0827783738f889d7f83ec5f540`.

## Auftrag und Ergebnis

Der Kunde soll keinen Einbaucode kopieren müssen. Gewünscht sind eine einmalige Verbindungsfreigabe und anschließend „Synchronisieren“ beziehungsweise „Webseite erzeugen“. Anbieterempfehlungen können später Provisionen oder Kundenrabatte ergänzen.

**Technische Empfehlung:** Hostinger als ersten Kandidaten für die Erstellung neuer Webseiten untersuchen; bestehende WordPress-Webseiten über einen eigenen WordPress-Anschluss unterstützen. IONOS bleibt ein Kandidat für Domain/DNS und für dort betriebenes WordPress. IONOS MyWebsite Now ist derzeit kein belegter Kandidat für den vollständig automatischen Einbau. Das ist eine technische Auswahl anhand öffentlicher Dokumentation, keine abgeschlossene Partnerschaft oder Vertragsentscheidung.

Diese Prüfung hat keine authentifizierte Provider-API aufgerufen. Es gibt keine nachgewiesene SMA-Verbindung zu Hostinger, IONOS oder einer externen WordPress-Webseite. Kostenpflichtige Angebote, Zugang, Kontingente und Schreibberechtigungen eines konkreten Kundenkontos sind nicht geprüft.

## Vergleich

| Aufgabe | IONOS | Hostinger |
| --- | --- | --- |
| Domain und DNS verwalten | Öffentliche APIs für Domains, DNS und SSL. DNS-Zugriff wird von IONOS Österreich als kostenfrei beschrieben. [I1–I3] | Domains und DNS sind Teil der öffentlichen API. [H1] |
| Neue Webseite automatisch einrichten | Kein entsprechender Endpunkt im geprüften Hosting-API-Katalog belegt. [I1] | Einrichtung auf einem vorhandenen Web-/Cloud-Hostingauftrag, optional mit WordPress, ist dokumentiert. Agency Hosting hat einen gesonderten Weg. [H2] |
| Bestehende WordPress-Seite ergänzen | WordPress-Anschluss möglich, wenn REST API und passende Berechtigungen verfügbar sind; Hostname allein reicht nicht als Nachweis. [W1–W3] | Derselbe WordPress-Anschluss ist der geplante Weg für bestehende Seiten. [W1–W3] |
| Beliebigen Baukasten automatisch verändern | MyWebsite Now dokumentiert manuellen HTML-Einbau, zudem tarifabhängig. Keine öffentliche Schreib-API dafür gefunden. [I4] | Das Auflisten einer Builder-Webseite beweist keine Unterstützung für das automatische Bearbeiten ihrer Inhalte. [H2] |
| Freigabe ohne Schlüsselkopieren | Dokumentierter Hosting-API-Einstieg verlangt API-Freischaltung und Schlüssel. [I2] | Öffentliche REST API nutzt Bearer-Token. Eigene Hostinger-Werkzeuge bieten OAuth; Eignung und Freigabe eines SMA-Webclients bleiben offen. [H1, H3] |

## Hostinger: belegter Anschlussweg und Grenzen

Aus der offiziellen SDK-Dokumentation [H2]:

- Einrichtung: `POST /api/hosting/v1/orders/{order_id}/onboardings`. Der ältere `POST /api/hosting/v1/websites` ist als veraltet markiert.
- `type: wordpress` installiert WordPress. Ohne Domain kann eine temporäre Subdomain entstehen. Ein vorhandener geeigneter Hostingauftrag bleibt erforderlich; eine kostenlose Subdomain bedeutet kein kostenloses Hosting.
- Einrichtung ist asynchron. `GET /api/hosting/v1/onboardings` liefert den Fortschritt; erst `completed` erlaubt Folgeschritte. Die Liste enthält nur Vorgänge der letzten 24 Stunden.
- Webseiten lassen sich einschließlich freigegebener Kundenkonten und ihres Typs auflisten. Den Zugriff deshalb immer auf den ausdrücklich zugeordneten Kundenauftrag und die gewählte Webseite begrenzen.
- Die Übertragung eines statischen Archivs überschreibt bestehende Seiteninhalte. Dieser Endpunkt ist **kein** Einbauweg für eine Produktliste auf einer bestehenden Kundenseite.

SMA muss die externe Vorgangskennung, Zielwebseite und Ergebnisse selbst dauerhaft speichern. Nach einer verlorenen Antwort zuerst abgleichen, bevor ein Erstellungsauftrag wiederholt wird. Bestehende Inhalte benötigen einen gezielten Anschluss, neue Seiten eine getrennte Erstellung und Vorschau. Eine WordPress-Installation ist noch keine fertig gestaltete Kundenwebseite.

Hostinger-REST-Token übernehmen die Rechte ihres Besitzers. Die dokumentierte OAuth-Anmeldung betrifft Hostingers eigene Werkzeuge. Ohne geprüfte Clientregistrierung, Rücksprungadresse, Rechteumfang, Widerruf und Mandantenzuordnung wird kein funktionierender SMA-Anmeldebutton behauptet. [H1, H3]

## WordPress: Verbindung ohne manuelles Kopieren von HTML

WordPress unterstützt authentifizierte REST-Aufrufe und das Erstellen beziehungsweise Ändern von Seiten. [W1, W2] Der dokumentierte Freigabeablauf lässt eine Anwendung auf der WordPress-Seite autorisieren; dafür muss die Funktion dort aktiviert sein. Ein passendes Anwendungspasswort ist widerrufbar. [W3]

Geplante SMA-Umsetzung:

1. Webseite und angebotenen Autorisierungsweg prüfen; nur freigegebene öffentliche HTTPS-Ziele zulassen.
2. Die Verbindung an den angemeldeten SMA-Kunden und einen kurzlebigen Einmalvorgang binden.
3. Freigabe im WordPress-Fenster durchführen. Die Rückgabe enthält Zugangsdaten: ausschließlich serverseitig entgegennehmen, verschlüsselt speichern und sofort auf eine saubere Dashboard-Adresse umleiten. Keine Zugangsdaten in Dashboard-Speicher, Analytik, Fehlerausgaben oder Anwendungslogs übernehmen.
4. Rechte und Darstellungsfähigkeit nachweisen. Das bestehende iframe kann durch WordPress-Berechtigungen oder Erweiterungen gefiltert werden; deshalb ist ein echter Darstellungstest erforderlich. Falls nötig einen gezielten SMA-Baustein entwickeln, keine globalen Filter abschalten.
5. Nur den zugeordneten SMA-Bereich anlegen/aktualisieren, dessen Kennung und Inhaltsstand speichern. Fremde Änderungen erkennen und erhalten. Erzeugung zunächst als Entwurf; Veröffentlichung gesondert freigeben.
6. „Synchronisieren“ prüft die Zuordnung und aktualisiert diesen Bereich. Öffentlich geladene Preise und Bestände kommen weiterhin aus dem SMA-Katalog. Eine Bestell- oder Checkout-Synchronisierung wird daraus nicht abgeleitet.

Dieser Ablauf ist noch nicht implementiert. Die WordPress-Freigabe ersetzt weder eine Domainregistrierung noch den Nachweis, dass alle Theme-, Plugin- und Rollenvarianten unterstützt sind.

## Partnerprogramme getrennt behandeln

IONOS und Hostinger veröffentlichen kostenlose Affiliate-Anmeldungen. Ein SMA-Link entsteht erst nach Registrierung/Freischaltung; kundenspezifische oder länderspezifische Konditionen müssen anschließend bestätigt werden. [P1, P2]

Hostingers normales Empfehlungsprogramm ist nicht für das Veröffentlichen seiner Links auf kommerziellen Webseiten bestimmt. Seine Kundenrabatte dürfen daher nicht ungeprüft in die SMA-Anbieterauswahl übernommen werden. [P3] Das Agentur-Partnerprogramm verlangt derzeit unter anderem mindestens zehn bei Hostinger betriebene Webseiten und eine geschäftliche E-Mail-Adresse. [P4] Keine Hostingkäufe zum Erreichen dieser Schwelle auslösen.

Die technische Anbindung darf keinen Affiliate-Kauf voraussetzen: Bestehende geeignete Kundenverträge bleiben nutzbar. Rabatt, Provision, regulärer Folgepreis und Kundenentscheidung sind getrennte Daten. Es gibt noch keine Anmeldung, keinen persönlichen Partnerlink und keine Rabattzusage für SMA.

## Nächster Implementierungsschritt

Zuerst eine kundengebundene Verbindung mit ausschließlich lesender Prüfung vorbereiten: Authentifizierung, Zielwebseite, tatsächliche Fähigkeiten, Widerruf und gespeicherter Zustand. Anschließend die gezielte WordPress-Einbindung und für neue Seiten die Hostinger-Erstellung ergänzen. Einen Tarif erst anhand einer konkreten erforderlichen Fähigkeit auswählen.

Der Abnahmelauf muss Zugangsentzug, falschen Kunden, unzulässige Zieladressen, verlorene Antworten, doppelte Klicks, externe Änderungen und erneutes Laden abdecken. Erst nach einem echten erfolgreichen Verbindungstest darf `website_connected` auf wahr wechseln. Erstellung/Veröffentlichung, Domain/DNS-Schreibzugriff und Bestellungen erhalten getrennte Aufträge und Freigaben.

## Prüfstand dieses Schritts

- Offizielle API-, SDK-, WordPress- und Partnerdokumentation gelesen; Versionswechsel und Tarifgrenzen berücksichtigt. Einzelne Hostinger-Referenzseiten waren nicht abrufbar; die Einrichtungsdetails wurden mit dem offiziellen PHP-SDK abgeglichen.
- `WEBSITE_DOMAIN.md`, `PRODUCT_EMBED.md` und bestehender Verbindungsstatus gelesen. Der vorhandene Katalog ist weiterhin ein öffentliches Embed, keine installierte Anbieteranbindung.
- Nur Dokumentation ergänzt. Keine Änderung an Oberfläche, Schrift, Datenbank, n8n, CNAME oder laufender Webseite. Keine erneute Testausführung für diese reine Dokumentationsänderung; die 315 Tests aus PR #62 werden nicht als neuer Testlauf ausgegeben.
- PR #57 bleibt offen und getrennt. Sightengine bleibt `VIDEO_PLAN_REQUIRED`. Kein Kauf, keine Tarifänderung, kein Hostingwechsel, kein DNS-Schreibzugriff, kein Social-Media-Upload und keine Kundenwebseite veröffentlicht.

## Offizielle Quellen

Alle nachfolgenden Quellen am 4. November 2026 gelesen. Konditionen und Schnittstellen vor Umsetzung erneut am dann aktuellen Stand prüfen.

- [I1 – IONOS Entwickler-APIs](https://www.ionos.de/hilfe/hosting/akkordeons-zu-weitere-skript-und-programmiersprachen/ionos-apis/ionos-entwickler-apis/)
- [I2 – IONOS API-Einstieg](https://developer.hosting.ionos.de/docs/getstarted)
- [I3 – IONOS Österreich: DNS](https://www.ionos.at/hosting/dns-hosting-kostenlos)
- [I4 – MyWebsite Now: HTML-Modul](https://www.ionos.de/hilfe/websites-shops/bearbeitung-von-mywebsite-now-inhalten/verwenden-von-html-und-javascript/)
- [H1 – Hostinger API-Übersicht](https://docs.hostinger.com/api-reference/overview)
- [H2 – Offizielles Hostinger PHP-SDK: HostingWebsitesApi](https://github.com/hostinger/api-php-sdk/blob/main/docs/Api/HostingWebsitesApi.md)
- [H3 – Hostinger Connector: Anmeldung](https://docs.hostinger.com/hostinger-connector/installation-and-setup)
- [W1 – WordPress REST-Authentifizierung](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [W2 – WordPress Seiten-API](https://developer.wordpress.org/rest-api/reference/pages/)
- [W3 – WordPress Anwendungsfreigabe](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
- [P1 – IONOS Affiliate](https://www.ionos.de/agentur-partner/affiliate)
- [P2 – Hostinger Affiliate](https://www.hostinger.com/de/affiliate-marketing)
- [P3 – Hostinger Empfehlungsprogramm und Einschränkungen](https://www.hostinger.com/support/6080777-how-to-use-the-referral-program-at-hostinger/)
- [P4 – Hostinger Agentur-Partnerprogramm](https://www.hostinger.com/support/hostinger-partner-program/)
