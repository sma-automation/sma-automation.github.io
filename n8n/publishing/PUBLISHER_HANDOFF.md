# Gespeicherte Portaltexte: getrennte Übergabeprüfung

Stand: 3. November 2026. Die Prüfung bereitet die Übernahme der bereits gespeicherten Kundenentwürfe vor. Sie veröffentlicht und lädt nichts hoch; sie ist noch nicht mit einem bestehenden Publisher verbunden.

## Bestätigte Lücke

Der vorhandene, inaktive Kunden-Testworkflow wurde ausschließlich exportiert und gelesen. Seine Übergabe `Kundendaten – Publishing` enthält Kunden-ID und Kanal, aber keine gespeicherte Caption. In den nachfolgenden Nodes fehlt dadurch die Textübergabe:

| Vorhandener Weg | Beobachteter Stand |
| --- | --- |
| YouTube | Titel fällt auf Ersatztext zurück; Beschreibung kann leer bleiben |
| Instagram, Bild und Reel | Container-Erstellung enthält keinen Beitragstext |
| Facebook, Bild und Video | Upload-/Veröffentlichungsaufruf enthält keinen Beitragstext |
| TikTok, Video | `post_info.title` fehlt |

Dies ist eine Bestandsaufnahme des Exports, keine erfolgreiche API-Übertragung. Die geschützten Haupt- und Tagesworkflows sowie der vorhandene Kunden-Testworkflow wurden nicht geändert oder ausgeführt.

## Schnittstelle und Grenzen

`publisher-handoff.cjs` und der daraus erzeugte `publisher-handoff-workflow.json` bilden einen separaten internen Unterworkflow. Der einzige externe Aufruf liest die bestehende, ausschließlich für `service_role` zugängliche Funktion `sma_publication_assignment_v1`. Kein Webhook, kein neuer Browserzugriff, keine neuen Datenbankrechte, keine Upload-Nodes und keine neue Zugangsdatenverbindung.

Der vertrauenswürdige aufrufende Serverworkflow muss genau einen zuvor ausgewählten Stand übergeben:

```json
{
  "version": 1,
  "customer_id": 1,
  "drive_file_id": "synthetic_drive_file",
  "asset_id": "00000000-0000-4000-8000-000000000001",
  "asset_revision": "version:9",
  "platform": "youtube",
  "assignment_revision": 3,
  "preview_id": "00000000-0000-4000-8000-000000000002",
  "preview_revision": 1,
  "shop_url": "https://sma-automation.com/app/shop.html?shop=synthetic-test",
  "media_kind": "video"
}
```

Das Beispiel ist synthetisch. Kunden-ID und Auswahl dürfen später nicht ungeprüft aus Browserdaten in einen privilegierten Aufruf übernommen werden. Der RPC prüft aktiven Kunden, Dateibesitz, Verfügbarkeit, aktuelle Katalogrevision, gespeicherte Zuordnung und Shop. Der Unterworkflow vergleicht zusätzlich die vom Aufrufer erwartete Datei-, Zuordnungs- und Vorschauversion, Portal, Medientyp und Shop exakt mit der Antwort. Eine inzwischen neue Textzuordnung wird abgelehnt statt still übernommen.

Fehlender, ungültiger, mindestens 15 Minuten alter oder mehr als eine Minute in der Zukunft liegender Verifizierungszeitpunkt stoppt die Prüfung. Der Zeitstempel wird niemals durch diesen Baustein erneuert. Eine aktuelle Drive-Abfrage und erneute Prüfung unmittelbar vor einem späteren Upload sind weiterhin erforderlich: Der Katalog kann innerhalb seines Frischefensters veralten, und dieser Leseschritt sperrt keine Datensätze bis zur Veröffentlichung.

`draft.title`, `draft.body`, `draft.caption`, Hashtags und interne Prüfhinweise werden unverändert aus dem gespeicherten Entwurf übernommen. Die Caption muss exakt dem gespeicherten Text, den Hashtags und genau einer gültigen deutschen oder englischen Shop-Fußzeile entsprechen. Es gibt keinen Ersatztitel, keine automatische Kürzung, keine neue Generierung und kein erneutes Anhängen des Links. Prüfhinweise bleiben außerhalb des Beitragstexts.

