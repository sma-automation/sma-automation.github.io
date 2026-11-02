# Gesamtprüfung der Vorbereitung und Server-Erweiterungen

Prüfstand: 2. November 2026. Anlass: Bei jeder neuen Veröffentlichung sollen passende neue Beschreibungen entstehen, auch wenn dieselbe Mediendatei verwendet wird. Alle unterstützten Portalwege sollen vor Veröffentlichung nachweisbar geprüft sein.

**Ergebnis: Eine vollständige Portalabnahme liegt noch nicht vor.** Die bisherigen Arbeitsschritte sind echte, getestete Teilbausteine. Sie sind weder ein fertig betriebener eigener Server-Worker noch ein vollständiger semantischer Inhaltsabgleich oder angeschlossener Veröffentlichungsprozess. Die neuen Ergebnisse bleiben `can_publish:false`. Das darf bei der Serverübergabe nicht als erledigte Gesamtlösung bezeichnet werden.

„Algorithmuskonform“ ist keine veröffentlichte technische Zertifizierung. SMA kann überprüfbare Plattformregeln, Veröffentlichungsbedingungen und Qualitätsziele umsetzen. Zugang zu allen internen Ranking-Signalen oder eine garantierte Empfehlung/Reichweite folgt daraus nicht. Beschreibungsvariation allein verändert weder die Videodatei noch deren Originalität. Eigene zulässige Wiederverwendung ist nicht pauschal verboten; massenhaft minimale Varianten und irrelevante Beschreibungen können jedoch Plattformregeln verletzen oder die Ausspielung verschlechtern. [S1–S4]

## 1. Geprüfte Arbeitsstände seit Beginn dieser Fortsetzung

Geprüft wurden die vier neuen Module samt Tests und Dokumentation, ihre Übergänge zur bestehenden Textvorschau und Dateizuordnung, die Medienprofile, der dokumentierte Publisher-Bestand in Issue #11 sowie aktuelle offizielle Quellen. PR-Status direkt in GitHub überprüft: #21–#24 offen und nicht gemergt. Kein erneuter Live-Export aller Produktionsworkflows, keine neue produktive Datenbankmigration und kein Portal-Testpost in dieser Prüfung. Frühere Live-Ergebnisse werden unten als solche bezeichnet, nicht als heute erneut ausgeführte Tests.

