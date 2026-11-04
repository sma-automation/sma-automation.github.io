# WordPress: begrenzter SMA-Anschluss mit einmaliger Freigabe

Stand: 4. November 2026. SMA-Ticketausgabe, Vault-Lebenszyklus und lesende Zielprüfung sind auf dem Server bereitgestellt. PR #63 ergänzt den kompakten Dashboard-Einstieg und das Plugin-Paket. **Noch keine externe WordPress-Webseite verbunden:** Beim Testkunden ist keine Zieladresse gespeichert. Ein dauerhafter Auftrag zur automatischen Entwurfserstellung ist noch nicht angeschlossen.

## Bedienung und Umfang

Eine WordPress-Erweiterung ersetzt das manuelle Kopieren von HTML. Ihre einmalige Installation benötigt Zugriff auf die betreffende WordPress-Verwaltung; sie kann bei vorhandener Freigabe von SMA übernommen werden. Sie kauft kein Hosting, ändert keine Domain und benötigt keine WordPress-Anwendungspasswörter.

Der vorgesehene Verbindungsablauf startet in SMA. Ein kurzlebiger Vorgang öffnet die WordPress-Einstellungen. Dort sieht der Administrator das SMA-Konto und den Shop und bestätigt „Verbindung freigeben“. Die Bestätigung verlangt WordPress-Rechte und einen gültigen WordPress-Nonce. Eine bestehende Verbindung zu einem anderen Vorgang muss zuerst getrennt werden. Wiederholtes Bestätigen desselben Vorgangs erhält den bisherigen Entwurf.

Der WordPress-Baustein unterstützt anschließend ausschließlich den eigenen Produktbereich als **Entwurf**. Der aktuell bereitgestellte SMA-Endpoint sendet jedoch nur `inspect`; er erteilt weder Synchronisierungs- noch Veröffentlichungsrechte. Der Baustein enthält keine Veröffentlichungsoperation. Er überträgt keine Preise oder Bestände in WordPress: Ein gezielt gerenderter SMA-Katalog lädt sie beim Anzeigen beziehungsweise Aktualisieren weiterhin aus dem öffentlichen SMA-Shop.

## Schlüssel statt WordPress-Passwort

Pro Verbindung entsteht auf dem SMA-Server ein RSA-Schlüsselpaar (3072 Bit). Der private Schlüssel wird in Vault gespeichert; WordPress erhält nur den öffentlichen Prüfschlüssel. Der Vault-Adapter akzeptiert dafür `bridge_private_key` ausschließlich im WordPress-Zweig. Seine SQL-Prüfung kontrolliert die Struktur; der Server lädt den Schlüssel kryptografisch zum Signieren und prüft anschließend die Anbieterantwort.

WordPress bezieht Freigabedaten ausschließlich per HTTPS von der festen SMA-Adresse `.../functions/v1/sma-wordpress-ticket`. Dabei werden keine WordPress-Zugangsdaten übertragen. Weiterleitungen sind gesperrt, Antwortgröße und Wartezeit begrenzt. Der Endpoint ist bereitgestellt; er gibt nach Ticketprüfung ausschließlich öffentliche Freigabedaten zurück. Ohne gültige Antwort, exakt passende Webadresse, nicht abgelaufenen Vorgang und öffentlichen RSA-Schlüssel wird keine Freigabe gespeichert. Eine Ticketabfrage allein bestätigt keine Verbindung.

`sma-wordpress-connect` prüft die SMA-Sitzung, den aktuellen Besitzer, Paket, Shop, gespeicherte Zieladresse und Vorgang. Ein Wiederaufnahmeversuch verwendet denselben Vault-Schlüssel. Ticketwerte werden nur gehasht gespeichert; ein abgelaufener oder ersetzter Vorgang verliert seinen temporären Schlüssel. Zusätzlich läuft alle fünf Minuten eine begrenzte Bereinigung. Erst ein passender signierter `inspect`-Nachweis führt zum atomaren Abschluss und zur dauerhaften Vault-Zuordnung.

Der Netzwerkadapter löst die gespeicherte HTTPS-Adresse über DNS-over-HTTPS auf. Er prüft Frage, CNAME-Kette und sämtliche IPv4-Ergebnisse, verbindet direkt zur geprüften öffentlichen IP und validiert TLS gegen den ursprünglichen Hostnamen. Redirects, interne/reservierte Adressen, mehrdeutige HTTP-Antworten und übergroße Antworten werden abgewiesen. Zeit- und Größenlimits gelten auch beim Lesen. IPv6-only-Ziele werden derzeit nicht unterstützt. Ein gewöhnliches `fetch()` auf die Kundenadresse wird nicht verwendet.

