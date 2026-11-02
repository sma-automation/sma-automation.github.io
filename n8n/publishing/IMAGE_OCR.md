# Bildtext als Inhaltsgrundlage

Stand 2. November 2026. `image-ocr.cjs` ergänzt den vorbereiteten technischen Dateiprüfer aus PR 21 um lokale Texterkennung für einzelne PNG- und JPEG-Bilder. Die Erkennung wurde mit tatsächlich erzeugten englischen und deutschen Textbildern sowie einem leeren Bild ausgeführt. Sie ist noch nicht an n8n, Datenbank, Textgenerierung oder Dashboard angeschlossen. Videoeinblendungen, Sprache und semantischer Aussagenabgleich sind damit nicht implementiert.

## Aufruf durch den späteren Serverworker

```js
const {recognizeImage} = require('./image-ocr.cjs');
const evidence = recognizeImage(verifiedBytes, {
  size_bytes: verifiedSize,
  content_sha256: verifiedSha256
}, {
  language: 'deu+eng',
  tessdata_dir: '/opt/sma/models/tesseract'
});
```

Der Betreiber legt Sprache und Modellverzeichnis fest; Browseranfragen dürfen weder Programm, Pfad noch Modellkonfiguration bestimmen. Der Worker muss Eigentümer, Auftrag, Dateiversion und Downloadberechtigung bereits prüfen. Die Buffer-Kopie wird auf erwartete Größe und SHA-256 geprüft, technisch untersucht und unverändert an Tesseract übergeben. PNG-Animationen und fehlerhafte PNG-Strukturen werden mit der vorhandenen Signaturprüfung ausgeschlossen. Grenzen: höchstens 12 MB, 20 Millionen Pixel, 20 Sekunden OCR-Laufzeit, 1 MiB Prozessausgabe, 2.000 Wörter und 20.000 erkannte Textzeichen. Unterstützt sind Deutsch, Englisch und deren Kombination, sofern die Sprachmodelle vorliegen. WebP, Dokumente, Dateilisten und Videos werden in dieser Stufe nicht angenommen.

Die Ausgabe `sma.image-text.v1` enthält die Inhaltskennung, Bytegröße, Engineversion, Modellprüfsummen, Sprache, Konfiguration, erkannten Text und Wörter mit Position und Konfidenz. Ein zusätzlicher Profilhash bindet Engine, Modelle und Konfiguration. Die Modelle werden vor und nach dem Prozess gehasht; Änderungen ergeben `OCR_MODEL_CHANGED`. Der Betreiber muss das Modellverzeichnis trotzdem schreibgeschützt und unveränderlich bereitstellen. Es gibt keinen Download oder externen Ersatzaufruf im Modul.

Unter 80 Prozent Wortkonfidenz wird `needs_review:true` gesetzt. Dieser Wert ist ein konservativer Hinweis, keine kalibrierte Fehlerwahrscheinlichkeit. Alle Wörter bleiben sichtbar; unsichere Preisangaben werden nicht verworfen oder als verifiziert ausgegeben. `no_text_detected` bedeutet ausschließlich, dass der konkrete Lauf keinen Text erkannt hat. Gedrehter, verdeckter, kleiner, gestalterisch ungewöhnlicher oder schlecht kontrastierter Text kann übersehen werden. Die fest gewählte Segmentierung 11 ist noch nicht an repräsentativen Kundendateien bewertet.

Erkannter Text ist untrusted reference data: Anweisungen im Bild dürfen weder Prompts überschreiben noch Werkzeuge auslösen. Er darf nur als abgegrenzte Medienquelle an eine spätere Vorbereitung übergeben werden. OCR beweist weder korrekte Preise/Verfügbarkeit noch Produkteigenschaften, Nutzungsrechte oder die Übereinstimmung mit einem Portaltext. `untrusted_text:true`, `content_verified:false` und `can_publish:false` bleiben immer erhalten. Es gibt keinen semantischen Freigabescore.

## Betrieb und Datenbehandlung

