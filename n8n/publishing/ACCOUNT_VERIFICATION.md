# Zielkonto und Portalberechtigungen

Stand: 2026-11-03. **Implementiert und lokal geprüft, noch nicht produktiv angeschlossen.**

Die Arbeitskopie `LR2Qng41OIYuVHAR` enthält die öffentliche Vorlage mit 35 Knoten. Sie ist unveröffentlicht und vor der Token-Erneuerung mit `TARGET_CONFIGURATION_REQUIRED` gesperrt. Der Export wurde gegen Parameter und Verbindungen der Vorlage geprüft. n8n lässt beim Export die Standardwerte `keyName: id` und `condition: eq` weg; der ID-Gleichheitsfilter wurde zusätzlich im Knoten bestätigt.

Der private Import wurde von der automatischen Freigabeprüfung wegen der enthaltenen bestehenden OAuth-App-Secrets gestoppt. Es wurden nur Platzhalter importiert. Die bestehende veröffentlichte API, der Ausführungsworkflow, die Publisher-Arbeitskopie und die geschützten Originalworkflows wurden in diesem Schritt nicht verändert. Datenbankänderungen und Dashboard-Änderungen dieses Zweigs sind noch nicht ausgerollt. Es gab keine Provider-Anfrage, Token-Erneuerung oder Veröffentlichung durch diese neue Arbeitskopie.

## Vertrag

- `account` liest die eindeutige aktive Kundenzuordnung mit dem Dashboard-JWT. Kundennummer und Zielkonto werden nicht aus dem Browser übernommen. Der neue Unterworkflow erhält ausschließlich den serverseitigen Kontext.
- YouTube: vorhandenen Zugang erneuern, genau einen authentifizierten Kanal mit `mine=true` laden, ID abgleichen und `youtube.upload` über Token-Introspection nachweisen. Ein Leserecht allein genügt nicht.
- TikTok: vorhandenen Zugang erneuern; `open_id`, `user.info.basic`, `video.publish` und aktuelle Creator-Info prüfen. Sichtbarkeit, gesperrte Interaktionen und maximale Dauer kommen vom Portal.
- Die vorbereitete Dashboard-Erweiterung lädt die Kontooptionen vor der Auswahl. Sichtbarkeit bleibt ohne Vorauswahl. Vom TikTok-Konto gesperrte Interaktionen können nicht aktiviert werden. Private Werbung für Dritte wird abgewiesen.
- `prepare` prüft das Portal erneut und bindet den Nachweis an Ziel-ID und Quellrevision. `approve` akzeptiert nur höchstens fünf Minuten alte, noch gültige Nachweise. Der Ausführungsworkflow prüft das Konto nach dem exklusiven Auftrags-Claim nochmals.
- Der Nachweis enthält nur ID, Anzeigename, Berechtigungen, erlaubte Optionen und Zeitstempel. Token, OAuth-App-Secrets und Kundentabellen verlassen den Unterworkflow nicht in der Antwort.
- Die Datenbank prüft den Nachweis unabhängig auf erlaubte Felder, Zeit, Zielbindung und Optionen. Eine erfolgreiche Kontoprüfung entfernt ausschließlich `TARGET_PERMISSIONS_REQUIRED`; Medien-/Textblocker, die finale Zustimmung und das Doppelveröffentlichungsjournal bleiben maßgeblich. `can_upload` und `can_publish` bleiben **false**.
- Instagram/Facebook behalten die vorhandene Kontozuordnung und den offenen Berechtigungsblocker. Diese Änderung bestätigt keine Meta-Berechtigungen.

## Gleichzeitige Erneuerung und verlorene Antworten

Die private Tabelle `publication_account_locks_v1` enthält pro Kunde und Portal eine Sperre, einen nicht rückrechenbaren Token-Fingerprint und eine begrenzte Abfragerate. Roh-Token werden dort nicht gespeichert.

Nach dem Sperren werden die Zugangsdaten erneut aus n8n gelesen. Ein inzwischen geänderter Token beendet den Versuch vor der Erneuerung. Vor der Provider-Anfrage wird die Sperre dauerhaft auf `refreshing` gesetzt. Es gibt keinen automatischen HTTP-Retry. Die Antwort wird mit Bedingungen auf Zeilen-ID, Kundenzuordnung und beide bisherigen Token in `SMA_Kunden` gespeichert und anschließend unabhängig zurückgelesen. Erst danach wird der Refresh als abgeschlossen markiert und die Profilprüfung gestartet.

