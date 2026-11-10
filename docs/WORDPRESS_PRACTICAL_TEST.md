# WordPress-Praxistest ohne zusätzliche Hostingkosten

Historischer Praxistest vom **4. November 2026**, übertragen auf den aktuellen SMA-Code am **10. November 2026**. Ursprüngliche Testbasis: `website-v1` nach PR #68 (`1a10658293db7c33614915d0adbdcb7ac8013442`). Der GitHub-Quellabgleich bestätigte: `wordpress/sma-bridge/{sma-bridge.php,protocol.php,store.php}`, der SMA-Signaturadapter und der Edge-Einstieg `sma-wordpress-sync` sind gegenüber dem dokumentierten nativen Test **bytegenau unverändert**. Die archivierten 29 WordPress-/MariaDB-Prüfungen und 359 damaligen Node-Tests sind historische Ergebnisse, **kein heute erneut ausgeführter nativer Test**. Kundenoberfläche, Schrift, produktives Plugin und ZIP wurden nicht verändert.

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

Der Lauf benutzt keinen HTTP-Webserver. Standardmäßig spricht MariaDB nur über einen Unix-Socket. Da die verwendete Arbeitsumgebung keine Unix-Sockets unterstützt, lief die Abnahme über einen zufälligen Port ausschließlich an `127.0.0.1` mit einem temporären Passwort. WordPress-HTTP-Anfragen, E-Mail, Cron und automatische Updates sind im isolierten Test deaktiviert. Schlüssel entstehen neu; der private Signierschlüssel bleibt im Node-Prozess. Temporäre Installation und Datenbank werden nach dem Lauf entfernt.

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
node tests/run-wordpress-real.mjs --wordpress="$sma_wp_source/wordpress"
```

Der SHA-256-Wert wurde beim Download von WordPress.org ermittelt; er ist ein Reproduktionsnachweis für diesen Lauf. Der Runner kann auch andere saubere WordPress-Versionen prüfen und meldet ihre tatsächliche Version. Niemals eine bestehende Kundenseite als Quellverzeichnis verwenden.

Falls Unix-Sockets nicht verfügbar sind:

```sh
SMA_TEST_DB_TRANSPORT=loopback node tests/run-wordpress-real.mjs --wordpress="$sma_wp_source/wordpress"
```

Abweichende lokale Programmorte sind über `SMA_TEST_PHP`, `SMA_TEST_MARIADBD`, `SMA_TEST_MARIADB`, `SMA_TEST_MARIADB_INSTALL` und optional `SMA_TEST_MARIADB_BASEDIR` einstellbar. Diese Variablen wählen nur lokale Testprogramme, keine externe Datenbank. Die geprüfte Arbeitsumgebung verwendete entpackte native Pakete in einem temporären Verzeichnis; eine Installation auf dem Rechner des Kunden ist damit nicht verbunden.

## Geeignete externe Testseite ohne Neubuchung

Für die nächste Abnahme wird eine **ausdrücklich freigegebene WordPress-Testadresse auf bereits vorhandenem Hosting** benötigt. Eine vorhandene, im Tarif enthaltene Staging-Seite ist geeignet, wenn der Anbieter die nötigen Rechte und Erreichbarkeit tatsächlich zulässt. Aktuell ist keine solche Adresse bestätigt. Es wird weder ein neues Hostingkonto angelegt noch ein Tarif geändert oder ein öffentlicher Tunnel eingerichtet.

Vor dem ersten Anbieterauftrag müssen folgende Punkte für genau diese Seite feststehen:

1. Eigene Testinstallation ohne echte Kundeninhalte; Zugriff zur einmaligen Plugin-Installation und Adminfreigabe. Die Produktseite bleibt ein Entwurf. Eine produktive Kundenwebsite ist kein Ersatz für diese Testinstallation.
2. Öffentliche HTTPS-Rootadresse, gültiges Zertifikat, mindestens eine öffentliche IPv4-Adresse und direkte Erreichbarkeit ohne Redirect. Subdirectory-Installationen unterstützt der aktuelle SMA-Transport nicht.
3. WordPress ab 6.8, PHP ab 8.1 mit OpenSSL und InnoDB für die benötigten Tabellen. Vorhandene Sicherheits-, Cache- und Inhaltsfilter dokumentieren.
4. Der signierte Endpoint `/wp-json/sma-bridge/v1/command` muss vom SMA-Server erreichbar sein; eine vorgeschaltete Basic-Auth-Sperre würde den derzeitigen Transport blockieren. Deshalb keinen bestehenden Zugriffsschutz ungefragt abschalten, sondern die passende Testumgebung festlegen.
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
