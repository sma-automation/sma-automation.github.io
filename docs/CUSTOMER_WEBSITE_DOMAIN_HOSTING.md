# Testdomain: geprüfter Hostingweg

> Fortschreibung 5. November: Der unten beschriebene Vorbereitungsstand ist historisch. [Domain-/HTTPS-/Inhaltstest abgeschlossen](CUSTOMER_WEBSITE_CUSTOM_DOMAIN_E2E.md); [bestätigte Adresse im Kundeneditor](CUSTOMER_WEBSITE_ADDRESSES.md).

Stand: **4. November 2026. Machbarkeit geprüft, noch nicht eingerichtet.** Der Nutzer hat die Prüfung einer Testadresse unter der vorhandenen SMA-Domain erlaubt. Eine Buchung, Kontoeröffnung, DNS-Änderung oder Veröffentlichung wurde dadurch nicht freigegeben und in diesem Schritt nicht ausgeführt.

## Ergebnis

`test.sma-automation.com` kann als Subdomain der vorhandenen Domain verwendet werden. Dafür ist keine weitere Domainregistrierung nötig. Empfohlener nächster Schritt ist die lokale Vorbereitung einer getrennten statischen Testauslieferung für **Cloudflare Pages Free**. Die DNS-Verwaltung kann bei IONOS bleiben; die bestehende Hauptdomain wird nicht umgestellt. Ein Cloudflare-Konto und ein nutzbarer Projektzugang sind bisher nicht bestätigt.

Dies ist ein begrenzter Domain-/HTTPS-Praxistest, keine Auswahl der endgültigen Infrastruktur für alle Kunden und kein Beginn des zurückgestellten Serverumbaus.

## Festgestellter Bestand

| Gegenstand | Prüfstand |
| --- | --- |
| Bestehende Hauptdomain | `sma-automation.com`; Repository-`CNAME` enthält genau diesen Namen. |
| DNS-Anbieter | IONOS; öffentliche Nameserver `ns1070.ui-dns.com`, `ns1116.ui-dns.biz`, `ns1017.ui-dns.org`, `ns1097.ui-dns.de`. Die frühere Domainbestellung bestätigt den Anbieter. |
| Hauptdomain-Ziel | A-Einträge `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (GitHub Pages). |
| Testadresse | A-, AAAA- und CNAME-Abfragen für `test.sma-automation.com`: `NXDOMAIN` (DNS-Status 3). Zur Prüfzeit öffentlich nicht eingerichtet. |
| IONOS-Webhosting | Aus den vorhandenen Unterlagen ist kein zusätzliches Webhostingpaket belegt. Ein Domainvertrag allein ist kein Nachweis für verwendbaren Webspace. |
| Kundenseite | Öffentlicher Test abgeschlossen, anschließend wieder offline. Unveränderter privater SHK-Entwurf, Revision 8; siehe [Live-Prüfbericht](CUSTOMER_WEBSITE_PUBLIC_E2E.md). |

Die DNS-Prüfung erfolgte ausschließlich lesend über DNS-over-HTTPS. Das Ergebnis ist eine Momentaufnahme und muss vor einer späteren Änderung erneut abgeglichen werden. Kontonummern und persönliche Zugangsdaten gehören nicht in diese Dokumentation.

## Warum ein getrenntes Testziel nötig ist

GitHub Pages unterstützt nicht gleichzeitig die vorhandene Hauptdomain und eine beliebige zusätzliche Subdomain auf derselben Pages-Site. Die branchbasierte `CNAME`-Datei darf nur einen Domainnamen enthalten. Eine Weiterleitung würde lediglich die Adresse wechseln und belegt kein eigenständiges Kundenhosting. Deshalb weder den bestehenden `CNAME` ersetzen noch `test` ungeprüft auf die aktuelle Pages-Site zeigen lassen.

Zusätzlich schließt GitHub Pages die Verwendung als kostenloses Hosting für Onlinegeschäft, E-Commerce oder überwiegend kommerzielles SaaS ausdrücklich aus. **Das kommerzielle SMA-Kundenhosting darf deshalb nicht auf einem Ausbau dieses Pages-Modells geplant werden.** Die bestehende Hauptseite wurde bei dieser Prüfung nicht verändert; die Konsequenz für den späteren Produktionsbetrieb gehört in die Hosting-/Serverübergabe.

## Vorgeschlagener Testweg und Kostenrahmen

Cloudflare Pages unterstützt eine einzelne Subdomain über einen CNAME beim bestehenden DNS-Anbieter; ein Nameserverwechsel ist dafür nicht erforderlich. Der Free-Tarif umfasst aktuell 500 Builds pro Monat, 100 eigene Domains pro Projekt und 20.000 Dateien. SSL gehört zum Angebot. Das genügt dem vorgeschlagenen kleinen statischen Testpaket. Diese Grenzen sind keine Zusage für einen unbegrenzten Mehrkundenbetrieb; dynamische Cloudflare-Funktionen oder andere kostenpflichtige Zusatzprodukte sind nicht eingeplant. Bestehende Domain- und Backendkosten bleiben davon getrennt.

Erst nach technischer Vorbereitung und ausdrücklicher Freigabe wäre die Reihenfolge:

1. Zugriff auf ein geeignetes kostenloses Cloudflare-Konto klären und ein getrenntes Pages-Testprojekt einrichten. Nur das geprüfte öffentliche Testpaket ausliefern, nicht das gesamte SMA-Repository.
2. `test.sma-automation.com` im Pages-Projekt als eigene Domain hinzufügen. Der konkrete Projektname und damit das CNAME-Ziel stehen noch nicht fest; keinen Beispielwert in DNS übernehmen.
3. Ausschließlich den vereinbarten IONOS-CNAME für `test` auf das tatsächliche `<projekt>.pages.dev`-Ziel setzen. Hauptdomain, E-Mail-Einträge und Nameserver unangetastet lassen. Der zusätzliche SMA-TXT-Nachweis ist ein eigener Schritt und erzeugt noch kein Hosting.
4. Aktives HTTPS und korrekte Seitenzuordnung prüfen. Eine private Seite muss auch auf der Testdomain gesperrt bleiben. Einen positiven öffentlichen Inhaltstest einschließlich eigener Bilder nur mit gesondert freigegebenem Testinhalt durchführen; danach wieder offline nehmen.
5. Bei Rückbau zuerst den Test-CNAME entfernen, danach die Domainbindung und gegebenenfalls das Testprojekt entfernen, damit kein verwaistes DNS-Ziel bleibt.

## Softwarearbeit aus dieser Machbarkeitsprüfung

**Fortschreibung:** Das [lokale Testpaket](CUSTOMER_WEBSITE_DOMAIN_PACKAGE.md) ist inzwischen implementiert und geprüft, aber noch nicht zusammengeführt oder bereitgestellt. Die folgenden Punkte beschreiben die ursprünglich festgestellten Lücken und die weitergehende Grenze zur Mehrkundenlösung.

- **Domain zur Seite zuordnen:** Der aktuelle öffentliche Renderer benötigt exakt `?site=<uuid>`; `/` kennt noch keine Hostzuordnung (`app/assets/customer-website-model.mjs`, `pageMode`). Ein begrenztes Testpaket braucht einen ausdrücklich zugeordneten Host und eine Seiten-ID. Unbekannte Hosts und private Vorschauparameter dürfen keine Kundenseite oder Anmeldung öffnen. Die spätere Mehrkundenlösung benötigt eine serverseitig gepflegte eindeutige Zuordnung mit Domainnachweis und Entzugsmöglichkeit.
- **Veröffentlichungsgrenze erhalten:** Weiterhin ausschließlich den vorhandenen öffentlichen Snapshot abrufen. Keine privaten Entwürfe oder Anmeldedaten in das statische Paket schreiben. Eine Hostzuordnung darf `NOT_AVAILABLE` und die Offline-Schaltung nicht umgehen.
- **Eigene Bilder berücksichtigen:** `supabase/functions/sma-website-image/handler.mjs` erlaubt derzeit nur den Origin `https://sma-automation.com`. Von der Testdomain werden Browserabrufe eigener Bilder deshalb abgewiesen. Für den öffentlichen Leseweg ist eine gezielte Erweiterung nötig; private Bildoperationen behalten ihren bisherigen Schutz. CORS ersetzt keine Prüfung, ob ein Bild tatsächlich zum veröffentlichten Seitenstand gehört.
- **Abnahme begrenzen:** Neue lokale Prüfungen für Root-Aufruf, falschen Host, verweigerte private Vorschau, Offline-Seite und öffentliche Bilder vorbereiten. Den Produktabruf samt Browser-CORS und HTTPS am neuen Origin prüfen. Gestaltung und Schrift übernehmen; abgeschlossene Firmenprofil-, Editor- und WordPress-Tests nicht erneut beginnen.

