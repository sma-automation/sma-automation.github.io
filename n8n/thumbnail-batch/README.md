# Gebündelte Kunden-Vorschaubilder

## Stand

Implementierung und private Importvorbereitung, noch nicht produktiv ausgerollt.
Die Offlineprüfungen rufen keine Dienste auf und laden keine Kundenmedien.
Ein Produktions- oder Verbrauchsnachweis ist damit nicht erbracht.

## Öffentliche Schnittstelle

Die bestehenden regulären und Pilotpfade bleiben erhalten. Anmeldung weiterhin
mit dem persönlichen Bearer-Token; die serverseitigen Eigentums-, Zugangs-,
Ordner-, Datei- und Revisionsprüfungen werden pro Bild unverändert ausgeführt.

Der bisherige Body `{asset_id, asset_revision}` und dessen JSON-Antwort mit
`image_base64`, `mime_type`, `media_kind`, Identität/Revision und
`can_publish: false` bleiben erhalten. Die öffentliche Antwort ist kein
Binärstream. Nur der vorhandene interne Drive-Ladeschritt verwendet Binary.

Der zusätzliche Body ist `{assets: [{asset_id, asset_revision}, ...]}` mit
1–10 eindeutigen Bindungen. Die Antwort lautet:

```json
{
  "ok": true,
  "can_publish": false,
  "assets": [
    {
      "ok": true,
      "asset_id": "gebundene Datei-ID",
      "asset_revision": "gebundene Revision",
      "media_kind": "video",
      "mime_type": "image/png",
      "image_base64": "geprüfte Bilddaten",
      "can_publish": false
    },
    {
      "ok": false,
      "code": "FILE_CHANGED",
      "asset_id": "andere gebundene Datei-ID",
      "asset_revision": "deren angefragte Revision",
      "can_publish": false
    }
  ]
}
```

Ein Dateifehler verwirft nicht die anderen Ergebnisse. Ungültige, doppelte,
überzählige oder fremde Antwortidentitäten werden clientseitig vor Übernahme
abgelehnt. Providerantworten, URLs und Credentials werden nicht durchgereicht.
Es gibt keinen automatischen Einzelbild-Fallback, der aus einem fehlgeschlagenen
Batch unbemerkt zehn neue Webhookstarts machen würde.

## Grenzen und Lebensdauer

| Grenze | Verhalten |
|---|---|
| Sammlung | 16 ms; höchstens zehn eindeutige sichtbare Bindungen pro Anfrage |
| Clientparallelität | Maximal drei laufende Batchrequests für alle Ansichten desselben Tabs |
| Clientfrist | Gemeinsame 45 Sekunden für Anmeldung, Transport und gestreamte Antwort eines gestarteten Batches |
| Einzelbild | Bestehende Obergrenze von 2.000.000 dekodierten Bildbytes |
| Gesamtantwort | Maximal 8 MiB UTF-8-JSON, serverseitig begrenzt und clientseitig beim Streamlesen geprüft |
| Gemeinsamer Cache | Höchstens 20 Bild-Blobs, unverändert 60 Sekunden, nach Besitzer, Endpoint, Datei, Revision und Medienart getrennt |
| Interne Verarbeitung | Ein einzelner nativer Unterlauf zur Zeit pro Batch; keine parallelen Dateiabrufe innerhalb eines Pakets |
| Arbeitsfrist am Server | Dieselbe absolute Frist von 35 Sekunden für alle Dateien; Prüfung vor jedem externen Schritt, HTTPtimeout maximal verbleibende Frist bzw. 25 Sekunden |

Passt ein Bild nicht mehr in die Gesamtantwort, bleibt für genau diese Bindung
ein Fehler stehen. Es werden weder Originalvideos noch beliebige Binärdateien
gebündelt. Die bestehende Bildtypprüfung bleibt maßgeblich.

