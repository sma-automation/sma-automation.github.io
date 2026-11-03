# Video-Magic-Effect im bestehenden n8n

Stand 02.11.2026: Die geprüfte Videoanalyse ist zusätzlich als authentifizierter Dashboard-Workflow umgesetzt. `video-magic-workflow.json` nutzt den vorhandenen n8n-/OpenAI-/Drive-/Supabase-Zugang. Die separate Fotoerkennung und die geschützten Hauptworkflows bleiben unverändert. Der neue Workflow heißt **SMA – Magic Effect – Videoanalyse V1**, ID `a1F5Ps0B3sXMh70S`, Webhook `sma-publication-video-magic-effect-v1`.

Neue Videos starten nur per Magic-Effect-Klick. Der Button unter „Inhalt und Ziel“ übernimmt die Beschreibung, der Button unter „Text für …“ führt anschließend die bestehende portalbezogene Texterstellung und Dateizuordnung aus. Ergebnisse werden kundenspezifisch für die exakte Dateirevision gespeichert; Wiederöffnen lädt den Cache. Eigene ungespeicherte Angaben benötigen weiterhin die ausdrückliche Ersetzungsaktion.

Die SQL-Erweiterung `supabase/sql/publication-video-magic.sql` ist additiv: authentifizierte Eigentümer-/Kontoprüfung, 15-Minuten-Katalogfrische, gemeinsame Begrenzung mit Fotos (6 neue Analysen/Stunde, 30 Sekunden Abstand, ein laufender Auftrag je Kunde), 12-Minuten-Lease, private Speicherung und ausschließlich Service-Role-Abschluss. Der Workflow antwortet vor der Analyse, prüft Kundenordner und Drive-Revision vor und nach der Verarbeitung, läuft maximal 10 Minuten und entfernt temporäre Container auch auf dem Fehlerpfad bestmöglich. Bei Prozessabbruch greift der Container-Inaktivitätsablauf.

## Ablauf und Bindung

1. Die gewählte MP4 muss Größe, SHA-256 und Dateisignatur erfüllen. Im Kunden-Testmodus werden zusätzlich die aktuellen Drive-Metadaten gelesen. Dieser manuelle Modus ersetzt keine Benutzerautorisierung eines späteren Webhooks.
2. Ein ZIP mit genau einem festen Eintrag `source.mp4` wird in einen eigenen temporären OpenAI-Container geladen. Der Container hat 1 GB RAM, deaktivierten Netzwerkzugang und 20 Minuten Inaktivitätsablauf. Keine öffentliche Medien-URL, keine Cloudinary-Freigabe, keine neuen Zugangsdaten.
3. `video-extract.py` prüft die Originalbytes nochmals, decodiert mit ffprobe/ffmpeg und erstellt unverzierte Einzelbilder (längste Seite höchstens 1536 Pixel, kein Hochskalieren), eine Kontaktübersicht, gegebenenfalls eine PCM-Tonspur und ein Manifest. Die Modellantwort muss genau den vorgegebenen Python-Aufruf einmal ausgeführt haben. Ein bloßer Erfolgstext des Modells genügt nicht: Ausführungsstatus, tatsächliche Tool-Ausgabe und Manifest werden geprüft.
4. Die Ergebnisdateien müssen aus genau diesem Container und den festen Ausgabepfaden stammen. Vom API-Dateikatalog gemeldetes `bytes:null` bleibt unbekannt. Tatsächlich heruntergeladene Bild-/Tonbytes müssen den exakten Größen und SHA-256-Werten des geprüften Manifests entsprechen.
5. `gpt-transcribe` erhält die extrahierte Tonspur. Fehlende Tonspur, leeres Transkript und vorhandener gesprochener Inhalt sind unterschiedliche Zustände. Ein Anbieterfehler wird nicht zu einem erfundenen Transkript.
6. `gpt-5` erhält jedes geprüfte Einzelbild separat in größerer Auflösung und das Transkript als untrusted Inhaltsdaten. Die kleine Kontaktübersicht dient nur der visuellen Nachprüfung, nicht mehr als alleinige Modellgrundlage. Beobachtungen, lesbare Aufschriften und Unsicherheiten werden getrennt ausgegeben. Das V2-Manifest bindet jeden Frame an festen Namen, Position, Maße, Größe und SHA-256.
7. Ein zweiter Modellaufruf gleicht den Entwurf gegen genau dieselben Frames und dasselbe Transkript ab. Er soll unbelegte Detailbezeichnungen und Wirkbehauptungen entfernen. Auch dieser Abgleich ist eine Modellbewertung von Stichproben, keine Garantie der Richtigkeit und keine lückenlose Inhaltsprüfung. Unvollständige Antworten, Refusals, falsche Felder, Steuerzeichen und übergroße Ergebnisse werden verworfen.
8. Bei erfolgreichem Abschluss wird ausschließlich der für diesen Test angelegte temporäre Container entfernt; dessen ID und Löschbestätigung werden geprüft. Der Kunden-Test liest anschließend den Drive-Dateistand erneut und akzeptiert nur die identische verfügbare Revision. Nach früheren Fehlern greift bisher der Container-Inaktivitätsablauf. n8n speichert keine erfolgreichen, fehlgeschlagenen oder manuellen Ausführungsdaten und keine Zwischenstände. OpenAI-Antworten werden mit `store:false` angefordert; dies ist keine Aussage über weitergehende Anbieter-Aufbewahrungsregeln.

