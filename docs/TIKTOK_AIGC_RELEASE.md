# TikTok: verbindliche Kennzeichnung von KI-generierten Videos

## Quellabgleich nach PR #197 – 10. November 2026

Der ältere PR #185 wurde isoliert auf den aktuellen SMA-Kernstand
`c5dd993675871f23563084b4069cc3d9f769533d` (inklusive PR #195, #196
und #197) übertragen. Neuere Änderungen an Beitragsvorschau, Shop-Link,
YouTube, Cover, History und Tests bleiben erhalten. Die unten genannten 718
Tests beziehen sich auf den älteren PR-Stand, nicht auf diese Arbeitsfassung.

**Sperre:** Diese GitHub-Änderung bleibt Entwurf, bis Datenbankmigration,
47-Node-Provider-/Coverkopie und danach der Dashboard-Client gemeinsam
koordiniert ausgerollt und geprüft sind. Hier erfolgt **kein** Supabase-
oder n8n-Live-Update, keine Kundendatenänderung und kein Social-Media-Upload.


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
5. **Nicht sendender Upload-Plan:** Auch der getrennte
   `n8n/publishing/provider-upload-plan.cjs` benötigt bei TikTok das
   ausdrückliche Boolean `is_aigc`, trägt es unverändert unter
   `post_info.is_aigc` ein und lehnt fehlende, als Text angegebene oder
   zusätzliche Felder ab. Der Plan hat weiterhin `dispatch_enabled:false`,
   `can_upload:false` und `can_publish:false`. Beide möglichen Werte,
   der unveränderte Caption-Text und die Ablehnungsfälle werden in
   `tests/provider-results.test.cjs` geprüft.

## Offline-Rolloutkontrolle für den installierten Provider-/Coverworkflow

**Quellenprüfung – ohne Live-Zugriff:**

```sh
python3 n8n/publishing/check-aigc-rollout.py --source-only
```

Die Meldung `SOURCE_PREFLIGHT_OK; LIVE_EXPORT_NOT_VERIFIED; NO_DEPLOYMENT`
bestätigt ausschließlich die gepinnten Quellen, den inerten 47-Node-Kandidaten
und die SQL-Guards. Sie ist **keine** Freigabe für einen n8n-Import.

**Pflichtprüfung vor einem späteren n8n-Rollout:** Den aktuellen privaten
Export des installierten 47-Node-Workflows `JaidX5YeKl6ZTqjQ` in einem
geschützten lokalen Ordner sichern. Niemals private Exporte oder Token ins
öffentliche GitHub-Repository übernehmen. Auf demselben Computer prüfen:

```sh
python3 n8n/publishing/check-aigc-rollout.py --installed-export /GESCHUETZT/aktueller-provider-cover-export.json
```

Nur `INSTALLED_BASELINE_MATCH; AIGC_CANDIDATE_SOURCE_READY; NO_DEPLOYMENT`
bestätigt den erwarteten alten 47-Node-Codebestand. Abweichende Nodes,
Verbindungen, Einstellungen, Trigger, Retries und teilweise aktiviertes
AIGC führen zum Abbruch. Der Prüfer liest nur lokale Dateien – er kann
**nicht** verifizieren, ob ein vorgelegter Export wirklich frisch aus n8n
stammt. Direkt vor dem Rollout Workflow-ID, Exportzeit und veröffentlichten
Stand in n8n gesondert feststellen.

Danach vor einem Schreibvorgang **lesend** prüfen: Supabase-Funktions-MD5
`ce9dc4edbe66a00ce89924c1a91b49d1`, keine nicht stornierten TikTok-
Aufträge ohne Boolean `choices.is_aigc`, null Provider-/Operatorfreigaben.
Den alten DB-Funktionsstand und den vorhandenen n8n-Export privat sichern.

Reihenfolge einer später separat freigegebenen Abnahme: Datenbankvalidierung,
dann 47-Node-Provider-/Coverkopie, zuletzt der versionierte Dashboard-Client.
Bei einem Fehler Teilausrollung stoppen, alte geprüfte Quellen wiederherstellen
und **keine** Provideranfrage blind wiederholen. Der 29-Node-Dispatcher sowie
geschützte Originalworkflows werden nicht überschrieben.

Die Rolloutkontrolle ist unabhängig von der persönlichen Kundenfreigabe und
der separaten Operator-Uploadberechtigung. Sie erzeugt keine Veröffentlichung.

Offline-Abnahme vor diesem Dokumentationsnachtrag: **774/774 Node-Tests** und
**38 isolierte AIGC-SQL-Prüfungen** bestanden; der Live-n8n-Export wurde
nicht gelesen. PR #199 bleibt Draft.

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

PR #57 wurde nach Ersatz durch #195 ohne Merge geschlossen; PR #69 bleibt unabhängig offen.
Das Live-Journal mit 10 Kundenaufträgen, 0 Freigaben und 0
Provider-Versuchen wurde ausschließlich gelesen und nicht verändert.

## Abnahmebelege vom 10.11.2026

- GitHub-Actions-Workflow „Publication history checks“: **718 Node-Tests bestanden, 0 fehlgeschlagen**. Die ergänzten AIGC-DOM- und 47-Node-Offline-Tests waren erfolgreich. Bestehende SQL-, History-, Cover- und Musikregressionen bestanden.
- GitHub-Actions-Workflow „Dashboard chapter navigation checks“: erfolgreich.
- Verbundene Supabase-Instanz (PostgreSQL 17): Die unveränderte kanonische AIGC-Migration wurde innerhalb einer ausdrücklichen `BEGIN`/`ROLLBACK`-Transaktion testweise kompiliert und angewendet. Der Test verifizierte die geänderte Funktion *innerhalb* der Transaktion, danach die vollständige Rücknahme.
- Nach `ROLLBACK`: Order-Funktions-MD5 weiterhin `ce9dc4edbe66a00ce89924c1a91b49d1`, `is_aigc` **nicht** produktiv installiert, zehn Bestandsaufträge, null Operator-Uploadfreigaben. Keine Kunden- oder Provider-Datensätze geschrieben.

**Wichtig:** Der erfolgreiche Test beweist den sicheren SQL-Änderungsweg. Er ist **keine** Freigabe des koordinierten Produktivrollouts und ersetzt keinen echten YouTube-/TikTok-Abnahmetest.

## Ergänzende Sicherheitsabnahme – 10.11.2026

- Ein zusätzlicher SQL-Rolloutschutz stoppt die Migration, falls noch ein **nicht stornierter** TikTok-Auftrag ohne ausdrückliches `is_aigc`-Boolean existiert. Alte stornierte Aufträge werden nicht verändert und behalten ihre historischen Angaben.
- `tests/run-publication-tiktok-aigc-sql.mjs` erstellt eine **vollständig isolierte PGlite-Datenbank**, installiert die tatsächlichen Order-/Account-/Review-Funktionen mit ihren getesteten Erweiterungen und prüft inzwischen **38 Fälle**: Legacy-Sperre, doppelte Installation, gültige Ja/Nein-Werte, unzulässige Datentypen, falsche Portalzuordnung, Berechtigungen, zwei vollständig synthetisch erzeugte Auftragsvorbereitungen, unveränderte Ja/Nein-Bindung, wiederholbare Anfrage mit gleicher ID, Schutz vor einer nachträglich geänderten Auswahl und weiterhin leere Provider-Journale. Der Test ist fest in `.github/workflows/publication-history-tests.yml` aufgenommen.
- GitHub Actions auf Commit `d5cada373db2478abe09ddaff69532b94cbb992a`: **718 Repository-Tests ohne Fehler, anschließend 38 isolierte AIGC-SQL-Prüfungen bestanden**, einschließlich bestehender History-/Musik-/Cover-Szenarien. Beide GitHub-Workflows erfolgreich.
- Erneute Supabase-Live-Dry-Run-Prüfung: Migration innerhalb einer **einzigen `BEGIN`/`ROLLBACK`-Transaktion** ausgeführt und die geänderte Funktion innerhalb der Transaktion überprüft. Nach `ROLLBACK` blieb der ursprüngliche Funktions-MD5 `ce9dc4edbe66a00ce89924c1a91b49d1` erhalten. Weiterhin **10 Bestandsaufträge, 0 aktive alte TikTok-Aufträge, 0 Uploadberechtigungen, 0 Provider-Versuche und 0 Provider-Ereignisse**.

**Rolloutgrenze unverändert:** Kein Merge und kein dauerhaftes Supabase-/n8n-Update, bevor neue Arbeitskopie, Datenbankvalidierung und Client gemeinsam bereitgestellt und erneut geprüft werden. Keine Social-Media-Veröffentlichung ohne separate ausdrückliche Freigabe.

### Ergänzende CI-Abnahme der vollständigen Auftragserstellung

Auf Commit `2b2647f4dabc643a94760611a54631fe94256587` liefen beide GitHub-Workflows erfolgreich. Im isolierten Datenbanktest wurden nach der Eingabeprüfung zwei neue TikTok-Aufträge mit `is_aigc=true` beziehungsweise `false` vorbereitet und anschließend erneut mit derselben Anfragenummer gelesen. Die verschiedenen Entscheidungen bleiben separat an die Aufträge gebunden; ein geänderter Wert mit derselben Anfragenummer führt zu `REQUEST_CONFLICT`. **38 SQL-Prüfungen erfolgreich**, zusätzlich **718 Repository-Tests und 0 Fehler**. Die lokale Medienvergleichsfunktion ist in diesem Test ausdrücklich ein synthetischer Stub; die echten Order-/Kontofunktionen und Uploadsperren werden verwendet. Keine echten Uploads oder Kundendaten.
