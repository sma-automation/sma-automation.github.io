# Medieneditor: echter Export V1

Stand: 06.11.2026. Aufbauend auf PR #93 (gespeicherte Bearbeitungsentwürfe).

## Kundenablauf

Content → Content Optimizer → Bearbeitungsentwurf öffnen. Die freigegebenen
Kapitelreiter bleiben erhalten; das fünfte Kapitel **Export** erzeugt aus dem
gespeicherten Stand eine tatsächlich bearbeitete Datei. Zuerst Vorschau abspielen
oder ansehen, dann separat herunterladen oder **Im Kundenordner speichern**.
Die letzten fünf abgeschlossenen Ergebnisse sind eingeklappt abrufbar.

Umgesetzt: Schnitt, Original/9:16/1:1/16:9, Einpassen/Ausschnitt und Position,
Texteinblendung, Lautstärke des Originaltons (0 % entfernt die Tonspur), optionales
Cover aus dem fertig gerenderten Video. Zusätzliche eigene Musik ist in
[MUSIC_AND_EXPORT_COVER.md](MUSIC_AND_EXPORT_COVER.md) beschrieben.

V1-Grenzen: MP4 bis 60 s; JPG/PNG/WebP; Quelle und jedes Ergebnis maximal 24 MB;
Quelle höchstens 4096 Pixel je Seite und 12 MP. Ausgabe H.264/AAC MP4 mit 30 fps
oder PNG; feste Formate 720×1280, 720×720, 1280×720, Original höchstens 1280 Pixel
an der langen Seite. Browser muss während der Verarbeitung geöffnet bleiben.

## Verarbeitung und Ablage

- Single-thread `@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/core@0.12.10`, lokal im
  Browser, ohne neuen bezahlten Renderdienst. Wrapper unverändert unter
  `app/vendor`; Core-Dateien von jsDelivr, vor Ausführung Länge und SHA-256 geprüft.
  Keine Kundendatei wird an jsDelivr gesendet. Lizenzen/Quellen: vendor/NOTICE.md.
- n8n **SMA – Medienexport – Eigene Quelldatei V1**,
  ID `KQpy1Y5M7Br60nJt`, Webhook `sma-publication-editor-source-v1`:
  nur Lesen; Anmeldung, aktives Kundenkonto, Dateieigentümer und Kundenordner,
  Katalogrevision/Prüfsumme, tatsächliche Bytes und erneute Eigentumsprüfung.
  Eine nachträgliche Drive-Metadatenindexierung darf bei identischer SHA-256/MD5
  die gespeicherten Bytes nicht sperren; ohne Prüfsummenrevision bleibt der
  Drive-Versionsabgleich streng. Eigentümer und Katalogrevision werden weiterhin
  vor und nach dem Abruf geprüft.
- n8n-Import übernimmt nicht alle Workflow-Einstellungen. Deshalb anschließend
  explizit v1, keine Speicherung erfolgreicher/fehlgeschlagener/manueller
  Ausführungen und Zwischenstände, Timeout 3 Minuten gesetzt.
- `sma_publication_editor_export_v1`: prepare → vorhandener Geräte-Upload → complete.
  Tabelle `sma_private.publication_editor_exports_v1` mit RLS und ohne direkte
  Rollenrechte. Öffentliche RPCs sind SECURITY INVOKER; private Helfer prüfen
  Eigentümer und besitzen einen leeren search_path.
- Bindung an Quelldatei **und Revision**, gespeicherte Entwurfversion und
  Einstellungen. Fertige Dateien werden zusätzlich mit Upload-ID, Name, Format,
  Bytezahl und Drive-SHA-256 abgeglichen. Kein fremder oder geänderter Dateistand
  kann als Export abgeschlossen werden.
- Ergebnis und Cover erhalten stabile Upload-IDs. Wiederholung im selben Fenster
  setzt das vorhandene Ergebnis fort; bereits abgeschlossene Uploads werden
  wiedererkannt. Kein zweiter Upload durch verlorene Abschlussantwort.