## Umfang und Grenzen

- MP4 mit SHA-256, bis 24 MB, höchstens 60 Sekunden, ein Videostream, höchstens ein Audiostream, Seitenlänge bis 4096 Pixel. Der normale Dashboard-Upload kann größere Dateien aufnehmen; diese Grenze betrifft ausschließlich die automatische Videoanalyse.
- Höchstens 21 gleichmäßig verteilte Frames. Das ist Inhaltsmaterial für Beschreibungen, keine lückenlose Sicherheits- oder Portalprüfung.
- Der Produktionsweg speichert Beschreibung, Beobachtungen, OCR, getrennte Zusammenfassung der gesprochenen Aussagen, Rohtranskript und Belegbindung. `source_text` wird serverseitig abgeleitet; fremde Quellen oder Clienttexte können das Ergebnis nicht ersetzen.
- Noch kein freigegebener Beitragstext, keine Prüfung eines finalen Posts gegen sämtliche Videoinhalte und keine Portalveröffentlichung. `can_publish:false`, `requires_confirmation:true` und `content_comparison:model_checked_sampled_evidence` beschreiben den begrenzten Analyseumfang. `manual_probe_only:true` gilt nur für den getrennten Testworkflow.
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

Manueller synthetischer n8n-Test: `Ga4qjgjbpmCoUyGA`, **SMA – Synthetischer Videoanalyse-Test**, 33 Nodes. Separater privater Kundentest: 36 Nodes. Beide unveröffentlicht. 227 automatisierte Node-Tests bestehen; die lokale ffmpeg-Ausführung mit und ohne Ton wurde zusätzlich geprüft. Cloud-Nachweise und ihr genauer Umfang stehen unter `validation/`; Kunden-IDs, Rohtranskripte und Kundenvideobilder werden dort nicht abgelegt.

