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

## Gemeinsamer Auftrag für Original und Editor-Ausgaben

Die zusätzliche SQL-Datei `supabase/sql/file-job-export-family.sql` erweitert
die installierte Mailbox. Sie wird nach `file-command-mailbox.sql` angewendet;
die ursprüngliche Migration bleibt unverändert. Die Erweiterung verwendet
dieselben öffentlichen Upload-/Asset-Anker, dieselben neun Operationen und
dieselben nativen Worker.

Ein Editor-Export weist seine Mediendatei und sein optionales Cover bereits
serverseitig über Export-ID, separate Cover-Upload-ID, Quelle, Entwurfsstand,
Ausgabehashes und Größen nach. Nur diese nachgewiesene Zugehörigkeit erlaubt
den Beitritt zum aktiven Auftrag der Quelle. Beliebige Dateien desselben
Kunden werden dadurch nicht zu einer Datei zusammengefasst.

Jeder zugehörige Upload behält seine eigene Upload-ID und seine ursprüngliche
private Startreservierung. Upload-Commands werden pro Auftrag, Operation und
Upload-ID kanonisch dedupliziert. Die öffentliche Antwortprojektion liest
Abschluss und Ablauf für genau diesen Upload. Die Quell-Assetbindung des
Hauptauftrags wird durch fertige Mediendateien oder Cover nicht überschrieben.
Alle Ansichten prüfen vor der Ausgabe einer Upload-Adresse erneut die aktuelle
Kunden- und Uploadbindung, auch wenn kein einzelner Command angefordert wurde.

Bestätigte Ergebnisdateien erhalten private Zuordnungen zum selben Auftrag.
Auch eine Dateiauswahl zwischen tatsächlichem Uploadabschluss und der späteren
Mailbox-Ergebnisquittung muss diesen Auftrag finden. Spätere Magic-, Review-
und Auftragsaktionen bleiben an die konkrete eigene Datei und Revision gebunden.
Bereits getrennt laufende ältere Aufträge haben Vorrang; sie werden nicht
zusammengeführt. Ein vollständig bestätigtes älteres Exportergebnis kann nach
Ende seines separaten Auftrags einem bereits aktiven Quellauftrag beitreten.
Unklare Ergebnisse, die Grenze von 64 Commands und die feste
24-Stunden-Frist erhalten keine zusätzliche Start- oder Verlängerungsmöglichkeit.

Die unabhängige SQL-Suite liegt in
`tests/file-job-export-family.test.mjs`. Die bisherigen Mailbox-Szenarien laden
die Erweiterung ebenfalls, nachdem sie die ursprünglichen Fachfunktionen mit
dem vorhandenen Produktionsmetadatenbeleg abgeglichen haben. Sämtliche Medien-
und Kundenzeilen in diesen Tests sind synthetisch; es werden keine Bytes an
Provider übertragen.

### Planungsrechnung für 20 Kunden

Dies ist ein Nutzungsmodell, kein gemessener Abrechnungswert. Es setzt
20 Kunden, drei neue Quelldateien je Kunde und Tag, 31 Tage und die Verarbeitung
einer zusammengehörigen Datei innerhalb derselben 24-Stunden-Frist voraus.
Eine fertige Exportdatei mit Cover und ihre Folgeaktionen benötigen in diesem
Modell keinen weiteren Hauptstart.

| Bestandteil | Angenommene Hauptstarts pro Monat |
| --- | ---: |
| 20 × 3 × 31 Datei-Aufträge einschließlich zugehöriger Exportausgaben | 1.860 |
| Ein Originalabruf pro Datei | 1.860 |
| Ein Vorschaubild-Batch pro Datei | 1.860 |
| Ein Katalogabruf pro Kunde und Tag | 620 |
| Ein Dashboardabruf pro Kunde und Tag | 620 |
| Ein gemeinsamer Stundenlauf | 744 |
| **Summe** | **7.564** |
| **Verbleibend bis 10.000** | **2.436** |