Der Server signiert `SMA-BRIDGE-V1`, Methode, festen REST-Pfad und den exakten JSON-Body mit RSASSA-PKCS1-v1_5/SHA-256. WordPress akzeptiert nur `POST /sma-bridge/v1/command`, ein maximales Zeitfenster von ±90 Sekunden und die freigegebene Vorgangskennung. Nach Erhalt der Datenbanksperre wird erneut geprüft. Die Befehle heißen ausschließlich `inspect` und `sync_draft`; beliebige URLs, Inhalte, Seitentitel, fremde Seiten-IDs oder Veröffentlichungswünsche sind keine Eingaben.

`inspect` meldet Ziel, Shop, Vorgang und Entwurfsrevision ohne Schlüssel zurück. `sync_draft` verlangt eine UUID und die erwartete Revision. Eine verlorene Antwort lässt sich mit derselben UUID/Absicht erneut abrufen, auch mit einer frischen Signatur nach Ablauf des kurzen Zeitfensters. Eine geänderte Absicht oder alte Revision wird abgewiesen.

## Erhalt vorhandener Inhalte

Die erste Synchronisierung erstellt eine neue Seite „Produkte“ im Status `draft`. Darin steht ein SMA-Shortcode; dadurch muss kein ungefiltertes iframe als WordPress-Seiteninhalt gespeichert werden. Das iframe wird später ausschließlich auf der zugeordneten Seite aus einer festen SMA-Adresse und dem freigegebenen Shop-Slug erzeugt.

Weitere Synchronisierungen verwenden dieselbe Seiten-ID. Vor jedem Schreiben prüft der Baustein den gespeicherten Stand von Titel, Inhalt, Status, URL-Slug, Autor und Kommentar-/Ping-Einstellungen. Eine bearbeitete, gelöschte oder bereits veröffentlichte Seite wird nicht überschrieben oder automatisch ersetzt. Verliert der freigebende Administrator seine Rechte, wird ebenfalls nicht geschrieben.

Die WordPress-Zuordnung liegt in einer eigenen Tabelle. Zuordnung und Entwurf werden in einer Transaktion unter Zeilensperren aktualisiert. Der Adapter lehnt nicht transaktionale Tabellen ab. Nach Fehlern werden Objektcaches der betroffenen Seite bereinigt. Tatsächliches MySQL-/MariaDB-Verhalten sowie Nebenwirkungen fremder WordPress-Hooks müssen vor einer Installation auf einer realen Testseite geprüft werden; die lokalen Speicher-Doubles ersetzen dies nicht.

„Verbindung trennen“ und Deaktivierung entfernen den Prüfschlüssel. Eine erneute Aktivierung verlangt neue Freigabe. Vorhandene Seiten bleiben erhalten. Bei aktivem Baustein gibt der SMA-Shortcode ohne passende Verbindung nichts aus; nach Deaktivierung oder Entfernen des Plugins kann WordPress den verbliebenen Shortcode als Text anzeigen. Dieser Fall ist vor einer späteren Veröffentlichung zu berücksichtigen. Ein neuer Verbindungsversuch übernimmt keine Seite eines alten Kontos. Bereits veröffentlichte Produktseiten werden in diesem Kandidaten nicht durch SMA bearbeitet.

## Dateien und Prüfung

| Datei | Aufgabe |
| --- | --- |
| `wordpress/sma-bridge/sma-bridge.php` | WordPress-Registrierung, Freigabeformular, Rechte/Nonce, feste Ticketabfrage, REST-Route und Shortcode |
| `wordpress/sma-bridge/protocol.php` | Freigabe-/Signaturprüfung, Entwurfsablauf, Konflikte, Wiederholung und Katalogausgabe |
| `wordpress/sma-bridge/store.php` | WordPress-Datenbankadapter, Transaktion und Zeilensperren |
| `supabase/functions/_shared/wordpress-bridge.mjs` | Serverseitige Schlüsselerzeugung, Signierung und Prüfung von Antwortzuordnungen; kein Netzwerkzugriff |
| `supabase/functions/_shared/wordpress-transport.mjs` | Öffentliche Zieladressen, DNS-Kette, IP-Bindung, TLS und begrenzte HTTP-Antworten |
| `supabase/functions/sma-wordpress-connect/`, `sma-wordpress-ticket/` | Authentifizierter Verbindungsablauf und öffentliche Ticketabfrage |
| `supabase/sql/wordpress-tickets.sql`, `wordpress-ticket-cleanup-job.sql` | Temporäre Vault-Schlüssel, atomarer Abschluss, Invalidierung und Bereinigung |
| `app/assets/wordpress-connection.mjs`, `app/downloads/sma-wordpress-bridge.zip` | Separater Dashboard-Detailbereich und installierbares Paket aus den drei PHP-Quelldateien |
| `tests/wordpress-bridge.test.cjs` | JavaScript-Protokoll und Antwortprüfung |
| `tests/run-wordpress-bridge.mjs` | PHP-8.3-WASM-Lauf, Syntaxprüfung aller Plugin-Dateien und echte OpenSSL-Prüfung der JS-Signaturen |
| `tests/wordpress-bridge.php`, `tests/wordpress-bridge-boundaries.php` | Entwurf, Konflikte, Wiederholung, Rechte, Nonce, Signaturen und Adapterfehler mit WordPress-/Speicher-Doubles |