`ok:true` bedeutet ausschließlich: Der ausgewählte gespeicherte Stand stimmt überein. `stage:handoff_preview`, `can_upload:false`, `can_publish:false` und die offenen Prüfpunkte bleiben immer gesetzt. Medienfehler und vorhandene Textfragen erscheinen zusätzlich als Blocker. Das Ergebnis ist kein API-Payload, keine unveränderliche Freigabe und keine Reservierung gegen Doppelpostings.

Vor Anschluss an die Publisher fehlen weiterhin: aktuelle Datei-/Byteprüfung, vollständige Medien- und Inhaltsfreigabe, konkretes Zielkonto und seine Berechtigungen, erforderliche Sichtbarkeits-/Werbekennzeichnungsentscheidungen, explizite finale Freigabe sowie ein transaktionales Veröffentlichungsjournal mit Wiederholungs- und Teilfehlerbehandlung. Die Videoerkennung ersetzt diese Prüfungen nicht. Keine Tariferweiterung ist freigegeben.

## n8n-Stand

Separat gespeichert: `LxayneKkUusok0Q8`, **SMA – Gespeicherte Portaltexte – Übergabeprüfung V1**. Unveröffentlicht. Die spätere [Publisher-Arbeitskopie](PUBLISHER_INTEGRATION.md) ruft diesen Baustein für ihre Textvorbereitung auf; ein ausführbarer Uploadpfad ist weiterhin nicht angeschlossen. Die exportierten Code-Parameter, Credential-Verweise, Verbindungen und Einstellungen wurden gegen die Repository-Definition abgeglichen. Erfolgreiche, fehlgeschlagene und manuelle Ausführungsdaten werden nicht gespeichert; Fortschrittsspeicherung ist aus, Laufzeit höchstens 60 Sekunden, Aufruf nur durch Workflows desselben Eigentümers, kein MCP-Zugriff.

## Validierung

- 244 Node-Tests erfolgreich, davon neun neue Übergabetests. Sie prüfen alle vier Kanäle in Deutsch/Englisch, Unicode und Absätze, exakte Versionen, veränderte Auswahl, fehlenden Zugriff, rohe Fehlerdaten, veraltete Zeitstempel, Medienfehler, unvollständigen Text, doppelte Links und fehlende Veröffentlichungserlaubnis.
- Die generierten Code-Nodes wurden im isolierten JavaScript-Kontext mit n8n-Ein-/Ausgabestruktur ausgeführt; zusätzliche Items werden abgewiesen. Der einzige HTTP-Node und die fehlenden Upload-/Webhookpfade werden geprüft.
- Nach tatsächlicher Aktualisierung des Kundenordners im angemeldeten Dashboard wurden alle vier vorhandenen dateigebundenen Entwürfe über den Live-RPC gelesen und durch den lokalen produktiven Prüfkern verarbeitet: Titel und Caption exakt gleich, jeweils ein Shop-Link, keine Upload-/Veröffentlichungsfreigabe. Keine Datenbankzeitstempel oder Kundentexte wurden für diesen Test verändert.
- Zusätzlich wurde der vollständige vierstufige n8n-Prüfbaustein manuell mit dem gespeicherten YouTube-Stand ausgeführt: echte Supabase-Abfrage erfolgreich, Titel und Caption zeichengetreu identisch, genau ein Shop-Link, `can_upload:false` und `can_publish:false`, alle sechs offenen Freigabepunkte erhalten. Nur die ausgewählte Eingabe war für diesen Test angeheftet; anschließend wurde sie gelöst und die sichtbare Ausführung bereinigt. Die Antwort des RPC und das Prüfungsergebnis waren nicht simuliert.
- Damit ist der isolierte n8n-Leseweg bestätigt, noch kein Aufruf aus einem produktiven Publisher und keine Portalübertragung. Private Kundenparameter und vollständige Texte werden nicht im Repository gespeichert.

```sh
python n8n/publishing/build-publisher-handoff.py
node --test tests/publisher-handoff.test.cjs
node --test tests/*.test.cjs
```

Grundlage für die spätere Adapterarbeit: [YouTube videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [n8n Unterworkflow-Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflowtrigger/). Meta-Endpunkte und Kontoumfang müssen vor ihrer Änderung separat verifiziert werden; die vorliegenden Exporte ersetzen diese Prüfung nicht.