Vor der Familienzuordnung hätten zusätzliche Mediendatei und Cover in diesem
Szenario bis zu 3.720 weitere Hauptstarts erzeugt: insgesamt 11.284. Werden
Originalansicht und Exportvorschau in getrennten Fenstern, nach einem Neuladen
oder außerhalb der unten beschriebenen Speichergrenzen geladen, kann
weiterhin ein zweiter Originalabruf pro Datei hinzukommen. Das ergibt nach der
Zuordnung 9.424 Starts und 576 verbleibende Starts. Weitere Abrufe, neue Arbeit
nach Ablauf, zusätzliche Dienste und tatsächliche Wiederholungen müssen in
einer betrieblichen Verbrauchsmessung mitgezählt werden; die Zahl 7.564 ist
keine pauschale Kapazitätszusage.

Nach den [veröffentlichten n8n-Quotaregeln](https://docs.n8n.io/build/understand-workflows/understand-executions.md)
zählen native Unterworkflow-Aufrufe nicht als weitere monatliche
Hauptausführungen. Zusätzliche Einträge in der Ausführungsliste sind deshalb
nicht automatisch zusätzliche abgerechnete Hauptstarts. Die native Zuordnung,
die tatsächliche Laufzeit und der Cloud-Abrechnungszähler bleiben unabhängig
von den SQL-Tests zu kontrollieren.

## Abrufe während Navigation und Bearbeitung

Ein normaler Wechsel zu „Veröffentlichung“ liest die gespeicherte Dateiliste
direkt aus Supabase. Er startet keinen Drive-Abgleich über n8n. Der ausdrückliche
Button „Dateien aktualisieren“ behält diesen Abgleich; die Prüfung eines laufenden
Abgleichs und die Wiederholung eines fehlgeschlagenen Listenabrufs bleiben reine
Status-/Listenabfragen. Die vorhandene Dateifrischeprüfung vor eigentlichen
Verarbeitungsaktionen bleibt bestehen. Dateien, die außerhalb von SMA in Drive
hinzukommen, werden weiterhin durch den ausdrücklichen Abgleich gefunden.

### Gemeinsamer Katalogabgleich vor dem n8n-Start

Galerie, Veröffentlichungsansicht und Editor verwenden denselben
`refreshMediaCatalog`-Adapter. Gleichzeitig angeforderte Abgleiche desselben
Kunden und tatsächlichen Katalogendpunkts teilen im selben SMA-Fenster einen
laufenden POST. Nach einem gesendeten Start bleibt ein 15-Sekunden-Abstand
wirksam, auch wenn eine Ansicht geschlossen oder die Antwort unterbrochen wird.
Ein einzelner Abbruch beendet nicht die Anfragen anderer beteiligter Ansichten.
Der Transport läuft im langlebigen übergeordneten Fenster.

Vor jedem neuen POST liest der Adapter über den vorhandenen
`sma_publication_files_v1`-RPC die Aktion `sync_status` mit leerem Input.
`publication-file-sync-preflight.sql` ergänzt dafür ausschließlich einen
Lesezweig hinter den bestehenden Auth-, Kunden- und Zugangskontrollen.
Die Antwort enthält Zustand, verbleibende Wartezeit und letzten Abschluss,
aber keine Kundenkennungen, Lease-ID oder Ordnerdaten. Sie reserviert keinen
Abgleich. Eine bereits laufende Lease oder Startpause wird dadurch vor dem
kostenpflichtigen Webhook-Aufruf erkannt. Eine fehlende oder ungültige
Statusantwort erlaubt keinen ersatzweisen Start.

Erfolg wird nicht zwischengespeichert und ein blockierter Start nicht als
abgeschlossener Abgleich ausgegeben. Alle Phasen eines Versuchs bleiben auf
insgesamt 90 Sekunden begrenzt; der Editor schließt darin auch das anschließende
Lesen der aktualisierten Dateiliste ein. Nach Abbruch oder Antwortverlust gibt
es keinen automatischen weiteren POST. Ein späterer ausdrücklicher Versuch
prüft den Serverstatus erneut. Der gespeicherte Dateistand und lokale Eingaben
bleiben in den bestehenden Fehler- und Wiederholungspfaden erhalten.

Die gemeinsame Browserkoordination gilt für Ansichten desselben übergeordneten
Fensters. Getrennte Tabs oder Geräte können gleichzeitig noch einen freien
Serverstatus lesen, bevor der erste Worker seine Lease reserviert. Der
bestehende serverseitige Startschutz bleibt deshalb erforderlich; diese
Leseprüfung ist keine globale atomare Startreservierung und keine Begrenzung
auf genau einen Abgleich je Kunde und Tag. Es entsteht weder ein zusätzlicher
n8n-Workflow noch ein neuer Hintergrundtimer.

Die synthetischen Tests `catalog-refresh*.test.*` prüfen die tatsächlichen
Adapter, Gleichzeitigkeit, Abbruch, Kontowechsel, Gesamtfrist und den Wegfall
unnötiger POSTs. Die Browserfälle laufen auf Desktop und Mobilgeräten in CI.
`publication-file-sync-preflight.test.mjs` prüft die tatsächlichen SQL-Funktionen
einschließlich öffentlichem Wrapper, Lesezugriff, Zeitgrenzen und unveränderten
Berechtigungen. Bei der Bereitstellung muss der SQL-Lesezweig vor den neuen
Frontenddateien verfügbar sein.

### Gemeinsame Originalabrufe

Originalplayer, Exportvorschau, Coveransicht und gespeicherter Download verwenden
denselben geprüften Originalabruf über `media-editor-api.mjs`. Der begrenzte
RAM-Speicher in `original-media-cache.mjs` teilt laufende Anfragen und erfolgreich
geprüfte Mediendaten innerhalb desselben gleichursprünglichen Hauptfensters.
Das Hauptfenster führt den gemeinsamen Abruf aus, damit das Schließen der
zuerst lesenden Unteransicht andere Verbraucher nicht unterbricht. Einbettungen
ohne das gemeinsame Modul im Hauptfenster verwenden einen eigenen lokalen
RAM-Speicher.
Er hält höchstens zwei Originale mit zusammen 48 MB und verwendet Einträge nur
innerhalb von zehn Minuten. Gleichzeitig laufende Originalabrufe sind auf zwei
begrenzt. Die bestehende
Grenze von 24 MB pro Original bleibt erhalten.
Quelle, Revision, Route, erwarteter Dateityp und Größe müssen passen; jede Nutzung
prüft die aktuelle Sitzung. Logout und Kontowechsel verwerfen gespeicherte und
laufende Daten. Der Abbruch eines einzelnen Verbrauchers beendet keinen Abruf,
den eine andere Ansicht noch benötigt.

Es werden keine Mediendaten, Tokens oder Provideradressen dauerhaft gespeichert.
Ein echtes Neuladen oder ein separates Fenster mit `noopener` besitzt einen
eigenen Speicher und benötigt wieder einen Abruf. Auch Ablauf und Verdrängung
aus dem begrenzten Speicher können einen neuen Abruf erforderlich machen.
Eine Einsparung über diese Grenzen hinweg ist nicht zugesagt.

Die Navigation wird mit der echten Dashboard-Funktion in
`tests/gallery-navigation-read-budget.test.cjs` geprüft. Die
`tests/original-media-cache*.test.*` prüfen den tatsächlichen Client, Editoraktionen,
Kontowechsel, Abbruch und Browserfenster. Browserprüfungen fangen sämtliche
Provider-/Authantworten synthetisch ab; sie übertragen keine echten Medien und
starten keine n8n-Workflows.
