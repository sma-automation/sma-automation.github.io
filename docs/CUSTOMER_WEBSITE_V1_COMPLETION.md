# SMA-Kundenwebseite V1 – Webseitenweg mit automatischer SMA-Adresse

Stand: 5. November 2026.

Die automatische Einrichtung einer **SMA-Unteradresse** ist inzwischen mit echtem
Hosting-, DNS- und HTTPS-Durchlauf belegt. Neue Kunden können mit einem Klick zuerst
ihren privaten Entwurf und anschließend die Adresse einrichten. Der vorhandene
Entwurf bleibt privat. Aktueller Umfang und Nachweise:
[Automatische Einrichtung](CUSTOMER_WEBSITE_AUTOMATION.md).

## Abgeschlossener Funktionsumfang

Der eigene SMA-Webseitenweg ist zusammenhängend implementiert: gemeinsame Firmendaten, privater Entwurf, bearbeitbare Texte/Leistungen, Gestaltung, eigene Logos/Startbilder, automatische Zuordnung des öffentlichen SMA-Produktkatalogs, private Vorschau, ausdrückliche Veröffentlichung/Offlineschaltung sowie eine bestätigte eigene Adresse. Die vorhandenen Nachweise für diese Schritte stehen in `CUSTOMER_WEBSITE_E2E.md`, `CUSTOMER_WEBSITE_IMAGES.md`, `CUSTOMER_WEBSITE_PUBLIC_E2E.md`, `CUSTOMER_WEBSITE_CUSTOM_DOMAIN_E2E.md` und `CUSTOMER_WEBSITE_ADDRESSES.md`.

Die bisher fehlende Dashboard-Rückkehr ist ergänzt. Eine bereits vorhandene SMA-Seite erscheint direkt unter „Webseite & Domain“ als „Webseite verwalten“, auch wenn nie eine separate Einrichtungsvorbereitung gespeichert wurde. Die bestehende Drei-Karten-Übersicht, die genehmigte Schrift und die beiden Einrichtungswege bleiben erhalten.

- Private Seite: Status, zugeordnete Adresse, „Webseite bearbeiten“, „Private Vorschau“.
- Öffentliche Seite: zusätzlich „Öffentliche Webseite öffnen“ auf die bestätigte eigene Adresse oder die bestehende SMA-Adresse; unveröffentlichte Änderungen werden kenntlich gemacht.
- Neue Kunden ohne Seite: unveränderte Einrichtungswahl.
- Inaktiver Zugang: kein öffentlicher Link; gespeicherten eigenen Stand weiterhin im Editor prüfen.

Die neue Übersicht liest ausschließlich `sma_customer_website_v1('get', {})`. Sie erzeugt, speichert und veröffentlicht nichts. Sie lädt erst beim Öffnen des Moduls und aktualisiert bei Rückkehr/Fokus. Gleichzeitige Ereignisse werden zusammengefasst, laufende Anfragen serialisiert. Ungespeicherte Einrichtungsangaben bleiben erhalten. Eine neue vollständige n8n-Dashboard-Ausführung wird dadurch nicht ausgelöst.

Besitzer werden vor und nach jeder Anfrage gegen den Besitzer des geladenen Dashboards geprüft. Authentifizierungswechsel leeren Adresse und Links sofort; verspätete Antworten dürfen sie nicht zurückbringen. Verborgene Ansichten, Fehler, zerstörte Ansichten und fehlgeschlagene Besitzerprüfungen behalten keine alten Links. Nur validierte Antworten des bestehenden Modells werden dargestellt.

## Frühere Abschlussprüfung der Webseitenübersicht

- 399 vorhandene Node-Tests bestanden.
- 11 neue DOM-Szenarien: vorhandener privater Stand ohne Vorbereitung, öffentliche Adresse/kanonischer Rückfall, neues Konto, inaktiver Zugang, verzögertes Laden, Erhalt ungespeicherter Angaben, zusammengefasste und serialisierte Anfragen, Kontowechsel, fehlende Auth-Ereignisse, verborgene Ansichten, Netzfehler/Wiederholung, ungültige Adresse, Abbau und verspätete Antworten.
- Die lokale visuelle Browserprüfung war hier nicht möglich: Der Browser erreicht den lokalen HTTP-Server nicht und erlaubt keine `file:`-Navigation. Daher kein neuer visueller oder angemeldeter Browsernachweis aus diesem Abschlussblock; die oben genannten Bedienprüfungen sind DOM-Tests.
- Bestehende Domainnachweis-, Firmenprofil- und WordPress-Dashboard-DOM-Prüfungen bestanden. Keine Datenbankmigration oder Änderung an RPCs, Kundendaten, Domain, Hosting, Tarif oder Veröffentlichung in diesem Abschlussblock.

Reproduzierbare Befehle:

```sh
node --test tests/*.test.cjs
node tests/run-customer-website-dashboard-dom.mjs
node tests/run-new-website-domain-dom.mjs
node tests/run-company-profile-dom.mjs
node tests/run-wordpress-dom.mjs
git diff --check
```

## Bewusste Grenzen und separate Restarbeit

Der bestätigte eigene Webseitenweg ist kein Nachweis für alle externen Anbieter. PR #69 enthält den lokalen WordPress-/MariaDB-Test; ein positiver Test auf einer freigegebenen externen WordPress-Seite fehlt weiterhin. Bestehende Anbieter werden dadurch weder automatisch ersetzt noch vollständig synchronisiert.

SMA-Unteradressen werden automatisch eingerichtet und bestätigt. Die Laufzeit
prüft die aktuelle Besitzer- und Zugangszuordnung; physische Hostingressourcen
werden bei Zugangssperre nicht automatisch gelöscht. Fremde Wunschdomains und
deren Anbieterzugänge bleiben getrennt: Ein gespeicherter Wunsch oder TXT-Nachweis
allein ist keine aktive Hostzuordnung. Kostenpflichtige Domainregistrierung bleibt
eine separate, ausdrücklich freizugebende Aktion.

Checkout-/Bestellabwicklung des Shops, PR #57/Social-Publishing, Sightengine, Meta und die externe Servermigration bleiben getrennte Arbeitsblöcke. „Webseitenweg abgeschlossen“ bedeutet keine Freigabe dieser anderen Bereiche. Keine echte Kundenseite wurde im Abschlussblock veröffentlicht; der vorhandene Teststand bleibt privat.

## Rückbau

Die neue Dashboard-Einbindung, `customer-website-dashboard.mjs` und die zwei ergänzten, auf das Modul begrenzten CSS-Regeln zurücknehmen. Es gibt keine Datenmigration und keinen Datenrückbau. Bestehende Einrichtungs-, Firmenprofil-, Vorschau- und Veröffentlichungswege bleiben unabhängig davon erhalten.
