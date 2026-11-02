# Lokale Spracherkennung für die Serverübernahme

Stand 2. November 2026. `speech_transcription.py` ergänzt die vorbereiteten Medienmodule um ein lokal ausführbares Transkript mit Zeitmarken. Die Verarbeitung wurde tatsächlich mit einem lokalen Whisper-Modell und einem elfsekündigen öffentlichen englischen Sprachbeispiel ausgeführt. Das ist ein Funktionsnachweis, keine Qualitätsmessung auf Kundenvideos. Zusätzlich wurde ein 2,2-sekündiges deutsches Aussprachebeispiel korrekt erkannt. Auch dieser kurze Test ist keine Qualitätsmessung für deutsche Kundenvideos. Ein Live-Anschluss an SMA besteht noch nicht.

## Ablauf und Aufruf

Der spätere vertrauenswürdige Worker prüft zuerst Auftrag, Kundenbesitz und aktuellen Drive-Stand. Er übergibt die heruntergeladenen Bytes über stdin sowie die unabhängig geprüfte Bytegröße und SHA-256. Sprache und Modellverzeichnis sind Betreiberkonfiguration, keine frei übernehmbaren Browserwerte.

```sh
python n8n/publishing/speech_transcription.py \
  --model-dir /opt/sma/models/whisper \
  --language de --size-bytes VERIFIED_SIZE --sha256 VERIFIED_SHA256 \
  < verified-input.mp4
```

Das CLI gibt genau ein JSON-Ergebnis mit `ok` sowie `evidence` oder einem bereinigten Fehlercode aus. Eine falsche Inhaltskennung wird vor Dekodierung und Modelllauf abgewiesen. Rohfehler und Kundentexte werden nicht als Diagnoseprotokoll ausgegeben. Der spätere Aufrufer darf das Transkript nicht in n8n-Ausführungslogs speichern.

Die Eingangsfamilien sind PCM-WAV und MP4/MOV beziehungsweise Matroska/WebM mit genau einer Tonspur, kleiner als 50 MB und kürzer als 60 Sekunden. Container mit unbekannter Dauer bleiben offen; nicht über stdin lesbare Dateien werden abgewiesen. WAV-Dauer und vollständige PCM-Datenlänge werden zusätzlich mit dem WAV-Parser geprüft. FFprobe und FFmpeg erhalten ausschließlich die übergebenen Bytes über Pipes, feste Format-/Protokollgrenzen und keine Shell. Fehlende oder mehrere Tonspuren werden nicht stillschweigend durch eine Ersatzquelle oder die erste gefundene Sprache ersetzt. Das Programm verarbeitet keine URLs und lädt im Transkriptionslauf keine Modelle herunter.

FFmpeg dekodiert die ausgewählte Tonspur in Mono-Float32 mit 16 kHz. Ein begrenztes Dekodierfenster von 61 Sekunden dient dazu, Dateien mit tatsächlich zu langer Tonspur zu erkennen; das Ergebnis muss kürzer als 60 Sekunden sein. Abweichungen zwischen Container- und dekodierter Dauer über 250 ms ergeben `AUDIO_INCOMPLETE`. Diese Toleranz ist keine Garantie für samplegenau vollständige Audioabdeckung. Nicht lesbare, beschädigte oder unvollständige Dateien ergeben keine erfolgreiche Inhaltsprüfung.

## Modell und Ergebnisbindung

Der Betreiber stellt ein unveränderliches lokales CTranslate2-Whisper-Modell bereit: `model.bin`, `config.json`, `tokenizer.json` und mindestens `vocabulary.txt` oder `vocabulary.json`. Eine vorhandene `preprocessor_config.json` wird ebenfalls gehasht; andernfalls gelten die Defaults der erfassten Engineversion. Die benötigte lokale Tokenizerdatei verhindert einen impliziten Tokenizer-Download. Der Lauf setzt die Offlinevariablen; zusätzlich muss der Betreiber den Netzwerkzugriff des Workers sperren.