Bei unklarem Refresh-Ergebnis bleibt die Sperre bestehen. Nach Ablauf der Ausführungsfrist erlaubt nur ein geänderter gespeicherter Fingerprint (erfolgreiches Speichern oder erneute Verbindung) einen neuen Versuch. Derselbe möglicherweise verbrauchte Refresh-Token wird nicht erneut verwendet. Die neuen Sperren koordinieren diesen neuen Pfad; die geschützten Altworkflows verwenden sie nicht. Der bedingte Schreibzugriff verhindert ein Überschreiben einer zwischenzeitlich gespeicherten Verbindung.

## Prüfung

```sh
node --test tests/*.test.cjs
npm ci --prefix tests/sql-runtime --ignore-scripts
node tests/run-publication-accounts-sql.mjs
PYTHONDONTWRITEBYTECODE=1 python n8n/publishing/build-publication-accounts.py
PYTHONDONTWRITEBYTECODE=1 python n8n/publishing/build-publication-orders.py \
  --worker-id zLlhr1I1vKm2AiiU --account-id LR2Qng41OIYuVHAR
```

273 Node-Tests bestanden. Die beiden SQL-Prüfreihen `publication-accounts.sql` und `publication-orders.sql` bestanden in PGlite 0.5.14 / PostgreSQL 18.6. Sie verwenden die echten Publikations-SQL-Definitionen, eine minimale Auth-/Kunden-Testtabelle und zurückgerollte synthetische Datensätze. Geprüft werden Eigentümerrechte, parallele Claims, unsichere Refresh-Ergebnisse, verlorene/alte Leases, Ratenbegrenzung, fehlende/veraltete Nachweise, TikTok-Optionen, doppelte Freigaben sowie weiterbestehende Medienblocker. Die produktive Supabase-Instanz verwendet PostgreSQL 17; ein dortiger Rollback-Test und die echten Provider-Durchläufe stehen vor dem Rollout noch aus. PGlite prüft die SQL-Sperrübergänge sequenziell, nicht mit mehreren gleichzeitig laufenden Datenbankverbindungen.

## Fortsetzung nach Freigabe des privaten Imports

1. Ausschließlich die schon vorhandenen YouTube-/TikTok-App-Parameter aus dem privaten n8n-Export übernehmen. `build-publication-accounts.py --private-source <export> --output <private-path>` schreibt das Ergebnis außerhalb des Repositorys und entsperrt nur diese private Fassung. Den Import in dieselbe n8n-Instanz vornehmen; die öffentliche Vorlage enthält weiterhin nur Platzhalter.
2. `supabase/sql/publication-accounts.sql`, anschließend die aktuelle `supabase/sql/publication-orders.sql` anwenden; beide SQL-Prüfreihen mit Rollback auf der Instanz ausführen und Security-Advisors prüfen.
3. Kontoworkflow importieren, Einstellungen/Export prüfen und veröffentlichen. Danach die 17-Knoten-Ausführung `zLlhr1I1vKm2AiiU` und 23-Knoten-API `RdtCqCWRi7P4W7B0` aktualisieren und veröffentlichen. Beim UI-Import bestehende Entwurfsknoten ersetzen, nicht anhängen. Pro Workflow keine Erfolgs-, Fehler-, manuellen oder Fortschrittsdaten speichern; Aufruf nur durch denselben Eigentümer; Timeout 150 Sekunden; MCP aus.
4. Dashboard-Fassung ausrollen. YouTube-/TikTok-Kontooptionen und Auftragsvorbereitung mit den bestehenden Verbindungen prüfen, ohne eine Veröffentlichungsfreigabe im Namen des Nutzers zu erteilen. Unbekannte Providerfehler, verlorene Refresh-Antworten und Änderungen der Zielkonten müssen sperren.
5. Erst danach die verbleibenden Mediennachweise, Meta-Berechtigungen, TikTok-Freigabehinweise einschließlich Musik-/Werbekennzeichnung, Upload-Übergabe und Provider-Statusnachweise fertigstellen. Diese Vorlage besitzt keinen Upload- oder Publish-Endpunkt.

## Primärquellen

- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://googleapis.github.io/google-api-python-client/docs/dyn/oauth2_v2.html
- https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
- https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