- Ablage ausschließlich über den bestehenden Geräte-Upload in **02 Verarbeitung**,
  niemals im automatisch überwachten Eingang **01 Upload**. Original bleibt erhalten.
- Ein Export ist **keine** Medien-, Inhalts- oder Veröffentlichungsfreigabe. Er wird
  als neue Vorbereitungsdatei verfügbar und kann anschließend regulär ausgewählt
  und geprüft werden. Keine automatischen Social-Media-Aktionen.

## Prüfstand

- 548 Node-Tests; 79 neue Export-SQL-Prüfungen; sieben Export-DOM-Szenarien.
- 120 bestehende Editor-SQL-Prüfungen; acht Editor-DOM-, 29 History-DOM- und
  acht Dashboard-Kapitel-Szenarien bestanden.
- Echter Browser-WASM-Test mit synthetischer MP4 und Testton: 3 s → Schnitt
  0,5–2,5 s, 720×720, Texteinblendung, AAC, Cover bei Originalsekunde 1.
  Heruntergeladene MP4 separat mit nativem FFmpeg vollständig dekodiert:
  H.264/AAC, exakt 2 s, 642322 Bytes. PNG-Cover dem
  Ergebnisframe bei 0,5 s zugeordnet: mittlere RGB-Abweichung 0,514/255,
  maximal 3/255 zwischen nativem FFmpeg und Browserdecoder; benachbarte Frames
  deutlich abweichend.
- Core 0.12.10 liefert bei erfolgreichem ffprobe `ret=-1`. Deshalb wird je Datei
  ein frischer, eigener JSON-Bericht gelesen; Dateiname, Fehlerfreiheit, Streams,
  Dimensionen, Dauer und Ausgabe-Codecs werden geprüft. Keine alten Berichte.
- Supabase-Migration installiert, authentifizierter Lese-/Quellgate-Test mit
  ROLLBACK erfolgreich. Advisor: keine zusätzliche Warnung; eine zusätzliche
  INFO für die absichtlich gesperrte private Tabelle (41 statt 40).
- Anonymer neuer n8n-Webhook: HTTP 200, `AUTH_REQUIRED`, keine Dateidaten.
- Weitere echte Browserexports: Testbild 9:16 mit Ausschnitt und Text → PNG
  720×1280; stummes Testvideo → MP4 ohne Audiostream, nativ nachgeprüft.
- Angemeldeter Durchlauf am 06.11.2026 abgeschlossen: vorhandenes neutrales
  Testbild → gespeicherter Entwurf Version 1 (1:1, Testtext) → Browserexport →
  **Im Kundenordner speichern** → Seite neu öffnen → **Gespeicherte Ergebnisse**
  → authentifizierter Download. PNG: 720×720, 22582 Bytes, SHA-256
  `d8b57951d8be77322930bf5db1de8425f01665549c70f277da3d27b2f9fbb04d`.
  Heruntergeladene Bytes stimmen exakt mit dem gespeicherten Export überein.
  Genau ein abgeschlossener Export und ein zugehöriger Upload; beide Originale
  weiterhin vorhanden, Revision des Testbilds unverändert.
- Der Live-Test reproduzierte den n8n-Fehler `this.helpers` durch eine eingebettete
  Strict-Mode-Direktive. Nur im Binärdatenknoten wird diese Direktive entfernt;
  die Moduldatei bleibt strikt. Regressionstest führt den eingebetteten Code
  mit globalem n8n-Helfer ohne künstlich gebundenes `this` aus.
  Temporäre Diagnoseknoten nach Prüfung entfernt; keine Ausführungsdaten gespeichert.
- Beim Rücklesen wurde außerdem die oben beschriebene Drive-Metadatenänderung
  sichtbar. Die Prüfsummenbindung ist im Live-Workflow und im Generator korrigiert.

## Export mit gespeicherter Musik abbrechen (06.11.2026)