```sh
npm ci --prefix tests/php-runtime --ignore-scripts --no-audit --no-fund
node --test tests/*.test.cjs
node tests/run-wordpress-bridge.mjs
node tests/run-website-provider-sql.mjs
node tests/run-wordpress-dom.mjs
npm exec --yes --package=deno@2.9.6 -- deno check supabase/functions/sma-wordpress-connect/index.ts supabase/functions/sma-wordpress-ticket/index.ts
```

**340 Node-Tests bestanden.** Zusätzlich bestehen **66 PHP-Prüfungen** unter PHP 8.3.36: 45 für Protokoll/Entwurf und 21 für WordPress-Grenzen/Adapter. OpenSSL prüft echte, während des Tests erzeugte JavaScript-Signaturen. WordPress und sein Speicher sind Doubles; weder eine echte WordPress-Installation noch konkurrierende MySQL-Verbindungen wurden getestet. Die PostgreSQL-Fälle einschließlich temporärer Tickets, Speicherung/Entfernung des Bridge-Schlüssels, Wiederholung, Widerruf, Shopwechsel und Ablauf bestehen ebenfalls. Der dortige PEM-Testwert prüft nur die Struktur; er ist kein echter RSA-Schlüssel. DOM-Prüfungen bestätigen drei unveränderte Übersichtseinträge, eine getrennte Verbindungsansicht und gesperrten Start ohne Zieladresse; beide Edge-Einstiege bestehen die Deno-Typprüfung.

Live installiert: Migration `website_wordpress_connection_tickets`, `sma-wordpress-connect` Version 2 und `sma-wordpress-ticket` Version 1. Fehlende/ungültige SMA-Sitzungen ergeben HTTP 401; ein ungültiges Ticket ergibt HTTP 403. Native Rollen-/Sperrprüfungen und der aktive Fünf-Minuten-Bereinigungsjob wurden geprüft. Die neuen privaten Tabellen haben bewusst RLS ohne Direktzugriff; der Advisor meldet dazu nur `INFO rls_enabled_no_policy`. Der TLS-Transport ist mit Doubles geprüft; ein lokaler nativer Netzwerkversuch scheiterte an der eingeschränkten Laufzeit. Ein positiver Live-Aufruf zu WordPress steht noch aus.

Die isolierten Testabhängigkeiten sind fest auf PHP.wasm 3.1.62 gesetzt. Das Paket nennt Node >=24.18 und npm >=11.16; der aktuelle Lauf verwendete Node 24.22.1/npm 11.9 und meldete eine npm-Versionswarnung. Installation und Lauf waren erfolgreich. Kein Produktionspaket wurde geändert.

## Noch zu verbinden

1. WordPress-Zieladresse festlegen, den Baustein auf der freigegebenen Testseite installieren und die einmalige Admin-Freigabe durchführen. Echte TLS-Verbindung, WordPress-Rechte, MySQL-Transaktionen und Darstellung dort prüfen. Der SMA-Testshop ist keine externe WordPress-Installation.
2. Dauerhaften Synchronisierungsauftrag mit UUID/Revision anschließen. `can_synchronize` im SMA-Status bleibt bis dahin false, auch wenn der isolierte WordPress-Baustein Entwürfe bearbeiten kann. Verlorene Antworten, konkurrierende Aufträge und fremde Änderungen auch auf der echten Seite abnehmen.
3. Erst danach die Erstellung eines Produktentwurfs anbieten. Veröffentlichung, Hostingkäufe, Tarif- und DNS-Änderungen bleiben getrennte Entscheidungen.

Offizielle Referenzen, am 4. November 2026 geprüft: [WordPress REST-Berechtigungen](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/), [sichere HTTP-Anfragen](https://developer.wordpress.org/reference/functions/wp_safe_remote_post/), [Seiten als Entwurf speichern](https://developer.wordpress.org/reference/functions/wp_insert_post/), [Plugin-Tabellen](https://developer.wordpress.org/plugins/creating-tables-with-plugins/), [PHP.wasm-Pakete](https://wordpress.github.io/wordpress-playground/developers/architecture/php-wasm-packages/).
