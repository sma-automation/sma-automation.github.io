# SMA – Provider-Quellen und Sicherheitsprüfungen zusammengeführt

Stand 10.11.2026. Zielbranch: `website-v1`. Dieser Pull Request übernimmt die bislang nur in PR #57 liegenden **Quellen** für den YouTube-/TikTok-Inhaltsabgleich und den journalgebundenen Providerweg, ohne die seit dem 03.11. weiterentwickelte SMA-Kernversion zurückzusetzen.

## Abgleich der Quellstände

- Ursprünglicher PR #57 (`media-provider-results`) basiert auf dem Stand vom 03.11. Zwei der damals bearbeiteten Dokumentationen haben inzwischen neuere Änderungen und bleiben deshalb aus `website-v1` erhalten: `CONTENT_REVIEW.md` und `PUBLICATION_ORDERS.md`.
- Die übrigen sechs bearbeiteten Dateien waren bytegleich mit der ursprünglichen Ausgangsversion und können mit dem geprüften PR-Stand übernommen werden.
- 26 bisher fehlende Dateien (einschließlich des vorhandenen Bildnachweises) wurden über ihre **Original-Git-Blob-SHAs** eingespielt: Provider-Transport, sichere Antwortauswertung, Vergleichsworkflow, Zustellung, SQL-Journal und Tests. Der Binärnachweis wurde dabei nicht neu erzeugt oder verändert.
- Die CI führt zusätzlich die vorhandenen Vergleichs-/Zustellungs-SQL-Tests aus, sodass künftige Änderungen an Provider-Quellen nicht nur durch allgemeine Dashboardtests abgedeckt werden.

## Sicherheitsgrenze

Die Quellen sind Dokumentation und Reproduktionsgrundlage für die laut `n8n/publishing/PROVIDER_RESULTS.md` bereits eingerichteten privaten Workflows. **Das Zusammenführen eines GitHub-PRs ist keine Bereitstellung in n8n und keine Bestätigung eines echten Provider-Uploads.** Es verändert keine Supabase-Tabellen, Token, Berechtigungen, Kundenaufträge oder Sichtbarkeiten.

Die tatsächliche Freigabe setzt weiterhin voraus:
- bestätigte, frische kundengebundene Dateiversion und unveränderten gespeicherten Portaltext,
- geprüfte Medienbefunde und persönliche Inhalts-/Rechtebestätigungen,
- eine eigenständige endgültige Kundenfreigabe für die konkrete Sichtbarkeit,
- einen expliziten, fingerprintgebundenen **Operator-Testschalter**,
- eine bestätigte HTTP-Providerantwort mit anschließendem Status-/History-Abgleich.

Keine Freigabe oder Upload wird durch diese Quellintegration erzeugt. Der noch nicht erfolgte private YouTube-Livetest bleibt offen.

## Live-Bestandsaufnahme vor Integration

Für die vorhandene 10-s-Testdatei `SMA_STUMMER_GALERIE_TEST_10S_2026-11-09.mp4` ist Magic Effect erfolgreich abgeschlossen, YouTube-Text ist in Revision 2 zugeordnet. Ohne Kundenaktion wird dieser ältere Text **nicht** auf die neue Shop-Einladung umgeschrieben. Kein Auftrag ist für die Datei angelegt. Die Medien-/Freigabeprüfungen sind nur teilweise abgeschlossen. Zehn historische Aufträge blieben ohne abschließende Freigabe, ohne Operator-Berechtigungen, Provider-Versuche oder Provider-Ereignisse.

## Abschlusskriterien des PR

Alle bestehenden Repository- und Sicherheitstests müssen zusammen mit dem neuen Vergleichs-/Delivery-SQL-Test vollständig erfolgreich sein. Falls eine alte Testannahme nicht mehr zur aktuellen Kernversion passt, wird die Ursache untersucht; Provider-Sperren dürfen nicht zum Bestehen der Tests gelockert werden.
