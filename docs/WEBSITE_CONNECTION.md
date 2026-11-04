# Webseiten-Verbindung: Anfragen und geschützte Zugangsdaten

Stand: 4. November 2026. Aufbauend auf [Anbieterprüfung](WEBSITE_PROVIDER_ASSESSMENT.md) und der veröffentlichten Webseiten-Vorbereitung. Implementierungskandidat in PR #63; noch nicht installiert oder mit einer echten Anbieteranmeldung verbunden.

## Dauerhafte Anfrage

Die Anfrageverwaltung bindet einen Vorgang an den angemeldeten Kunden, dessen gespeicherte Webadresse, die Revision der Vorbereitung und den gewählten Anschluss (`wordpress` oder `hostinger`). Die Zieladresse stammt aus dem vorhandenen Entwurf, nicht aus einem Callback oder frei übergebenen Kundenkennungen.

Eine Anfrage ist zehn Minuten gültig. Derselbe Speicherversuch liefert nach einer verlorenen Antwort denselben Vorgang, ohne die Laufzeit zu verlängern. Neue Versuche erhalten eine neue Kennung, höchstens einmal pro Minute. Änderungen am Entwurf machen die vorherige Anfrage ungültig, einschließlich Änderungen am Pfad derselben Domain.

`revoke` ist auch nach Ablauf des SMA-Zugangs oder Pakets verfügbar. Mit dem neuen Speicherbaustein löscht er die zugehörigen lokalen Zugangsdaten aus Vault. Ein Besitzerwechsel, eine geänderte Vorbereitung oder ein neuer Verbindungsversuch entfernt ebenfalls die bisherige Zuordnung und deren Secret. Ein beim Anbieter ausgestelltes Anwendungspasswort oder Token wird dadurch **nicht beim Anbieter widerrufen**. Diese zusätzliche externe Aktion bleibt Aufgabe des späteren Adapters.

## Zugangsdaten und atomare Bestätigung

`website-provider-credentials.sql` ergänzt eine private RLS-Tabelle und verwendet **Supabase Vault** für Zugangsdaten. Die Zuordnung enthält ausschließlich den Vault-Verweis, einen Fingerabdruck für Wiederholungen und nicht geheime Prüfmetadaten. Kunden haben weder direkten Tabellenzugriff noch Zugriff auf die serverseitigen Speicher- und Lesefunktionen.

Der Ablauf des späteren vertrauenswürdigen Serveradapters:

1. SMA-Benutzer anhand einer geprüften Sitzung bestimmen; niemals eine Benutzer-ID aus dem Browser unverändert übernehmen. `sma_website_provider_begin_v1` prüft diese Zuordnung und reserviert den aktuellen Versuch für zwei Minuten.
2. Anbieterzugriff unabhängig prüfen: exakt die gespeicherte Webadresse, deren Anbieterkennung und tatsächlichen Lesezugriff. Diese externe Prüfung und der sichere Übergabeweg sind noch nicht implementiert. Ein vom Browser geliefertes `can_read:true` ist kein Nachweis.
3. `sma_website_provider_finish_v1` mit der reservierten Prüfkennung aufrufen. Die Funktion prüft Besitzer, Paket, Ziel, Revision, Widerruf, Anfrageablauf und Prüfzeit erneut, während die betreffenden Zeilen gesperrt sind. Nur dann speichert sie Secret und Zuordnung in derselben Transaktion. Ein Speicherfehler hinterlässt kein verwaistes Secret.
4. Eine verlorene Abschlussantwort mit identischen Daten wiederholen: dieselbe Bestätigung, kein zweites Secret. Ein anderer Inhalt, eine abgelöste Prüfkennung oder eine veraltete Anfrage wird abgewiesen. Ein inzwischen fehlendes Secret wird auch bei Wiederholung nicht als funktionierende Verbindung gemeldet.

Die Datenbank prüft Struktur und Zuordnung des Nachweises. Sie führt selbst **keinen Anbieteraufruf** aus. Die Service-Rolle ist deshalb eine Vertrauensgrenze: Sie darf `finish` ausschließlich nach einer eigenen erfolgreichen Prüfung aufrufen. Zugangsdaten dürfen nicht in URLs, Browser-Speicher, Anwendungslogs oder Fehlerantworten gelangen. Bestehende globale Vault-Rechte werden durch den Kandidaten nicht verändert. Für den WordPress-Baustein ist alternativ zum Anwendungspasswort ein ausschließlich serverseitiger `bridge_private_key` vorgesehen; dessen Lebenszyklus ist noch nicht an eine echte Ticketausgabe angeschlossen.

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

Der neue Status kann nach erfolgreichem Abschluss `website_connected:true` melden; `verified_at` bezeichnet die letzte erfolgreiche Prüfung, keine dauernde Gültigkeitsgarantie des Anbieters. `can_synchronize` und `can_publish` bleiben **false**. Vor einem echten Arbeitsauftrag muss der Adapter Zugang und benötigte Fähigkeiten erneut prüfen. Die bisherigen Anfrageantworten und deren Client-Modell bleiben unverändert; Anfrageablauf und dauerhafte Verbindung sind getrennte Zustände. Noch kein Frontend importiert diesen neuen Status.

