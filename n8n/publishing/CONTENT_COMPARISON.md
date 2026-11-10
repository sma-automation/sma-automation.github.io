# Gespeicherte Portaltexte gegen Video-Beobachtungen prüfen

Stand 3. November 2026. Für YouTube und TikTok gibt es jetzt einen getrennten internen Inhaltsabgleich. Er vergleicht den tatsächlich gespeicherten Titel und die Caption einschließlich Hashtags mit den vorhandenen Video-Beobachtungen, erkannten Bildtexten und gegebenenfalls dem Transkript. Er erzeugt keinen Ersatztext und bestätigt weder Rechte noch die Sicherheit des vollständigen Videos.

Aktueller Anschlussstand: Vergleich und Zustellung sind veröffentlicht und automatisch mit der Auftrags-API verbunden. **314 Tests bestanden.** Der nachfolgende Erstnachweis dokumentiert den zuvor isolierten Modelllauf; den späteren Live-Anschluss beschreibt [der aktuelle Abschnitt](#automatische-auftragsansteuerung--live-anschluss-pr-57).

## Erstnachweis des gespeicherten Vergleichs

| Bestandteil | Ergebnis |
| --- | --- |
| Interner n8n-Unterworkflow | `1qMj37a5gXlrbCWd`, 11 Nodes, nur Execute-Workflow-Einstieg |
| Isolierter manueller Zweikanaltest | `icUFQQBughY8hRb1`, 4 Nodes, beide Ergebnisse vorhanden |
| TikTok | `needs_review`, eine konkrete Rückfrage |
| YouTube | `needs_review`, zwei konkrete Rückfragen |
| Titel und Caption beider Zuordnungen | SHA-256 unverändert gegenüber dem gemeinsamen Dateiabruf |
| Freigegebene Aufträge / Journaleinträge | weiterhin 0 / 0 |

Die Datenbank bestätigt abgeschlossene Modellprüfungen am 03.11.2026 um 19:31:04 und 19:31:25 MEZ, ohne verbleibende Lease. Die letzte QA-Node lieferte zwei Ergebnisse mit `can_upload:false` und `can_publish:false`. Die n8n-Oberfläche zeigte dabei noch einen weiterlaufenden Gesamtzähler; dieser wird ausdrücklich nicht als Laufzeitnachweis verwendet. Fachlicher Nachweis sind die beiden abgeschlossenen Datenbankergebnisse und die erfolgreiche abschließende Prüfnode. Die flüchtige Ausführungsanzeige wurde anschließend geleert.

Bei beiden Texten ist die beschriebene Mechanik anhand der gespeicherten Beobachtungen noch nicht ausreichend belegt; bei YouTube zusätzlich der Hotel-Bezug. Das ist eine Modellrückfrage zu begrenzten Belegen, kein Beweis, dass die Aussage im vollständigen Video falsch ist. Die gespeicherten Beiträge bleiben unverändert. Die konkreten Zitate werden nur im privaten Prüfdatensatz gespeichert.

![Abgeschlossener Prüfnode mit beiden gesperrten Kanalwegen](evidence/content-comparison-20261103.jpg)

## Bindung und Freigabegrenzen

`publication-content-comparison.sql` reserviert einen privaten Prüfdatensatz pro SHA-256-Fingerabdruck aus Eigentümer, vollständiger Dateizuordnung, gespeicherten Texten, aktueller Analyse und Prüfpolicy. Vor Start, Abschluss und Anzeige werden die maßgeblichen Daten erneut gelesen. Datei- und Zuordnungsrevisionen, Shop-Ziel, Analysepolicy, Dateiprüfsumme, Dateigröße und frischer Katalogstand müssen passen. Ein geänderter Text oder Beleg erbt kein altes Ergebnis.

Der Start ist auf sechs Versuche pro Eigentümer und Stunde begrenzt. Eine vierminütige Lease bindet den Abschluss. Ein bereits versuchter Fingerabdruck wird nicht automatisch kostenpflichtig wiederholt; ein abgeschlossenes Ergebnis wird aus dem Cache gelesen. Das Modell darf ausschließlich ein geschlossenes Ergebnisschema mit exakten Zitaten aus den gespeicherten Texten liefern. Unvollständige Antworten, fremde Zitate, unbekannte Felder und modellseitige Freigaben werden zurückgewiesen. Fehler werden ohne rohe Providerantwort gespeichert.

Die bestehenden Medienchecks werden ausschließlich im konkreten Auftrag um `PORTAL_TEXT_COMPARISON` ergänzt. Bei Rückfragen bleibt er `pending`; ein passender Text kann hier `pass` erhalten. `SEMANTIC_REVIEW_PENDING`, `CONTENT_REVIEW_PENDING`, sämtliche Rechtebestätigungen und die finale Zustimmung bleiben unabhängig davon bestehen. Der vorhandene Dialog zeigt offene Rückfragen über seinen bestehenden Text-Renderer. Keine Änderung an UI-Code, Schrift oder CSS.

Die Projektion wurde mit den beiden echten aktuellen Bindungen nach einem erfolgreichen Dashboard-Katalogabgleich um 19:38 MEZ geprüft: aktueller Kontext, unveränderte Titel-/Caption-Prüfsummen und sowohl neuer Hinweis als auch bisherige Medienblocker vorhanden. Für diese Prüfung wurde kein neuer Kundenauftrag angelegt. Eine erneute visuelle Abnahme des Auftragsdialogs ist damit nicht behauptet.

## Betrieb und Reproduktion des isolierten Ersttests

Beim Ersttest war die Modellstrecke eine unveröffentlichte interne Kopie ohne öffentlichen Webhook und noch nicht automatisch mit der Auftragsvorbereitung verbunden. Die gespeicherten Ergebnisse wurden bereits durch die installierte Auftragsprojektion gelesen. Der automatische Anschluss ist inzwischen umgesetzt und unten dokumentiert.

```sh
python3 n8n/publishing/build-content-comparison.py
python3 n8n/publishing/build-content-comparison-rehearsal.py \
  --input /private/selected-bindings.json \
  --workflow-id 1qMj37a5gXlrbCWd \
  --output /private/content-comparison-qa.json
node --test tests/*.test.cjs
node tests/run-publication-comparison-sql.mjs
node tests/run-publication-accounts-sql.mjs
```

Bei Neuinstallation zuerst die vorhandenen Datei-, Analyse- und Kontodefinitionen, danach `publication-content-comparison.sql`, dann `publication-orders.sql` installieren. Live angewendet: `publication_stored_content_comparison_20261103` und `publication_comparison_order_projection_20261103`. Vor der Änderung war der Funktionsrumpf von `publication_order_media_v1` exakt gleich dem vorherigen Repositorystand. Nur diese vorhandene Funktion wurde für die Projektion ersetzt; sonst additive Funktionen und private Tabelle.

Die beiden Abschlussexporte wurden gegen die Generatoren geprüft: gleiche Nodeparameter, Code, Credential-Referenzen und Verbindungen; n8n entfernt beim Execute-Workflow-Node das Standardfeld `source:database` und erneuert IDs/Positionen beim Import. Beim isolierten Ersttest waren beide Kopien `active:false`, ohne Pins oder Ausführungsdatenspeicherung, ohne Fortschrittsspeicherung, nur gleicher Eigentümer, MCP aus; Zeitlimits 210 beziehungsweise 450 Sekunden. Die Vorlagen verwenden die bereits vorhandenen OpenAI-/Supabase-Verbindungen. Es gab keine neue Berechtigung oder Tarifänderung.

Validierung: **301 Node-Tests bestanden**. Vergleichs-, Konto-, Auftrags- und Creator-SQL-Prüfreihen bestanden lokal unter PGlite/PostgreSQL 18; Vergleichs-, Auftrags- und Creator-Fälle zusätzlich auf der produktiven PostgreSQL-17-Instanz mit synthetischen, zurückgerollten Fixtures. Rollenrechte, geänderte Belege/Texte, falsche Leases, Wiederholungen, exakte Zitate und unveränderte Medienblocker sind abgedeckt. Keine neue Sicherheitsberater-Warnung. Für die absichtlich service-interne Tabelle entsteht derselbe INFO-Hinweis „RLS Enabled No Policy“ wie bei den übrigen privaten Servicetabellen; Kundenrollen besitzen keine Tabellen- oder Funktionsrechte. [Hinweisbeschreibung](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Sightengine bleibt bei `VIDEO_PLAN_REQUIRED`. Vollständige visuelle Sicherheitsprüfung, ausdrückliche Nutzerfreigabe und tatsächlicher Providerbetrieb bleiben offen. Meta und Serverumbau bleiben außerhalb dieses Schritts. Zum inzwischen angeschlossenen Upload-/Ergebnisweg: [PROVIDER_RESULTS.md](PROVIDER_RESULTS.md).

## Automatische Auftragsansteuerung – Live-Anschluss PR #57

Die additive Migration `publication_comparison_delivery_v1` ist installiert. Neue YouTube-/TikTok-Videoaufträge legen ihre Abgleichaufgabe in derselben Transaktion an. Queue-Leases, Fingerabdruck und der vorhandene Vergleichscache verhindern parallele Zustellung und doppelte Modellversuche. Stornierte Aufträge werden nicht verarbeitet.

Veröffentlicht sind der Vergleichsunterworkflow **`1qMj37a5gXlrbCWd`** (11 Nodes), die interne Zustellung **`ZFO9NSh5nHSn3ues`** (8 Nodes) und die ergänzte Auftrags-API **`RdtCqCWRi7P4W7B0`** (32 Nodes). Die API sendet zuerst ihre bisherige bereinigte Dashboard-Antwort und führt danach den Unterworkflow mit `waitForSubWorkflow:true` aus. Das Dashboard wartet damit nicht auf den Inhaltsabgleich; n8n behält den ausführenden Auftrag bis zum Abschluss. Ein erneutes authentifiziertes `get` kann einen verlorenen Start wieder aufnehmen. Es gibt keinen zusätzlichen Zeittrigger oder öffentlichen Einstieg.

Der vorherige entkoppelte Aufruf mit `waitForSubWorkflow:false` ließ im Live-Test die Vergleichsaufgabe auf `queued`. Der isolierte Vergleich funktionierte. Eine interne n8n-Ursache ist nicht bewiesen; der abschließend getestete Ablauf verwendet deshalb die Fortsetzung **nach** `Dashboard-Antwort` und wartet intern auf den Unterworkflow. Fehler können die bereits gesendete Antwort nicht mehr verändern oder eine zweite Antwort senden. [n8n: Ausgabe des Respond-to-Webhook-Nodes](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/).

Die ausdrücklich genehmigten Einstellungen sind gespeichert: keine erfolgreichen, fehlgeschlagenen oder manuellen Ausführungsdaten, keine Fortschrittsspeicherung; nur Unterworkflows desselben Eigentümers, MCP aus. Limits: Vergleich 210 s, Zustellung 270 s, API und Providerweg 600 s. Die Exporte wurden mit den Generatoren abgeglichen, einschließlich des korrigierten If-Ausdrucks ohne `.binding` im n8n-Parameter. Temporäre Diagnose-Pins wurden entfernt; die abschließende API enthält keine Pins. Die 23 bisherigen API-Nodes sind unverändert.

### Live-Nachweis am 03.11.2026

- YouTube: Nach der Korrektur löste „Status erneut laden“ die Zustellung aus; Queue-Abschluss um **21:17:55 MEZ**. Der vorherige isolierte Diagnoselauf ist davon getrennt.
- TikTok: Ein neuer Vorbereitungsauftrag schloss seinen Vergleich automatisch um **21:21:24 MEZ** ab, knapp drei Sekunden nach Auftragseinfügung.
- Beide Wege verwendeten exakt die bestehenden abgeschlossenen Vergleichsfingerabdrücke. Keine neue Modellprüfung, keine Änderung der gespeicherten Titel/Captions. Beide Queue-Einträge waren `completed`, ohne offene Lease und ohne neuen Modellzustellversuch.
- In beiden Dialogen waren die konkreten Inhaltsfragen sichtbar; Medien-/Rechtebestätigungen und finale Zustimmung blieben leer, die Freigabeschaltfläche gesperrt. Anschließend wurden ausschließlich die zwei eigenen Testaufträge unter Eigentümer-, Status-, Lease- und Journalprüfung storniert.
- **314 Node-Tests bestanden.** Die bereits geprüften SQL-Definitionen blieben bei diesem Anschluss unverändert. [Providerjournal und Wiederaufnahme](PROVIDER_RESULTS.md).

```sh
python3 n8n/publishing/build-comparison-delivery.py
python3 n8n/publishing/build-publication-orders.py \
  --worker-id zLlhr1I1vKm2AiiU --account-id LR2Qng41OIYuVHAR \
  --comparison-delivery-id ZFO9NSh5nHSn3ues \
  --provider-dispatch-id JPtiMBrudXLxxSrz
node --test tests/*.test.cjs
node tests/run-publication-delivery-sql.mjs
```

Sightengine `VIDEO_PLAN_REQUIRED`, die inhaltlichen Rückfragen und die ausdrückliche Freigabe eines echten Uploadtests bleiben separate offene Voraussetzungen. Der Anschluss selbst ist keine Medien- oder Uploadfreigabe.
