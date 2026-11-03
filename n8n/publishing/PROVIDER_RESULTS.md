# Vorbereitung der Upload- und Provider-Ergebnisse

Stand 3. November 2026. Zwei reine JavaScript-Module ergänzen die bestehende Veröffentlichungsvorbereitung für YouTube und TikTok. Sie senden keine Anfrage und besitzen weder Credentials noch einen aktivierten Dispatcher. Kein Social-Media-Upload und kein Posting wurde ausgeführt.

## Exakter gespeicherter Inhalt

`provider-upload-plan.cjs` erstellt aus der bestehenden gesperrten Publisher-Vorbereitung eine überprüfbare Anfragebeschreibung. Datei-/Textbindung und Adapterfelder müssen übereinstimmen. Unterstützt sind MP4-Dateien bis zur bisherigen internen Grenze von 24.000.000 Bytes. Alle Sichtbarkeits-, Kinder-/KI-, Interaktions- und Werbeoptionen müssen explizit übergeben werden; fehlende Optionen erhalten keine stillen Standardwerte.

YouTube erhält den gespeicherten Titel und die unveränderte Caption in `snippet.title` beziehungsweise `snippet.description`; TikTok die vollständige gespeicherte Caption in `post_info.title`. Die Beschreibung enthält die Metadaten für einen YouTube-Resumable-Upload beziehungsweise TikTok-Direct-Post mit `FILE_UPLOAD`. Der kleine bestehende Dateipfad verwendet bei TikTok einen Chunk. Kein tatsächlicher Upload-Session-Endpunkt wird aufgerufen. Das Ergebnis behält alle bestehenden Blocker und ergänzt `PROVIDER_DISPATCH_DISABLED`.

## Providerantworten auswerten

`provider-results.cjs` trennt Dateitransfer, Verarbeitung und nachgewiesenes Providerergebnis:

| Antwort | Interpretation |
| --- | --- |
| YouTube 308 mit gültigem empfangenem Bytebereich | Transfer noch offen |
| YouTube 200/201 mit Video-ID nach Transfer | Providerverarbeitung ausstehend |
| YouTube Statusabfrage | Video-ID, Kanal-ID, Verarbeitung, Uploadstatus und gewählte Sichtbarkeit müssen passen |
| TikTok Transfer 201 | Nur Dateitransfer beendet |
| TikTok `PROCESSING_UPLOAD` | Verarbeitung läuft |
| TikTok `SEND_TO_USER_INBOX` | Nutzeraktion erforderlich; nur beim Inbox-Weg gültig |
| TikTok `PUBLISH_COMPLETE` | Providerabschluss; öffentliche Post-ID kann noch fehlen |
| Fehler, fehlende Felder, unbekannte Statuswerte | Unklar oder fehlgeschlagen; keine automatische Uploadwiederholung |

Privat beziehungsweise nicht gelistet ist kein öffentlicher Erfolg. Bei öffentlich angefragtem TikTok-Post ohne öffentliche ID bleibt die öffentliche Verfügbarkeit unbekannt (`null`). Die dokumentierte Schreibweise `publicaly_available_post_id` wird absichtlich verwendet. Große TikTok-IDs bleiben genaue Strings; unsichere JavaScript-Zahlen werden verworfen. Spätere öffentliche IDs können ein bereits abgeschlossenes Ergebnis ergänzen, ohne durch verspätete leere Antworten wieder verloren zu gehen. Die Zusammenführung bindet Portal, Zielkonto, Provider-ID, Route und gewählte Sichtbarkeit.

Die TikTok-Statusantwort enthält weder die angefragte Publish-ID noch die Zielkonto-ID. Diese Bindung muss der künftige Aufrufer aus seinem dauerhaft gespeicherten Versuch und der tatsächlich authentifizierten Anfrage gewährleisten. Die reinen Funktionen beweisen diese Anfrageherkunft nicht selbst. Ebenso ersetzt ihre Zusammenführung keine atomare Datenbanksequenzierung oder dauerhafte Wiederanlaufsicherung.

## Offen bis zum vollständigen Betrieb

- Dauerhaftes Provider-Versuchsjournal mit atomarer Reservierung, Anfragesequenz und sicherer Wiederaufnahme nach unsicherem Netzwerkresultat.
- Anbindung der echten Upload-/Statusnodes an die aktuelle Auftrags-, Konto-, Datei-, Medien- und ausdrückliche Nutzerfreigabe.
- Sichere Validierung von Upload-Session-URLs und Behandlung von Ablauf/Refresh; kein erneuter Init-Aufruf nach unklarem Ergebnis.
- Kontrollierter echter Uploadtest nach ausdrücklicher Freigabe. Die vorliegenden Providerfälle sind synthetische Tests, keine Live-Uploadabnahme.

Die geschützten Originalworkflows und die bestehende Publisher-Arbeitskopie bleiben unverändert. Keine Provider-Nodes sind durch diese Module erreichbar. Der [reale Inhaltsabgleich](CONTENT_COMPARISON.md) und die Medienfreigaben bleiben davon unabhängig.

Primärquellen, am 03.11.2026 geprüft:

- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