„Abbrechen“ erreicht jetzt auch den laufenden Abruf aus der Musikbibliothek.
Der Editor gibt die Bedienung unmittelbar frei, selbst wenn ein verspäteter Abruf
seine Antwort noch liefert. Diese Antwort startet weder Originaldatei-Abruf noch
Verarbeitung. Ein erneuter Export lädt die Musik mit einem neuen Abbruchsignal;
bereits vollständig geprüfte Musik und die gespeicherten Einstellungen bleiben
für den nächsten Versuch erhalten. Schließen und Kontowechsel verwerfen ebenfalls
späte Ergebnisse. Die Modulversionen sind bis zum Dashboard-Einstieg angehoben.

Prüfung: 575 Repository-Tests, 33 bestehende Editor-/Export-/Musik-DOM-Szenarien
und vier neue integrierte Abbruch-Szenarien bestanden. Der neue Integrationstest
reproduziert den Fehler auf dem unveränderten Vorgängerstand. Er prüft den echten
Editor-Aufrufweg mit verzögerten Testdaten; kein Provider- oder Kundenexport wurde
dafür ausgeführt. Der Test ist in die bestehenden GitHub-Prüfungen aufgenommen.

## Browserexport im Kundenmedien-Pilot am 15.11.2026

Im angemeldeten SMA-Testkonto wurde die bearbeitete Fassung eines vorhandenen
Dreisekundenvideos über die Dateisuche im Medieneditor geöffnet. Gespeichert
wurden Schnittbeginn bei 0,5 Sekunden, Schnittende bei 2 Sekunden und der
Cover-Zeitpunkt bei 1,5 Sekunden. Im Kapitel **Export** erzeugte **Vorschau
erzeugen** die MP4 und das PNG im Browser. Die Vorschau spielte bis zum Ende.

Beide Download-Schaltflächen lieferten die Dateien. FFmpeg dekodierte die MP4
vollständig. Sie enthielt 45 H.264-Bilder bei 30 Bildern pro Sekunde, war
exakt 1,5 Sekunden lang und hatte eine Auflösung von 1280 × 720 Pixeln.
Das PNG hatte dieselbe Auflösung. Am erwarteten Zeitpunkt von 1,0 Sekunden
im geschnittenen Video betrug die maximale Abweichung zwischen PNG und
dekodiertem Einzelbild zwei Stufen je RGB-Kanal auf einer Skala von 0 bis 255.

Das Video und das Cover wurden ausschließlich lokal geprüft. Der Kundenordner
erhielt keine neue Datei. Nach dem Test wurden die ursprünglichen Zeitfelder
wiederhergestellt und erneut geladen. Im Entwurfsverlauf stehen der Test
als Version 1 und die Rückstellung als Version 2.

## Vorschau abbrechen und erneut starten (15.11.2026)

**Abbrechen** gibt **Vorschau erzeugen** sofort wieder frei, auch wenn die
Entwurfsversion noch geprüft wird. Ein neuer Versuch verwendet ein eigenes
Abbruchsignal. Eine verspätete Antwort oder Fortschrittsmeldung des ersten
Versuchs kann die neue Vorschau weder ersetzen noch deren Bedienung freigeben.

## Texteinblendung in der Standbildvorschau

Die Standbildvorschau zeichnet den Text in den Pixelmaßen des gewählten Ausgabeformats und skaliert ihn mit dem Bild. Vorschau und Export nutzen dieselbe Berechnung für Schriftgröße, Zeilenumbruch, Hintergrund und Position. Das gilt für Originalformat, Hochformat, Quadrat und Querformat.

## Nächster Schritt

Zusätzliche Musik und die Cover-Zuordnung zur Portalvorbereitung sind implementiert;
Prüfstand und nächste Grenzen stehen in [MUSIC_AND_EXPORT_COVER.md](MUSIC_AND_EXPORT_COVER.md). Der echte Export und die sichere Ablage
sind abgeschlossen. Die abgeschlossene Bestandsstrecke nicht erneut beginnen.
PR #57/#69, Shopify-Testmodus und geschützte Originalworkflows unverändert lassen.