| Baustein | Tatsächlicher Stand | Für das Gesamtziel noch fehlend |
| --- | --- | --- |
| Ausgangsstand PR #20 / `website-v1` | Bestehende Datei-/Portalzuordnung, Drive-Vorprüfung, visuelle Bildprüfung und Hinweise; früherer Live-Test mit neutralem PNG dokumentiert | Kein vollständiger Videopfad, keine neue Beschreibung je Veröffentlichungsereignis, keine neue Publisher-Freigabekette |
| [PR #21](https://github.com/sma-automation/sma-automation.github.io/pull/21), `c679a86351b0122a0dca0e028237d4f77896473a` | SHA-256-gebundener FFprobe-Baustein; echte MP4-/PNG-Fixtures getestet | Nur Container-/Streamheader, kein vollständiges Video-Decoding, keine finale Portalbewertung, nicht live angeschlossen |
| [PR #22](https://github.com/sma-automation/sma-automation.github.io/pull/22), `e62862ea0fa42411ecd9eb9bc25f59e99388d9e6` | Lokales Tesseract für PNG/JPEG, Deutsch/Englisch, Modellbindung und Unsicherheiten | Keine Texte über den gesamten Videoverlauf, keine Garantie fehlerfreier OCR, noch kein UI-/Speicherpfad |
| [PR #23](https://github.com/sma-automation/sma-automation.github.io/pull/23), `d60202c5a93e68203290132bf8c99cec537a1d56` | Lokale Spracherkennung mit Zeitbezügen, Modell-/Dateibindung und Audiodekodierung | Begrenzte Testbeispiele, keine ausreichend breite Messung von Erkennungsqualität, keine Musikrechteprüfung, kein laufender Dienst |
| [PR #24](https://github.com/sma-automation/sma-automation.github.io/pull/24), `1e1555f5ac8eb791d3fa0364a3f4da49c19066df` | Gebundene Preis-/Währungsvergleiche und Prüfung der Aktualität von Produktsnapshots; deutscher Sprachtest | Kein vollständiges Verstehen von Bild, Video, Aussagen, Negationen, Bedingungen oder Werbeversprechen; semantischer Abgleich bleibt offen |
| Ergänzung dieser Prüfung | Neue Textvariantenkontrolle und verbindlicher Reservierungsvertrag, dokumentiert in [CAPTION_VARIATION.md](CAPTION_VARIATION.md) | Dauerhafter Transaktionsadapter, Import alter Veröffentlichungen, Queue/UI/Publisher-Anbindung und Live-Abnahme fehlen |

Die PRs bauen aufeinander auf (#21 → #22 → #23 → #24 → diese Ergänzung). Ein einzelner ungemergter Baustein ist kein Deployment. Server, Prozessisolierung, Queue, Authentifizierung, Modellbereitstellung, Ergebnisspeicherung und Betrieb müssen zusammengefügt werden. Der vorhandene Cloud-Bildprüfpfad ist kein Nachweis eines eigenen laufenden Workers.

## 2. Festgestellte Lücken und Korrektur

| Priorität | Befund und Beleg | Erforderliches Verhalten / Stand |
| --- | --- | --- |
| P0 | `publication_assignments_v1` hat `primary key(asset_id,platform)`; erneutes Speichern überschreibt den aktuellen Entwurf. `prepare-preview.cjs` kennt keinen Veröffentlichungsverlauf. | Neue Veröffentlichung separat identifizieren, unveränderliche Texthistorie führen, vor Freigabe atomar reservieren. Neue Prüflogik vorhanden, Speicher/Integration offen. |
| P0 | Die bisherigen OCR-/Transkript-Ergebnisse sind weder Eingang des aktiven Generators noch zwingender Bestandteil der Upload-Adapter. | Geprüfte Inhaltsgrundlage bereitstellen, finalen Text dagegen prüfen und bei fehlender Evidenz anhalten. Kein Durchreichen bloßer Dateinamen oder ungeprüfter Aussagen. |
| P0 | Der „Inhaltsabgleich“ aus #24 erkennt nur explizite Preis-/Währungsangaben und Bindungsprobleme. | Vollständiger Aussagenabgleich inklusive Bildinhalt, eingeblendeter Texte, Sprache, Produktvariante, Mengen, Bedingungen und Aktualität separat implementieren und evaluieren. |
| P0 | Laut dokumentierter Bestandsaufnahme in Issue #11 fehlen Caption-Felder in mehreren alten Publisher-Pfaden; YouTube nutzt einen generischen Fallback. Diese Pfade wurden in dieser Fortsetzung nicht neu verdrahtet. | Finale freigegebene Payload an jeden konkreten Adapter anschließen; fehlender Text muss sperren, nicht auf generische Beschreibung zurückfallen. Live-Bestand vor Umbau erneut exportieren und vergleichen. |
| P0 | Kein eigener dauerhafter Worker mit Queue, Betriebsschutz und Ergebnisrückgabe abgenommen. | Isolierter Dienst, Authentifizierung/Kundentrennung, sichere Dateibeschaffung, Ressourcenlimits, unveränderliche Modelle, Fehler-/Retry-Verhalten und Speicherung nachweisen. |
| P0 | Meta-API-Route/-Version und einige Formatgrenzen nicht zuverlässig verifiziert. | Je konkretem Endpoint bestätigen; bei unbekanntem Profil blockieren. Keine Übernahme von Facebook-Reels-Limits für Feed-Videos oder Instagram-Bilder. |
| P0 | Universeller Shop-Footer ist Vorschauverhalten; Klickbarkeit, TikTok-Editierbarkeit und endgültige Platzierung nicht bewiesen. | Pro Placement zulässigen Shop-Verweis prüfen; vollständige finale Vorschau, vom Nutzer editierbare TikTok-Caption. Keine ungeprüfte Aussage „Link im Profil“. |
| P0 | Finale Freigabe-/Upload-/Statuskette fehlt. | Datei, finale Caption, Zielkonto, Format, Kennzeichnungen und Regelstand unveränderlich binden; Änderungen invalidieren Freigabe. Unbekannter Uploadstatus darf keinen zweiten Post auslösen. |
| P1 | Untertitel, Cover, lesbare Textabstände, Tonqualität und visuelle Varianten fehlen. | Tatsächliche Ausgabevarianten erstellen/prüfen, Original erhalten, nicht pauschal zuschneiden. |
| P1 | Kein durchgehender Nachweis von Ergebnis-/Shop-/Verkaufsmetriken. | Nur tatsächlich verfügbare Daten erfassen; Qualität daran verbessern. Trackingparameter ersetzen keine Affiliate-Provisionszuordnung. |

P0 bedeutet: vor Freigabe des neuen Veröffentlichungswegs zu schließen. P1 ist Qualität/Ausbau; einzelne Punkte können je Format oder Inhalt ebenfalls Pflicht werden. Unbekannte Pflichtbedingungen ergeben keine Freigabe.

## 3. Beschreibungsvariation und Medienwiederverwendung

- Neuer Beitrag: neue `publication_id`, neuer sachlich passender `body`, Prüfung gegen den vollständigen SMA-Verlauf dieses Kunden, einschließlich anderer Portale/Konten.
- Technischer Retry: gleiche `publication_id`, exakt derselbe reservierte Text und unveränderter Medien-/Produkt-/Evidenzstand. Neue Zufalls-ID nach Timeout ist kein Retry.
- Titel-/Hashtag-/Emoji-/Satzzeichenwechsel allein zählen nicht als neue Beschreibung. Gemeinsamer Shop-Footer zählt nicht als neue inhaltliche Formulierung.
- Dateibytes und Text werden getrennt identifiziert. Gleiches Video unter anderem Namen bleibt erkennbar; andere Bytes sind noch kein Beweis neuer Inhalte.
- Keine bloßen kosmetischen Medienänderungen zur Umgehung von Wiederholungserkennung. Eigene Nutzungserlaubnis und Kontext/Mehrwert gesondert beurteilen. Vorhandenes Video nicht durch eine unzutreffende neue Beschreibung umdeuten.
- „Bio“ bezeichnet das Profil, nicht die einzelne Datei. Eine Profiländerung ist kein Ersatz für eine individuelle Beitragsbeschreibung.
- Ohne vollständigen Verlauf keine Einmaligkeitszusage. Der neue Vergleich ist eine konservative sprachliche Heuristik, keine semantische oder plattformübergreifend weltweite Dublettensuche.

## 4. Anforderungen je Veröffentlichungsweg

Die folgende Matrix trennt bestätigte Regeln, Empfehlungen und offene Bedingungen. Ein kleineres Arbeitslimit des eigenen Workers ist **kein Plattformlimit**. Der derzeitige Byte-Probe akzeptiert weniger als 50 MB, OCR höchstens 12 MB/20 Megapixel, die Spracherkennung weniger als 60 Sekunden. Damit ist die auf den Portalen zulässige Medienmenge noch nicht vollständig abgedeckt.

| Weg | Bestätigte Vorgaben / Anforderung | Noch abzuprüfen oder umzusetzen |
| --- | --- | --- |
| YouTube Video | Upload höchstens 256 GB/12 Stunden; längere Videos als 15 Minuten benötigen freigeschaltetes Konto. Titel max. 100 Zeichen, Beschreibung max. 5.000 UTF-8-Bytes. Nutzer muss Titel, Beschreibung und Sichtbarkeit wählen können. [S5–S7] | Vollständige Dekodierung, Container-/Codec-Verträglichkeit, tatsächliche Kanalrechte/Quoten, passend bestätigte Kategorie/Sprache/Zielgruppe/Werbe-/KI-Angaben, Thumbnail/Untertitel nach unterstütztem Weg, Verarbeitungsergebnis. Kein generischer Fallback. |
| YouTube Short | Eigenes Format; aktuelle Zuordnung für neue quadratische/vertikale Videos bis 3 Minuten. Rechte-/Claim-Bedingungen für Shorts über 1 Minute beachten. [S8] | Kein Schluss „kurzes Video = Short“. Seitenverhältnis und Kanal-/Musikbedingungen prüfen. Shop-URL in Shorts-Beschreibung ist nicht klickbar; unterstützte Alternative konkret nachweisen. [S9] |
| Instagram Reel | Offizielle Meta-Sammlung nennt MOV/MP4, H.264/HEVC, 23–60 FPS, max. 1920 horizontale Pixel, 3 s–15 min, AAC 48 kHz, Audio 128 kbit/s, Video max. 25 Mbit/s. 9:16 ist Empfehlung. [S10] | Exakter Login-/API-Weg, aktuelle Grenzen einschließlich Größe, Rotation/angezeigte Maße, Tonanforderungen, Caption, Cover, Konto-/App-Rechte und Containerstatus. Die Sammlung nennt 1 GB; wegen widersprüchlicher Dokumentationsstände und nicht abrufbarer direkter Referenz weiterhin kein endgültiger Größen-Pass. |
| Instagram Bild | Eigenes Bildprofil erforderlich; eine klare visuelle Sicherheitsprüfung ersetzt dieses nicht. | Direkt belegte Regeln für Format/Farbraum, Maße/Seitenverhältnis, Dateigröße, Caption/Hashtags, Alt-Text, Link-Platzierung, App-/Kontorechte und API-Version. Keine geratenen JPEG-/Größenwerte als abgenommen markieren. |
| Facebook Bild / Video / Reel | Getrennte Route und unterstützte Felder je Format festlegen. Originalität und passende Beschreibung zählen; unpassende Captions und übermäßige Hashtag-Nutzung können die Ausspielung beeinträchtigen. [S3–S4] | Bild-/Video-/Reels-Endpoint, Codec, Maße, Größe, Dauer, Textfelder, Untertitel/Cover/Alt-Text, Page-Aufgaben und Berechtigungen, Verarbeitungsstatus. Aktuelle direkte API-Referenz beim Abruf HTTP 429: technische Vollabnahme bleibt offen. |
| TikTok Video / Direct Post | MP4/MOV/WebM; H.264/H.265/VP8/VP9; 23–60 FPS; Breite und Höhe jeweils 360–4096 Pixel; max. 4 GB. MP4/H.264 empfohlen. Caption in `post_info.title`, max. 2.200 UTF-16-Einheiten. Dauer anhand aktueller `max_video_post_duration_sec`, nicht pauschal anhand des Upload-Endpoints. [S11–S13] | Frische Creator-Info, angezeigtes Zielkonto, explizit gewählte Sichtbarkeit, deaktivierte/gewählte Interaktionen, bearbeitbare Caption, Werbe-/KI-Angaben, Musikbestätigung und ausdrückliche Zustimmung vor Übertragung. App-Audit, Rate-/Postinggrenzen, gegebenenfalls verifizierte Pull-URL und finaler Status erforderlich. [S12–S14] |

TikTok-Fotoposts, Stories, Karussells und weitere nicht implementierte Wege werden hierdurch nicht automatisch freigeschaltet. Ihre Unterstützung braucht jeweils ein eigenes geprüftes Profil und einen Adapter. Das 10-Minuten-Limit der TikTok-Upload-Route ist kein Ersatz für die dynamische Direct-Post-Dauer.

YouTube-Encodingempfehlungen (etwa MP4/H.264 und Aufnahmebildrate) sind Empfehlungen, keine pauschale Pflicht zur Neukodierung aller zulässigen Dateien. [S15] Keine universelle „beste“ Bitrate, Hashtagzahl, Postingzeit oder Videolänge wird als Rankinggarantie verwendet.

## 5. Vollständiger Abnahmeumfang des neuen SMA-Pfads

| Prüffeld | Nachweis vor Freigabe |
| --- | --- |
| Eigentümer und Ziel | Aktiver berechtigter Kunde, korrekte Kontoverbindung/Scopes, passendes Portal/Placement, aktuelle App-Freigaben und Kontofähigkeiten |
| Dateiidentität | Verfügbare exakte Datei, SHA-256 und Revision; erneute Änderung vor Upload erkennen; finale Variante separat hashen |
| Technische Medienqualität | Dekodierbare gesamte Datei; Codec/Profil/Container, Maße, Rotation, Pixel-Seitenverhältnis, Bildrate/Zeitbasis, Dauer, Größe, Bitraten und Farbraum/HDR passend zum verifizierten Profil |
| Ton | Audio vorhanden/absichtlich stumm, richtige Spur/Sprache, Kanalzahl/Samplerate/Codec, verständliche Sprache, keine Übersteuerung; Musik-/Aufnahmerechte gesondert belegen |
| Medieninhalt | Visuelle Sicherheitsprüfung, Videoverlauf und eingeblendeter Text; aussagekräftige zeitliche Abdeckung. Leere OCR oder fehlende Sprache ist kein Beweis harmlosen Inhalts |
| Aussage und Produkt | Caption, Titel, Cover, OCR und Sprache konsistent mit tatsächlichem Medium und aktuellen Produktdaten; keine erfundenen Aussagen, Preise, Rabatte, Verfügbarkeit, Mengen oder Wirkungen |
| Originalität/Wiederholung | Verwendete Texte und Medien berücksichtigen; Rechte/eigene Urheberschaft/zulässige Wiederverwendung prüfen; Empfehlungseignung von bloßer Veröffentlichbarkeit trennen |
| Lesbarkeit/Zugänglichkeit | Untertitel, Sprache, Kontrast, Schriftgröße und sichere Textpositionen am finalen Format; Cover/Thumbnail/Alt-Text nur in tatsächlich unterstützten Feldern |
| Text/Payload | Eigene passende Beschreibung je neuem Vorgang; serverseitige Längen-/Unicodeprüfung nach finalen Ergänzungen, zutreffender Titel, relevante Hashtags, keine abgeschnittenen Links/Kennzeichnungen |
| Shop/Kaufweg | Richtiger öffentlicher Kundenshop, gültiges Ziel, portalgeeignete Platzierung und belegte Klickbarkeit; Profilverweis nur bei überprüft eingerichteter Profil-URL |
| Rechte/Kennzeichnungen | Bestätigte Bild-/Video-/Musikrechte, zutreffende Werbung/Partnerschaft und KI-Kennzeichnung nach konkreter Plattformregel; unbekannt ist nicht automatisch „nein“ |
| Nutzerkontrolle | Finale sichtbare Vorschau der tatsächlich gesendeten Datei, Caption, Zielkonten und Schalter; vorgeschriebene Auswahl/Einwilligung dokumentieren, TikTok vor Medienübertragung |
| Freigabestand | Medien-/Text-/Produkt-/Regelrevision zusammen binden, Ablauf/Aktualität definieren; Bearbeitung erfordert neue Prüfung und gegebenenfalls erneute Freigabe |
| Übertragung/Fehler | Reservierung, dauerhafte Auftrags-ID, kontrollierte Wiederholung/Backoff, Teilfehlerbehandlung; unbekannten Status zuerst auflösen; keine Umgehung von Posting-/Spam-Sperren |
| Portalbestätigung | Upload angenommen, Verarbeitung abgeschlossen und tatsächlich veröffentlicht getrennt speichern; externe Beitrags-ID und endgültigen Status bestätigen |
| Wirkung | Nur verfügbare autorisierte Kennzahlen zu Bindung, Sehzeit, Interaktion, Shopbesuchen und nachweisbaren Verkäufen; fehlende Werte bleiben unbekannt |
| Regelpflege | Quelle, Abrufdatum, Endpoint, API-Version, Anwendbarkeit, Grenzwerteinheit und Regelversion festhalten; vor Adapteränderung/Aktivierung erneut prüfen |

## 6. Grenzen der bisherigen technischen Tests

Der vollständige lokale Lauf nach der Ergänzung besteht aus **161 Node-Tests, 0 Fehlern und 0 übersprungenen Tests**, einschließlich des Python-Wrappers mit fünf Sprach-/Audiotests. FFprobe, deutsche/englische Tesseract-Modelle und das lokale Whisper-Modell waren aktiviert. Echte Testmedien: generiertes MP4/PNG, OCR-Testbilder, öffentliches englisches Sprachbeispiel und kurzer deutscher Gruß; Herkunft siehe jeweilige Modul-Dokumentation.

Diese Tests belegen Implementierungsverhalten, keine Portalannahme, keine Erkennungsgenauigkeit für alle Kundenmedien und keine vollständige Sprachen-/Produktabdeckung. Die fünf Spracherkennungstests sind im Node-Zähler über einen Wrapper enthalten, nicht 161 zusätzliche Sprachtests. Der neue Verlaufstest verwendet einen Transaktionsadapter im Speicher; eine produktive Datenbankkonkurrenz wurde damit nicht getestet.

Weitere technische Grenzen aus der erneuten Durchsicht:

- FFprobe normalisiert Containerfamilien und Headerwerte; es beweist weder fehlerfreies vollständiges Decoding noch konstante Bildrate oder korrekte Darstellung nach Rotation/Pixel-Seitenverhältnis. Fehlende Fakten dürfen nicht zu `pass` werden.
- OCR gilt derzeit nur für einzelne PNG-/JPEG-Bilder. WebP, Videoeinblendungen und zeitliche Abdeckung sind nicht durch diesen Baustein erledigt.
- Whisper-Ergebnisse bleiben prüfbedürftig; kurze Demoerkennung validiert keine Produktnamen, Zahlen, Dialekte oder störende Musik. Eingeblendete Preise fehlen ohne Video-OCR weiterhin.
- Native Programme benötigen Betriebsschutz auf Prozessebene. `max_alloc` begrenzt nicht den gesamten Prozessspeicher. Die Python-Ausgabegrenze wird nach Prozessende geprüft; die äußere Speicher-/Zeit-/Netzwerkisolierung ist deshalb unverzichtbar und noch nicht als betriebener Dienst nachgewiesen.
- Der Betragsvergleich erkennt nur explizite EUR/USD/GBP-/Euro-Angaben im unterstützten Zahlenformat. „Ab“, Monatsraten, alte/gestrichene Preise, Mengenrabatte, gesprochene Zahlwörter, Negationen und sonstige Werbeaussagen sind nicht abschließend semantisch geprüft.

## 7. Nächste Abnahme, bevor dieser Pfad posten darf

1. Dauerhaften Beitrags-/Textverlauf einschließlich alter SMA-Posts anbinden; Konkurrenz, Neustart, Commit-Ausfall und unveränderten Retry-Endzustand an echter Datenbank testen.
2. Worker betreiben und Datei → technische Analyse → Video/Bild/OCR/Sprache → vollständigen Inhaltsabgleich → neue portalbezogene Caption → finale Vorschau verbinden.
3. Pro Portal den konkreten Endpoint und vollständigen Regelstand bestätigen; offene Meta-Regeln und Shop-Platzierungen schließen. Danach tatsächliche Pflichtfelder und Nutzerkontrolle in die UI übernehmen.
4. Freigabesnapshot und Sperre vor den ersten Upload setzen; bestehende Adapter ohne generische Text-Fallbacks anschließen. Unbekannte Pflichtprüfung bleibt blockiert.
5. Je unterstütztem Format einen ausdrücklich freigegebenen End-to-End-Fall durchführen und finale Datei, sichtbaren Text, Link/Kennzeichnung, Konto und externe Beitrags-ID abgleichen. Öffentlicher Testpost braucht die konkrete Beitragsfreigabe.

Bis dahin lautet die belastbare Aussage: **Vorbereitung und geprüfte Teilmodule vorhanden; vollständige Server-/Portal-Veröffentlichung noch nicht abgenommen.**

## Offizielle Quellen, geprüft am 02.11.2026

- S1: [YouTube Spam Policy](https://support.google.com/youtube/answer/2801973) – repetitive Massenproduktion, irreführende Metadaten und Umgehung von Erkennung.
- S2: [Meta: Instagram-Originalinhalte](https://about.fb.com/ltam/news/2024/05/ayudando-a-los-creadores-a-encontrar-nuevas-audiencias/) – audiovisuelle Zuordnung identischer Inhalte; andere Beschreibung ist kein Originalitätsnachweis.
- S3: [Meta: Original Creators on Facebook](https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/) – eigene Inhalte, Mehrwert und geringfügige Änderungen fremder Inhalte.
- S4: [Meta: Spammy Content](https://about.fb.com/news/2025/04/cracking-down-spammy-content-facebook/) – irrelevante Beschreibungen, übermäßige Hashtags und künstliches Engagement.
- S5: [YouTube Upload-Limits](https://support.google.com/youtube/answer/71673).
- S6: [YouTube API Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality).
- S7: [YouTube videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert).
- S8: [YouTube dreiminütige Shorts](https://support.google.com/youtube/answer/15424877) – Suchindex abrufbar, Direktabruf in dieser Prüfung Timeout; vor Adapterabnahme erneut direkt prüfen.
- S9: [YouTube Link-Platzierungen](https://support.google.com/youtube/answer/13748639?hl=en).
- S10: [Offizielle Meta-Postman-Sammlung: Reels](https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing). [Direkte Instagram-Referenz](https://developers.facebook.com/docs/instagram-platform/content-publishing/) und [Facebook-Reels-Referenz](https://developers.facebook.com/docs/video-api/guides/reels-publishing/) lieferten HTTP 429; Endpoint-Vollprüfung offen.
- S11: [TikTok Media Transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide).
- S12: [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), angezeigter Dokumentstand 27.10.2026.
- S13: [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines) und [Creator Info](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info).
- S14: [TikTok Post Status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status).
- S15: [YouTube Encoding-Empfehlungen](https://support.google.com/youtube/answer/1722171).

Referenz für die bestehende Produktanforderung und frühere Live-Belege: [Issue #11](https://github.com/sma-automation/sma-automation.github.io/issues/11). Die Quellenliste ist ein datierter Prüfstand, keine bereits eingerichtete Überwachungsautomatik und keine Behauptung einer vollständigen Kenntnis interner Rankingregeln.
