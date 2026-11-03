# Zielkonto und Portalberechtigungen

Stand: 2026-11-03. **Anschlusskorrektur veröffentlicht, echte YouTube-/TikTok-Kontoprüfungen erfolgreich, PR #46 zusammengeführt und Dashboard v23 live abgenommen.**

Der bereits genehmigte private OAuth-Import bleibt unverändert in derselben n8n-Instanz. App-Secrets und Provider-Token stehen nicht im Repository. Die Migrationen `publication_account_verification_v1` und `publication_order_account_evidence_v1` sind eingespielt; die zuvor dokumentierten SQL-Prüfreihen bestanden auf PostgreSQL 17 mit Rollback.

## Verifizierter Live-Stand

| Workflow | Stand | Exportabgleich |
| --- | --- | --- |
| Konto `LR2Qng41OIYuVHAR` | Veröffentlicht, Version `773f8ae0-2cc7-4353-ac76-12434112cf5d` | Alle 35 Knotenparameter und Verbindungen stimmen mit der privaten Vorlage überein. |
| Ausführung `zLlhr1I1vKm2AiiU` | Veröffentlicht, Version `bb2e7a4b-ea64-4c7f-80e9-010345d4286a` | Alle 17 Knotenparameter und Verbindungen stimmen mit der Repository-Vorlage überein. |
| API `RdtCqCWRi7P4W7B0` | Bereits veröffentlicht, 23 Knoten | In dieser Fortsetzung unverändert; vorheriger Exportabgleich bleibt bestehen. |

Der IF-Ausdruck `YouTube oder TikTok?` liest jetzt das geprüfte `target.platform`. `Zielkonto und Ordner prüfen` leitet `drive_file_id` aus dem vertrauenswürdigen Auftragskontext ab; `Aktuellen Dateistand lesen` verwendet dieses flache Feld. Der bisherige Laufzeitfehler `Cannot access "binding" due to security concerns` ist damit im echten Kontoaufruf behoben. Keine n8n-Sicherheitsprüfung wurde abgeschaltet oder umgangen.

Beim Exportabgleich wurden ausschließlich bekannte ausgelassene Standardwerte normalisiert: `keyName: id`, `source: database` und `mode: once`. Erfolgs-, Fehler-, manuelle und Fortschrittsdaten bleiben ungespeichert; der Timeout beträgt 150 Sekunden, Aufrufe sind auf denselben Eigentümer beschränkt, MCP bleibt aus. Geschützte Originalworkflows und Publisher-Arbeitskopie bleiben unverändert. Dashboard v23 ergänzt die Kontooptionen innerhalb der bestehenden freigegebenen Oberfläche.

## Echte Provider-Nachweise am 3. November 2026

Der unveröffentlichte, isolierte QA-Workflow `9o3GxmGI6jdhgjzG` las die bestehende aktive Kundenzuordnung frisch aus Supabase und übergab nur diesen serverseitigen Kontext an den Kontoworkflow. Der frühere stornierte Auftrag wurde nicht erneut verwendet. Die QA-Einstellungen wurden vor dem Lauf kontrolliert: keine Speicherung von Ausführungsdaten. Nach den beiden Läufen wurden die flüchtigen Anzeigen geleert und der QA-Workflow archiviert.

| Portal | Unterausführung | Prüfergebnis |
| --- | --- | --- |
| YouTube | `4028`, Nachweis `2026-11-03T13:57:40.815Z` | `ok:true`; authentifizierte Kanal-ID stimmt; `youtube.upload` durch Introspection bestätigt. |
| TikTok | `4030`, Nachweis `2026-11-03T13:59:10.154Z` | `ok:true`; `open_id` stimmt; `video.publish` und `user.info.basic` bestätigt; aktuelle Creator-Optionen gelesen. |

Beide erfolgreichen Ergebnisse setzen im veröffentlichten Workflow die erfolgreiche Tokenantwort, das bedingte Speichern, das unabhängige Rücklesen und den abgeschlossenen Sperrübergang voraus. Nach jedem Lauf wurde die Datenbank geprüft: Beide Kontosperren stehen auf `idle`, ohne Lease, mit jeweils einem Versuch. Es gab keinen unklaren Refresh und keine automatische Wiederholung.

TikTok lieferte für das geprüfte Konto die Sichtbarkeiten `FOLLOWER_OF_CREATOR`, `MUTUAL_FOLLOW_FRIENDS` und `SELF_ONLY`; Kommentare waren erlaubt, Duett und Stitch deaktiviert, die maximale Videodauer betrug 3600 Sekunden. Das sind kontospezifische Momentaufnahmen und keine allgemeine TikTok-Freigabe. Die Nachweise gelten jeweils höchstens fünf Minuten und werden beim nächsten Vorgang erneut erhoben.

Beide Antworten enthalten `can_upload:false` und `can_publish:false`. Es wurde kein Inhalt hochgeladen oder veröffentlicht, keine finale Freigabe erteilt und kein neuer Veröffentlichungsauftrag angelegt. Die 274 Node-Tests wurden erneut ausgeführt: alle bestanden.

## Dashboard-Abnahme und Bereitstellung

