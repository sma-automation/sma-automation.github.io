# Dauerhafte Verbindungsanfragen – erster Implementierungsschritt

Stand: 4. November 2026. Aufbauend auf [Anbieterprüfung](WEBSITE_PROVIDER_ASSESSMENT.md) und der veröffentlichten Webseiten-Vorbereitung.

## Was implementiert ist

Die neue Anfrageverwaltung bindet eine Verbindungsanfrage an den angemeldeten Kunden, dessen gespeicherte Webadresse, die Revision der Vorbereitung und den gewählten Anschluss (`wordpress` oder `hostinger`). Die Zieladresse stammt aus dem vorhandenen Entwurf, nicht aus einem Callback oder frei übergebenen Kundenkennungen.

Eine Anfrage ist zehn Minuten gültig. Derselbe Speicherversuch liefert nach einer verlorenen Antwort denselben Vorgang, ohne die Laufzeit zu verlängern. Ein neuer Versuch erhält eine neue Kennung; fremde oder alte Vorgänge werden abgewiesen. Ein neuer Vorgang ist höchstens einmal pro Minute möglich. Änderungen an der Webseiten-Vorbereitung machen die vorherige Anfrage ungültig, einschließlich Änderungen am Pfad derselben Domain.

`revoke` widerruft **diese SMA-Verbindungsanfrage**, auch wenn inzwischen Paket oder SMA-Zugang inaktiv sind. Ein späterer Anbieteranschluss muss zusätzlich die Anbieter-Zugangsdaten löschen beziehungsweise widerrufen; das ist hier noch nicht umgesetzt. Kunden- oder Besitzerwechsel geben keine alten Anfragen frei.

## Dateien und Schnittstellen

| Datei | Aufgabe |
| --- | --- |
| `supabase/sql/website-connection-requests.sql` | Kandidat für private RLS-Tabelle, ownergebundene RPCs, Ablauf und Widerruf |
| `app/assets/website-connection-model.mjs` | Antwortprüfung, Kontowechsel, Revisionen und sichere Wiederholung im Client; noch nicht ins Dashboard importiert |
| `tests/website-connection.test.cjs` | Client-Verhalten und Ablehnung vorgetäuschter Verbindungsrechte |
| `tests/website-connection.sql` | Datenbankfälle mit Rollen, Zeitablauf, Konflikten und zurückgerollten Fixtures |
| `tests/run-website-connection-sql.mjs` | Lokaler PostgreSQL-Test mit dem vorhandenen PGlite-Prüfaufbau |

`sma_website_connection_request_v1` bietet `get`, `prepare` und `revoke` für angemeldete Kunden. `prepare` verlangt Anbieter, erwartete Revision und Anfrage-UUID. Kunden-ID, Benutzer-ID, Webadresse und Berechtigungen werden nicht als Eingaben akzeptiert. Direkter Tabellenzugriff ist auch für die Service-Rolle gesperrt.

`sma_website_connection_context_v1` ist ausschließlich für einen späteren serverseitigen Adapter bestimmt. Er prüft Benutzer, Zugriff, gespeicherte Adresse, Revision, Vorgangskennung, Widerruf und Ablauf erneut. Das Ergebnis ist **kein Lease**, keine Anbieterfreigabe und kein Beleg für eine erfolgreich abgeschlossene Verbindung. Die spätere Bestätigungsfunktion muss dieselbe Bindung nach dem Anbieteraufruf atomar erneut prüfen.

Alle öffentlichen Antworten enthalten weiterhin `website_connected:false`, `can_synchronize:false` und `can_publish:false`. Der Client verwirft Antworten, die diese Grenzen unzulässig verändern. Lokaler Zeitablauf entfernt die verwendbare Vorgangskennung auch dann, wenn eine Antwort während der Übertragung abläuft.

## Noch erforderlich für die echte einmalige Freigabe

1. **Ein unterstützter Anmeldeweg.** Hostingers Anmeldung für eigene Entwicklerwerkzeuge belegt noch keine für SMA registrierte Webanwendung. Clientregistrierung, Redirect und Berechtigungen sind offen. WordPress bietet einen nativen Anwendungsfreigabeweg, überträgt dabei aber Zugangsdaten in Callback-Queryparametern; dieser wird nicht ungeprüft auf eine öffentlich protokollierte Dashboard- oder Edge-Adresse gelegt.
2. **Zugangsdaten und Bestätigung.** Benötigt werden der serverseitige Austausch beziehungsweise eine sichere Übergabe, verschlüsselte Speicherung, Widerruf, echte Prüfung des ausgewählten Ziels und atomarer Abschluss. Die Vorgangskennung dieser Implementierung ist kein OAuth-State und darf nicht als alleiniger Authentifizierungsnachweis verwendet werden. Ein OAuth-Adapter benötigt zusätzliche an Browser/Sitzung gebundene Einmalzustände und PKCE.
3. **Gezielte Einbindung.** Nach erfolgreicher Freigabe den SMA-Produktbereich anlegen/aktualisieren, fremde Änderungen erhalten und Wiederholung absichern. Kauf, Domain-/DNS-Änderung und Veröffentlichung bleiben getrennt.
4. **Abnahme mit einer echten freigegebenen Zielwebseite.** Der bisherige Testshop und seine Vorschau ersetzen keine externe Kundenwebseite.

Die bereitgestellte Datenbankdefinition ist ein **lokal getesteter Kandidat**, noch keine installierte Migration. Kein neuer Endpoint und kein Dashboard-Button wurden veröffentlicht. Das verhindert, dass Kunden eine noch nicht angeschlossene Anmeldung beginnen oder eine bloße Anfrage für eine Verbindung halten. Die Oberfläche, Schrift und vorhandenen Workflows sind unverändert.

## Prüfungen

**322 Node-Tests bestanden, 0 fehlgeschlagen**, einschließlich sieben neuer Fälle. Die lokale PostgreSQL-Prüfreihe für Rechte, Wiederholung, Ablauf, Adressänderung, Besitzerwechsel und Widerruf ist ebenfalls bestanden. `git diff --cached --check` meldet keine Formatfehler.

```sh
node --test tests/*.test.cjs
node tests/run-website-connection-sql.mjs
```

Die SQL-Fixtures werden vollständig zurückgerollt. Es wurden keine echten Kundendaten, Zugangsdaten, Providerkonten, Webseiten oder DNS-Einträge verändert. Die Datenbankdefinition wurde gegen die gelesenen Live-Spaltentypen geprüft; das ersetzt keine spätere Live-Migration und keine echte Provider-Abnahme.

Technische Referenzen: [Supabase Auth in Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Supabase Logging](https://supabase.com/docs/guides/functions/logging), [Supabase Changelog](https://supabase.com/changelog), [WordPress Freigabeablauf](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/). Die Markdown-Dokumentationsadressen waren nicht abrufbar; die entsprechenden HTML-Seiten beziehungsweise die Supabase-Dokumentationssuche wurden verwendet.
