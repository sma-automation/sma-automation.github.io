# WordPress: begrenzter SMA-Anschluss mit einmaliger Freigabe

Stand: 4. November 2026. Implementierungskandidat in PR #63, **nicht auf einer Kundenwebseite installiert**. Der WordPress-Baustein und das Signaturprotokoll sind implementiert und lokal geprüft. Die SMA-Ticketausgabe und der Netzwerkadapter fehlen noch; eine vollständige Verbindung ist damit noch nicht verfügbar.

## Bedienung und Umfang

Eine WordPress-Erweiterung ersetzt das manuelle Kopieren von HTML. Ihre einmalige Installation benötigt Zugriff auf die betreffende WordPress-Verwaltung; sie kann bei vorhandener Freigabe von SMA übernommen werden. Sie kauft kein Hosting, ändert keine Domain und benötigt keine WordPress-Anwendungspasswörter.

Der vorgesehene Verbindungsablauf startet in SMA. Ein kurzlebiger Vorgang öffnet die WordPress-Einstellungen. Dort sieht der Administrator das SMA-Konto und den Shop und bestätigt „Verbindung freigeben“. Die Bestätigung verlangt WordPress-Rechte und einen gültigen WordPress-Nonce. Eine bestehende Verbindung zu einem anderen Vorgang muss zuerst getrennt werden. Wiederholtes Bestätigen desselben Vorgangs erhält den bisherigen Entwurf.

Danach darf SMA ausschließlich den eigenen Produktbereich als **Entwurf** anlegen und aktualisieren. Der Baustein enthält keine Veröffentlichungsoperation. Er überträgt keine Preise oder Bestände in WordPress: Ein gezielt gerenderter SMA-Katalog lädt sie beim Anzeigen beziehungsweise Aktualisieren weiterhin aus dem öffentlichen SMA-Shop.

## Schlüssel statt WordPress-Passwort

Pro Verbindung entsteht auf dem SMA-Server ein RSA-Schlüsselpaar (3072 Bit). Der private Schlüssel bleibt bei SMA und ist für Vault vorgesehen; WordPress erhält nur den öffentlichen Prüfschlüssel. Der Vault-Kandidat akzeptiert dafür `bridge_private_key` ausschließlich im WordPress-Zweig. Seine SQL-Prüfung kontrolliert die Struktur; der Server muss zusätzlich den Schlüssel kryptografisch laden und den Anbieterzugriff prüfen.

WordPress bezieht Freigabedaten ausschließlich per HTTPS von der festen SMA-Adresse `.../functions/v1/sma-wordpress-ticket`. Dabei werden keine WordPress-Zugangsdaten übertragen. Weiterleitungen sind gesperrt, Antwortgröße und Wartezeit begrenzt. **Dieser Endpoint ist noch nicht bereitgestellt.** Ohne gültige Antwort, exakt passende Webadresse, nicht abgelaufenen Vorgang und öffentlichen RSA-Schlüssel wird keine Freigabe gespeichert.

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
| `tests/wordpress-bridge.test.cjs` | JavaScript-Protokoll und Antwortprüfung |
| `tests/run-wordpress-bridge.mjs` | PHP-8.3-WASM-Lauf, Syntaxprüfung aller Plugin-Dateien und echte OpenSSL-Prüfung der JS-Signaturen |
| `tests/wordpress-bridge.php`, `tests/wordpress-bridge-boundaries.php` | Entwurf, Konflikte, Wiederholung, Rechte, Nonce, Signaturen und Adapterfehler mit WordPress-/Speicher-Doubles |

```sh
npm ci --prefix tests/php-runtime --ignore-scripts --no-audit --no-fund
node --test tests/*.test.cjs
node tests/run-wordpress-bridge.mjs
node tests/run-website-provider-sql.mjs
```

**327 Node-Tests bestanden.** Zusätzlich bestehen **66 PHP-Prüfungen** unter PHP 8.3.36: 45 für Protokoll/Entwurf und 21 für WordPress-Grenzen/Adapter. OpenSSL prüft echte, während des Tests erzeugte JavaScript-Signaturen. WordPress und sein Speicher sind Doubles; weder eine echte WordPress-Installation noch konkurrierende MySQL-Verbindungen wurden getestet. Die PostgreSQL-Fälle einschließlich Speicherung/Entfernung des Bridge-Schlüssels bestehen ebenfalls. Der dortige PEM-Testwert prüft nur die Struktur; er ist kein echter RSA-Schlüssel.

Die isolierten Testabhängigkeiten sind fest auf PHP.wasm 3.1.62 gesetzt. Das Paket nennt Node >=24.18 und npm >=11.16; der aktuelle Lauf verwendete Node 24.22.1/npm 11.9 und meldete eine npm-Versionswarnung. Installation und Lauf waren erfolgreich. Kein Produktionspaket wurde geändert.

## Noch zu verbinden

1. Authentifizierte SMA-Ticketausgabe: Besitzer, bestehende Webseite, Shop und aktueller Versuch ausschließlich serverseitig zuordnen; kontobezogene Beschriftung aus geprüften Kontodaten beziehen. Temporären privaten Schlüssel in Vault verwalten, Ticket nur gehasht speichern und abgelaufene/veraltete Einträge entfernen. Kein Schlüssel im Browser oder in Logs.
2. Ticketabfrage für WordPress implementieren, ohne durch eine bloße Abfrage eine Verbindung als erfolgreich zu markieren. Erst nach der ausdrücklichen WordPress-Freigabe einen signierten `inspect`-Aufruf an die gespeicherte Zielwebseite durchführen.
3. Einen HTTPS-Transport mit Schutz vor privaten Zielen und DNS-Rebinding, ohne Redirects, mit TLS-Namensprüfung sowie Antwort-/Zeitlimits anschließen. Diese Aufgabe ist nicht durch ein gewöhnliches `fetch()` mit vorheriger DNS-Abfrage gelöst. Der Signierbaustein bietet deshalb bewusst keinen Standard-Netzwerkaufruf.
4. Ergebnis über den bestehenden atomaren Provider-Abschluss speichern und einen dauerhaften Synchronisierungsauftrag mit UUID/Revision anschließen. `can_synchronize` im SMA-Status bleibt bis dahin false, auch wenn der isolierte WordPress-Baustein Entwürfe bearbeiten kann.
5. Installation und Abnahme auf einer freigegebenen echten WordPress-Testseite; danach kompakter Einstieg in das bestehende Dashboard. Keine Veröffentlichung oder Kundenkonto-Aktion ist durch den lokalen Test bereits freigegeben.

Offizielle Referenzen, am 4. November 2026 geprüft: [WordPress REST-Berechtigungen](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/), [sichere HTTP-Anfragen](https://developer.wordpress.org/reference/functions/wp_safe_remote_post/), [Seiten als Entwurf speichern](https://developer.wordpress.org/reference/functions/wp_insert_post/), [Plugin-Tabellen](https://developer.wordpress.org/plugins/creating-tables-with-plugins/), [PHP.wasm-Pakete](https://wordpress.github.io/wordpress-playground/developers/architecture/php-wasm-packages/).