Offizielle Grundlagen: [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter), [Container erstellen](https://developers.openai.com/api/reference/resources/containers/methods/create), [Container-Dateien](https://developers.openai.com/api/reference/resources/containers/subresources/files/methods/create), [Transkription](https://developers.openai.com/api/docs/guides/speech-to-text).

## Integrationsnachweis

Der synthetische Sprachclip wurde mit dem produktiven Ergebnisschema erneut in n8n ausgeführt: neun hashgeprüfte Einzelbilder, korrektes Transkript, getrennte Tonzusammenfassung, zweiter Inhaltsabgleich und bestätigte Container-Entfernung. Das tatsächliche Cloud-Ergebnis wurde anschließend durch den produktiven Supabase-Reservierungs-/Abschluss-/Leseweg unter einer ausschließlich synthetischen Testidentität gespeichert und wieder abgerufen; alle Testdaten wurden zurückgerollt. Der öffentliche Webhook weist eine Anfrage ohne Anmeldung mit `AUTH_REQUIRED` ab. Die exportierte n8n-Konfiguration stimmt mit den generierten Parametern und Verbindungen überein.

`tests/publication-video-magic.sql` prüft ausschließlich künstliche Identitäten/Dateien, Rollenrechte, Fremdzugriff, Revision, Cache, Rate-Limit, Ergebnisgrenzen, Audio-Konsistenz und Lease-Replay. Die Browserlogik prüft expliziten Videostart, Wiederladen, Inhalts-/Textübernahme, exakte Dateizuordnung und Erhalt eigener Änderungen. Ein vollständiger Klickdurchlauf im echten angemeldeten Kundenbrowser ist damit noch nicht behauptet.

## Ergänzung vom 3. November 2026: Kundendurchlauf und freigegebene Oberfläche

Nach PR #39 wurde der technische Klickdurchlauf im angemeldeten Kundendashboard mit einem vorhandenen Video geprüft: gespeicherte Videoerkennung übernommen, YouTube-Entwurf erzeugt, Datei und Portal zugeordnet und den gespeicherten Entwurf erneut geladen. Das war keine erneute Videoanalyse und keine redaktionelle Abnahme der generierten Aussagen.

Die anschließend freigegebene Oberfläche verwendet die Schrift des Dashboards und einen einzeiligen Zurück-Button „Veröffentlichung“. „Datei ändern“ entfällt im Inhaltseditor. „Ausgewählte Datei ansehen“ ersetzt den zusätzlichen Weiter-Button in der Galerie und öffnet eine eigene Ansicht mit Beitragsvorschau und Dateidetails. Die Ansicht verwendet das vorhandene autorisierte Medium, die aktuellen Editorwerte, den validierten Shop-Link und die dateigebundenen Prüfdaten. Sie veröffentlicht nichts. Der Wechsel und der Browser-Verlauf erhalten den Editor; Dateientfernung und Abmeldung räumen die Vorschau auf.

Validierung vor Veröffentlichung: 234 automatisierte Tests erfolgreich; Desktop- und 360-Pixel-Browserprüfung der eigenen Vorschauseite erfolgreich. n8n-Workflows und Datenbankberechtigungen bleiben unverändert. Bei gespeicherten Videos wird weiterhin das autorisierte Vorschaubild angezeigt; lokal hochgeladene Videos können im bestehenden Medienplayer abgespielt werden.

## Redaktionelle Portaltexte – 3. November 2026

Der echte Videodurchlauf zeigte, dass der Textgenerator die Erkennungsbeschreibung wie einen Analysebericht umformulierte: lange Ablaufprotokolle, Formulierungen wie „laut Beschreibung“ und pauschale Hinweise auf fehlende Nachweise. Eine allgemeine Überschrift mit „verfügbarer Tonspur“ führte außerdem trotz des eindeutigen Status „keine Tonspur“ zu einem falschen Widerspruchshinweis.

`prepare-preview.cjs` trennt jetzt öffentliche Beiträge von internen Inhaltsfragen. Die belegten sichtbaren Handlungen dürfen direkt beschrieben werden, ohne eine eigene Medienprüfung zu behaupten. Unklare Merkmale werden nicht als Fakten ausgegeben; sichtbare Werbeslogans begründen weder Produkteigenschaften noch Herstellerzuordnung. Die Kanalvorgaben verlangen kurze, natürliche Texte: YouTube und Facebook zwei bis vier Sätze, Instagram einen prägnanten Einstieg mit kurzen Absätzen, TikTok ein bis zwei kurze Sätze. Das sind redaktionelle Ziele, keine technischen Portallimits. Prüfhinweise beziehen sich auf tatsächlich betroffene Aussagen; die Unsicherheitenliste der Erkennung soll nicht pauschal wiederholt werden.

Aktiver Textworkflow: `9dNstQ4E2uXpZ18Z`, veröffentlichte Version `90427058-63bb-4b06-b73e-ca55191ff61e` („Portaltexte in Alltagssprache – 03.11.2026“). Der erneute n8n-Export stimmt bei allen Nodes, Verbindungen, Einstellungen und leeren angehefteten Daten exakt mit `preview-workflow.json` überein. Nur die drei eingebetteten Kopien des Textkerns wurden geändert. Die Dashboard-Gestaltung, Videoanalyse, Datenbankrechte, Dateibindung, Wiederholungsprüfung und geprüfte Shop-Zuordnung bleiben erhalten. Rückkehr zur vorherigen Textlogik: n8n-Version `d038ba64-d805-4d96-a6b3-2171bf3fe87e`; keine Datenbankmigration nötig.

Automatisierte Prüfung: **235 Node-Tests erfolgreich**, einschließlich einer Regression für die Trennung interner Inhaltsfragen von öffentlichen Captions in Deutsch und Englisch. Alle eingebetteten Code-Nodes lassen sich syntaktisch kompilieren. Promptvorgaben allein garantieren keine redaktionelle Qualität; der Kundendurchlauf ergänzt diese technischen Prüfungen. Alle Ergebnisse bleiben private Entwürfe mit `can_publish:false`.

Im angemeldeten Kundendashboard wurde dieselbe bereits freigegebene Videoerkennung für alle vier Portale verwendet. Jeder Aufruf erzeugte einen neuen Entwurf und bestätigte die Speicherung sowie die Zuordnung zur ausgewählten Datei und zum jeweiligen Portal. Die endgültigen Texte enthalten weder das frühere Berichtsraster noch „laut Beschreibung“, technische Prüfprotokolle oder den falschen Tonspur-Widerspruch. Es wurden keine Sicherheits-, Wirksamkeits-, Marken- oder Zertifizierungsbehauptungen ergänzt; die internen Prüflisten waren für diese rein beschreibenden Entwürfe leer. Einzelne Formulierungen wie „Totale“ bleiben redaktionell verbesserbar; dies ist keine pauschale Abnahme sämtlicher künftig erzeugten Texte.

| Portal | Titel/Einstieg, Zeichen | Beitragstext, Zeichen | Ergebnis |
| --- | ---: | ---: | --- |
| YouTube | 66 | 329 | Drei Sätze, zwei Absätze; gespeichert und dateigebunden |
| TikTok | 34 | 241 | Zwei Sätze; gespeicherte Caption mit geprüftem Shop-Link |
| Instagram | 57 | 380 | Drei kurze Absätze; gespeicherte Caption mit geprüftem Shop-Link |
| Facebook | 60 | 341 | Drei zusammenhängende Sätze; gespeicherte Caption mit geprüftem Shop-Link |

Zeichenzahlen entsprechen JavaScript-UTF-16-Einheiten, beim Beitrag ohne Hashtags und Shop-Fußzeile. Kundendatei-IDs, Dateinamen und vollständige Kundentexte werden nicht in dieses öffentliche Repository übernommen. Die Prüfung erzeugt keine Social-Media-Veröffentlichung und belegt keine Portalübertragung.

Nach vollständigem Neuladen des Dashboards wurde die Videodatei erneut ausgewählt. „Zugeordneten Beitragstext geladen“ bestätigte die gespeicherte Zuordnung; der YouTube-Beitrag war zeichengetreu identisch mit dem neuen Entwurf. Die separate Beitragsvorschau zeigt diesen Text, das autorisierte Vorschaubild, die Hashtags und den richtigen Shop-Link gemeinsam.
