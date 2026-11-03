# Zielkonto und Portalberechtigungen

Stand: 2026-11-03. **Privater Import freigegeben und erfolgt; Datenbank und n8n-Anbindung ausgerollt. Live-Anschlusskorrektur und Provider-Nachweis noch offen. PR #46 bleibt Entwurf, Dashboard v23 ist nicht ausgerollt.**

Der Nutzer hat die Übernahme der bestehenden YouTube-/TikTok-OAuth-App-Konfiguration in dieselbe n8n-Instanz ausdrücklich freigegeben. Die private Fassung von `LR2Qng41OIYuVHAR` wurde importiert und veröffentlicht. Alle 35 Knotenparameter einschließlich der App-Werte und die Verbindungen wurden per Export gegen die private Vorlage geprüft; keine Secrets stehen im Repository. n8n lässt Standardwerte wie `keyName: id` im Export weg.

Die Migrationen `publication_account_verification_v1` und `publication_order_account_evidence_v1` sind eingespielt. Beide SQL-Prüfreihen bestanden auf der produktiven PostgreSQL-17-Instanz mit Rollback. Die Security-Advisors wurden geprüft: Für die neuen Tabellen gilt absichtlich RLS ohne Nutzer-Policy, Zugriffe erfolgen nur über die eingeschränkten Funktionen. Vorhandene projektweite Hinweise zu älteren Funktionen und Passwortschutz bleiben außerhalb dieser Änderung.

`zLlhr1I1vKm2AiiU` wurde mit 17 Knoten, `RdtCqCWRi7P4W7B0` mit 23 Knoten veröffentlicht. Der API-Export stimmt nach Normalisierung der n8n-Standardwerte mit der Vorlage überein. Alle drei Workflows speichern keine Erfolgs-, Fehler-, manuellen oder Fortschrittsdaten, haben 150 Sekunden Timeout und erlauben Aufrufe nur durch denselben Eigentümer; MCP bleibt aus. Die geschützten Originale und die Publisher-Arbeitskopie wurden nicht verändert.

Der echte YouTube-Vorbereitungstest scheitert **vor der Token-Erneuerung**: n8n blockiert im IF-Ausdruck den Zugriff auf `binding` mit `Cannot access "binding" due to security concerns`. Der isolierte, unveröffentlichte QA-Workflow `9o3GxmGI6jdhgjzG` bestätigte denselben Fehler beim Unterworkflow-Aufruf. Die Kontosperrentabelle blieb leer, es wurde kein Provider-Token erneuert. Der Testauftrag `0e00b17c-1d06-4cfe-bee2-72e2c9d5bd8d` wurde ohne Freigabe und ohne Journaleintrag auf `cancelled` gesetzt.

Die Korrektur ist im Repository und in den generierten Vorlagen fertig: Der IF-Ausdruck liest das zuvor geprüfte `target.platform`; die Dateiabfrage verwendet eine im Code-Knoten aus dem vertrauenswürdigen Kontext abgeleitete `drive_file_id`. Es wird keine n8n-Sicherheitsprüfung umgangen oder abgeschaltet. 274 Node-Tests bestehen einschließlich einer Regression gegen den reservierten Feldzugriff in n8n-Parameterausdrücken. **Diese beiden Knotenänderungen sind noch nicht in n8n eingespielt.** Die Browsersteuerung reagierte anschließend mehrfach mit einem Transport-Timeout von 300 Sekunden, auch auf Dokumentations- und Reset-Aufrufe. Das belegt keinen Ausfall der n8n-Instanz.

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

274 Node-Tests bestanden. Die beiden SQL-Prüfreihen `publication-accounts.sql` und `publication-orders.sql` bestanden in PGlite 0.5.14 / PostgreSQL 18.6. Sie verwenden die echten Publikations-SQL-Definitionen, eine minimale Auth-/Kunden-Testtabelle und zurückgerollte synthetische Datensätze. Geprüft werden Eigentümerrechte, parallele Claims, unsichere Refresh-Ergebnisse, verlorene/alte Leases, Ratenbegrenzung, fehlende/veraltete Nachweise, TikTok-Optionen, doppelte Freigaben sowie weiterbestehende Medienblocker. Beide Prüfreihen bestanden zusätzlich auf der produktiven Supabase-Instanz mit PostgreSQL 17 und Rollback. Die echten Provider-Durchläufe stehen noch aus. PGlite prüft die SQL-Sperrübergänge sequenziell, nicht mit mehreren gleichzeitig laufenden Datenbankverbindungen.

## Fortsetzung nach Wiederherstellung der Browsersteuerung

Die Freigabe des privaten Imports liegt bereits vor; nicht erneut einholen.

1. Im Kontoworkflow `LR2Qng41OIYuVHAR` die aktuelle private Vorlage importieren oder ausschließlich den Ausdruck von `YouTube oder TikTok?` auf die aktuelle Vorlage ändern; veröffentlichen. Der private Generator übernimmt unverändert dieselben bestehenden App-Parameter. Im Ausführungsworkflow `zLlhr1I1vKm2AiiU` die beiden korrigierten Knoten `Zielkonto und Ordner prüfen` / `Aktuellen Dateistand lesen` einspielen, Export vergleichen und veröffentlichen. Die API-Vorlage ist unverändert.
2. Den inzwischen stornierten Testauftrag nicht weiterverwenden. Einen neuen Testauftrag über das Dashboard vorbereiten oder im isolierten QA-Ablauf einen serverseitigen Kontokontext für das bestehende eigene Konto lesen. Provider-Ergebnis, bedingtes Speichern und Rücklesen der Token, Portalidentität und aktuelle Berechtigungen prüfen. Bei unklarem Refresh keine automatische Wiederholung. Danach QA-Workflow archivieren.
3. PR #46 erst nach erfolgreichem Anschluss abschließen und Dashboard v23 ausrollen. YouTube-/TikTok-Kontooptionen und Auftragsvorbereitung mit den bestehenden Verbindungen prüfen, ohne eine Veröffentlichungsfreigabe im Namen des Nutzers zu erteilen. Testaufträge anschließend stornieren.
4. Die verbleibenden Mediennachweise, Meta-Berechtigungen, TikTok-Freigabehinweise einschließlich Musik-/Werbekennzeichnung, Upload-Übergabe und Provider-Statusnachweise fertigstellen. Diese Vorlage besitzt keinen Upload- oder Publish-Endpunkt.

## Primärquellen

- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://googleapis.github.io/google-api-python-client/docs/dyn/oauth2_v2.html
- https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
- https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
