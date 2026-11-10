# Gemeinsamer Dateiabruf für YouTube und TikTok

Am 3. November 2026 wurde der gemeinsame Leseweg mit dem tatsächlich für beide Portale zugeordneten Kundenvideo erfolgreich geprüft. SMA liest die Datei aus Drive und bereitet je Kanal den gespeicherten Beitrag vor. Der Test überträgt keine Videodaten an YouTube oder TikTok.

## Beobachtetes Ergebnis

Separater manueller Workflow **QA – YouTube und TikTok – Gemeinsamer Dateiabruf**, ID `mQZxWmJ0Lms940Cr`, erfolgreiche Ausführung **4220**, Beginn der Kanalprüfung **19:02:40 MEZ**. Beide Kanalbindungen wurden in derselben Ausführung verarbeitet; die HTTP-Nodes verwenden eine gemeinsame Gruppe mit zwei Items und ohne Warteintervall. Beide Kanäle verwendeten dieselbe zugeordnete Videoquelle, aber unterschiedliche gespeicherte Beitragszuordnungen.

| Nachweis | YouTube | TikTok |
| --- | --- | --- |
| Aktive Kunden-, Ordner- und gespeicherte Zielkontozuordnung | bestanden | bestanden |
| Drive-Version vor und nach dem Download unverändert | bestanden | bestanden |
| Tatsächlich empfangene Bytes | 1.347.227 | 1.347.227 |
| Prüfsumme stimmt mit ausgewählter Datei überein | bestanden | bestanden |
| Gespeicherter Titel und Caption unverändert | bestanden | bestanden |
| Kanalspezifische Textfelder korrekt | bestanden | bestanden |
| Upload / Veröffentlichung freigegeben | nein | nein |

Der Download-Node erhielt und lieferte zwei Items. Die nachfolgende Byteprüfung war für beide erfolgreich. Die gespeicherten Portaltexte wurden über die unveränderte Arbeitskopie `JZwPbzCpgIByxk94` und deren echte Datenbankabfrage gelesen. Der Unterworkflow läuft dabei einmal je Item und wartet jeweils auf dessen Ergebnis. Der Test behauptet keine zeitgleiche Provider-Veröffentlichung. Seine Zeitstempel umschließen die Lese-/Prüfschritte; sie sind keine einzelnen Netzwerk-Start-/Endmessungen.

## Grenzen und Erhalt der Freigaben

Der Test bestätigt den gemeinsamen Dateiabruf und die getrennte Textzuordnung. Er ist keine Abnahme des vollständigen Veröffentlichungswegs: kein neuer OAuth-Providercheck, keine Rechtebestätigung, keine Auftragsfreigabe, kein Upload, kein Posting und keine Tarifänderung. Der konkrete Zielkontonachweis aus der Auftragsprüfung wird in diesem reinen Lesetest nicht erzeugt. Daher bleiben die allgemeinen Freigabeblocker einschließlich des generischen `TIKTOK_CREATOR_LIMIT` sichtbar; die kontogebundene Korrektur aus #55 bleibt unverändert.

Die bestehenden visuellen und semantischen Prüfungen bleiben offen. In der Datenbank wurden nach dem Lauf weiterhin **0 freigegebene Aufträge**, **0 Journaleinträge** und unverändert **9 Vorschauen** gezählt. Der Dateikatalog wurde zuvor über den echten Dashboard-Klick aktualisiert; keine Verifizierungszeit wurde künstlich erneuert.

Die geschützten Originalworkflows, Oberfläche, Schrift und Portalgestaltung wurden nicht geändert. Der Testworkflow hat ausschließlich einen manuellen Einstieg, einen Kunden-Leseknoten, drei Drive-GET-Nodes und den vorhandenen Text-Unterworkflow. Keine Provider-Upload-Nodes und kein öffentlicher Webhook.

## Reproduktion und Prüfung

`build-dual-channel-rehearsal.py` erzeugt die isolierte Kopie aus den vorhandenen Prüfkernen und einem privaten Auswahl-JSON. Das JSON enthält genau die beiden explizit ausgewählten Datei-/Beitragsrevisionen, die Kundenreferenz, erwartete Dateigrößen und SHA-256-Werte von Titel und Caption. Private Auswahl und vollständiger Workflowexport werden außerhalb des öffentlichen Repositorys gespeichert.

```sh
python3 n8n/publishing/build-dual-channel-rehearsal.py \
  --input /private/selected-bindings.json \
  --output /private/dual-channel-rehearsal.json
node --test tests/dual-channel-rehearsal.test.cjs
```

Der erste Live-Versuch stoppte vor dem Drive-Abruf, weil n8n den Feldnamen `binding` in einer HTTP-Expression als reserviert abwies. Die Testkopie reicht die bereits geprüfte Datei-ID deshalb als normales Feld `drive_file_id` weiter. Keine n8n-Sicherheitseinstellung wurde geändert. Der anschließende vollständige Lauf war erfolgreich.

Vier neue Prüfungen decken den ausschließlich lesenden Ablauf, getrennte Prüfsummen auch bei zwei unterschiedlichen synthetischen Dateien, vertauschte Caption-/Dateizuordnungen, doppelte Kanäle und unerwartete Uploadfreigaben ab. **290 Node-Tests bestanden.**

Abschlussexport `e296ab03-0be2-4df0-9cc9-b18820f5e3a8`: genau 12 Nodes, Parameter, Code, Credential-Referenzen und Verbindungen gegen den Generator abgeglichen. `active:false`, leere `pinData`, keine Speicherung erfolgreicher, fehlgeschlagener oder manueller Ausführungsdaten und kein Fortschrittsspeichern; Laufzeitlimit 150 Sekunden, nur gleicher Eigentümer, MCP aus. Die flüchtige Ausführungsanzeige wurde danach geleert. Die UI importiert Nodes zusätzlich und übernimmt Einstellungen nicht zuverlässig; bei Reproduktion nur in einer leeren Testfläche importieren und die gespeicherten Einstellungen erneut prüfen.

Primärquellen, am 03.11.2026 geprüft: [n8n HTTP-Batching](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/#batching), [Unterworkflow je Item](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/).

## Fortsetzung: gespeicherte Texte inhaltlich vergleichen

Der anschließende [Inhaltsabgleich für beide gespeicherten Kanaltexte](CONTENT_COMPARISON.md) ist abgeschlossen: TikTok eine, YouTube zwei Rückfragen gegen die vorhandenen Video-Beobachtungen. Titel und Captions sind prüfsummengleich geblieben. Die Rückfragen ergänzen den vorhandenen Auftrags-Mediencheck, ohne bisherige Sperren aufzuheben. Außerdem sind [inaktive Upload-Anfragebeschreibungen und Provider-Ergebnisauswertung](PROVIDER_RESULTS.md) vorbereitet. Aktueller Teststand: 301 Node-Tests; weiterhin kein Upload oder Posting.
