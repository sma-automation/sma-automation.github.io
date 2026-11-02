# Neue Beschreibung je Veröffentlichung

Stand: 2. November 2026. Implementierung für den künftigen internen Server-Worker, **noch nicht live angeschlossen**. `publication-caption.cjs` ergänzt den vorhandenen Textgenerator; es veröffentlicht nichts und setzt immer `can_publish:false`.

## Verbindliches Verhalten

Eine neue geplante Veröffentlichung erhält eine neue `publication_id` und einen eigenen Beitragstext. Das gilt auch bei unveränderten Medienbytes. Wiederholungen desselben Auftrags verwenden dieselbe ID und exakt den bereits reservierten Text. Die ID gehört zur fachlichen Veröffentlichung, nicht zum HTTP-Versuch, Scheduler-Durchlauf oder zufällig neu erzeugten Dateinamen. Ein Scheduler darf bei einem Timeout keine neue ID erzeugen.

Der Verlauf gilt je Kunde über alle verwalteten Konten und Portale hinweg. Dadurch zählt auch das erneute Verwenden derselben Caption auf einem anderen Portal als Wiederholung. Fremde Kundenverläufe werden weder verglichen noch dem Modell gezeigt. Die Profil-Bio ist kein Textfeld pro Datei und wird nicht automatisch geändert.

Verglichen wird der eigentliche `body`, ohne Titel, Hashtags und wiederkehrenden Shop-Footer. Großschreibung, Leerzeichen, unsichtbare Formatzeichen, Satzzeichen und Emojis begründen keine neue Formulierung. Ein konservativer Wort-/Zeichenvergleich weist zusätzlich sehr ähnliche Texte zurück. Die Schwellen sind eine **SMA-Heuristik**, keine Portalregel, kein Originalitätsnachweis und kein semantischer Ähnlichkeitsbeweis. Semantisch gleichartige Paraphrasen können unerkannt bleiben, sachlich verschiedene Texte können zur Überarbeitung zurückgegeben werden.

Der Text muss weiterhin zu tatsächlich geprüften Aussagen passen. Neue Preise, Wirkungen, Anwendungsfälle oder Anlässe dürfen nicht zur erzwungenen Variation erfunden werden. Es gibt keine unbegrenzte Garantie sinnvoller Varianten aus begrenztem Ausgangsmaterial. Nach einer Ablehnung muss die Vorbereitung korrigiert oder zur redaktionellen Prüfung angehalten werden; keine Endlosschleife mit zufälligen Zusätzen.

## Aufrufvertrag

1. Der authentifizierte Server lädt die aktuelle Kunden-/Kontozuordnung, Medienrevision und SHA-256 sowie Produkt- und Analyse-Snapshots. Kein Browser darf `customer_id`, Evidenz oder `complete:true` als vertrauenswürdigen Nachweis liefern. Hashes erkennen Veränderungen, authentifizieren aber keinen Aufrufer.
2. `planCaption(context, history)` gibt `generate` mit dem bestehenden strengen Modellrequest oder `reuse` mit dem gespeicherten Kandidaten zurück. Höchstens 20 frühere Beschreibungen gelangen als untrusted Beispiele zum Modell. Der deterministische Vergleich verwendet den **gesamten gelieferten Verlauf**.
3. `prepareCaption(response, context, history)` validiert den vollständigen Entwurf und prüft Wiederholung. Auch manuell bearbeitete Entwürfe müssen diesen Weg erneut durchlaufen. Es gibt keinen automatischen Modellaufruf und keine automatische Regeneration in diesem Modul.
4. `reserveCaption(store, candidate, context)` reserviert vor Freigabe/Upload den unveränderten Kandidaten. Geänderte Eingaben, parallele Reservierung und veraltete Verlaufsrevision werden erkannt. Erst nach erfolgreichem Commit ist eine Reservierung bestätigt. Reservierung ist keine Veröffentlichungserlaubnis.
5. Semantischer Abgleich, Wiederverwendungsentscheidung, Rechts-/Kennzeichnungsprüfung, Shop-Platzierung und finale Nutzervorschau/Freigabe folgen separat. Die spätere Freigabe muss genau den reservierten Text samt Medienvariante und Zielkonto binden. Ein Bearbeiten nach Reservierung erfordert eine nachvollziehbare neue Revision; diese Revisionierung ist noch zu integrieren. Alte reservierte Texte bleiben im Verlauf.