Das **lokale Testpaket samt den gezielten Anpassungen und Prüfungen** ist abgeschlossen. Das konkrete Ergebnis dient jetzt als Grundlage für eine spätere Freigabe von Hosting, DNS und Veröffentlichung. Die noch offene Konto-/Zugangsfrage hat die lokale Vorbereitung nicht blockiert.

## Quellen und Prüfgrenzen

Offizielle Quellen, am 4. November 2026 gelesen:

- [IONOS: Subdomain erstellen](https://www.ionos.de/hilfe/domains/website-mit-subdomains-strukturieren/subdomain-erstellen/) – keine zusätzliche Registrierung nötig.
- [GitHub: Fehlerbehebung bei eigenen Domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages) – einzelner CNAME-Domainname und nicht unterstützte Domainkombinationen.
- [GitHub Pages: Nutzungsgrenzen](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) – Grenzen kommerzieller Hostingnutzung.
- [Cloudflare Pages: Eigene Domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) – externe DNS-Verwaltung, CNAME und Reihenfolge der Domainbindung.
- [Cloudflare Pages: Tarifgrenzen](https://developers.cloudflare.com/pages/platform/limits/) und [Produktangebot](https://www.cloudflare.com/products/pages/) – Free-Plan und SSL.

Nur Dokumentation ergänzt; kein Programmcode, DNS, Backend, Tarif oder Hosting verändert. Daher keine erneute vollständige Testserie: zuletzt 383 Node-Tests sowie die dokumentierten DOM-/SQL-Prüfungen bestanden. Der externe WordPress-Test aus PR #69 bleibt mangels externer Testseite offen; PR #57 separat. Sightengine `VIDEO_PLAN_REQUIRED`, Meta und Serverumbau bleiben zurückgestellt.