**Grenze der Serverfrist:** Die 35 Sekunden sind eine Arbeitsfrist mit Gates und
Restzeit-HTTPtimeouts. Sie ersetzen keinen Cloud-Abbruch eines hängenden
DataTable-/Engine-Schritts. Die Overlays erhalten die vorhandenen harten
Timeouts ihrer Quellexporte: 120 Sekunden im Einzelworkflow und 180 Sekunden im
bisherigen gemeinsamen Medienpilot. Der anschließend konsolidierte Zielworkflow
hat eine eigene Timeoutkonfiguration; daraus folgt kein harter 35-Sekunden-Abbruch.
Das ist vor einem Rollout mit n8n zu prüfen; die Offlinegraphprobe beweist keine
Cloudlaufzeit.

Galerie, Dateiauswahl und ausgewählte Vorschau nutzen denselben Broker im
gleich-originigen obersten Fenster. Ein eigener Portalframe besitzt keinen
zweiten Bildcache. Das Schließen einer Ansicht entfernt nur deren Verbraucher;
Anfragen anderer Ansichten bleiben bestehen. Abmelden/Besitzerwechsel löscht
den gesamten passenden Besitzerkontext und bricht laufende Requests ab.
Verspätete Auth-, Transport- und Bodyantworten dürfen den Cache nicht auffüllen.
Ein verspätetes Aufräumen eines alten Besitzers löscht keinen neuen Kontext.

## Private n8n-Vorbereitung

`build-thumbnail-batch.cjs` verändert nur Kopien der beiden freigegebenen
Quellen. Die unveränderten Exporte bleiben Rollbackgrundlage. Liveexporte und
Importkandidaten gehören nicht in dieses Repository.

```sh
node n8n/thumbnail-batch/build-thumbnail-batch.cjs PRIVATE_BEFORE_DIR PRIVATE_OVERLAY_DIR
```

Der Transform erhält Quell-ID und versionId, alle öffentlichen Trigger,
Antwortformate, Credentials, Tabellen und bisherigen Fach-Code-Bodies. Lediglich
die HTTPtimeouts bekommen für interne Batchschritte eine Restzeitbegrenzung.
Katalog- und Originalzweige der Pilotquelle bleiben unverändert.

Pro Quelle kommt ein interner ExecuteWorkflowTrigger hinzu. Der Batch ruft
dieselbe Quelle nativ mit `mode: each` und `waitForSubWorkflow: true` auf. Seine
Eingaben sind einzelne bisherige Webhook-Items; vorhandene Binary bleibt auf
dem Item. Der übergeordnete Konsolidierungsbuilder führt die Ziel-ID und das
Envelope `{operation, payload, context: {deadlineAt}}` ein. Der Kontrollkontext
übernimmt gegebenenfalls die kürzere Elternfrist; `payload` bleibt das bisherige
Fach-JSON. Stabile Operationen:

- Regulär: `media.thumbnail.single`.
- Pilot: `media.thumbnail.pilot_single`.

Das interne Ergebnis endet in einer normalen Code-Ausgabe und erreicht keinen
Respond-to-Webhook-Knoten. Nur der äußere Batch sendet die öffentliche Antwort.
Ein intern eingespeistes `assets[]` wird nicht erneut gebündelt.

## Gezielte Offlineprüfungen

```sh
node --test tests/asset-thumbnail-timeout.test.cjs tests/thumbnail-batch.test.cjs
node --test n8n/thumbnail-batch/thumbnail-batch.test.cjs
SMA_THUMBNAIL_SOURCE_DIR=PRIVATE_BEFORE_DIR node --test n8n/thumbnail-batch/thumbnail-batch.test.cjs
```

Die Frontendprobe verwendet zwei getrennte JavaScript-Realms und synthetische
Bilddaten. Sie prüft unter anderem zehn sichtbare Bilder in einer Anfrage,
31 Bilder in vier begrenzten Batches, gemeinsame ausstehende Anfragen, Redraws,
IntersectionObserver, Besitzerwechsel, Fristen, partielle Fehler und Größen.

Die Backendprobe führt die tatsächlichen Code-Bodies und Verbindungen mit
lokalen HTTP-/DataTable-Doubles aus. Sie prüft die unveränderte Einzelantwort,
zehn eindeutig gebundene interne Aufrufe, gesperrte Dateien, abgelaufene Fristen
und die maximale Antwortgröße. Mit privaten Quellen werden zusätzlich deren
unveränderte Fachknoten und Geschwisterzweige geprüft. Das ersetzt keine native
n8n-Engineprobe.

## Konkrete native QA-Probe

