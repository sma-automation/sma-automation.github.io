# SMA – Kostenfreie Medienvorprüfung des Galerie-Testclips

Stand: **11. November 2026** (Europe/Vienna). Diese Bestandsaufnahme ist eine **lesende Offline-Prüfung** für
`SMA_STUMMER_GALERIE_TEST_10S_2026-11-09.mp4`. Sie ist **keine** Kundenfreigabe,
Anbieter-Zertifizierung, vollständige visuelle/semantische Prüfung oder Genehmigung zum Upload.

## Herkunft und Übereinstimmung

Die unveränderte Originaldatei wurde aus dem verbundenen **privaten SMA-Testordner in Google Drive**
gelesen und **nur in einem isolierten Arbeitsbereich** untersucht. Sie wird diesem Repository
weder als Video noch als Bildfolge oder Vorschaubild hinzugefügt.

- Größe: **1.951.847 Byte**.
- SHA-256: lokal berechnet und mit der bestehenden, an **vier Portale** gebundenen Dateirevision
  in `sma_private.publication_files_v1` verglichen: **exakt identisch**.
- Container: **MP4**, ein H.264-Videostream (`avc1`, `yuv420p`).
- Abmessungen: **720 × 1280 Pixel**, Hochformat **9:16**.
- Bildrate: **24 fps**, **240** tatsächlich gelesene Einzelbilder.
- Dauer: **10,000 Sekunden** laut MP4-Dekoder; im Drive-Katalog **9.999 ms** gemeldet
  (Metadatenrundung).
- Videodatenrate: etwa **1,56 Mbit/s**.
- Audio: **keine Audiospur**.
- Vollständiges Decoding mit FFmpeg `-xerror`: **ohne gemeldeten Dekodierfehler**.

Die technische Evidenz war bereits über den an Prüfsumme und Kunden gebundenen
`sma_private.publication_video_technical_v1`-Leseweg vorhanden. Der unabhängige lokale
Decoderlauf bestätigt sie; er schreibt **keinen neuen Maschinenbefund** in SMA.

## Visuelle Stichproben und Textabgleich

20 Stichproben über zehn Sekunden (Abstand 0,5 s) zeigen farbige Testbalken, bewegte
Diagonalen, punktierte grafische V-Linien, ein dunkles Textfeld sowie eine kleine
Zeitcodeanzeige. Diese Elemente stimmen mit den bestehenden
YouTube-/TikTok-/Instagram-/Facebook-Entwürfen als **beschreibende Tatsachenbehauptungen**
überein. Die Metadaten bestätigen das fehlende Audio.

Die dauerhaft eingeblendete Testkennung enthält sinngemäß:
**„SMA TESTCLIP“**, **„STUMM / 10 SEKUNDEN“**, **„NUR GALERIE-TEST“** und ausdrücklich
**„KEINE VERÖFFENTLICHUNG“**. Diese Datei bleibt darum **ausschließliches internes
Testmaterial**; sie ist nicht als Demonstration eines echten Provideruploads vorgesehen.

**Grenze:** Ein erfolgreicher vollständiger technischer Decoderlauf und 20 betrachtete
Stichproben beweisen weder die Sicherheit sämtlicher Frames noch urheberrechtliche
Verwertungsrechte, semantische Vollständigkeit oder die Zulässigkeit eines Posts.
Keine persönliche Kundenerklärung und kein Sightengine-Videoprüfergebnis wurden erzeugt.

## Live-Medienvorprüfung für genau diesen Dateistand (nur gelesen)

Die Ergebnisse stammen aus der unveränderten privaten PostgreSQL-Funktion
`sma_private.publication_media_precheck_v1`; alle Rückgaben enthalten
`can_publish=false`.

| Portal | Bestanden | Fehler | Weiterhin offen |
| --- | ---: | ---: | --- |
| YouTube | 4 | 0 | Visuelle/semantische Prüfung, persönliche Rechte-/Inhaltsfreigabe und Zielkonto |
| TikTok | 8 | 0 | Aktuelle Creator-Optionen/Dauer, visuelle/semantische Prüfung und finale Freigabe |
| Instagram | 5 | 0 | Konkretes Größenlimit, Codec/Bildrate als Portalcheck, Audioprofil, visuelle/semantische Prüfung und Meta-Anbindung |
| Facebook | 2 | 0 | Gewählter Veröffentlichungsweg samt Formatprofil, visuelle/semantische Prüfung und Meta-Anbindung |