## Dateien und Tests

- `supabase/sql/website-connection-requests.sql`: Anfrageverwaltung.
- `supabase/sql/website-provider-credentials.sql`: Vault-Anbindung, Abschluss, Wiederaufnahme und automatische lokale Entfernung. Nach der Anfrageverwaltung innerhalb einer Migrationstransaktion installieren; hier noch nicht durchgeführt.
- `app/assets/website-connection-model.mjs`: Client für Anfragen, noch nicht im Dashboard importiert.
- `tests/website-connection.test.cjs`, `tests/website-connection.sql`: Client- und Datenbankfälle für Anfragen.
- `tests/website-provider.sql`: Rollen, fremde Besitzer, falsches Ziel, verspätete Antworten, Ablauf, Wiederholung, Speicherfehler, fehlende Secrets, Wiederaufnahme und Löschung.
- `tests/sql-runtime/vault-test-double.sql`: ausschließlich lokaler Vault-Vertragsersatz, **ohne Verschlüsselung**. Der SQL-Test beweist damit Ablauf und Rechte, nicht die Kryptografie der Erweiterung.

```sh
node --test tests/*.test.cjs
node tests/run-website-connection-sql.mjs
node tests/run-website-provider-sql.mjs
```

**327 Node-Tests bestanden, 0 fehlgeschlagen.** Die lokale PostgreSQL-Prüfung für Zugangsdaten einschließlich der bisherigen Anfragefälle besteht ebenfalls; alle Fixtures werden zurückgerollt. Fehler zwischen Secret-Erstellung und Zuordnung werden gezielt ausgelöst und ihre vollständige Rücknahme geprüft. Die zeitlichen Überschneidungen werden durch versetzte Zustände geprüft, nicht durch einen Mehrprozess-Lasttest.

Zusätzlich ist die vorhandene native Vault-Erweiterung (`supabase_vault` 0.3.1) mit einem neu erzeugten synthetischen Wert geprüft: verschlüsselter Tabellenwert, korrekte Entschlüsselung und Entfernung. Die Transaktion wurde zurückgerollt. Es wurden keine bestehenden Secrets gelesen und keine echten Kundenzugangsdaten gespeichert. Dieser Test ersetzt weder eine Installation des Kandidaten auf dem Server noch eine echte Provider-Abnahme.

## Noch erforderlich für die einmalige Freigabe

**Anbieterweg:** Hostinger hat öffentlich bestätigt, dass sein OAuth-Server derzeit nicht für externe Integrationen freigegeben wird ([offizielles Issue #53](https://github.com/hostinger/api-mcp-server/issues/53), Antwort vom 27. August 2026). Ein eigener SMA-Weblogin ist damit aktuell kein belegbar verfügbarer Weg. Token oder Kontofreigaben sind keine bereits umgesetzte Alternative. Keine Kauf- oder Tarifentscheidung daraus ableiten.

**WordPress-Anschluss zuerst:** WordPress bietet einen nativen Anwendungsfreigabeweg, überträgt dabei aber Zugangsdaten in Callback-Queryparametern. Deshalb wird dieser nicht ungeprüft auf eine protokollierte Dashboard- oder Edge-Adresse gelegt. Der [WordPress-Baustein mit öffentlichem Prüfschlüssel und signierten Entwurfsaufträgen](WORDPRESS_BRIDGE.md) ist inzwischen implementiert und mit 66 PHP-Prüfungen getestet. Er benötigt kein WordPress-Anwendungspasswort. SMA-Ticketausgabe, temporäre Vault-Schlüssel und eine echte Zielprüfung über einen sicheren Netzwerkadapter fehlen noch. Die Vorgangskennung allein ist kein Authentifizierungsnachweis. Für einen später unterstützten OAuth-Anbieter werden zusätzlich sitzungsgebundene Einmalzustände und PKCE benötigt.

Anschließend folgen die gezielte Einbindung des SMA-Produktbereichs, Erhalt fremder Änderungen, sichere Wiederholung und die Abnahme auf einer ausdrücklich freigegebenen externen Testwebseite. Erstellung zunächst als Entwurf; Veröffentlichung, Käufe und DNS-Änderungen bleiben getrennt. Der vorhandene Testshop ersetzt diese externe Abnahme nicht.

Kein neuer Endpoint und kein Dashboard-Button wurden veröffentlicht. Oberfläche, Schrift, n8n-Workflows und Live-Schema bleiben unverändert. Der Kandidat verschafft noch keine automatische Webseiten-Synchronisierung.

Technische Referenzen: [Supabase Vault](https://supabase.com/docs/guides/database/vault), [Supabase Auth in Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Supabase Logging](https://supabase.com/docs/guides/functions/logging), [WordPress Freigabeablauf](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/).
