# Nächster Schritt: visuelle Videoprüfung

## Ergänzung: persönlicher Prüfweg

Am 06.11.2026 wurde der kostenfreie, auftragsgebundene
[persönliche Prüfweg](MANUAL_MEDIA_REVIEW.md) technisch umgesetzt. Er ersetzt
keinen automatischen Befund und erteilt keine Providerfreigabe. Die unten
dokumentierte zusätzliche automatische Videoprüfung bleibt zurückgestellt.

Stand: 06.11.2026, nach PR #106/#107. Die konkreten YouTube-/TikTok-Textfragen
sind abgeschlossen. Dieser Nachtrag betrifft nur die noch fehlende visuelle
Sicherheitsprüfung; keine erneute Bestandsprüfung.

## Tatsächliche Grenze

`VIDEO_PLAN_REQUIRED` ist eine absichtliche Sperre nach dem bereits dokumentierten
echten Sightengine-Test. Der kostenlose Tarif unterstützt laut aktueller
[Preisseite](https://sightengine.com/pricing) keine Videoverarbeitung.
Der angezeigte Starter-Tarif kostet 29 USD/Monat für 10.000 Operationen;
Mehrverbrauch wird mit 0,002 USD pro Operation berechnet. Der im konkreten Konto
anfallende Endpreis einschließlich möglicher Steuern wurde nicht aufgerufen
oder bestätigt. Keine Buchung, kein Tarifwechsel, kein neuer Anbieteraufruf.

Der [vorhandene eigene Adapter](../n8n/publishing/SELF_HOSTED_REVIEW.md) ist nur
ein getesteter Vertrag. Ein eigener Prüfdienst mit allen sieben Kategorien ist
noch nicht eingerichtet; er ersetzt diese Grenze derzeit nicht. Die spätere
Servermigration bleibt ein separater Schritt.

## Technischer Anschluss

Der vorhandene n8n-Generator enthält bereits den festen synchronen Videoendpunkt,
Binärübertragung, sieben Modellprofile, ein Sekundenintervall, Ergebnisprüfung
und anschließenden erneuten Drive-Abgleich. Die lokale gezielte Prüfung der
14 vorhandenen Inhalts-/Anbietertests bestand am 06.11.2026. Das ist kein
Nachweis eines echten erfolgreichen Videoaufrufs.

Eine spätere Aktivierung erfordert abgestimmte Änderungen an drei Stellen;
ein Tarifwechsel allein schaltet SMA nicht frei:

| Stelle | Aktueller Zustand | Änderung erst nach Freigabe |
| --- | --- | --- |
| `supabase/sql/publication-content-review.sql`, `publication_review_request_v1` | Videoreservierung liefert `VIDEO_PLAN_REQUIRED` | Kontrollierte Reservierung für das bestätigte Videoprofil |
| `n8n/publishing/review-providers.cjs`, `providerCapability` | Videopfad nicht verfügbar | Bestätigtes Profil aktivieren und Workflow neu erzeugen |
| `app/assets/publication-preview.js`, `syncReviewButton` und Klickhandler `reviewContent` | Video-Prüfaktion gesperrt | Nur den tatsächlich verfügbaren Prüfweg anbieten |

Die aktuell installierten Funktionen und der veröffentlichte n8n-Workflow
bleiben unverändert. Keine nur teilweise entsperrte Zwischenversion ausrollen.
Das Profil `visual-2026-11-01.1` darf nicht stillschweigend für andere Modelle,
Anbieter, Schwellenwerte oder Stichprobenverfahren wiederverwendet werden.

## Konkrete Abnahme nach einer Kostenentscheidung

1. Kontoseitigen Videozugriff, endgültigen Preis und ein ausdrücklich erlaubtes
   Nutzungsbudget prüfen. Der Anbieter berechnet Mehrverbrauch automatisch;
   die bestehenden Grenzen je Kunde sind kein globaler Monatskostendeckel.
2. Einen separaten unveröffentlichten Prüflauf mit selbst erzeugtem neutralem
   Video vorbereiten. Bestehende Originalentwürfe erhalten, keine Nutzdaten-
   oder Fortschrittsprotokolle und keine Provider-Publishing-Knoten.
3. Genau den bestätigten Modellumfang mit `interval=1` prüfen. Dateibytes und
   Prüfsumme müssen passen; alle Kategorien und Zeitpositionen müssen vorhanden
   sein. Lücken, fehlende Werte und uneindeutige Antworten bleiben Fehler.
4. Erst nach erfolgreicher neutraler Abnahme die drei oben genannten Stellen
   zusammen aktivieren, Eigentümer-/Versions-/Lease-/Budgetgrenzen prüfen und
   anschließend den ausdrücklich vorgesehenen Kundendateistand testen.
5. Die gespeicherte visuelle Prüfung separat nachweisen. Keine Auftragsfreigabe,
   kein YouTube-/TikTok-Upload und keine Coverübertragung daraus ableiten.

Die Schnittstelle prüft Videos unter 50 MB und unter 60 Sekunden. Ihre
[synchronen Ergebnisse](https://sightengine.com/docs/moderate-stored-video)
enthalten zeitbezogene visuelle Stichproben. Dies ist **keine Prüfung jedes
Videoframes, keine Tonprüfung und keine vollständige semantische Abnahme**.
`SEMANTIC_REVIEW_PENDING` darf deshalb weder durch den Tarifwechsel noch durch
ein visuell unauffälliges Ergebnis entfernt werden. Der bereits bestandene
Portaltextvergleich bleibt ebenfalls eine getrennte Aussage.

## Betriebsentscheidung: keine zusätzlichen Kosten

Am 06.11.2026 wurde der kostenpflichtige Videoweg ausdrücklich zurückgestellt.
Es gibt keine Kostenfreigabe und keine ausstehende Buchungsentscheidung.
Sightengine bleibt im vorhandenen kostenlosen Tarif. Keine neuen Abonnements,
kein bezahlter Ersatzdienst und keine Serverbuchung für diesen Prüfschritt.
Die Vorbereitungen oben gelten nur für eine spätere ausdrücklich neu beauftragte
Aktivierung; weitere Aufforderungen zum Tarifwechsel sind kein nächster Arbeitsschritt.

Dieser konkrete Video-Anbieterweg bleibt daher gesperrt.
Eine Freigabe für Medienanalyse ist außerdem keine Freigabe für Social-Media-
Veröffentlichungen. Alle neun Veröffentlichungsaufträge, Operatorfreigaben,
Provider-/Coverversuche, Shopify-Testmodus und PR #57/#69 bleiben unberührt.

Die vorhandenen Funktionen für private Entwürfe, Textkorrekturen, Medieneditor,
Musikbibliothek und Export können weiter genutzt werden. Abgeschlossene Bereiche
nicht erneut prüfen oder als unfertig behandeln. Der fehlende automatische
Videonachweis darf nicht durch einen erfundenen Erfolgsstatus ersetzt werden.

Primärquellen, am 06.11.2026 gelesen:

- [Tarife, Videozugriff und Mehrverbrauch](https://sightengine.com/pricing)
- [Synchroner Videoendpunkt und Ergebnisstruktur](https://sightengine.com/docs/moderate-stored-video)
- [Parameter: Intervall in Sekunden](https://sightengine.com/docs/offensive-detection-model)
- [Bisheriger echter Diensttest und Grenzen](../n8n/publishing/CONTENT_REVIEW.md)
