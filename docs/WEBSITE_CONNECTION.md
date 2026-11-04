# Webseiten-Verbindung: Anfragen und geschützte Zugangsdaten

Stand: 4. November 2026. Aufbauend auf [Anbieterprüfung](WEBSITE_PROVIDER_ASSESSMENT.md) und der veröffentlichten Webseiten-Vorbereitung. Anfrageverwaltung, Vault und WordPress-Tickets sind mit Migration `website_wordpress_connection_tickets` installiert. Die beiden WordPress-Endpoints sind bereitgestellt; PR #63 enthält den kompakten Dashboard-Anschluss. Eine echte externe WordPress-Verbindung ist noch nicht abgenommen.

Ergänzung: Der getrennte [WordPress-Produktentwurfsauftrag](WORDPRESS_DRAFT_SYNC.md) ist mit eigener Speicherung, Ausgangsrevision und Wiederaufnahme angeschlossen. Er verwendet die hier geprüfte Verbindung und zeigt die Erstellungsaktion erst nach deren erfolgreicher Bestätigung. Die bisherigen Verbindungsantworten bleiben unverändert; der neue Auftragsstatus gibt seine eigene verfügbare Aktion an.

## Dauerhafte Anfrage

Die Anfrageverwaltung bindet einen Vorgang an den angemeldeten Kunden, dessen gespeicherte Webadresse, die Revision der Vorbereitung und den gewählten Anschluss (`wordpress` oder `hostinger`). Die Zieladresse stammt aus dem vorhandenen Entwurf, nicht aus einem Callback oder frei übergebenen Kundenkennungen.

Eine Anfrage ist zehn Minuten gültig. Derselbe Speicherversuch liefert nach einer verlorenen Antwort denselben Vorgang, ohne die Laufzeit zu verlängern. Neue Versuche erhalten eine neue Kennung, höchstens einmal pro Minute. Änderungen am Entwurf machen die vorherige Anfrage ungültig, einschließlich Änderungen am Pfad derselben Domain.

`revoke` ist auch nach Ablauf des SMA-Zugangs oder Pakets verfügbar. Mit dem neuen Speicherbaustein löscht er die zugehörigen lokalen Zugangsdaten aus Vault. Ein Besitzerwechsel, eine geänderte Vorbereitung oder ein neuer Verbindungsversuch entfernt ebenfalls die bisherige Zuordnung und deren Secret. Ein beim Anbieter ausgestelltes Anwendungspasswort oder Token wird dadurch **nicht beim Anbieter widerrufen**. Diese zusätzliche externe Aktion bleibt Aufgabe des späteren Adapters.

## Zugangsdaten und atomare Bestätigung

`website-provider-credentials.sql` ergänzt eine private RLS-Tabelle und verwendet **Supabase Vault** für Zugangsdaten. Die Zuordnung enthält ausschließlich den Vault-Verweis, einen Fingerabdruck für Wiederholungen und nicht geheime Prüfmetadaten. Kunden haben weder direkten Tabellenzugriff noch Zugriff auf die serverseitigen Speicher- und Lesefunktionen.

Der Ablauf des vertrauenswürdigen Serveradapters:

1. SMA-Benutzer anhand einer geprüften Sitzung bestimmen; niemals eine Benutzer-ID aus dem Browser unverändert übernehmen. `sma_website_provider_begin_v1` prüft diese Zuordnung und reserviert den aktuellen Versuch für zwei Minuten.
2. Anbieterzugriff unabhängig prüfen: exakt die gespeicherte Webadresse, deren Anbieterkennung und tatsächlichen Lesezugriff. Für WordPress sind Ticketausgabe, öffentliche Ticketabfrage und ein signierter `inspect`-Aufruf über den begrenzten HTTPS-Transport implementiert. Ein vom Browser geliefertes `can_read:true` ist kein Nachweis.
3. `sma_website_provider_finish_v1` mit der reservierten Prüfkennung aufrufen. Die Funktion prüft Besitzer, Paket, Ziel, Revision, Widerruf, Anfrageablauf und Prüfzeit erneut, während die betreffenden Zeilen gesperrt sind. Nur dann speichert sie Secret und Zuordnung in derselben Transaktion. Ein Speicherfehler hinterlässt kein verwaistes Secret.
4. Eine verlorene Abschlussantwort mit identischen Daten wiederholen: dieselbe Bestätigung, kein zweites Secret. Ein anderer Inhalt, eine abgelöste Prüfkennung oder eine veraltete Anfrage wird abgewiesen. Ein inzwischen fehlendes Secret wird auch bei Wiederholung nicht als funktionierende Verbindung gemeldet.