Benötigt werden FFprobe und Tesseract 5 mit lokal vorgehaltenen Modellen. Getestet: FFprobe 6.1.1, Tesseract 5.3.4, Englisch aus der vorhandenen Systeminstallation und Deutsch aus `tesseract-ocr/tessdata_fast`, Tag `4.1.0`, Datei `deu.traineddata` (SHA-256 `19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d`). Diese Versionen dokumentieren den Test, keine Empfehlung zur dauerhaften Verwendung alter Systempakete. Der Betreiber muss eine gepflegte Version fixieren und erneut prüfen. Lizenzhinweise der eingesetzten Programme und Modelle sind bei der Übergabe mitzuliefern.

Fehlende Sprachdateien ergeben `OCR_LANGUAGE_UNAVAILABLE`; fehlende/unerwartete Engine `OCR_UNAVAILABLE`; Prozessfehler und Timeout `OCR_FAILED`; ungültige Ergebnisdaten `OCR_INCOMPLETE`. Die Ausgabe enthält keine rohen Prozessfehler, Pfade oder Geheimnisse. Ein neues kostenpflichtiges Anbieter-Abo ist nicht erforderlich; Serverbetrieb und Rechenaufwand bleiben beim Betreiber.

Das Modul bietet keinen öffentlich erreichbaren Dienst. Es ist für einen isolierten Worker ohne Netzwerk, ohne Zugang zu anderen Kundendateien und mit CPU-/Gesamtspeicherlimit vorzubereiten. Das Prozesslimit ersetzt diese Isolation nicht. Das Modellverzeichnis ist vertrauenswürdige Betreiberkonfiguration. Das Modul schreibt keine Medien oder OCR-Texte auf Platte und protokolliert sie nicht. Der spätere Aufrufer darf erkannte Texte nicht in n8n-Ausführungslogs schreiben. Falls Speicherung erforderlich wird, sind Mandantentrennung, Dateiversion, Modellprofil, Auftragsbindung und Löschregeln vor dem Anschluss umzusetzen. Ein Modell- oder Dateiaustausch macht alte OCR-Ergebnisse für neue Vorbereitungen unbrauchbar.

## Tests und offene Anschlüsse

```sh
SMA_FFPROBE_INTEGRATION=1 SMA_OCR_INTEGRATION=1 \
SMA_OCR_GERMAN_INTEGRATION=1 SMA_TEST_TESSDATA=/path/to/test-models \
node --test tests/*.test.cjs
```

Ohne die entsprechenden Schalter werden die echten Systemintegrationstests ausdrücklich übersprungen; reine Parserprüfungen bleiben aktiv. Der Testmodellordner benötigt `eng.traineddata` und für den deutschen Test `deu.traineddata`. Die englische Integration verwendet ohne Konfiguration den Ubuntu-Testpfad `/usr/share/tesseract-ocr/5/tessdata`. Die Integration benötigt zusätzlich FFmpeg mit drawtext und die im Test angegebene DejaVu-Schrift; alle Testbilder werden im Arbeitsspeicher erzeugt.

Getestet sind erkannter Text, leere Bilder, Konfidenz, Zeilen-/Positionsbezug, Prüfsummenfehler, fehlende Modelle, ungültige Konfiguration und manipulierte Ergebnisdaten. Keine Kundendateien oder Anbieteraufrufe. Der deutsche Test ist ein synthetischer Funktionsnachweis und keine Qualitätsmessung auf realen Inhalten.

Nächste eigene Arbeitsschritte bleiben ein lokal betriebenes Sprachmodell samt echter Audioprüfung, die Bildtexterkennung über Videostichproben, der Abgleich der erkannten Inhalte mit berechtigten aktuellen Produktdaten und dem Portaltext sowie der Live-Anschluss mit Auftrags- und Mandantenbindung. Der bisherige visuelle Prüfdienst und seine Videosperre werden durch dieses Modul nicht verändert.

Primärquellen: https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html (Sprache, Segmentierung, TSV), https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0 (Testmodell).