Vor und nach dem Lauf werden die Modellprüfsummen verglichen. Einzelne Modelldateien dürfen keine Symlinks sein; auch das Verzeichnis selbst ist vom Betreiber schreibgeschützt und vertrauenswürdig bereitzustellen. Das Profil `whisper-speech-2026-11-02.1` bindet Modelldateien, Engineversionen, Sprache, Sampling und Inferenzoptionen in einem zusätzlichen Profilhash. Die Ausgabe `sma.speech-text.v1` enthält außerdem Original-SHA-256 und Bytegröße, dekodierte Dauer, Text und Segmentzeitmarken. Das allein ersetzt keine Benutzer-, Datei- oder Auftragsberechtigung.

Die Inferenz nutzt CPU/int8, zwei Threads, beam_size 5, feste Eingabesprache `de` oder `en`, keine Übersetzung, Temperatur 0 und keinen Kontext aus dem vorherigen Segment. VAD ist hier ausdrücklich aus; es wird damit weder jede Sprachpassage garantiert erkannt noch ein vollständiger Sprecherwechsel erfasst. Das Ergebnis wird vollständig aus dem Segmentgenerator gelesen. Unvollständige, überlappende oder außerhalb der dekodierten Dauer liegende Segmentdaten werden abgewiesen. Grenzen: 500 Segmente und 20.000 Textzeichen. Wahrscheinlichkeits-/Kompressionswerte sind Modellhinweise und keine kalibrierte Wortkonfidenz.

`needs_review:true`, `untrusted_text:true`, `content_verified:false` und `can_publish:false` bleiben immer erhalten. Auch ein leeres Resultat bedeutet nur `no_speech_detected` für diesen Lauf, nicht den Nachweis, dass keine Sprache vorhanden ist. Spracherkennung kann Wörter, Preise, Namen und Aussagen falsch wiedergeben oder Text halluzinieren. Das Transkript wird als abgegrenzte, nicht vertrauenswürdige Medienquelle verwendet; gesprochene Anweisungen dürfen keine Prompts oder Werkzeuge steuern. Produkteigenschaften, Rechte und Übereinstimmung mit dem Portaltext sind damit nicht bestätigt.

## Betrieb

`speech-requirements.lock.txt` fixiert die für den Test installierten Python-Abhängigkeiten. Sie wurden ausschließlich in eine temporäre Testumgebung installiert. Die Modellgewichte gehören nicht in das Repository. Für den Server ist eine eigene isolierte Umgebung aus diesem Lock einzurichten; der Betreiber prüft Aktualität, Lizenzen und Hardwareeignung vor dem Einsatz.

Der Test verwendete faster-whisper 1.2.1 und `Systran/faster-whisper-tiny`, Revision `d90ca5fe260221311c53c58e660288d3deb8d356`, mit CPU/int8. Das kleine Modell ist eine Testwahl, keine Freigabe seiner Qualität für Kundenbeiträge. Die installierten Paketversionen sowie die exakten Modellhashes stehen im Lock beziehungsweise im Ergebnis. Die lokale Modelleinrichtung erfolgte getrennt vom Offline-Transkriptionslauf; das Modul enthält keinen Downloadpfad und keinen bezahlten Ersatzaufruf.

Der Aufrufer muss einen äußeren Timeout für den gesamten Modellprozess setzen, beispielsweise 120 Sekunden. Im Modul sind FFprobe und FFmpeg auf 15 beziehungsweise 20 Sekunden beschränkt. Der Aufrufer begrenzt stdout, etwa auf 1 MiB, und beendet den Prozess bei Überschreitung. Die untergeordneten Prozessausgaben werden derzeit im Arbeitsspeicher gesammelt und nach dem Aufruf auf ihre Größe geprüft; die FFmpeg-Ausgabe ist zusätzlich durch feste Zeit-/Byteparameter begrenzt. `max_alloc` begrenzt nur Einzelallokationen. Ein isolierter Worker braucht darüber hinaus CPU-, Gesamtspeicher- und Parallelitätslimits sowie keinen Netzwerk- oder Fremddateizugriff. Das Modul selbst stellt diese Betriebssystemisolation nicht her.

