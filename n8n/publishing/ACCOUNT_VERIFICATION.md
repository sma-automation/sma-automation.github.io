# Zielkonto und Portalberechtigungen

Stand: 2026-11-03. **Anschlusskorrektur und Kontoprüfungen abgeschlossen (#46), Storno-Korrektur live abgenommen (#49), technische Videonachweise aus #50 veröffentlicht und mit dem ausgewählten echten Video erfolgreich geprüft. Die Medienbestätigungen aus #53 sind mit Dashboard v28 live und im TikTok-Auftrag geprüft; siehe [PUBLICATION_ORDERS.md](PUBLICATION_ORDERS.md#live-abnahme-der-medienbestätigungen--3-november-2026).**

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

## Stornierte Aufträge

Der Browserclient akzeptiert den terminalen Zustand `cancelled` und zeigt eine eindeutige Stornomeldung. Ein Statusabruf ersetzt auch eine zuvor bereits angekreuzte Vorschau: Zustimmung wird zurückgesetzt, Zustimmung und Freigabeknopf verschwinden, und eine erneute Statusabfrage wird nicht angeboten. Das Schließen und erneute Öffnen beginnt mit einer neuen Auftrags-ID. Ziel-/Dateibindung, Eigentümerprüfung und die gesperrten Upload-/Publish-Antworten bleiben maßgeblich.

Regressionen prüfen den Übergang von einer bestätigungsbereiten Vorschau zur Stornierung, die gesperrte erneute Zustimmung, den Erhalt der Bindungsprüfungen und den neuen Auftrag nach Wiederöffnen. Die Änderung betrifft ausschließlich Zustandsbehandlung und Meldung; CSS und Layout werden nicht geändert.

PR #49 wurde mit Merge-Commit `56bcf76823dce5684c3c96f2b4c2e9e6235a64fa` bereitgestellt. [Pages-Lauf 41658417267](https://github.com/sma-automation/sma-automation.github.io/actions/runs/41658417267) war erfolgreich; der Browser lud tatsächlich `v=25`. Alle 276 Node-Tests bestanden. Der CSS-Blob blieb unverändert (`5a985f88acc0e810869234d93afbc570441f7cf5`).

Live-Abnahme am 3. November 2026: Ein eigener YouTube-Testauftrag wurde um 14:57 UTC vorbereitet, ohne angekreuzte Zustimmung oder Freigabe. Nur dieser Auftrag wurde nach Prüfung von `prepared`, `approved_at:null`, fehlender Lease und fehlendem Journaleintrag storniert. „Status erneut laden“ zeigte anschließend die Stornomeldung und ausschließlich „Schließen“; Zustimmung, Freigabe und Statusabfrage waren verschwunden. Der Dialog wurde geschlossen. Kein Upload und keine Veröffentlichung.

## Technische Videonachweise – 3. November 2026

PR #50 ergänzt vollständige FFmpeg-Decodierung, Codec, Pixelformat, Abmessungen, rationale Bildrate, Anzahl decodierter Frames, minimale/maximale Frame-Abstände und optionale Audio-/Bitratendaten. `sma-video-evidence-v3` bindet diese geschlossenen, typisierten Felder an die tatsächlich geladenen Videobytes und die Quellrevision. Fehlgeschlagene oder unvollständige Decodierung liefert keinen Nachweis. Fehlende Bitraten bleiben unbekannt.

- n8n-Workflow `a1F5Ps0B3sXMh70S` wurde als Version `4e2287ac-751c-4cd9-a2fa-4f9d2a37f642` veröffentlicht. Der gespeicherte Export stimmt bei allen 52 Knotenparametern mit der generierten Vorlage überein (HTTP-GET-Standardwert normalisiert). Verbindungen, Knoten-IDs, Positionen, Credentials und private Ausführungseinstellungen entsprechen exakt dem vorherigen Export. Nur 20 Code-Felder wurden aktualisiert.
- Isolierter, unveröffentlichter QA-Workflow `9XKreTHHGR3Agtwd`: alle 17 Schritte erfolgreich mit einem synthetischen 8-Sekunden-Video, H.264, 640 × 360, 12 fps, 96 Frames, AAC 16 kHz mono. Temporärer Container nachweislich entfernt; keine Kundenmedien verwendet. Nachweis: [video-technical-synthetic-20261103.json](validation/video-technical-synthetic-20261103.json). 12 fps sind ausdrücklich keine erfolgreiche TikTok-Bildratenprüfung.
- Migration `publication_video_technical_evidence_20261103` ist auf Supabase eingespielt. Eine Transaktionssperre und Prüfung auf laufende Analyse-Leases schützen den Versionswechsel. Reihenfolge: `publication-video-technical.sql`, `publication-video-magic.sql`, `publication-media-profiles.sql`.
- Neue Analysepolicy: `magic-video-2026-11-03.1`. Ergebnisse früherer Versionen bleiben erhalten, zählen jedoch nicht als technische Nachweise. Eigentümer, aktive Kundenzuordnung, Dateirevision, SHA-256 und Byteanzahl werden unabhängig in SQL geprüft.
- TikTok verwendet die verifizierten Codec-, Abmessungs- und Bildratendaten. Die Frame-Abstände müssen ebenfalls im zulässigen Bereich liegen; ein passender Mittelwert allein genügt nicht. Vollständige Decodierung kann `BINARY_INSPECTION` erfüllen. Andere inhaltliche, kontoabhängige und finale Freigaben bleiben erforderlich.
- 278 Node-Tests, drei echte FFmpeg-/Python-Tests und beide SQL-Prüfreihen bestanden lokal. Beide SQL-Prüfreihen bestanden zusätzlich auf der produktiven Datenbank mit ausschließlich synthetischen, zurückgerollten Daten. Fälle umfassen beschädigte MP4-Dateien, rationale Bildraten, variable Frame-Abstände, ungültige Nenner, fremde Eigentümer, alte Revisionen und falsche Byteanzahl.
- Die Oberfläche ändert ausschließlich Analysepolicy und Cacheversion (Dashboard v26, Vorschau-JS v25). Schrift, CSS und Darstellung bleiben unverändert. PR #50 ist mit Merge-Commit `156f2f6455f67c458ad62a9d8e6f3b330eb9d9ab` zusammengeführt; [Pages-Lauf 41667532087](https://github.com/sma-automation/sma-automation.github.io/actions/runs/41667532087) war erfolgreich. Das Dashboard lud tatsächlich `v=26`; der CSS-Blob bleibt `5a985f88acc0e810869234d93afbc570441f7cf5`.

### Echte Video-Abnahme

Die separate Erkennung wurde im angemeldeten Dashboard-Kontext für die bereits ausgewählte MP4-Datei gestartet; keine automatische Texterstellung und keine Übernahme in gespeicherte Beiträge. Abschluss am 3. November 2026 um 15:51:46 UTC, Policy `magic-video-2026-11-03.1`, Status `completed`, Lease vollständig freigegeben.

| Nachweis | Ergebnis |
| --- | --- |
| Bytes / Format | 1.347.227 Byte; H.264 / yuv420p |
| Decodierte Abmessungen | 720 × 1280 Pixel |
| Bildrate | 24/1 fps; 241 vollständig decodierte Frames |
| Frame-Abstände | 41.666–41.667 Mikrosekunden |
| Videobitrate | 1.070.396 Bit/s |
| Audio | Keine Tonspur; sämtliche Audiofelder korrekt null |
| TikTok-Technik | `VIDEO_FRAMERATE`, `VIDEO_CODEC`, `VIDEO_DIMENSIONS`, `BINARY_INSPECTION` jeweils `pass` |
| Gesamtergebnis | `needs_review`, `can_publish:false` |

Die Live-Anzeige unter „Vorschau für TikTok → Dateidetails“ zeigte die vier neuen technischen Nachweise als „Geprüft“; die offenen Inhalts-/Freigabepunkte und der Sightengine-Tarifhinweis blieben sichtbar. Auch die berichtigte H.264-Empfehlung wurde im Dashboard verifiziert.

Der Prüfsummenvergleich sämtlicher gespeicherten Vorschauen vor und nach dem Lauf war identisch. Die tatsächliche Quelldatei wurde aus dem zugeordneten Drive-Kundenordner geladen; die Drive-Anbindung ist für diesen geprüften Pfad funktionsfähig. Es wurde kein Veröffentlichungsauftrag vorbereitet, kein Inhalt an YouTube/TikTok hochgeladen und keine finale Zustimmung erteilt.

Der alte MP4-Empfehlungstext behauptete nach erfolgreicher Codecprüfung weiterhin, der Codec müsse noch geprüft werden. Er nennt jetzt ausschließlich die H.264-Empfehlung. Diese Textkorrektur ist mit Migration `publication_video_recommendation_wording_20261103` live; die Medienprofil-Prüfreihe bestand danach erneut. Keine CSS-, Layout- oder Schriftänderung.

Die technische Decodierung ersetzt keine visuelle Sicherheitsprüfung. Der bestehende Sightengine-Zugang meldet für Video weiterhin `VIDEO_PLAN_REQUIRED`; es wurde kein kostenpflichtiger Plan eingerichtet. Die finale Veröffentlichungszustimmung wurde nicht erteilt, `can_publish` bleibt false.

## Nächster Umsetzungsschritt

Die TikTok-Musik-/Werbebestätigungen sind seit #53 eingebunden und live geprüft. Auch der zuvor dauerhaft offene Creator-Mediencheck berücksichtigt nun den frischen, auftragsgebundenen Kontonachweis; [Umsetzung und Live-Abnahme](PUBLICATION_ORDERS.md#kontogebundener-tiktok-mediencheck--3-november-2026). Verbleibende Medien-/Inhaltsnachweise, Meta-Berechtigungen, Upload-Übergabe und Provider-Statusnachweise bleiben offen. Die Kontovorlage besitzt keinen Upload- oder Publish-Endpunkt. Eine endgültige Veröffentlichungsfreigabe bleibt eine bewusste Entscheidung des Nutzers.

Die frühere Browserstörung war in dieser Fortsetzung ausreichend behoben, um beide Korrekturen und Provider-Tests auszuführen. Einzelne verzögerte Browseraktionen wurden anhand des tatsächlichen Seitenstands überprüft. Daraus folgt kein belegter Fehler in den PC-Einstellungen des Nutzers.

## Primärquellen

- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://googleapis.github.io/google-api-python-client/docs/dyn/oauth2_v2.html
- https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token
- https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info
- https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info
- https://developers.tiktok.com/docs/en/content-sharing-guidelines


## Fortsetzung: gebundene Medienbestätigungen

Die neue Auftragsänderung ist in [PUBLICATION_ORDERS.md](PUBLICATION_ORDERS.md#medienbestätigungen-und-tiktok-hinweise--3-november-2026) dokumentiert. Sie ergänzt ausdrückliche Erklärungen zu Inhalt, Medienrechten und Musik sowie TikTok-Musik-/Werbehinweise. Automatische Medienblocker einschließlich Sightengine bleiben bestehen. Die vier Portalgalerien aus PR #52 sowie Schrift und CSS bleiben unverändert. Es wurden weder ein Tarifwechsel noch eine Social-Media-Veröffentlichung freigegeben.
