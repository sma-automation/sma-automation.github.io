# Technische Medienvorprüfung V1

Stand: 1. November 2026. Die Vorbereitung zeigt technische Dateiangaben und konkrete offene Prüfpunkte je Portal. Sie dekodiert keine Medien und erteilt keine Veröffentlichungsfreigabe.

## Datenfluss

Der separate Dateikatalog `Tta5irg2Z3DiCGy4` fragt zusätzlich `imageMediaMetadata(width,height)` und `videoMediaMetadata(width,height,durationMillis)` bei Drive ab. Fehlende oder unbrauchbare Angaben bleiben `null`. EXIF-Standort, Kamera, Aufnahmezeit und andere nicht benötigte Bilddaten werden weder angefordert noch gespeichert.

Die service-only Katalogfunktion validiert den ganzen Datensatz vor dem Austausch. `width_px`, `height_px` und `duration_ms` werden mit der aktuellen Dateiversion gespeichert. Bei einem späteren Abgleich werden auch weggefallene Metadaten geleert; alte Werte werden nicht auf eine neue Version übertragen.

`public.sma_publication_files_v1('check', {asset_id, asset_revision, platform})` prüft Anmeldung, aktiven Kunden, Eigentum, Verfügbarkeit und exakte Version. Die private Funktion `publication_media_precheck_v1` liefert den Regelstand `2026-11-01.1`, Dateifakten und einzelne Ergebnisse `pass`, `fail`, `pending`. Gesamtstatus ist `needs_changes` oder `needs_review`; `can_publish` bleibt immer `false`. Der vorhandene dienstseitige Zuordnungsabruf liefert die gleiche Vorprüfung zusätzlich zum gebundenen Text.

Im kompakten Optimieren-Fenster erscheint „Medienprüfung“. Erkannte Probleme öffnen die Hinweise; ansonsten bleibt der Abschnitt eingeklappt. Allgemeine Textvorlagen ohne Datei lösen keine erfundene Prüfung aus. Ergebnisse anderer Dateien/Versionen und vermeintliche Veröffentlichungsfreigaben werden nicht angezeigt.

## Geprüfter Umfang und Grenzen

| Weg | Vorprüfung | Noch nicht erfüllt |
| --- | --- | --- |
| Alle | Leere Datei, gemeldete Auflösung/Länge, Aktualität | Dekodierung, Inhalt/Sicherheitsprüfung am exakten Dateistand, Rechte, Kennzeichnungen, Zielkonto, Freigabe |
| YouTube-Video | 12 Stunden, SMA-Vorgrenze 256 GB; Kontoprüfung bei mehr als 15 Minuten offen | Container/Codec, Konto-Fähigkeiten, Format Video/Short |
| TikTok-Video | Gemeldetes MP4/MOV/WebM, beide Seiten 360–4096 Pixel, SMA-Vorgrenze 4 GB | Aktuelle Creator-Daten einschließlich maximaler Dauer, Codec, 23–60 FPS, Sichtbarkeit und Interaktionen |
| Instagram-Reel | Gemeldetes MP4/MOV, 3 Sekunden bis 15 Minuten, gemeldete Breite bis 1920 Pixel | Verwendeter API-Stand, Größenlimit, tatsächliche Orientierung, Codec/Ton/Bildrate und weitere Vorgaben |
| Instagram-Bild / Facebook | Gemeinsame Dateifakten | Vollständiges verifiziertes Ausgabeprofil und Adaptergrenzen |

SMA-Vorgrenzen rechnen GB dezimal (`10^9` Bytes); sie sind konservative Vorgrenzen und kein Nachweis einer vom Portal akzeptierten Datei. Dateityp ist der gemeldete MIME-Typ, kein Ergebnis einer Binäranalyse. Die existierende Sightengine-Prüfung im älteren Kundenworkflow wird nicht pauschal als Prüfung dieser neuen Dateiversion übernommen. Kein neues Medien-Upload, keine Änderung an Produktions- oder Kundenpublishing-Workflows.

## Quellen und offene Regelverifikation

- [Google Drive File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files): optionale Bild-/Videometadaten; Videoangaben können nach dem Upload verzögert vorliegen.
- [YouTube Upload-Limits](https://support.google.com/youtube/answer/71673) und [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert): 256 GB, 12 Stunden, Kontofreischaltung über 15 Minuten; MIME-Typ allein bestätigt keinen Codec.
- [TikTok Media Transfer Guide](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide) und [Creator Info](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info): technische Übertragungsvorgaben und dynamische Kontofähigkeiten. Das 10-Minuten-Limit des Upload-Endpunkts wird nicht ungeprüft auf Direct Post übertragen.
- [Offizielle Meta Instagram Postman-Dokumentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api): Reel-Container, Länge und Breite. Die direkte aktuelle IG-User/Media-Referenz und Facebook Video API waren beim Abruf mit HTTP 429 nicht verfügbar. Größenangaben in verfügbaren Dokumentationsständen widersprechen sich; deshalb wird kein endgültiges Instagram-Größenlimit behauptet. Kein Ausweichen auf Drittanbieterwerte.

## Deployment und Prüfung

Bestehende Installationen: `supabase/sql/publication-media-precheck.sql`; Neuinstallation: die aktualisierte `publication-files.sql` nach `publication-preview.sql`. Bestehende private Tabellen behalten RLS und ihre service-only Schreibrechte. Keine zusätzliche Berechtigung für Browserclients.

Migration `publication_media_metadata_and_precheck_v1` angewendet. 28 relevante Node-Tests bestanden. `tests/publication-media-precheck.sql` prüft Grenzwerte, unbekannte Metadaten, Kunden-/Versionsprüfung, Rollenrechte, atomaren Katalogaustausch und Lease-Wiederholung innerhalb einer zurückgerollten Transaktion. `tests/publication-files.sql` bestätigt die bisherigen Zuordnungs-/Bearbeitungsgarantien erneut. Keine Fixture-Datei wird in einen überwachten Drive-Ordner gelegt.

Sicherheitsberater: keine neue WARN für diese Änderung; bestehende Hinweise zu anderen öffentlichen Funktionen und Passwortschutz bleiben separat offen. Private RLS-Tabellen ohne direkte Browserrechte haben absichtlich keine Benutzerpolicies.

Vorheriger n8n-Stand: `53dafc89-b1d1-4375-9954-d16b0cf59080`; geprüfter neuer Export: `bc8cf83b-08e1-4971-974c-b5529512e034`. Ausschließlich drei Knoten geändert: `Ordner prüfen`, `Dateimetadaten aus Drive lesen`, `Dateien prüfen`. Einstellungen, Verbindungen und Credentials unverändert; Ausführungsdaten weiterhin nicht gespeichert, Timeout 120 Sekunden, keine Pins.
