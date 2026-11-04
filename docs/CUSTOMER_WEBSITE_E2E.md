# Angemeldeter Kundentest: Firmendaten und private SMA-Webseite

Stand: 4. November 2026. Der Ablauf wurde in der ausgelieferten SMA-Oberfläche mit einer regulären SMA-Anmeldung im bestehenden Delta-Demo-Testkonto geprüft. Die Schreibvorgänge erfolgten über die Kundenoberfläche, nicht über direkte Datenbankänderungen oder simulierte Browserantworten.

## Durchgeführter Ablauf

1. „Webseite & Domain“ → „Webseite einrichten“ → „Firmendaten bearbeiten“ geöffnet. Das Profil war noch nicht gespeichert; kein vorhandenes Firmenprofil wurde überschrieben.
2. Alle 16 Felder mit eindeutig fiktiven Angaben gespeichert. Firmenname: **SMA SHK-Testbetrieb (Testdaten)**; E-Mail `kontakt@example.com`; Anschrift, Telefonnummer und Registerangaben ausdrücklich als Muster/Test gekennzeichnet. Die Oberfläche bestätigte die Speicherung.
3. Über „Zur Webseite“ genau einen privaten Webseitenentwurf erzeugt. Firmenname, Geschäftsadresse und öffentliche Kontaktdaten wurden ohne zweite Eingabe übernommen; der vorhandene SMA-Testshop wurde automatisch zugeordnet.
4. Überschrift, Vorstellung, Über-uns-Text und drei Leistungsbereiche für Sanitär, Heizung und Klima bearbeitet und gespeichert. Die private Vorschau zeigte diese Texte und die drei vorhandenen Produkte mit Bildern beziehungsweise Bildplatzhalter, Preisen und Verfügbarkeit.
5. Das Firmenprofil erneut geöffnet: gespeicherte Angaben waren vorhanden. Den Ort von „Musterort“ auf „Musterort – Standort 2 (Test)“ und die Ansprechperson auf „SMA SHK-Testteam“ geändert und gespeichert.
6. Webseiteneditor erneut geöffnet und private Vorschau neu geladen. Beide übernahmen die geänderte Adresse ohne erneute Eingabe oder separates Speichern der Webseite. Die Vorschau übernahm außerdem die neue Ansprechperson; die vorher gespeicherten SHK-Texte blieben erhalten. Auch die Firmendatenkarte im wieder geöffneten Dashboard zeigte den neuen Stand.
7. Die Darstellung des gerenderten Testentwurfs zusätzlich als lokale Layoutaufnahme im 390-Pixel-Handyrahmen geprüft: 375 Pixel nutzbare Breite und 375 Pixel Inhaltsbreite, kein horizontaler Überlauf. Startbereich und Kontaktbereich waren lesbar. Dies ist eine Layoutprüfung der tatsächlich gerenderten Inhalte, kein separater mobiler Authentifizierungstest.
8. Eine lesende native Datenbankprüfung bestätigte Profilrevision 2, Webseitenrevision 2 und genau eine Webseite für das Testprofil. `published`, `published_company` und `published_at` waren weiterhin leer. Ein anonymer HTTP-Aufruf der öffentlichen Webseiten-RPC für diesen Entwurf lieferte `NOT_AVAILABLE`.

![Kontaktbereich mit automatisch übernommener Testadresse](evidence/customer-website-private-test-2026-11-04.jpg)

Die Testangaben und der private Entwurf bleiben im Demo-Testkonto zur weiteren Prüfung erhalten. Es wurde keine Webseite veröffentlicht, kein Kontaktformular oder E-Mail-Versand ausgelöst und kein externer WordPress-Auftrag gestartet. Anmelde- und Zahlungsdaten wurden nicht geändert. Der Screenshot zeigt ausschließlich fiktive Firmenangaben und bereits öffentliche Testprodukte.

## Kleine Korrektur aus dem Kundentest

Im Einrichtungsbereich stand noch, die automatische WordPress-Einbindung werde ergänzt. Der Hinweis beschreibt jetzt den bereits vorhandenen Ablauf: Nach bestätigter Verbindung kann der Kunde seinen SMA-Produktbereich automatisch als Entwurf erzeugen. Layout, Schrift und Funktionsumfang bleiben unverändert; der Dashboard-Import erhält eine neue Cache-Version. Die acht vorhandenen Webseiten-Vorbereitungstests und die WordPress-Dashboard-DOM-Prüfung bestanden nach dieser Textkorrektur; `git diff --check` ist sauber. Der zuvor bestandene Gesamtstand bleibt bei 359 Node-Tests.

## Grenzen und nächster Schritt

- Der Test bestätigt den privaten Erstellungs- und Bearbeitungsweg im angemeldeten Demo-Konto mit fiktiven Daten. Eine Veröffentlichung mit echten Firmendaten wurde nicht abgenommen.
- Ein bereits offener Editor wurde für die nachgewiesene Übernahme erneut geöffnet; eine automatische Tab-Fokus-Aktualisierung wird aus diesem Browserlauf nicht zusätzlich abgeleitet.
- Der WordPress-Produktentwurf ist implementiert. Der zusätzliche [kostenlose lokale WordPress-/MariaDB-Praxistest](WORDPRESS_PRACTICAL_TEST.md) besteht inzwischen; die externe Ende-zu-Ende-Abnahme über die echte SMA-Verbindung bleibt offen. Noch keine externe Testseite verbunden; kein neues Hosting buchen.
- Eigene Kundendomains benötigen weiterhin ihren jeweiligen Nachweis und eine gesonderte konkrete Anbindung. Keine DNS- oder Tarifänderung vorgenommen.
- PR #57 bleibt separat. Social-Media-Uploads/Postings benötigen ausdrückliche Freigabe; Sightengine bleibt `VIDEO_PLAN_REQUIRED`, Meta und Serverumbau bleiben zurückgestellt.

Fortsetzung im neuen Chat: `docs/CUSTOMER_WEBSITE_E2E.md`, `docs/COMPANY_PROFILE.md`, `docs/CUSTOMER_WEBSITES.md`, `docs/WORDPRESS_DRAFT_SYNC.md` und `docs/WORDPRESS_PRACTICAL_TEST.md` lesen. Die abgeschlossene Profil-/Entwurfsprüfung nicht erneut starten. Der lokale WordPress-/MariaDB-Test und der externe Abnahmeablauf sind vorbereitet; für die externe Abnahme fehlt weiterhin eine geeignete freigegebene Testadresse. Bis dahin keinen echten Anbieterauftrag auslösen.