Die Datenbank prüft Struktur und Zuordnung des Nachweises. Sie führt selbst **keinen Anbieteraufruf** aus. Die Service-Rolle ist deshalb eine Vertrauensgrenze: Sie darf `finish` ausschließlich nach einer eigenen erfolgreichen Prüfung aufrufen. Private Schlüssel dürfen nicht in URLs, Browser-Speicher, Anwendungslogs oder Fehlerantworten gelangen. Bestehende globale Vault-Rechte werden nicht verändert. WordPress verwendet einen ausschließlich serverseitigen `bridge_private_key`: zunächst als temporäres Vault-Secret, nach echter Zielprüfung atomar als dauerhafte Zuordnung. Das kurzlebige Freigabeticket ist ein separater, undurchsichtiger Wert; seine öffentliche Abfrage liefert niemals den privaten Schlüssel.

## Wiederaufnahme und Zustand

Eine erfolgreich gespeicherte Verbindung überlebt das zehnminütige Anmeldefenster. Der Server kann über `sma_website_provider_context_v1` die aktuelle, nicht geheime Vorgangskennung wiederfinden und anschließend über `sma_website_provider_credential_v1(..., 'get')` deren Zugangsdaten laden. Ändert sich die Zuordnung zwischen diesen Aufrufen, wird der Zugriff abgewiesen. Ein später Worker kann somit nicht unbemerkt die Zugangsdaten eines neueren Vorgangs verwenden.

`credential(..., 'forget')` entfernt ausschließlich die passende lokale Verbindung, etwa nach einer Anbieterablehnung. Ein verspäteter Fehler eines alten Vorgangs kann keinen neuen löschen. Inaktive Zugänge dürfen Zugangsdaten nicht laden; deren Eigentümer kann weiterhin über `revoke` löschen. Eine vorübergehende Paketdeaktivierung alleine löscht die gespeicherten Zugangsdaten nicht.

| Schnittstelle | Aufrufer | Bedeutung |
| --- | --- | --- |
| `sma_website_connection_request_v1` | Angemeldeter Kunde | `get`, `prepare`, `revoke`; Status der Anfrage, stets ohne Verbindungs-/Schreibrechte |
| `sma_website_connection_context_v1` | Service-Rolle | Zeitlich begrenzter Anfragekontext; keine Anbieterfreigabe |
| `sma_website_provider_begin_v1` / `finish_v1` | Service-Rolle | Prüfversuch reservieren und geprüfte Zugangsdaten atomar zuordnen |
| `sma_website_provider_context_v1` | Service-Rolle | Dauerhafte Zuordnung ohne Secret wiederfinden |
| `sma_website_provider_credential_v1` | Service-Rolle | Zugangsdaten des exakten Vorgangs laden oder lokal entfernen |
| `sma_website_provider_status_v1` | Angemeldeter Kunde | Ausschließlich eigene geprüfte Zuordnung, ohne Zugangsdaten |

Der neue Status kann nach erfolgreichem Abschluss `website_connected:true` melden; `verified_at` bezeichnet die letzte erfolgreiche Prüfung, keine dauernde Gültigkeitsgarantie des Anbieters. `can_synchronize` und `can_publish` bleiben **false**. Vor einem echten Arbeitsauftrag muss der Adapter Zugang und benötigte Fähigkeiten erneut prüfen. Die bisherigen Anfrageantworten und deren Client-Modell bleiben unverändert; Anfrageablauf und dauerhafte Verbindung sind getrennte Zustände. Der WordPress-Detailbereich fragt den bereinigten Zustand über den authentifizierten Edge-Endpoint ab. Die Übersicht behält ihre drei Einträge und die vorhandene Schrift.

## WordPress-Tickets und Transport

`wordpress-tickets.sql` ergänzt private, besitzergebundene Tickets. Ziel, Shop und Konto kommen aus der gespeicherten Vorbereitung und geprüften Kontodaten. Wiederaufnahme verwendet denselben Schlüssel; ein verlorener Abschluss kann den bereits gespeicherten Erfolg abrufen. Ziel-/Shop-/Besitzerwechsel und Widerruf entfernen zugehörige temporäre Schlüssel. `wordpress-ticket-cleanup-job.sql` bereinigt alle fünf Minuten bis zu 50 abgelaufene Tickets; Endpoint-Aufrufe bereinigen zusätzlich.

`sma-wordpress-connect` prüft Bearer-Sitzungen selbst über Supabase Auth; `verify_jwt:false` ersetzt diese Prüfung nicht. Der öffentliche Endpoint `sma-wordpress-ticket` akzeptiert nur den 256-Bit-Ticketwert und die genau passende Webseite. Seine Antwort enthält ausschließlich sieben öffentliche Freigabefelder. Die Abfrage schreibt keinen Verbindungsnachweis.

Der Transport prüft Google-DNS-over-HTTPS-Antworten einschließlich Frage und CNAME-Kette, lehnt interne/reservierte IPv4-Ziele ab und bindet den Socket an die geprüfte IP. TLS und HTTP-Host beziehen sich auf den ursprünglichen Namen. Keine Redirects; begrenzte Wartezeit, Header und JSON-Antwort. IPv6-only-Webseiten werden derzeit abgewiesen. Einzelheiten: [WordPress-Baustein](WORDPRESS_BRIDGE.md).

## Dateien und Tests

