# Portalbezogene Cover-Übergabe

Stand: 06.11.2026; PR #102 zusammengeführt und live. Baut auf [MUSIC_AND_EXPORT_COVER.md](MUSIC_AND_EXPORT_COVER.md)
und [MUSIC_LIBRARY.md](MUSIC_LIBRARY.md) auf.

## Verhalten

| Portal | Übergabe | Zeitpunkt |
| --- | --- | --- |
| TikTok | `post_info.video_cover_timestamp_ms` aus dem fertigen Video | Beim bereits freigegebenen Video-Init |
| YouTube | Geprüfte PNG-Datei über `thumbnails.set` | Nach bestätigter Verarbeitung des Videos, bei der nächsten normalen Statusfortsetzung |
| Instagram/Facebook | Noch nicht angeschlossen | Meta bleibt separat blockiert |

Der Coverzeitpunkt bezieht sich auf die fertige Datei, also `cover_ms - start_ms`.
Am Schnittende gilt dieselbe Begrenzung wie im Exportrenderer (Dauer minus 34 ms).
Die vorhandene eingeklappte Cover-Vorschau unter **Inhalt und Ziel** erläutert
die jeweilige Portalbehandlung. Kapitel, Schrift und Layout bleiben erhalten.

Die Erweiterung erteilt keine Veröffentlichungsfreigabe. Auftragszustand,
Kundenfreigabe, Medienprüfung, frische Kontoprüfung und explizite Operatorfreigabe
bleiben Voraussetzung. Ein normaler Statusabruf kann nur einen bereits so
freigegebenen Auftrag fortsetzen. Es wurde kein Zeitplan/Poller ergänzt.

## Bindung und Wiederholungsschutz

- Beim ersten erfolgreich reservierten Provideraufruf wird das Cover atomar
  mit dem bisherigen Providerjournal an Auftrag und unveränderten Fingerprint
  gebunden. Video- und Coverrevision, Eigentümer, Kunde, abgeschlossener Export,
  Drive-Datei, Größe und SHA-256 müssen passen.
- Auch „kein Cover“ wird festgehalten. Spätere Exporte ändern diese Entscheidung
  nicht. Bereits begonnene alte Aufträge ohne Snapshot bleiben im alten Ablauf.
- TikTok erhält einen Zeitpunkt im Video, keine separat hochgeladene PNG.
- YouTube: Drive-Metadaten lesen, Bild laden, echte Bytes/PNG/Hash prüfen,
  Metadaten erneut prüfen, atomare Cover-Lease reservieren, genau ein HTTP-Aufruf.
  Erst nach bestätigtem Videoergebnis darf diese Lease entstehen.
- Antwort 200 mit gültigem Thumbnail-Ergebnis wird als abgeschlossen gespeichert.
  Definierte Ablehnungen bleiben fehlgeschlagen; fehlende oder unklare Antworten
  bleiben unklar. Kein automatischer Wiederholungsupload, auch nicht nach Timeout.
  Veraltete Leases dürfen spätere Ergebnisse nicht überschreiben.
- Das fertige Video und sein Ergebnis bleiben bei einem Coverfehler erhalten.
  Kein erneuter Video-Init und kein zweiter Video-Upload durch den Coverpfad.

## Dateien und Live-Anbindung

- `n8n/publishing/provider-cover.cjs`: reine Plan-, Request- und Antwortvalidierung.
- `patch-provider-cover.py`: erzeugt eine separate Arbeitskopie aus einem
  ausdrücklich übergebenen, anhand semantischer Hashes geprüften Workflowexport.
  Baseline ist PR #57, Commit `4b846e8525dbed26dbc4ef8907e0050d3fb25464`.
  PR #57 wird dadurch nicht zusammengeführt. Die unter `tests/` gespeicherten
  öffentlichen Baseline-Dateien dienen ausschließlich isolierten Prüfungen.
- Migration `20261106192518_publication_provider_cover_v1.sql` installiert;
  kanonische SQL-Datei und Migration identisch, SHA-256
  `5e6377ef620e4287d9ff67c0768d10a324150a4d3029ee66cf4f14c951c53dc6`.
  Privates Register mit RLS und ohne direkte Tabellenrechte. Öffentlicher Wrapper
  `sma_publication_provider_cover_v1` ausschließlich für `service_role`.
- Separater Workflow **SMA – Auftrag – Provider und Cover V1**, ID
  `JaidX5YeKl6ZTqjQ`: 47 Nodes, veröffentlicht. Kein Scheduler, keine HTTP-Retries,
  keine Redirects. Erfolgs-/Fehler-/manuelle Ausführungsdaten und Fortschritt
  werden nicht gespeichert; 600-s-Timeout, nur Aufrufe desselben Eigentümers,
  kein MCP-Zugriff.
