# WordPress-Praxistest ohne zusätzliche Hostingkosten

Historischer Praxistest vom **4. November 2026**, übertragen auf den aktuellen SMA-Code am **10. November 2026**. Ursprüngliche Testbasis: `website-v1` nach PR #68 (`1a10658293db7c33614915d0adbdcb7ac8013442`). Der GitHub-Quellabgleich bestätigte: `wordpress/sma-bridge/{sma-bridge.php,protocol.php,store.php}`, der SMA-Signaturadapter und der Edge-Einstieg `sma-wordpress-sync` sind gegenüber dem dokumentierten nativen Test **bytegenau unverändert**. Die archivierten 29 WordPress-/MariaDB-Prüfungen und 359 damaligen Node-Tests sind historische Ergebnisse, **kein heute erneut ausgeführter nativer Test**. Kundenoberfläche, Schrift, produktives Plugin und ZIP wurden nicht verändert.

## Externe Abnahme vom 13. November 2026

Der produktive SMA-Kundenbereich hat auf einer isolierten WPSandbox-Testseite für den Shop `sma-testkunde` genau eine WordPress-Seite „Produkte“ angelegt. Der WordPress-Admin bestätigte vorher die Freigabe. SMA bestätigte den signierten Leseaufruf. Vor dem Klick auf **Produktbereich erzeugen** lagen null Aufträge vor. Danach meldeten SMA und WordPress die Seite **103**, Revision **1**, Status **Entwurf**. Ein erneuter Klick auf **Stand laden** lieferte dieselbe Seite. In der WordPress-Seitenliste stand genau eine Zeile „Produkte“, in der SMA-Datenbank genau ein erfolgreicher Auftrag.

Die angemeldete WordPress-Vorschau und der öffentliche SMA-Testshop zeigten dieselben drei Artikel. Geprüft wurden Namen, Preise (9,90 €, 39,90 €, 34,90 €), Verfügbarkeit und Bilddarstellung (ein Platzhalter und zwei Produktbilder). Der anonyme Abruf der Entwurfsseite über die WordPress-REST-API ergab HTTP 401 mit `rest_forbidden`. Nach der Prüfung wurden beide Testfreigaben getrennt. Es blieben null Tickets, null aktive Verbindungen, null laufende Aufträge und ein gespeicherter Abschluss. Der Screenshot der Vorschau wurde vor dem Trennen gesichert.

### Wie SMA die REST-Adresse auswählt

Die WordPress-Routenübersicht der Testseite nannte ihre `wp-json/sma-bridge/v1/command`-Adresse als eigenen Endpunkt. Aus dem SMA-Projekt antwortete dieser auf einen leeren, unsignierten POST mit der erwarteten Plugin-Antwort `403 sma_not_authorized`. Derselbe Aufruf über die Query-Adresse lieferte die Zugangscode-Seite des Hosters als HTML. Der produktive signierte Lese- und Schreibaufruf gelang über die vom Plugin bestätigte REST-Adresse.

