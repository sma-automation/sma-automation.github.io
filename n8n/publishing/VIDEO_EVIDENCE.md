# Videoanalyse im bestehenden n8n: isolierter Integrationstest

Stand 02.11.2026: Der neue Ablauf verarbeitet MP4-Bytefolgen über die vorhandene OpenAI-Anbindung. Ein synthetischer Sprachclip und die vom Nutzer ausdrücklich freigegebene echte MP4 wurden getestet. Dies ist ein **unveröffentlichter manueller Test**, kein freigeschalteter Dashboard-Endpunkt. Fotoerkennung, Dashboard, Kundendatenbank und bestehende Publisher werden nicht verändert.

## Ablauf und Bindung

1. Die gewählte MP4 muss Größe, SHA-256 und Dateisignatur erfüllen. Im Kunden-Testmodus werden zusätzlich die aktuellen Drive-Metadaten gelesen. Dieser manuelle Modus ersetzt keine Benutzerautorisierung eines späteren Webhooks.
2. Ein ZIP mit genau einem festen Eintrag `source.mp4` wird in einen eigenen temporären OpenAI-Container geladen. Der Container hat 1 GB RAM, deaktivierten Netzwerkzugang und 20 Minuten Inaktivitätsablauf. Keine öffentliche Medien-URL, keine Cloudinary-Freigabe, keine neuen Zugangsdaten.
3. `video-extract.py` prüft die Originalbytes nochmals, decodiert mit ffprobe/ffmpeg und erstellt unverzierte Einzelbilder (längste Seite höchstens 1536 Pixel, kein Hochskalieren), eine Kontaktübersicht, gegebenenfalls eine PCM-Tonspur und ein Manifest. Die Modellantwort muss genau den vorgegebenen Python-Aufruf einmal ausgeführt haben. Ein bloßer Erfolgstext des Modells genügt nicht: Ausführungsstatus, tatsächliche Tool-Ausgabe und Manifest werden geprüft.
4. Die Ergebnisdateien müssen aus genau diesem Container und den festen Ausgabepfaden stammen. Vom API-Dateikatalog gemeldetes `bytes:null` bleibt unbekannt. Tatsächlich heruntergeladene Bild-/Tonbytes müssen den exakten Größen und SHA-256-Werten des geprüften Manifests entsprechen.
5. `gpt-transcribe` erhält die extrahierte Tonspur. Fehlende Tonspur, leeres Transkript und vorhandener gesprochener Inhalt sind unterschiedliche Zustände. Ein Anbieterfehler wird nicht zu einem erfundenen Transkript.
6. `gpt-5` erhält jedes geprüfte Einzelbild separat in größerer Auflösung und das Transkript als untrusted Inhaltsdaten. Die kleine Kontaktübersicht dient nur der visuellen Nachprüfung, nicht mehr als alleinige Modellgrundlage. Beobachtungen, lesbare Aufschriften und Unsicherheiten werden getrennt ausgegeben. Das V2-Manifest bindet jeden Frame an festen Namen, Position, Maße, Größe und SHA-256.
7. Ein zweiter Modellaufruf gleicht den Entwurf gegen genau dieselben Frames und dasselbe Transkript ab. Er soll unbelegte Detailbezeichnungen und Wirkbehauptungen entfernen. Auch dieser Abgleich ist eine Modellbewertung von Stichproben, keine Garantie der Richtigkeit und keine lückenlose Inhaltsprüfung. Unvollständige Antworten, Refusals, falsche Felder, Steuerzeichen und übergroße Ergebnisse werden verworfen.
8. Bei erfolgreichem Abschluss wird ausschließlich der für diesen Test angelegte temporäre Container entfernt; dessen ID und Löschbestätigung werden geprüft. Der Kunden-Test liest anschließend den Drive-Dateistand erneut und akzeptiert nur die identische verfügbare Revision. Nach früheren Fehlern greift bisher der Container-Inaktivitätsablauf. n8n speichert keine erfolgreichen, fehlgeschlagenen oder manuellen Ausführungsdaten und keine Zwischenstände. OpenAI-Antworten werden mit `store:false` angefordert; dies ist keine Aussage über weitergehende Anbieter-Aufbewahrungsregeln.

