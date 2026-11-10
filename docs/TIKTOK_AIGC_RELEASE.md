# TikTok: verbindliche Kennzeichnung von KI-generierten Videos

**Stand:** 10. November 2026 – staged, nicht in der SMA-Produktivinstallation freigegeben.

## Warum

TikToks aktuelle offizielle Direct-Post-API unterstützt `post_info.is_aigc`.
Bei `true` kennzeichnet TikTok den Beitrag als KI-generierten Inhalt.
SMA darf diese Entscheidung weder aus Produktnamen ableiten noch `false`
vorbelegen. Ein mit Runway erstelltes Video ist ein relevantes Testbeispiel.

Quellen:
- [TikTok Direct Post – Request post_info.is_aigc](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- [TikTok Media Transfer – Single-Chunk-Videos unter 5 MB](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
- [YouTube Videos insert – containsSyntheticMedia](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)

## Staged Implementierung

1. **Kunde:** `Freigabe vorbereiten` bietet bei TikTok eine verpflichtende
   Ja/Nein-Auswahl „Ist das Video KI-generiert?“. Sie beginnt leer.
   Die Auswahl wird bei `Auftrag prüfen` als echtes Boolean `is_aigc`
   zusammen mit Sichtbarkeit und Werbekennzeichnung gebunden. Die
   Auftragsansicht zeigt „KI-generierter Inhalt: Ja/Nein“.
2. **Datenbank:** `publication-tiktok-aigc.sql` erweitert ausschließlich
   `sma_private.publication_order_request_v1`, sodass neue TikTok-Vorbereitungen
   einen Boolean `is_aigc` enthalten müssen. Bei YouTube und anderen
   Plattformen wird dieser zusätzliche Schlüssel abgewiesen. Der
   Migrations-Guard verlangt den am 10.11.2026 gelesenen
   `prosrc`-MD5 `ce9dc4edbe66a00ce89924c1a91b49d1`; bei
   Abweichung bleibt der Lauf unverändert.
3. **n8n-Generator:** Die ausschließlich aus der verifizierten
   PR-#57-Baseline generierte separate 47-Node-Cover-Kopie fügt
   `post_info.is_aigc` nur aus dem gespeicherten Kundenauftrag ein.
   Die vier eingebetteten Validatoren werden konsistent ergänzt,
   und alle bekannten Versionsabweichungen führen zu einem Fehler.
   Es wird weder ein KI-Flag erfunden noch eine bestehende n8n-Kopie
   automatisch überschrieben.
4. **Reproduzierbare Tests:** `tests/publication-tiktok-aigc.test.cjs`,
   `tests/publication-order-dialog.test.cjs` und
   `tests/publication-provider-cover-offline-replay.test.cjs` prüfen
   Pflichtauswahl, unveränderte Caption, echtes Ja/Nein,
   fehlende/falsche Flags, exakte Coverbindung und kein Posting.
   `node --test tests/*.test.cjs` ist die CI-Regression.

## Rollout erst nach technischer Abnahme

Die Änderungen dürfen **nicht** einzeln gemergt oder in die laufenden
n8n-/Supabase-Systeme eingespielt werden, solange der andere Teil fehlt.
Geplante Reihenfolge:

1. Prüfen, ob SQL-Funktionshash und Basisworkflow noch exakt stimmen.
2. SQL-Änderung transaktional testen; ausschließlich bei vollständigem
   Erfolg die neue Validierung installieren, ohne bestehende Kundenaufträge
   zu ändern.
3. Neue 47-Node-Workflowkopie gegen einen frischen Export prüfen,
   einzeln testen und ausdrücklich in der freigegebenen *Arbeitskopie*
   bereitstellen; geschützte Originale erhalten.
4. Danach den versionierten Dashboard-Client ausrollen und sowohl
   Nicht-KI- als auch KI-Fall im Testkonto prüfen. Beim Rollout
   vorhandene, abgelaufene Vorbereitungen nicht blind übernehmen.
5. **Keine** Operator-Uploadfreigabe, Social-Media-Veröffentlichung,
   bezahlte Anbieteränderung oder Kauf ohne ausdrückliche Zustimmung.

## Noch notwendige externe TikTok-Bedingung

Laut TikTok können **nicht auditierte Direct-Post-Apps**
in ihrer Veröffentlichungssichtbarkeit eingeschränkt sein;
für den allgemeinen öffentlichen Marktbetrieb wird eine
App-Prüfung benötigt. Die interne `SELF_ONLY`-Abnahme ersetzt
die externe Freigabe nicht. Zusätzlich bleibt das Zusammenspiel
`brand_content_toggle=true` / `SELF_ONLY` gesperrt.
SMA darf Kunden keine öffentliche Veröffentlichung versprechen,
bevor TikTok die dafür nötige Freigabe tatsächlich bestätigt.

Die Alt-PRs #57 und #69 bleiben eigenständig offen.
Das Live-Journal mit 10 Kundenaufträgen, 0 Freigaben und 0
Provider-Versuchen wurde ausschließlich gelesen und nicht verändert.

## Abnahmebelege vom 10.11.2026

- GitHub-Actions-Workflow „Publication history checks“: **718 Node-Tests bestanden, 0 fehlgeschlagen**. Die ergänzten AIGC-DOM- und 47-Node-Offline-Tests waren erfolgreich. Bestehende SQL-, History-, Cover- und Musikregressionen bestanden.
- GitHub-Actions-Workflow „Dashboard chapter navigation checks“: erfolgreich.
- Verbundene Supabase-Instanz (PostgreSQL 17): Die unveränderte kanonische AIGC-Migration wurde innerhalb einer ausdrücklichen `BEGIN`/`ROLLBACK`-Transaktion testweise kompiliert und angewendet. Der Test verifizierte die geänderte Funktion *innerhalb* der Transaktion, danach die vollständige Rücknahme.
- Nach `ROLLBACK`: Order-Funktions-MD5 weiterhin `ce9dc4edbe66a00ce89924c1a91b49d1`, `is_aigc` **nicht** produktiv installiert, zehn Bestandsaufträge, null Operator-Uploadfreigaben. Keine Kunden- oder Provider-Datensätze geschrieben.

**Wichtig:** Der erfolgreiche Test beweist den sicheren SQL-Änderungsweg. Er ist **keine** Freigabe des koordinierten Produktivrollouts und ersetzt keinen echten YouTube-/TikTok-Abnahmetest.