- `supabase/sql/website-connection-requests.sql`: Anfrageverwaltung.
- `supabase/sql/website-provider-credentials.sql`: Vault-Anbindung, Abschluss, Wiederaufnahme und automatische lokale Entfernung; zusammen mit Anfrageverwaltung und Tickets installiert.
- `app/assets/website-connection-model.mjs`: Client für Anfragen, noch nicht im Dashboard importiert.
- `tests/website-connection.test.cjs`, `tests/website-connection.sql`: Client- und Datenbankfälle für Anfragen.
- `tests/website-provider.sql`: Rollen, fremde Besitzer, falsches Ziel, verspätete Antworten, Ablauf, Wiederholung, Speicherfehler, fehlende Secrets, Wiederaufnahme und Löschung.
- `tests/sql-runtime/vault-test-double.sql`: ausschließlich lokaler Vault-Vertragsersatz, **ohne Verschlüsselung**. Der SQL-Test beweist damit Ablauf und Rechte, nicht die Kryptografie der Erweiterung.

```sh
node --test tests/*.test.cjs
node tests/run-website-connection-sql.mjs
node tests/run-website-provider-sql.mjs
```

**340 Node-Tests bestanden, 0 fehlgeschlagen.** Die lokale PostgreSQL-Prüfung für Zugangsdaten einschließlich bisheriger Anfragefälle und neuer WordPress-Tickets besteht ebenfalls; alle Fixtures werden zurückgerollt. Fehler zwischen Secret-Erstellung und Zuordnung werden gezielt ausgelöst und ihre vollständige Rücknahme geprüft. Die zeitlichen Überschneidungen werden durch versetzte Zustände geprüft, nicht durch einen Mehrprozess-Lasttest. Hinzu kommen 66 PHP-Prüfungen, DOM-Prüfungen und die Deno-Typprüfung. Native Rollenprüfungen und Live-HTTP-Ablehnungen (401 ohne gültige Sitzung, 403 bei ungültigem Ticket) bestehen. Ein positiver Live-Aufruf auf eine echte WordPress-Seite steht aus.

Zusätzlich wurde die vorhandene native Vault-Erweiterung (`supabase_vault` 0.3.1) im vorherigen Schritt mit einem neu erzeugten synthetischen Wert geprüft: verschlüsselter Tabellenwert, korrekte Entschlüsselung und Entfernung. Die Transaktion wurde zurückgerollt. Es wurden keine bestehenden Secrets gelesen und keine echten Kundenzugangsdaten gespeichert. Dieser Test ersetzt keine echte Provider-Abnahme.

## Noch erforderlich für die einmalige Freigabe

**Anbieterweg:** Hostinger hat öffentlich bestätigt, dass sein OAuth-Server derzeit nicht für externe Integrationen freigegeben wird ([offizielles Issue #53](https://github.com/hostinger/api-mcp-server/issues/53), Antwort vom 27. August 2026). Ein eigener SMA-Weblogin ist damit aktuell kein belegbar verfügbarer Weg. Token oder Kontofreigaben sind keine bereits umgesetzte Alternative. Keine Kauf- oder Tarifentscheidung daraus ableiten.

**WordPress-Anschluss zuerst:** WordPress bietet einen nativen Anwendungsfreigabeweg, überträgt dabei aber Zugangsdaten in Callback-Queryparametern. Deshalb wird dieser nicht auf eine protokollierte Dashboard- oder Edge-Adresse gelegt. Der [WordPress-Baustein mit öffentlichem Prüfschlüssel und signierten Entwurfsaufträgen](WORDPRESS_BRIDGE.md) benötigt kein WordPress-Anwendungspasswort. SMA-Ticketausgabe, temporäre Vault-Schlüssel und die lesende Zielprüfung sind angeschlossen. Die Vorgangskennung allein ist kein Authentifizierungsnachweis. Für einen später unterstützten OAuth-Anbieter werden zusätzlich sitzungsgebundene Einmalzustände und PKCE benötigt.

Die gezielte Einbindung des SMA-Produktbereichs, der Erhalt fremder Änderungen und die sichere Wiederholung sind im [Produktentwurfsauftrag](WORDPRESS_DRAFT_SYNC.md) angeschlossen. Offen bleibt die Abnahme auf einer ausdrücklich freigegebenen externen Testwebseite. Erstellung zunächst als Entwurf; Veröffentlichung, Käufe und DNS-Änderungen bleiben getrennt. Der vorhandene Testshop ersetzt diese externe Abnahme nicht.

Die zwei Endpoints und das neue Schema sind installiert. Der Einstieg liegt im separaten Detailbereich „Webseite einrichten“ → „WordPress verbinden“; Übersicht, Schrift und geschützte n8n-Workflows bleiben erhalten. Die Verbindung allein aktiviert noch keine automatische Webseiten-Synchronisierung. Für den nächsten echten Verbindungstest fehlt beim Testkunden die externe WordPress-Adresse.

Technische Referenzen: [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase Auth in Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Supabase Logging](https://supabase.com/docs/guides/functions/logging), [WordPress Freigabeablauf](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/).