- Auftrags-API `RdtCqCWRi7P4W7B0`: veröffentlicht. Nur der Subworkflow-Verweis
  in **Providerweg im Hintergrund** führt nun zur neuen Kopie; leere UI-generierte
  Inputmapping-Metadaten ändern den weitergereichten Auftrag nicht. Alle übrigen
  32 Nodes, Verbindungen, Einstellungen und bisherigen Guards unverändert.
- Bisheriger Providerworkflow `JPtiMBrudXLxxSrz`: alle 29 Nodes, Verbindungen
  und Einstellungen nach dem verworfenen Importversuch per Exportvergleich
  unverändert. Sein veröffentlichter Stand wurde nicht ersetzt.

## Prüfung ohne Social-Veröffentlichung

- 570 Node-Tests bestanden, zusätzlich 97 neue SQL-Prüfungen in isoliertem
  PGlite. Echtes gepinntes Providerjournal sowie Konto-/Freigabevalidatoren;
  Mediennachweise ausschließlich in dieser lokalen Testdatenbank simuliert.
- Regressionen: Export-SQL 105, History-SQL 62/52, History-DOM 29 und
  Musik/Cover-DOM 7 bestanden. Alle generierten Code-Nodes syntaxgeprüft.
- n8n-Export der neuen Kopie gegen generierte Parameter/Verbindungen geprüft;
  Einstellungen ausdrücklich nachgeprüft. API-Export vor/nach verglichen.
- Bereits abgeschlossener Export `283abd16-3b72-4224-ab66-81b30afdab13`
  rein lesend gebunden: Video `a85fa4cc-b4d9-4998-b97d-e399b74d30ba`,
  Cover `d010523a-c338-4b8f-a53f-fe60875c1e9a`, 465264 PNG-Bytes,
  Zeitpunkt 1000 ms bei 3000 ms Videolänge. Kein neuer Auftrag angelegt.
- Live-Datenbank: 9 bestehende Aufträge, 0 Operatorfreigaben, 0 Providerversuche,
  0 Coverversuche. Bestehende Fingerprint-/Providerfunktionen unverändert
  (`md5(prosrc)` = `5867545f1bdb0e8a7523609fdbbb4a57` bzw.
  `a407894984fc400aa440bdb7bcbaa683`).
- Security-Advisor: bestehende Warnungen 4/6/1 unverändert. INFO 42 → 43 wegen
  der absichtlich nicht direkt zugänglichen privaten Tabelle mit RLS ohne Policy.

**Kein echter Provider-Coveraufruf wurde ausgelöst.** Die technische Anbindung
und Sperren sind geprüft; eine tatsächliche YouTube-/TikTok-Bestätigung steht
bis zu einer separat autorisierten Veröffentlichung noch aus. Der Coverstatus
wird intern geführt; eine eigene Anzeige dieses Ergebnisses in der History ist
noch offen.

## Bereitstellung und angemeldete Anzeige

- Feature-Commit `4aead286dd6e826417c8aa4d317f7102b245820c`, Merge
  `fa7ae3673576adadea3a2f647a6810a1acb2e83c` auf `website-v1`.
  Beide PR-Prüfungen erfolgreich; zusätzliche History-Prüfung nach dem Merge
  ebenfalls erfolgreich. Pages Run `42283109609`, Deployment-Job
  `128117163030` erfolgreich.
- Vorhandenen Export im angemeldeten Portal geöffnet: **Inhalt und Ziel** →
  eingeklapptes **Cover aus deinem Export**. Für YouTube und TikTok jeweils
  passender neuer Hinweis; Bild vollständig geladen (Vorschau 124 × 220),
  gespeicherter Zeitpunkt eine Sekunde. Kapitelwechsel funktioniert unverändert.
- Der ältere Export hat im Dateikatalog weiterhin keine Drive-Videolänge und
  Bildgröße; die vorhandene Warnung und Magic-Effect-Sperre bleiben sichtbar.
  Die Coverbindung nutzt die geprüften abgeschlossenen Exportdaten mit 3000 ms.
  Diese Anzeigeprüfung hat keine Dateiangaben, Texte oder Aufträge verändert.
- Abschlussabfrage weiterhin 9 Aufträge, 0 Operatorfreigaben, 0 Provider- und
  0 Coverversuche. PR #57 und #69 nochmals als offen und ungemergt bestätigt.

## Providergrundlagen

Geprüft am 06.11.2026:
[TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
definiert den Coverzeitpunkt im Video unter `post_info`.
[YouTube thumbnails.set](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set)
unterstützt PNG/JPEG und laut aktueller Dokumentation auch Shorts nach erfolgreicher
Verarbeitung. Die Providergrenze beträgt inzwischen 50 MB; SMA behält die engere
24-MB-Grenze bei. Alte Annahmen „2 MB“ oder „Shorts grundsätzlich ausgeschlossen“
sind für diese Umsetzung nicht maßgeblich.

Bestandsprüfung abgeschlossen. PR #57/#69 separat offen. Shopify-Testmodus und
unveröffentlichte n8n-Originalentwürfe erhalten. Keine Tarifänderung, kein Kauf
und keine Social-Media-Veröffentlichung.
