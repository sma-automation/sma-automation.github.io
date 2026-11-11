# Technische Dateifakten für die Serverübernahme

Stand 2. November 2026. Das Modul `media-byte-probe.cjs` prüft lokal die übergebenen Bytes mit FFprobe. Es ist als separater Baustein implementiert und mit erzeugten MP4- und PNG-Dateien getestet, aber noch nicht an n8n, Datenbank oder Dashboard angeschlossen. Es gibt keinen neuen Dienst, Tarif oder veröffentlichten Endpunkt.

## Nutzung im späteren Worker

```js
const {probeBytes} = require('./media-byte-probe.cjs');
const facts = probeBytes(verifiedBytes, {
  size_bytes: verifiedSize,
  content_sha256: verifiedSha256
});
```

Der aufrufende vertrauenswürdige Worker muss den Auftrag, Kundenbesitz, aktuellen Dateistand und Download bereits geprüft haben. Die erwartete SHA-256 kommt aus dieser Prüfung; die Prüfsumme allein ist keine Berechtigung. Das Modul nimmt ausschließlich einen Buffer an, weder Pfade noch URLs. Es erstellt eine eigene Kopie, prüft Größe und SHA-256 und übergibt dieselben Bytes über die Standardeingabe an FFprobe. Die Größe muss kleiner als 50 MB sein. FFprobe wird ohne Shell gestartet; nur das Pipe-Protokoll und die Containerleser MOV/MP4, Matroska/WebM sowie PNG/JPEG/WebP sind zugelassen. Untertitel, weitere visuelle Streams und nicht unterstützte Formate bleiben unvollständig.

Die Ausgabe `sma.media-facts.v1`, Profil `ffprobe-facts-2026-11-02.1`, enthält SHA-256, Bytegröße, Containerfamilie, Dauer, Bitrate sowie Streamfakten. Bei Video: Codec, gespeicherte Breite/Höhe, durchschnittliche und nominelle Bildrate, Pixelformat und gegebenenfalls Rotation. Bei Ton: Vorhandensein, Codec, Abtastrate und Kanäle. Unbekannte Werte bleiben `null`. Rotierte Videos benötigen bei der späteren Profilprüfung eine getrennte Auswertung der Anzeigegeometrie; Bildraten von Einzelbildern werden nicht als echte Bildrate ausgegeben. MP4 und MOV teilen dieselbe Containerfamilie; diese Ausgabe allein beweist kein bestimmtes Dateiformatprofil. Tags, EXIF, Dateinamen, Pfade und rohe Prozessfehler werden nicht zurückgegeben.

Die Laufzeit ist auf 15 Sekunden und die Prozessausgabe auf 256 KiB begrenzt. `max_alloc` begrenzt einen einzelnen Speicherblock, nicht den gesamten Prozess. Die spätere Serverausführung benötigt zusätzlich einen isolierten Worker mit CPU-/Gesamtspeicherlimit, ohne Netzwerkzugriff und ohne Kundengeheimnisse oder andere Dateisystemzugriffe. FFprobe ist eine externe Systemabhängigkeit: eine gepflegte, vom Betreiber fixierte Version muss vorhanden sein; der aktuelle Integrationstest verwendete FFprobe/FFmpeg 6.1.1. Ein fehlendes Programm ergibt `PROBE_UNAVAILABLE`; Prozessfehler, Timeout oder zu große Ausgabe ergeben `PROBE_FAILED`. Unvollständige Ergebnisse ergeben `PROBE_INCOMPLETE`. Keine Meldung enthält die rohe Prozessausgabe.

## Aussagegrenze und Anschluss

Diese Stufe liest Container- und Streamheader. Sie dekodiert nicht das gesamte Video, prüft keine tatsächliche variable Bildratenverteilung, keine Sprachverständlichkeit und keinen Medieninhalt. `full_decode:false`, `content_reviewed:false` und `can_publish:false` bleiben ausdrücklich erhalten. Eine vorhandene Tonspur beweist weder Sprache noch Musikrechte. OCR, Transkript und Aussagenabgleich bleiben eigene Arbeitsschritte. Der bestehende Sightengine-Videopfad bleibt gesperrt.

Für den Live-Anschluss fehlen der isolierte Serverworker und authentifizierte Transport, die Reservierung und Speicherung der neuen Fakten mit Dateiversion und Auftragsbindung sowie die abgestimmte Übernahme in Portalprofile und Oberfläche. Nach der Prüfung muss der Worker erneut den aktuellen Drive-Stand und die Eigentümerzuordnung bestätigen. Alte Metadatenprüfungen dürfen nicht nachträglich als Byteprüfung gelten. Ein Prozessresultat darf keine Publisher-Freigabe oder Benutzerbehauptungen übernehmen. Ein zusätzliches Anbieter-Abo ist für diesen lokalen Baustein nicht erforderlich; Serverbetrieb und Rechenaufwand bleiben beim Betreiber.

## Prüfung

```sh
SMA_FFPROBE_INTEGRATION=1 node --test tests/*.test.cjs
```

Der Integrationstest erzeugt ein einsekündiges H.264/AAC-Video und ein PNG lokal, prüft die tatsächlichen Bytes und weist eine Playlist mit fremder URL ab. Weitere Tests prüfen fehlende Angaben, mehrdeutige Streams, unbekannte Container, Prüfsummen, Rotationsangaben, Tonspur, unbekannte Werte und die bereinigte Ausgabe. Ohne `SMA_FFPROBE_INTEGRATION=1` bleiben die reinen Vertragsprüfungen aktiv; der explizite Integrationstest wird übersprungen. Keine Kundendateien oder Anbieteraufrufe.

Quellen: https://www.ffmpeg.org/ffprobe.html (`show_entries`, JSON-Ausgabe), https://ffmpeg.org/ffprobe-all.html (Protokoll- und Formatbegrenzung). Optionen zusätzlich gegen die lokal installierte FFprobe-Hilfe geprüft.