PR #46 wurde am 3. November 2026 mit Merge-Commit `d76021fa67751d4b823a05b22c3f83439ec85f9f` in `website-v1` zusammengeführt. [GitHub-Pages-Lauf 41651819816](https://github.com/sma-automation/sma-automation.github.io/actions/runs/41651819816) endete erfolgreich. Im angemeldeten Kundendashboard wurden beide Optimierungsseiten mit `v=23` tatsächlich geladen.

| Portal | Dashboard-Abnahme |
| --- | --- |
| YouTube | Echtes Zielkonto geladen; Sichtbarkeit und Kennzeichnungen zunächst ohne Vorauswahl. Ein separater Testauftrag mit Privat, nicht speziell für Kinder und synthetische Inhalte wurde vorbereitet. Erneuter Kontonachweis: `2026-11-03T14:17:04.995Z`. |
| TikTok | Nur Follower, Freunde und Nur ich angeboten; Duett und Stitch gemäß Creator-Antwort fest auf deaktiviert. Ein separater Testauftrag mit Nur ich, erlaubten Kommentaren und ohne Werbung wurde vorbereitet. Erneuter Kontonachweis: `2026-11-03T14:18:25.825Z`. |

Beide Aufträge erreichten `prepared`; Supabase bestätigte die gewählten Optionen, aktuellen kontogebundenen Nachweise und `approved_at:null`. Die finale Zustimmungsbox blieb unangekreuzt und der Freigabeknopf deaktiviert. Anschließend wurden ausschließlich diese beiden Testaufträge unter Prüfung von Status, fehlender Zustimmung, fehlender Lease und fehlendem Journaleintrag auf `cancelled` gesetzt. Kein Upload, keine Veröffentlichung und kein Journaleintrag wurden ausgelöst. Die Testkennzeichnungen sind keine inhaltliche Freigabe des Videos. Gespeicherte Beitragstexte, geschützte Originalworkflows und das freigegebene Layout bleiben erhalten.

## Vertrag

- `account` liest die eindeutige aktive Kundenzuordnung mit dem Dashboard-JWT. Kundennummer und Zielkonto werden nicht aus dem Browser übernommen. Der neue Unterworkflow erhält ausschließlich den serverseitigen Kontext.
- YouTube: vorhandenen Zugang erneuern, genau einen authentifizierten Kanal mit `mine=true` laden, ID abgleichen und `youtube.upload` über Token-Introspection nachweisen. Ein Leserecht allein genügt nicht.
- TikTok: vorhandenen Zugang erneuern; `open_id`, `user.info.basic`, `video.publish` und aktuelle Creator-Info prüfen. Sichtbarkeit, gesperrte Interaktionen und maximale Dauer kommen vom Portal.
- Die veröffentlichte Dashboard-Erweiterung lädt die Kontooptionen vor der Auswahl. Sichtbarkeit bleibt ohne Vorauswahl. Vom TikTok-Konto gesperrte Interaktionen können nicht aktiviert werden. Private Werbung für Dritte wird abgewiesen.
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

274 Node-Tests bestanden. Die beiden SQL-Prüfreihen `publication-accounts.sql` und `publication-orders.sql` bestanden in PGlite 0.5.14 / PostgreSQL 18.6. Sie verwenden die echten Publikations-SQL-Definitionen, eine minimale Auth-/Kunden-Testtabelle und zurückgerollte synthetische Datensätze. Geprüft werden Eigentümerrechte, parallele Claims, unsichere Refresh-Ergebnisse, verlorene/alte Leases, Ratenbegrenzung, fehlende/veraltete Nachweise, TikTok-Optionen, doppelte Freigaben sowie weiterbestehende Medienblocker. Beide Prüfreihen bestanden zusätzlich auf der produktiven Supabase-Instanz mit PostgreSQL 17 und Rollback. Die echten Provider-Kontodurchläufe sind zusätzlich wie oben dokumentiert erfolgreich abgeschlossen. PGlite prüft die SQL-Sperrübergänge sequenziell, nicht mit mehreren gleichzeitig laufenden Datenbankverbindungen.

## Nächster Umsetzungsschritt

Die Statusanzeige für administrativ stornierte Aufträge ergänzen: Ein erneuter Statusabruf nach der Testbereinigung zeigt derzeit die allgemeine Fehlermeldung, weil der Browserclient den terminalen Zustand `cancelled` noch nicht akzeptiert. Die Datenbankstornierung beider Testaufträge ist bestätigt; der offene Dialog wurde geschlossen. Diese Anzeige ist keine fehlgeschlagene Kontoprüfung oder Veröffentlichung.

Verbleibende Mediennachweise, Meta-Berechtigungen, TikTok-Freigabehinweise einschließlich Musik-/Werbekennzeichnung, Upload-Übergabe und Provider-Statusnachweise fertigstellen. Die Kontovorlage besitzt keinen Upload- oder Publish-Endpunkt. Eine endgültige Veröffentlichungsfreigabe bleibt eine bewusste Entscheidung des Nutzers.

Die frühere Browserstörung war in dieser Fortsetzung ausreichend behoben, um beide Korrekturen und Provider-Tests auszuführen. Einzelne verzögerte Browseraktionen wurden anhand des tatsächlichen Seitenstands überprüft. Daraus folgt kein belegter Fehler in den PC-Einstellungen des Nutzers.

## Primärquellen

- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://googleapis.github.io/google-api-python-client/docs/dyn/oauth2_v2.html
- https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
- https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
