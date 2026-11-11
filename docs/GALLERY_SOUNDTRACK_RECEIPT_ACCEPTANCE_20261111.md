# SMA – Galerie-Musikvideo: unabhängige Prüfsummen- und Stream-Abnahme

Stand: 11.11.2026. Rein lesende lokale Prüfung ohne Cloud-Aktion, Credits, Upload oder Posting.

## Ausgangspunkt

Die Galerie meldet für den privaten stummen 10-Sekunden-Testclip einen abgeschlossenen Musikauftrag. Der Ergebnis-Upload ist im Kunden-Dateikatalog mit eigener SHA-gebundener Revision bestätigt. Das belegt die Speicherung, aber **nicht automatisch die tatsächliche Audio- und Videodekodierung**. Die Instagram-Prüfung dieser neuen Datei zeigt deshalb zu Recht bisher offene technische Mediennachweise.

## Lokal geprüfte Eingaben

Das ursprüngliche Video und die private AAC-Musikdatei wurden aus der verbundenen SMA-Testablage geholt. Beide SHA-256 stimmen überein.

| Gegenstand | Nachweis |
| --- | --- |
| Original-MP4 | 1.951.847 Bytes; SHA-256 d550d2dc767a613d89717149808678fc1da05b0d18574c34d37ec36541f030be |
| Musik-AAC | 1.063.935 Bytes; SHA-256 1afadc7d45cca3cf17816a3831c82b2909eddee5434d9d8556a2c3db6a1a44de |
| Audio | AAC-LC, 48 kHz, zwei Kanäle |
| Video | H.264, 720×1280, 24 FPS, 10 Sekunden, stummes Original |

Der unveränderte Repository-Renderer n8n/publishing/gallery-soundtrack.cjs wurde zusätzlich über seinen Git-Blob-SHA identifiziert und exakt lokal ausgeführt.

## Offene Übereinstimmung: 114 Bytes Unterschied

Der aktuelle Repository-Renderer erzeugt deterministisch **2.125.633 Bytes** mit SHA-256
0436fb66541088f224ad1116697d5aa67ad7a2a32124d5a5f5a96a91926f4511.

Das am 09.11.2026 gespeicherte Kunden-Galerie-Receipt erwartet dagegen **2.125.747 Bytes** mit SHA-256
aa4f169c20be5b1a1f5a1916d93bb516745f190f5523ddf69a1e8b5f91747074.

Differenz: **114 Bytes**. Der lokale Nachbau ist mit FFprobe lesbar, enthält die unveränderten H.264-Videopakete und einen AAC-LC-Stereo-Stream mit 48 kHz. Die vollständige lokale Dekodierung gelingt. Das beweist aber **nicht**, dass die tatsächlich im Kunden-Drive gespeicherte Fassung identisch oder abspielbar ist.

Die verbundenen Google-Drive-Zugriffsrechte reichen für das private Kundenergebnis nicht aus; die direkte Datei-Abfrage lieferte 404. Eine abweichende historische Browser- oder n8n-Renderingversion ist möglich. Ohne die tatsächlichen Videobytes ist weder Defekt noch vollständiger Erfolg bewiesen.

## Neues Prüfwerkzeug

Datei: n8n/publishing/verify-gallery-output.mjs

Rein lokaler Aufruf mit den berechtigt gespeicherten privaten Dateien:

    node n8n/publishing/verify-gallery-output.mjs ORIGINAL.mp4 MUSIK.aac EXPECTED_SHA256 EXPECTED_BYTES [ACTUAL_SAVED.mp4]

Ohne tatsächliche Ergebnis-MP4 kann das Werkzeug Eingabeprüfsummen und reproduzierte Bytes vergleichen, muss das Produkt aber ausdrücklich als **requires_original_saved_output** offenlassen.

Mit tatsächlicher Ergebnisdatei prüft es zuerst die exakte Übereinstimmung mit den gespeicherten Ergebnis-Bytes (SHA-256 und Größe) und erst danach Video- und Audiostreams: H.264/HEVC, unveränderte Original-Videopakete, AAC-LC Stereo/48 kHz, synchronisierte Länge, Datenrate und vollständige FFmpeg-Dekodierung. Ein anderer Renderer kann andere Binärbytes erzeugen; für die Abnahme zählt deshalb die unabhängig geprüfte tatsächliche Ergebnisdatei, nicht nur ein nachgebauter Clip.

Das Werkzeug benötigt weder Netzwerkanmeldung noch Datenbank-Schreibrechte. CI-Tests verwenden ausschließlich synthetische Repo-Fixtures.

## Sicherheitsgrenzen

Es wurde keine Datei veröffentlicht, kein Provider gestartet, kein Auftrag freigegeben, kein Kundenkonto geändert und kein Musikguthaben abgebucht. Es gab keine neue n8n-Bereitstellung und keine Migration.

**Noch offen vor der Instagram-Abnahme:** die tatsächliche gespeicherte Musikfassung berechtigt abrufen, auf Hash, Ton, Videobild und Wiedergabe prüfen und erst dann technische Evidenz für genau deren eigene Dateirevision hinterlegen. Keine Vererbung der alten stummen Quelldatei-Evidenz; visuelle Sicherheit, Rechte, Meta, persönliche Freigabe und Betreiber-Uploadfreigabe bleiben separat offen.

## Nachtrag: technische Tonsignalprüfung

Beim Abgleich einer **tatsächlich bereitgestellten und per SHA-256 bestätigten**
Ausgabe muss der Offline-Prüfer zusätzlich feststellen, ob die AAC-Tonspur
nicht nur formal vorhanden ist, sondern beim Dekodieren auch einen
messbaren Tonpegel hat. Dies verhindert einen falsch positiven Erfolg,
wenn ein MP4 eine technisch gültige, jedoch vollständig stumme AAC-Spur
enthält.

`verify-gallery-output.mjs` analysiert deshalb den decodierten Audiostream
mit `ffmpeg volumedetect`, protokolliert Mittel- und Spitzenpegel
in dBFS und gibt nur dann `technical_checks_pass` zurück, wenn
ein verlässliches Signal (Mittel über −80 dBFS und Spitze über −65 dBFS)
vorliegt. Extrem leises oder nicht messbares Material bleibt
`technical_checks_incomplete` und wird nicht automatisch verworfen
oder veröffentlicht. Die Schwellen sind eine interne Vorsichtsgrenze,
keine Instagram-Zertifizierung oder musikalische Qualitätsbewertung.

Die vom Nutzer im Chat vorgelegte **AAC-Quelldatei** wurde lokal
mit FFmpeg überprüft: Mittelpegel **−26,2 dBFS**, Spitzenpegel
**−12,8 dBFS**. Diese Messung beweist, dass das Musikmaster hörbare
Tonsignale enthält; sie gilt **nicht** als Messung des gespeicherten
MP4-Endprodukts und ersetzt dessen weiterhin ausstehende Abnahme nicht.

An der produktiven Galerie, den Credits, der Datenbank, dem
Dashboard und den Provider-Berechtigungen ändert dieser Nachtrag nichts.