Fehler: `FILE_CHANGED`, `MEDIA_UNSUPPORTED`, `SPEECH_MODEL_UNAVAILABLE`, `SPEECH_MODEL_CHANGED`, `SPEECH_DEPENDENCY_UNAVAILABLE`, `SPEECH_LANGUAGE_UNSUPPORTED`, `AUDIO_DECODE_FAILED`, `AUDIO_INCOMPLETE`, `AUDIO_MISSING`, `AUDIO_AMBIGUOUS`, `TRANSCRIPT_INCOMPLETE`, `TRANSCRIPT_LIMIT`, `TRANSCRIPTION_FAILED`. Der Abschluss liefert keine rohe Ausnahme. Im späteren Worker müssen Zeitüberschreitung und Prozessabbruch ebenfalls als offen/fehlgeschlagen abgeschlossen werden.

## Verifikation und weiterer Anschluss

```sh
PYTHONPATH=/path/to/test-dependencies \
SMA_FFPROBE_INTEGRATION=1 SMA_SPEECH_INTEGRATION=1 \
SMA_SPEECH_MODEL_DIR=/path/to/local-model \
SMA_SPEECH_TEST_WAV=/path/to/jfk-11000ms.wav \
python tests/publication_speech_test.py -v
```

Der echte Modelltest benötigt die öffentliche JFK-Testdatei aus dem offiziellen OpenAI-Whisper-Repository, lokal in Mono-PCM-WAV mit 16 kHz umgewandelt. Der Test lädt nichts herunter. Die fünf Python-Tests laufen auch über `tests/publication-speech.test.cjs`; ohne Integrationsschalter werden die entsprechenden System-/Modellfälle ausdrücklich übersprungen. Der isolierte Testlauf prüfte echte Transkription, Segmentdaten, Inhaltskennung, Modelländerung, fehlende Modelle, tatsächliche WAV-Dekodierung, beschädigte Dateien, Dauergrenze und das sichere CLI-Fehlerformat. Kein Kundenmedium wurde verwendet.

Weiter offen sind Qualitätsmessung einschließlich Deutsch, verbindliche Modellauswahl durch den Betreiber, der Live-Transport mit Reservierung/Dateiversion/Mandantentrennung sowie Speicherung/Löschung und Anzeige. Danach folgt der semantische Abgleich mit OCR, berechtigten aktuellen Produktdaten und dem bearbeiteten Portaltext. Der Worker muss vor Abschluss erneut den tatsächlichen Drive-Stand und die Kontozuordnung prüfen. Weder ein Transkript noch die vorbereitete Bild-OCR gibt eine Veröffentlichung frei. Bestehende n8n-Workflows, Datenbank und Publisher wurden für diesen Baustein nicht verändert.

Primärquellen: https://github.com/SYSTRAN/faster-whisper (lokale Modelle, Generator), https://pypi.org/project/faster-whisper/1.2.1/ (getestete Paketversion), https://huggingface.co/Systran/faster-whisper-tiny (Testmodell), https://github.com/openai/whisper/blob/main/tests/jfk.flac (öffentliche Testquelle), https://www.ffmpeg.org/ffprobe.html (Stream-/Containerdaten).

## Deutscher Funktionsnachweis

Der zusätzliche Integrationstest verwendet „De-guten Morgen.ogg“ von Jeuwre, Wikimedia Commons, CC BY-SA 4.0: https://commons.wikimedia.org/wiki/File:De-guten_Morgen.ogg, Lizenz https://creativecommons.org/licenses/by-sa/4.0/. Für den Test wurde die Datei lokal in Mono-PCM-WAV mit 16 kHz umgewandelt. Ergebnis des lokalen Modells: „Guten Morgen!“, Dauer 2200 ms. SHA-256 der getesteten WAV-Variante: `cce5ec27e8f7ff3ee6b4c1bc78702aea1324554f1c1f1e174a62f4798c7bc64a`. Die Audiodatei wird nicht im Repository verteilt. Der Test ist über `SMA_SPEECH_GERMAN_INTEGRATION=1` und `SMA_SPEECH_GERMAN_TEST_WAV=/path/to/german.wav` zuschaltbar und lädt keine Datei herunter.