## Grenzen vor Produktivbetrieb

- MP4 mit SHA-256, bis 24 MB, höchstens 60 Sekunden, ein Videostream, höchstens ein Audiostream, Seitenlänge bis 4096 Pixel. Der normale Dashboard-Upload kann größere Dateien aufnehmen; diese Grenze betrifft ausschließlich den neuen Analysetest.
- Höchstens 21 gleichmäßig verteilte Frames. Das ist Inhaltsmaterial für Beschreibungen, keine lückenlose Sicherheits- oder Portalprüfung.
- Noch kein authentifizierter Video-Webhook, keine Video-Reservierung/Rate-Limits in Supabase, keine automatische Übernahme ins Dashboard. Der Dateistand wird im manuellen Ablauf vor und nach der Analyse geprüft; die spätere Speicherung benötigt zusätzlich dieselbe Eigentümer-/Lease-Bindung wie die Fotoerkennung.
- Noch kein freigegebener Beitragstext, keine Prüfung eines finalen Posts gegen sämtliche Videoinhalte und keine Portalveröffentlichung. `can_publish:false`, `manual_probe_only:true` und `content_comparison:model_checked_sampled_evidence` beschreiben den begrenzten Testumfang.
- Der Nutzer hat die Übertragung der bereits hochgeladenen MP4 einschließlich Bild-/Tonderivaten an die bestehende OpenAI-Anbindung ausdrücklich freigegeben. Nur diese ausgewählte Datei wurde im separaten privaten Test verwendet. Der synthetische Test enthält weiterhin ausschließlich selbst erzeugte Formen, einen festen Schriftzug und künstliche Sprache, keinen Drive-Zugriff und keine Kundendatei-ID.

## Reproduktion

```sh
python tests/make-synthetic-video.py /tmp/synthetic-sma-test.mp4
python n8n/publishing/build-video-evidence-probe.py \
  --synthetic-video /tmp/synthetic-sma-test.mp4 \
  --output /tmp/synthetic-video-probe.json
node --test tests/publication-video-evidence.test.cjs tests/publication-magic-effect.test.cjs
```

Der Fixture-Generator benötigt ffmpeg mit libflite, libx264 und drawtext. Er verwendet keine Aufzeichnung einer echten Person. `--no-audio` erzeugt den separaten Test ohne Tonspur. Die privaten Testparameter des optionalen `--fixture`-Modus sowie exportierte Workflows mit Kundendatei-IDs gehören nicht ins Repository.

Die ursprüngliche Kontaktblatt-Erkennung übersah kleine lesbare Einblendungen im Kundenvideo. Die größeren Einzelbilder erkannten diese Texte im erneuten Durchlauf. Ein ungenaues Beschreibungsdetail war Anlass für den zusätzlichen Entwurfsabgleich. Deshalb ist ein technischer Erfolg ausdrücklich keine inhaltliche Abnahme jeder Modellbehauptung.

Manueller synthetischer n8n-Test: `Ga4qjgjbpmCoUyGA`, **SMA – Synthetischer Videoanalyse-Test**, 33 Nodes. Separater privater Kundentest: 36 Nodes. Beide unveröffentlicht. 20 relevante Node-Tests bestehen; die lokale ffmpeg-Ausführung mit und ohne Ton wurde zusätzlich geprüft. Cloud-Nachweise und ihr genauer Umfang stehen unter `validation/`; Kunden-IDs, Rohtranskripte und Kundenvideobilder werden dort nicht abgelegt.

Offizielle Grundlagen: [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter), [Container erstellen](https://developers.openai.com/api/reference/resources/containers/methods/create), [Container-Dateien](https://developers.openai.com/api/reference/resources/containers/subresources/files/methods/create), [Transkription](https://developers.openai.com/api/docs/guides/speech-to-text).