`context` enthält den bisherigen Vorschaukontext und `publication` mit `publication_id`, `customer_id`, `account_id`, `asset_id`, `asset_revision`, `platform`, `format`, `content_sha256`, `evidence_sha256`, `product_snapshot_sha256`. Die Snapshots werden an die Eingabe gebunden; damit wird ihre fachliche Richtigkeit noch nicht bestätigt. Unterstützte Formate im Vertrag: YouTube Video/Short, Instagram Bild/Reel, Facebook Bild/Video/Reel, TikTok Video. Dies schaltet keine neuen Upload-Adapter frei.

`history` enthält `customer_id`, `complete`, monotone `revision` und unveränderliche `entries`. Fehlender, fremder oder unvollständiger Verlauf sperrt den Aufruf. Grenze des gegenwärtigen In-Memory-Vergleichs: 10.000 Einträge bzw. 20 Millionen JSON-Zeichen. Überschreitung erzeugt einen Fehler, keine stillschweigende Kürzung. Für größere Verläufe ist ein geprüftes Datenbankverfahren erforderlich.

## Erforderlicher dauerhafter Speicher – noch offen

`store.transaction(customerId, callback)` ist ein bewusst verpflichtender Adaptervertrag, **keine bereits existierende Datenbankanbindung**. Der Adapter muss:

- die Historie dieses Kunden während Lesen, Vergleich und Schreiben exklusiv sperren und die Änderung atomar committen;
- `tx.read()` und `tx.write(nextHistory)` innerhalb derselben Transaktion bereitstellen; Schreibfehler vollständig zurückrollen;
- einmalige Veröffentlichungsschlüssel und normalisierte Texthashes innerhalb des Kunden zusätzlich in der Datenbank absichern; konkurrierende Schreibwege dürfen den Vertrag nicht umgehen;
- vollständige reservierte/verwendete Texte, Dateihashes, endgültige Payloads und deren Versionsbezüge dauerhaft aufbewahren; ein abgebrochener oder gelöschter Beitrag darf die Wiederholungskontrolle nicht stillschweigend zurücksetzen;
- bestehende SMA-Veröffentlichungen vor Aktivierung nachvollziehbar importieren. Solange dieser Verlauf fehlt, `complete:false` setzen. Außerhalb SMA manuell veröffentlichte Beiträge sind ohne autorisierten Import nicht erfasst; eine weltweite Einmaligkeit wird nicht zugesichert;
- Rechte bei Reservierung und unmittelbar vor Upload erneut prüfen. Sicherung/Wiederherstellung und Ausfall nach Commit müssen getestet werden.

Die Tests verwenden einen ausdrücklich nur im Speicher arbeitenden Transaktionsadapter. Sie belegen Konkurrenz- und Wiederholungsverhalten des Vertrags, **keine produktive Datenbanktransaktion**. Ein produktiver Adapter, Migration, UI und Publisher-Anbindung bleiben notwendige Arbeit.

## Medien und Shop getrennt prüfen

Identische Inhaltsbytes werden unabhängig vom Dateinamen als zuvor reserviert markiert. Auch bei anderer Caption bleibt `originality:pending`. Ein anderer Hash beweist ebenfalls keine Originalität: eine Neukodierung desselben Videos kann einen anderen Hash haben. Visueller/akustischer Vergleich, eigene Urheberschaft, zulässige Wiederverwendung und Mehrwert benötigen eine separate Entscheidung. Es werden keine kosmetischen Medienänderungen zur Umgehung von Plattformprüfungen erzeugt.

Das Modul übernimmt die bestehende Vorschau einschließlich Shop-Footer. `shop_placement:pending` bleibt deshalb ausdrücklich bestehen. Der Footer ist kein Nachweis einer klickbaren oder erlaubten Link-Platzierung. Insbesondere die TikTok-Editierbarkeit und die Platzierung von Eigenwerbung müssen vor einem Upload geklärt werden. Die bisherige Vorschau darf nicht als finale universelle Publisher-Payload weitergereicht werden.

## Tests

13 gezielte Tests: neue Texte auf gleichen Medien, kosmetische und sehr ähnliche Wiederholungen, mehrere Portale/Konten, umbenannte Dateien, fremder/unvollständiger Verlauf, identische Retry-Ausgabe, geänderte Datei/Evidenz/Produktgrundlage, Konkurrenz, Schreibausfall, widersprüchliche Kandidaten, manipulierte Snapshots und Vergleich auch jenseits der 20 Modellbeispiele. Im Gesamtlauf am 02.11.2026: 161 Node-Tests bestanden, 0 übersprungen, einschließlich der aktivierten echten Medien-/OCR-/Spracherkennungsfälle.