**Präzisierung:** Die SHA-gebundene technische Quelle kennt bereits **H.264 und 24 fps**,
die Instagram-Vorprüfung meldet ihre separaten Codec-/Bildratenchecks derzeit trotzdem
als offen. Das ist eine **Darstellungs-/Vorprüf-Lücke**, nicht der Nachweis eines
ungeeigneten Videos und keinesfalls eine Berechtigung, die offenen Prüfungen
pauschal als bestanden zu markieren. Die Audio-Anforderungen dürfen aus einer
fehlenden Audiospur nicht automatisch als erfüllt gelten. Facebook benötigt zuerst
die konkrete Veröffentlichungsroute.

Für den Testclip ist keine abgeschlossene automatische visuelle Prüfung gespeichert.
Der bisherige kostenlose Sightengine-Tarif meldet für Video weiterhin
`VIDEO_PLAN_REQUIRED`. Der in `docs/MANUAL_MEDIA_REVIEW.md` dokumentierte
**ausdrückliche persönliche Prüfweg** bleibt auf geeignete konkrete YouTube-/TikTok-
Aufträge begrenzt und ersetzt nur zwei dort genau benannte offenen Prüfungen.
Er ist keine allgemeine Ausnahme für Video, Instagram oder Facebook.

## Veröffentlichungs- und Doppelschutz (Bestandskontrolle)

- Neun alte Aufträge: **cancelled**.
- Ein historisch vorbereiteter privater YouTube-Testauftrag: **prepared**,
  Freigabefrist abgelaufen.
- **0** abschließende Kundenfreigaben, **0** Betreiber-Uploadfreigaben,
  **0** Provider-Versuche, **0** Provider-Ereignisse.
- Die private Veröffentlichungsreservierung bindet Kunde, Dateirevision,
  Portal und Zielkonto eindeutig. Getrennte Kundenerklärung,
  Fingerprint-/Operatorfreigabe und frische Medien-/Kontoprüfung bleiben Pflicht.
- **Keine** vorhandenen Datensätze, Kontooptionen, Freigaben, n8n-Workflows oder
  Providerantworten wurden durch diese Bestandsaufnahme geschrieben oder geändert.

## Nächster erlaubter Arbeitsweg

1. **Testclip intern belassen.** Keine Freigabe, kein Upload; niemals aus dem
   Testmaterial einen erfolgreichen realen Providerlauf ableiten.
2. Die noch offenen **technischen Instagram-Vorprüfpunkte** nur gegen bereits
   validierte, dateiversionsgebundene Videofakten auswerten; Audio, Größenlimit,
   Meta-Route und persönliche Prüfungen offen lassen. Eine Codeänderung
   braucht eigene Regressionstests und gesonderte, dokumentierte Migration.
3. Für die spätere echte Abnahme eine **separate, tatsächlich freigegebene
   Kundendatei** verwenden. Eigentümer muss das gesamte Original einschließlich
   Ton eigenständig prüfen, die konkreten Aussagen bestätigen und die
   endgültige auftragsgebundene Freigabe abgeben. Die Betreiberfreigabe ist
   ein zusätzlicher, separat genehmigungspflichtiger Schritt.
4. Erst mit allen bestätigten technischen und persönlichen Voraussetzungen
   einen **ausdrücklich genehmigten privaten YouTube-Uploadtest** erwägen.
   `TikTok SELF_ONLY` und Meta bleiben gesonderte Abnahmen. Unbekannte
   Uploadausgänge nie blind wiederholen.

Referenzen: [Persönlicher Prüfweg](MANUAL_MEDIA_REVIEW.md),
[Technische Videonachweise](../n8n/publishing/VIDEO_EVIDENCE.md),
[Providerjournal und Sperren](../n8n/publishing/PROVIDER_RESULTS.md),
[Provider-Cover-Abnahme](PROVIDER_COVER_ACCEPTANCE.md).
