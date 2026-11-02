# Videoanalyse im bestehenden n8n: isolierter Integrationstest

Stand 02.11.2026: Der neue Ablauf verarbeitet eine echte MP4-Bytefolge über die vorhandene OpenAI-Anbindung. Ein synthetischer Clip wurde in Einzelbilder und Tonspur zerlegt, transkribiert und visuell beschrieben. Dies ist ein **unveröffentlichter manueller Test**, kein freigeschalteter Dashboard-Endpunkt. Fotoerkennung, Dashboard, Kundendatenbank und bestehende Publisher werden nicht verändert.

## Ablauf und Bindung

1. Die gewählte MP4 muss Größe, SHA-256 und Dateisignatur erfüllen. Im Kunden-Testmodus werden zusätzlich die aktuellen Drive-Metadaten gelesen. Dieser manuelle Modus ersetzt keine Benutzerautorisierung eines späteren Webhooks.
2. Ein ZIP mit genau einem festen Eintrag `source.mp4` wird in einen eigenen temporären OpenAI-Container geladen. Der Container hat 1 GB RAM, deaktivierten Netzwerkzugang und 20 Minuten Inaktivitätsablauf. Keine öffentliche Medien-URL, keine Cloudinary-Freigabe, keine neuen Zugangsdaten.
3. `video-extract.py` prüft die Originalbytes nochmals, decodiert mit ffprobe/ffmpeg und erstellt ein Kontaktblatt mit Zeitmarken, eine PCM-Tonspur und ein Manifest. Die Modellantwort muss genau den vorgegebenen Python-Aufruf einmal ausgeführt haben. Ein bloßer Erfolgstext des Modells genügt nicht: Ausführungsstatus, tatsächliche Tool-Ausgabe und Manifest werden geprüft.
4. Die Ergebnisdateien müssen aus genau diesem Container und den festen Ausgabepfaden stammen. Vom API-Dateikatalog gemeldetes `bytes:null` bleibt unbekannt. Tatsächlich heruntergeladene Bild-/Tonbytes müssen den exakten Größen und SHA-256-Werten des geprüften Manifests entsprechen.
5. `gpt-transcribe` erhält die extrahierte Tonspur. Fehlende Tonspur, leeres Transkript und vorhandener gesprochener Inhalt sind unterschiedliche Zustände. Ein Anbieterfehler wird nicht zu einem erfundenen Transkript.
6. `gpt-5` erhält die tatsächliche Bildfolge und das Transkript als untrusted Inhaltsdaten. Technische Kontaktblatt-Rahmen und Zeitmarken sind ausdrücklich kein Videoinhalt. Beobachtungen, lesbare Aufschriften und Unsicherheiten werden getrennt ausgegeben.
7. Bei erfolgreichem Abschluss wird ausschließlich der für diesen Test angelegte temporäre Container entfernt. Nach Fehlern greift bisher dessen Inaktivitätsablauf. n8n speichert keine erfolgreichen, fehlgeschlagenen oder manuellen Ausführungsdaten und keine Zwischenstände. OpenAI-Antworten werden mit `store:false` angefordert; dies ist keine Aussage über weitergehende Anbieter-Aufbewahrungsregeln.

## Grenzen vor Produktivbetrieb

- MP4 mit SHA-256, bis 24 MB, höchstens 60 Sekunden, ein Videostream, höchstens ein Audiostream, Seitenlänge bis 4096 Pixel. Der normale Dashboard-Upload kann größere Dateien aufnehmen; diese Grenze betrifft ausschließlich den neuen Analysetest.
- Höchstens 21 gleichmäßig verteilte Frames. Das ist Inhaltsmaterial für Beschreibungen, keine lückenlose Sicherheits- oder Portalprüfung.
- Noch kein authentifizierter Video-Webhook, keine Video-Reservierung/Rate-Limits in Supabase, kein finaler Dateistand-Abgleich vor Speicherung, keine automatische Übernahme ins Dashboard. Die vorhandene Fotoerkennung bleibt unverändert.
- Noch kein freigegebener Beitragstext, keine Prüfung eines finalen Posts gegen sämtliche Videoinhalte und keine Portalveröffentlichung. `can_publish:false` und `manual_probe_only:true` sind Bestandteil des Testergebnisses.
- Das vorhandene Kundenvideo wurde **nicht** an OpenAI übertragen. Die automatische Freigabeprüfung verlangt hierfür eine ausdrückliche Zustimmung für Video, Bild-/Tonderivate und OpenAI als Empfänger. Der erreichbare n8n-Test enthält stattdessen ausschließlich selbst erzeugte Formen, einen festen Testschriftzug und künstliche Sprache; keinen Drive-Zugriff und keine Kundendatei-ID.

## Reproduktion

```sh
python tests/make-synthetic-video.py /tmp/synthetic-sma-test.mp4
python n8n/publishing/build-video-evidence-probe.py \
  --synthetic-video /tmp/synthetic-sma-test.mp4 \
  --output /tmp/synthetic-video-probe.json
node --test tests/publication-video-evidence.test.cjs tests/publication-magic-effect.test.cjs
```

Der Fixture-Generator benötigt ffmpeg mit libflite, libx264 und drawtext. Er verwendet keine Aufzeichnung einer echten Person. `--no-audio` erzeugt den separaten Test ohne Tonspur. Die privaten Testparameter des optionalen `--fixture`-Modus sowie exportierte Workflows mit Kundendatei-IDs gehören nicht ins Repository.

Manueller n8n-Test: `Ga4qjgjbpmCoUyGA`, **SMA – Synthetischer Videoanalyse-Test**, 28 Nodes, unveröffentlicht. Beim achtsekündigen Test wurden neun Frames und der Satz „This is a synthetic test, a blue square moves from left to right.“ erkannt. Der temporäre Container wurde anschließend entfernt. 15 relevante Node-Tests bestehen; die lokale ffmpeg-Ausführung mit und ohne Ton wurde zusätzlich geprüft.

Offizielle Grundlagen: [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter), [Container erstellen](https://developers.openai.com/api/reference/resources/containers/methods/create), [Container-Dateien](https://developers.openai.com/api/reference/resources/containers/subresources/files/methods/create), [Transkription](https://developers.openai.com/api/docs/guides/speech-to-text).