`thumbnail-batch-native-probe.cjs` erzeugt ausschließlich eine synthetische
Fixture für einen bereits vorhandenen, inaktiven QA-Workflow. Sie enthält keine
Workflow-ID; der native Aufruf verwendet dynamisch `$workflow.id`. Es soll kein
weiterer Workflow angelegt oder aktiviert werden.

```sh
node n8n/thumbnail-batch/thumbnail-batch-native-probe.cjs \
  n8n/consolidation/dispatcher-runtime.cjs PRIVATE_QA_WORKFLOW_JSON
```

Die 16 Knoten bestehen nur aus einem Manualtrigger, genau einem internen
ExecuteWorkflowTrigger, einem nativen ExecuteWorkflow-Knoten und Code. Es gibt
keinen HTTP-, DataTable-, Provider-, öffentlichen Webhook- oder Credential-Knoten.
Wrapper, Validator, Fristmarker und Singleadapter werden bytegleich aus dem aktuell
bereitgestellten Konsolidierungsruntime eingebettet. Thumbnail-Normalisierung,
Einzelrückgabe und Collector stammen aus demselben Runtime wie die Kandidaten.

Die manuelle Route erzeugt zehn synthetische Asset-IDs mit einer kleinen
Text-Binary als Transportprobe. Der native Selbstaufruf läuft mit `mode: each`
und `waitForSubWorkflow: true`. Jedes Kind prüft genau eine Bindung, liest nur
seine bereits vorhandene Fixture-Binary und wartet synthetisch 100 ms, damit
überlappende Ausführungsfenster erkennbar wären. Das fünfte Ergebnis wird
absichtlich abgelehnt; neun Ergebnisse enthalten ein festes Testpixel.

Für die manuelle Enginekontrolle im bestehenden QA-Workflow:

1. Fixture dort importieren und speichern, ohne den Workflow zu aktivieren.
2. Vom Knoten `Probe · Manuell beginnen` den ganzen manuellen Ablauf starten.
3. In `Probe · Prüfergebnis` zehn verschiedene Kind-Execution-IDs, lückenlose
   `parent_paired_items` von 0 bis 9, nicht überlappende Arbeitsfenster,
   `native_sequential: true`, `mapped_1_to_1: true`, `unchanged_binary: true`,
   neun Erfolge und eine Ablehnung kontrollieren. Die geerbte Frist muss erhalten
   sein, `external_effects` muss 0 bleiben.
4. Den bisherigen QA-Stand anschließend gemäß der vorhandenen Sicherung
   wiederherstellen.

Der Generator führt diese Probe nicht aus. Die Offlineprobe kontrolliert ihre
Code-Bodies mit lokalen Doubles; erst der tatsächliche n8n-Lauf kann den
nativen Selbstaufruf und die Cloud-Ausgabe belegen.

Die korrigierte synthetische Fixture wurde am 16.11.2026 im vorhandenen QA-Workflow
bis zum vollständigen Receipt ausgeführt: zehn sequenzielle native Kinder,
neun Testpixel und eine absichtliche Ablehnung, unveränderte Binary/Payload,
Zuordnungen 0 bis 9 und erhaltene Elternfrist. Der erste Lauf hatte eine konkrete
Code-Ausgabe-Inkompatibilität mit `metadata.subExecution` gezeigt; der korrigierte
Adapter übernimmt nur die erlaubten n8n-Itemfelder. Diese Engineprobe belegt den
synthetischen Transport, keine produktive Medienabfrage oder Verbrauchsersparnis.

## Reihenfolge für einen späteren Rollout

Zuerst den geprüften Mediengruppen-Kandidaten mit beiden Batchoperationen
bereitstellen und die Rückwärtskompatibilität kontrollieren. Anschließend die
Frontendversion ausrollen. Die neuen Clientversionen sind Thumbnail v4,
Batchmodul v1, Veröffentlichungsscript v104 und eingebettete Vorschau v53.
Ein Browser mit dem bisherigen Einzelbildclient muss weiterhin funktionieren.
Bei einem Backend-Rollback zuerst den vorherigen Einzelbildclient wieder
bereitstellen. Es werden keine zusätzlichen aktiven Workflows benötigt.
