# Native Datei-Commands in bestehenden Workern

## Stand und Umfang

Private Importvorbereitung. Der Generator ändert Kopien von sechs bestehenden
Workflows; er erstellt keinen Workflow, führt keinen Command aus und ruft keine
Dienste auf. Die ursprünglichen Exporte bleiben unveränderte Rollbackgrundlage.
Die gemeinsame Zusammenführung und der Rollout erfolgen getrennt.

| Bestehende Quelle | Interne Dispatcheroperation | Feste Commandoperationen |
|---|---|---|
| Geräte-Upload `lo3Wt6jem0CxCrJF` | `media.device_upload` | `upload_start`, `upload_finish` |
| Fotoerkennung `dheEkIi8KUNqHpmq` | `content.image_analysis` | `magic_photo` |
| Videoanalyse `a1F5Ps0B3sXMh70S` | `content.video_analysis` | `magic_video` |
| Inhaltsprüfung `mWoUMjzxAsfggRHU` | `content.review` | `review` |
| Textvorschau `9dNstQ4E2uXpZ18Z` | `content.preview` | `preview_prepare` |
| Veröffentlichungsauftrag `RdtCqCWRi7P4W7B0` | `publication.order_api` | `account`, `order_prepare`, `order_approve` |

## Transport und Berechtigung

Der private Einstieg erhält genau ein Item mit
`{job_id, command_id, command_ticket, parent_execution_id}`. Er akzeptiert weder
ein Browser-JWT noch austauschbare RPC-Namen, Argumente, URLs oder Owner-IDs.
`child_execution_id` kommt ausschließlich aus der tatsächlichen Ausführung.

Als erster Dienstaufruf bindet der vorhandene serverseitige Credential den
Command über `sma_file_job_worker_v1('claim', ...)`. Der geprüfte Claim liefert
die feste Operation, ihren gespeicherten Originalinput, die rekonstruierte
Requestform und eine absolute Operationsfrist. Der Adapter prüft Operation,
Request-/Inputgleichheit, leere Headers und Frist, bevor er den Fachpfad erreicht.

Der öffentliche Eingang und seine ursprüngliche Bearer-Prüfung bleiben bestehen.
Nur die tatsächliche Ausführung des internen Einstiegs ersetzt das Transport-
Auth-Gate; ein Feld im öffentlichen Body kann diesen Zustand nicht setzen.
Sämtliche übrigen Eingabe-, Besitzer-, Revisions-, Ordner-, Medien-, Konto-,
Freigabe- und Providerprüfungen bleiben erhalten. Die ursprünglichen
authentifizierten RPCs werden intern über `reserve` aufgerufen: Die Datenbank
nimmt Funktion und Input ausschließlich aus dem gespeicherten Command.

Neue HTTP-Knoten kopieren ausschließlich die bestehende Service-Credential und
die zugehörige Supabase-Basisadresse. Es werden keine Credentialwerte exportiert,
keine neuen Credentials angelegt und keine Providersecrets in den Browser gegeben.
Alle neuen Code-Ausgaben sind auf `json`, `binary`, `pairedItem`, `error`, `index`
begrenzt. Engine-interne `metadata.subExecution` wird nicht weiterkopiert.

## Frühe Antwort und tatsächliches Arbeitsende

Die sechs bestehenden öffentlichen Antworten sind HTTP 200 mit JSON. Der native
Pfad speichert an genau dieser Stelle Status und denselben bereinigten Body über
`result`; er erreicht keinen öffentlichen Respond-to-Webhook-Knoten.

Bei Magic/Review und beim Auftrag ist die Antwort früh: Danach läuft der
vorhandene Fachpfad weiter. Das erfolgreiche Speichern einer Antwort beendet den
Command nicht. Erst dessen tatsächlicher Terminalpfad ruft `completed` auf.
Ein späterer Fehler bleibt `failed`/`WORKER_FAILED`, auch wenn die frühere Antwort
`ok: true` und `processing` enthielt. Ein bestätigter Cache-/Nichtarbeitsfall kann
dagegen unmittelbar erfolgreich abschließen.