SMA fragt per OPTIONS die bekannte REST-Adresse unter derselben gespeicherten Installation ab. Es verwendet diese Adresse, wenn die Antwort den Plugin-Namensraum, die POST-Methode und exakt die erwartete Adresse bestätigt. Installationen ohne diese Route können die bisherige Query-Adresse verwenden. Ein abgesetzter POST wird nie auf einem zweiten Pfad wiederholt. DNS- und TLS-Prüfung, Signatur, Frist und maximale Antwortgröße gelten weiterhin. [WordPress REST API Discovery](https://developer.wordpress.org/rest-api/using-the-rest-api/discovery/)

## Früherer Prüfstand vom 13. November 2026

SMA hat eine Adresse bei WPSandbox als vorhandene Webseite gespeichert. Die
zugehörige Verbindungsanfrage ist abgelaufen. Die lesende Prüfung ergab null
verifizierte WordPress-Verbindungen und null Synchronisierungsaufträge.

Der native Lauf mit WordPress 7.1.4, PHP 8.3.6 und MariaDB 10.11.14 prüft nun
das Administratorformular des Plugins. Das Öffnen des Formulars lässt den
Anschluss gesperrt. Beim Absenden prüft WordPress die Nonce aus dem Formular.
Eine fehlende Nonce und eine abgelaufene Ticketantwort werden abgewiesen.
Eine gültige Bestätigung führt zurück in die WordPress-Einstellungen. Erst
danach gelingt der signierte Leseaufruf. Zu diesem Zeitpunkt existiert noch
keine Produktseite. Zwei gleichzeitige Erstellungsbefehle ergeben genau
einen Entwurf. Erneute Bestätigung erhält dessen Seiten-ID und Revision.
Die 29 bisherigen Prüfungen und der Paralleltest bestanden ebenfalls.

Die Testinstallation ersetzt den HTTPS-Abruf des Tickets durch eine lokale
Antwort und setzt den Testadministrator im WordPress-Prozess. Der externe
Anmelde-, Ticket- und HTTPS-Weg bleibt separat offen. Der neue GitHub-Prüflauf
verwendet dasselbe per SHA-256 geprüfte WordPress-Archiv und eine temporäre
MariaDB. Er läuft bei Änderungen am Plugin, am Signaturadapter oder an der
nativen Teststrecke.

## Durchgehender Test mit SMA-Ticket und verloren gegangener Antwort

Der zusätzliche Lauf verwendet die SMA-Handler für Verbindung, Ticket und
Synchronisierung, die SQL-Funktionen aus dem Repository und das unveränderte
Plugin in WordPress mit MariaDB. Ein fiktiver Kunde mit Testshop startet die
Freigabe. Das WordPress-Formular und sein Administratorhandler holen das Ticket
jeweils über eine lokale HTTP-Verbindung ab. SMA bestätigt die Verbindung durch
einen signierten Leseaufruf. Bis dahin existiert keine Produktseite.

Beim ersten Synchronisieren speichert WordPress die Seite „Produkte“ als Entwurf.
Die Teststrecke verwirft die erfolgreiche Antwort an SMA. Der Auftrag ist in SMA
zur Wiederholung vorgemerkt, während die Seite in WordPress bereits existiert.
Nach der regulären Wartefrist verwendet SMA dieselbe Auftragskennung und
Ausgangsrevision. SMA und WordPress melden dieselbe Seiten-ID und Revision 1.
Ein erneuter Statusabruf und ein weiterer Klick liefern den gespeicherten
Abschluss ohne weiteren Schreibaufruf. In MariaDB bleibt genau ein Produktentwurf.

Die Testidentität ersetzt die echte Benutzeranmeldung. Das PostgreSQL-System
läuft lokal mit PGlite und einem Vault-Testadapter. Der Ticketabruf verwendet
Loopback, die signierten Befehle laufen durch den nativen WordPress-REST-Dispatcher.
Öffentliches HTTPS, Supabase Auth und eine freigegebene externe Plugin-Installation
gehören zur noch offenen Live-Abnahme.

## Externer WordPress-Smoke-Test ohne Hostingbuchung – 10. November 2026

Eine isolierte, automatisch ablaufende Gratis-Sandbox bei WPSandbox wurde
ausschließlich für synthetische Prüfdaten angelegt. Die für die zweite
Testinstanz öffentliche, zeitlich begrenzte HTTPS-Adresse lautete
`https://eu2.wpsandbox.org/site/s-qa73zdpavg6dm/`. Der Anbieter
stellte WordPress **6.8.1** und PHP **8.4** bereit. Eine Anmeldung, neue
Zahlungsdaten und eine Hostingbuchung waren nicht erforderlich.

Das unveränderte SMA-Plugin-ZIP von
`https://sma-automation.com/app/downloads/sma-wordpress-bridge.zip`
wurde bereits während des Erstellens der zweiten Sandbox installiert.
Die WordPress-Pluginliste zeigte den **SMA Webseiten-Anschluss
(Testkandidat)** und den Status **Active**. Eine Browsermeldung meldete
widersprüchlich eine PHP-Anforderung; der tatsächliche SMA-Pluginheader
in `wordpress/sma-bridge/sma-bridge.php` verlangt **PHP >= 8.1**
und **WordPress >= 6.8**, also nicht mehr als die verwendeten Versionen.
Die Browserwarnung wurde daher *nicht* als nachgewiesener
Inkompatibilitätsfehler gewertet.

**Unabhängig bestätigter externer HTTP-Nachweis:** Ein nicht
authentifizierter Abruf von `/wp-json/` der zweiten Sandbox lieferte
`sma-bridge/v1` unter `namespaces` und den Pfad
`/sma-bridge/v1/command` mit ausschließlich `POST` in den
registrierten Methoden. Ein `GET` auf diesen nur für POST registrierten
Pfad ergab `404 rest_no_route`. Diese Beobachtungen belegen die
aktivierte WordPress-REST-Registrierung, nicht die vollständige
Befehlsautorisierung.

**Nicht abgeschlossen:** Das Browserwerkzeug konnte keinen kontrollierten
unsignierten `POST` senden; der erwartete `403 sma_not_authorized`
ist deshalb **nicht extern nachgewiesen**. Ebenso sind weder das
SMA-seitige Benutzerlogin, die einmalige WordPress-Administratorfreigabe,
Ticket-/Schlüsselübertragung, ein signiertes `inspect`, ein
`sync_draft`-Auftrag noch die tatsächliche externe Produktentwurfsseite
getestet. Der aktuelle SMA-Kundenbestand enthält **keine** verifizierte
WordPress-Verbindung und **keinen** WordPress-Sync-Auftrag. Alle
bestehenden Kunden- und WordPress-Seiten blieben unverändert.

Diese Gratis-Testseite lebt nur wenige Stunden und ist **kein**
dauerhaftes Kundenhosting. Sie wurde nicht als Ziel in SMA gespeichert.
Die echte Ende-zu-Ende-Abnahme benötigt eine vom Testkunden vorbereitete
Zieladresse und eine ausdrückliche WordPress-Administratorfreigabe.
Subdirectory-URLs und Zugangscodes einer Testanbieter-Website sind vor
einem echten `sma-wordpress-connect`-Aufruf gesondert mit der
produktiv installierten Zielprüfung abzugleichen. Keinen öffentlichen
Schreibzugriff, Secret oder Testfreigabe automatisch erzeugen.

---

## Ergebnis und verbleibende Grenze

Ein kostenloser lokaler Integrationstest läuft jetzt mit **echtem WordPress 7.1.4, PHP 8.3.6 und MariaDB 10.11.14/InnoDB**. Er verwendet den unveränderten SMA-Baustein, echte WordPress-REST-Registrierung, WordPress-Seiten und zwei unabhängige PHP-/Datenbankverbindungen. **29 Prüfungen und der konkurrierende Aufruf bestanden.** Die vorhandenen **359 Node-Tests** bestehen ebenfalls.

Das [Protokoll des erfolgreichen lokalen Laufs](evidence/wordpress-local-2026-11-04.txt) enthält die tatsächlichen Laufzeitversionen und Einzelergebnisse.

Dies ist noch keine externe Ende-zu-Ende-Abnahme. Die lokale Freigabe verwendet ausschließlich einen synthetischen öffentlichen Prüfschlüssel. Die echte SMA-Anmeldung, Ticketabholung, WordPress-Adminfreigabe, Supabase-Auftrag und öffentliche TLS-Verbindung sind nicht Teil dieses lokalen Laufs. Es wurde kein echter SMA-Verbindungs- oder Synchronisierungsauftrag gestartet. Das gespeicherte SHK-Testprofil und sein privater SMA-Webseitenentwurf bleiben erhalten.

| Prüfabschnitt | Nachweis |
| --- | --- |
| Plugin installieren und aktivieren | Echte WordPress-Aktivierung und InnoDB-Tabelle erfolgreich |
| Zwei gleichzeitige Erstellungsbefehle | Zweite sperrende Datenbankabfrage während der ersten offenen Transaktion beobachtet; beide Antworten enthalten dieselbe Seiten-ID und Revision 1 |
| Verlorene Antwort erneut abrufen | Frische Signatur mit derselben Befehls-UUID liefert denselben Entwurf |
| Weitere Synchronisierung | Dieselbe Seiten-ID, nächste Revision, weiterhin `draft` |
| Unerlaubte/abweichende Anfragen | Fehlende oder manipulierte Signatur, HTTP-Kontext, andere Absicht und alte Revision werden abgewiesen |
| Reale Inhaltsfilter und Datenbank-Hooks | Manipulierter Inhalt stoppt den Auftrag; Seite, Bridge-Revision sowie getestete Postmeta-/Options-Schreibvorgänge werden zurückgerollt |
| Manuelle Änderungen, Löschung, Rechteentzug | Kein Überschreiben und keine Ersatzseite; vorhandene fremde Testseite unverändert |
| WordPress-Ausgabe | Echte `the_content`-/Shortcode-Verarbeitung erzeugt das zugeordnete Katalog-iframe; auf anderen Seiten bleibt der Shortcode leer |
| Privater Entwurf | Anonyme WordPress-REST-Abfrage abgewiesen; keine veröffentlichten Testinhalte |
| Ungeeignete Tabellen und Widerruf | MyISAM wird abgewiesen; Deaktivierung entfernt den Prüfschlüssel; Reaktivierung verlangt neue Freigabe |

Der ursprüngliche Lauf vom 4. November benutzt keinen HTTP-Webserver. Standardmäßig spricht MariaDB nur über einen Unix-Socket. Da die verwendete Arbeitsumgebung keine Unix-Sockets unterstützt, lief die Abnahme über einen zufälligen Port ausschließlich an `127.0.0.1` mit einem temporären Passwort. WordPress-HTTP-Anfragen, E-Mail, Cron und automatische Updates sind im isolierten Test deaktiviert. Schlüssel entstehen neu; der private Signierschlüssel bleibt im Node-Prozess. Temporäre Installation und Datenbank werden nach dem Lauf entfernt.

Die WordPress-REST-Aufrufe erfolgen innerhalb echter PHP-Prozesse mit gesetztem HTTPS-Kontext; daraus wird **kein TLS-Nachweis** abgeleitet. Der Katalog-Frame wird als HTML geprüft, nicht in einem Browser geladen. Externe Plugin-Nebenwirkungen wie E-Mail/Webhooks, persistente Objektcaches, zusätzliche Themes und andere Datenbankversionen sind nicht pauschal abgenommen.

## Wiederholbarer lokaler Lauf

Dateien: `tests/run-wordpress-real.mjs` und `tests/wordpress-real/worker.php`.

Voraussetzungen auf einer Linux-Entwicklungsumgebung: Node, natives PHP mit `mysqli`/OpenSSL und den normalen WordPress-PHP-Modulen sowie `mariadbd`, `mariadb` und `mariadb-install-db`. Der Runner installiert keine Pakete, startet keinen Systemdienst und akzeptiert weder eine fremde Datenbankadresse noch eine bestehende WordPress-Konfiguration. Er erzeugt immer eine eigene temporäre Installation. Die normale Node-Testsuite startet diesen Integrationstest nicht automatisch.

Sauberes offizielles WordPress-Archiv herunterladen und den hier tatsächlich geprüften Download reproduzieren:

```sh
sma_wp_source="$(mktemp -d)"
curl -fsSL https://wordpress.org/wordpress-7.1.4.tar.gz -o "$sma_wp_source/wordpress.tar.gz"
printf '%s  %s\n' '881e53a4681ff2cd911651b11cccdede5ae477ddf0765af5d6a1a8b219a1d835' "$sma_wp_source/wordpress.tar.gz" | sha256sum -c -
tar -xzf "$sma_wp_source/wordpress.tar.gz" -C "$sma_wp_source"
npm ci --prefix tests/sql-runtime --ignore-scripts
node tests/run-wordpress-real.mjs --wordpress="$sma_wp_source/wordpress"
```

Der SHA-256-Wert wurde beim Download von WordPress.org ermittelt; er ist ein Reproduktionsnachweis für diesen Lauf. Der Runner kann auch andere saubere WordPress-Versionen prüfen und meldet ihre tatsächliche Version. Niemals eine bestehende Kundenseite als Quellverzeichnis verwenden.

Falls Unix-Sockets nicht verfügbar sind:

```sh
SMA_TEST_DB_TRANSPORT=loopback node tests/run-wordpress-real.mjs --wordpress="$sma_wp_source/wordpress"
```

Abweichende lokale Programmorte sind über `SMA_TEST_PHP`, `SMA_TEST_MARIADBD`, `SMA_TEST_MARIADB`, `SMA_TEST_MARIADB_INSTALL` und optional `SMA_TEST_MARIADB_BASEDIR` einstellbar. Diese Variablen wählen nur lokale Testprogramme, keine externe Datenbank. Die geprüfte Arbeitsumgebung verwendete entpackte native Pakete in einem temporären Verzeichnis; eine Installation auf dem Rechner des Kunden ist damit nicht verbunden.

## Erreichbarkeit der gespeicherten Sandbox am 13. November 2026

Die WordPress-REST-Übersicht der oben genannten Sandbox antwortete am
13. November über ihre Unterverzeichnis-Adresse direkt mit HTTP 200. Sie
meldete dieselbe Installationsadresse und die Route `/sma-bridge/v1/command`
für POST. Beim Öffnen von `wp-admin/` verlangte der Anbieter einen eigenen
Zugangscode. Der lesende Abruf bestätigt die Installation und die registrierte
Route. Eine aktuelle Administratorfreigabe oder einen signierten
Synchronisierungsauftrag weist er nicht nach.

## Erster externer Rückruf am 13. November 2026, vor der erfolgreichen Abnahme

Auf einer frisch angelegten, kostenlosen WPSandbox-Testinstallation wurde das ausgelieferte SMA-Plugin aktiviert. Der Administrator bestätigte über den regulären SMA-Kundenbereich die Freigabe für den Shop `sma-testkunde`. WordPress zeigte die Zuordnung an. Der Ticketdienst beantwortete die Anfragen erfolgreich.

Der öffentliche WordPress-REST-Index enthielt die SMA-Route, und OPTIONS meldete POST als zulässige Methode. Der signierte POST aus der produktiven SMA-Verbindungsfunktion erhielt auf dem vorgesehenen HTTPS-Pfad HTTP 200 mit HTML. Für die Verifizierung ist eine gültige JSON-Antwort mit den Daten der konkreten Verbindung erforderlich. SMA hat keine verifizierte Verbindung und keinen Synchronisierungsauftrag für diesen Versuch gespeichert. Zu diesem Zeitpunkt war der externe Produktentwurf offen. Der spätere Vergleich der Routen und die erfolgreiche Abnahme sind oben dokumentiert.

Beim Verbindungscheck meldet SMA diese Antwort als `WORDPRESS_HTML_RESPONSE`. Die technischen Protokolle enthalten nur den Verarbeitungsschritt, eine feste Fehlerkategorie und gegebenenfalls den HTTP-Status. Die Oberfläche erklärt, welche Serverantwort die Freigabe benötigt.

## Geeignete externe Testseite ohne Neubuchung

Für die nächste Abnahme wird eine **ausdrücklich freigegebene WordPress-Testadresse auf bereits vorhandenem Hosting** benötigt. Eine vorhandene, im Tarif enthaltene Staging-Seite ist geeignet, wenn der Anbieter die nötigen Rechte und Erreichbarkeit tatsächlich zulässt. Die oben dokumentierte kostenlose Testinstallation erfüllte die Voraussetzungen während ihrer Laufzeit. Es wird weder ein neues Hostingkonto angelegt noch ein Tarif geändert oder ein öffentlicher Tunnel eingerichtet.

Vor dem ersten Anbieterauftrag müssen folgende Punkte für genau diese Seite feststehen:

1. Eigene Testinstallation ohne echte Kundeninhalte; Zugriff zur einmaligen Plugin-Installation und Adminfreigabe. Die Produktseite bleibt ein Entwurf. Eine produktive Kundenwebsite ist kein Ersatz für diese Testinstallation.
2. Öffentliche HTTPS-Startadresse der Installation mit abschließendem Schrägstrich, gültigem Zertifikat und öffentlicher IPv4-Adresse. Auch ein Unterverzeichnis wie `/blog/` ist möglich. Der Transport behält diesen Pfad bei und folgt keiner Weiterleitung.
3. WordPress ab 6.8, PHP ab 8.1 mit OpenSSL und InnoDB für die benötigten Tabellen. Vorhandene Sicherheits-, Cache- und Inhaltsfilter dokumentieren.
4. Die WordPress-REST-Route `/sma-bridge/v1/command` muss vom SMA-Server erreichbar sein. SMA prüft die registrierte REST-Adresse und unterstützt die Query-Adresse für einfache Permalinks. Eine vorgeschaltete Basic-Auth-Sperre würde den Transport blockieren. Deshalb keinen bestehenden Zugriffsschutz ungefragt abschalten, sondern die passende Testumgebung festlegen.
5. Das bestehende SMA-Delta-Demo-Konto und ein öffentlicher **Testshop** sind eindeutig zugeordnet. Keine echten Firmenprofiltexte oder echten Kundendaten für diese Abnahme einsetzen.

### Vorbereiteter externer Ablauf

1. Plugin-ZIP aus `app/downloads/sma-wordpress-bridge.zip` auf genau dieser Testseite installieren. Adresse, WordPress-/PHP-/Datenbankversion und aktive Plugins erfassen; Ausgangsbestand der Seiten festhalten.
2. Im SMA-Dashboard **WordPress verbinden** starten, den einmaligen Vorgang in WordPress als Administrator freigeben und in SMA prüfen. Vor **Produktbereich erzeugen** darf noch keine Produktseite existieren.
3. **Produktbereich erzeugen** einmal auslösen. Erwartet: gespeicherter SMA-Erfolg, genau eine neue WordPress-Seite „Produkte“, Status **Entwurf**, passender Shop und sicherer Bearbeitungslink.
4. Im angemeldeten WordPress die Vorschau öffnen. Produkte, Bilder, Preise, Verfügbarkeit und Darstellung auf Desktop/Handy mit dem Testshop vergleichen. Kein Kauf und kein Klick auf **Veröffentlichen**.
5. Auf der isolierten Testseite eine verlorene Browserantwort gezielt über lokale Netzwerkkontrolle nachstellen. **Einrichtung fortsetzen** beziehungsweise **Stand laden** muss denselben Auftrag und dieselbe Seiten-ID liefern. Keine zusätzlichen Produktionsaufträge erzeugen.
6. Manuelle Änderung/Entzug im Testkonto prüfen, wo der konkrete Auftrag eine weitere Aktion zulässt. Ein bereits gespeicherter Erfolg ist ein Abschlussnachweis und keine laufende Fremdänderungskontrolle. Die technischen Konfliktfälle sind zusätzlich lokal geprüft.
7. Ergebnis mit Verbindungs-/Auftragskennung, Seiten-ID, Status, Zeit und Darstellung dokumentieren; keine Tickets, Passwörter oder Schlüssel aufnehmen. Testverbindung anschließend trennen, sofern sie nicht ausdrücklich für weitere Prüfungen erhalten bleiben soll.

**Umfang bleibt Produktbereich:** WordPress erhält weiterhin keine zentralen Firmenprofil-, Impressums- oder übrigen SHK-Webseitentexte. Diese Übertragung ist ein eigener späterer Entwicklungsschritt. Die zentrale Profilübernahme in Dashboard und SMA-Webseitenentwurf ist bereits abgenommen und wird nicht neu gestartet.

## Warum nicht einfach ein Gratis-Baukasten?

- [WordPress Playground](https://developer.wordpress.org/playground/handbook/troubleshooting/) verwendet SQLite. Der aktuelle SMA-Adapter verlangt echte InnoDB-Transaktionen und lehnt ungeeignete Tabellen bewusst ab; eine SQLite-Sonderfreigabe wäre kein MySQL-Nachweis.
- [WordPress.com Free](https://wordpress.com/support/plugins/install-a-plugin/) erlaubt keine eigene Plugin-Installation; dafür nennt WordPress.com einen bezahlten Tarif. Daher keine Tarifbuchung für diesen Test.
- [WordPress.org](https://wordpress.org/download/) stellt WordPress zur eigenen lokalen Installation bereit. Der hier ausgeführte Test benötigt dafür keinen Hostingvertrag. Die ebenfalls dokumentierte lokale [wp-env-Umgebung](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/) ist eine Alternative bei bereits vorhandenem Docker, wurde in diesem Lauf aber nicht verwendet.

Die Anbieterinformationen wurden am 4. November 2026 anhand dieser offiziellen Quellen geprüft. Eine kostenlose lokale Prüfung ersetzt keine später freigegebene externe Testadresse.