Das private Child-Ergebnis lautet
`{ok, job_id, command_id, outcome, detail?}`. Es enthält kein Ticket. Die ursprüngliche
öffentliche Antwort steht in der Mailbox und wird durch spätere Fortschritte
nicht umgeschrieben.

## Fortsetzung des freigegebenen Providerauftrags

Ein nativer `order_approve` führt die vorhandenen Auftrags-/Providerknoten unter
demselben Command weiter. `order_continue` ist ein fester privater Worker-Schritt
derselben Kindbindung. Er liest ausschließlich die gespeicherte Order-ID und
liefert die ursprüngliche Orderansicht plus einen kleinen Journalstatus ohne
URLs, Tokens oder austauschbare Providerparameter.

Die Schleife nutzt die bestehenden Providerkinder und deren Journal-/Lease-/
Freigabeprüfungen. Sie legt weder einen Operatorpermit noch eine neue Freigabe,
Journalreservierung oder abweichende Veröffentlichung an. Zwischen Statusschritten
berücksichtigt sie die vorhandene 10-Sekunden-Pollgrenze; Warteschritte dauern
drei Sekunden und rufen ausschließlich den privaten Status-RPC erneut auf.
Ein laufender Inhaltsabgleich führt zu einer solchen Wartephase, ein negativer
Abgleich beendet den Command vor einem Provideraufruf.

Alle Schleifendurchläufe verwenden dieselbe ursprüngliche Frist: maximal den
Quellen-Timeout (Auftrag: 600 Sekunden), begrenzt durch `claim.deadline_at` und
zusätzlich den geerbten Konsolidierungskontext. Kein Zyklus erreicht einen Trigger
oder setzt den Fristmarker erneut. Vor Ablauf bleibt ein kleines Fenster für den
Fehlerabschluss. Eine ausbleibende Providerbestätigung wird nicht als Erfolg
behandelt.

**Praktische Grenzen:** Ein länger ausstehender Providerstatus, eine unklare
Initialisierung, `needs_review`, eine veränderte Bindung oder ein fehlender
vorhandener Uploadpermit bleibt ein nachvollziehbarer Fehler-/Prüffall. Die
bestehende Beschränkung des Journals auf YouTube/TikTok und der Guard
`UPLOAD_TEST_APPROVAL_REQUIRED` bleiben unverändert. Diese Adapter belegen weder
eine Freigabe echter Posts noch eine vollständig fertige Plattformanbindung.

## Private Erzeugung und gezielte Prüfung

```sh
node n8n/file-command/build-file-command.cjs PRIVATE_BEFORE_DIR PRIVATE_OVERLAY_DIR
SMA_COMMAND_SOURCE_DIR=PRIVATE_BEFORE_DIR node --test n8n/file-command/file-command.test.cjs
```

Ohne privaten Quellenpfad laufen dieselben gezielten Fälle mit den bestehenden
Repo-Workflows. Die Graphprobe führt tatsächliche Code-Bodies und Verbindungen
mit lokalen HTTP-, DataTable- und Child-Doubles aus. Sie prüft die öffentlichen
Antworten, alle neun festen Commandoperationen, Ticket-/Ownertransportgrenzen,
frühe Antwort plus spätere Fachfehler, einen mehrphasigen Providerablauf im selben
Child, Pollabstand und ursprüngliche Frist. Sie führt keine echte Zahlung,
Medienübertragung oder Veröffentlichung aus und ersetzt keine native Engine-
und SQL-Integrationskontrolle des fertigen Gesamtimports.

Die erzeugten JSONs und das Manifest bleiben außerhalb des Repositories. Das
Manifest bindet jeden Overlay an die SHA256 seines unveränderten Quellexports.
