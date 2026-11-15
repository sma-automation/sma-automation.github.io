# Galerie-Musik: getrennte Ursachen statt vier vermeintlich fertiger Clips

Stand: 15. November 2026. Ausgangsbranch `website-v1`, Commit
`b7435cea5869bc7a25215448df8beedfe33893e2` (PR #321).
Die folgenden Bestandsprüfungen wurden in Supabase ausschließlich in
READ-ONLY-Transaktionen mit zehn Sekunden Statement-Timeout und ROLLBACK
ausgeführt. Keine Medienbytes, Tokens, Datei-IDs oder Kundendaten werden hier veröffentlicht.

## Tatsächlicher Befund

Der aggregierte Startcheck meldete vier Galerie-Musikaufträge und null technische
Galerie-Nachweise. Vier Aufträge sind jedoch **nicht vier fertig erzeugte Musikclips**.
Der Abgleich am 15.11.2026 um 20:31–20:33 UTC ergab:

- **Ein abgeschlossener Auftrag** mit Ergebniszuordnung, erwartetem Hash und
  Byteumfang. Quelle und Ergebnis sind im Katalog als verfügbar markiert.
  Die bestehende private Snapshot-Funktion liefert für genau diesen Auftrag
  eine gültige gespeicherte Zuordnung einschließlich AAC-Sidecar.
- **Drei wartende Aufträge** ohne Ergebniszuordnung, erwarteten Ergebnishash
  oder Ergebnisgröße. Alle drei haben null Fehlversuche und null Hintergrundversuche.
  Zum Abfragezeitpunkt war einer zeitlich fällig; zwei waren noch nicht fällig.
  Kunden-/Quellzuordnung und die übrigen separat abgefragten Basisbedingungen
  waren bei allen drei konsistent. Fälligkeit ist keine Ausführungsfreigabe.
- **Ein Katalogtrack, aber null gelistete und null im Ready-Katalog verfügbare Tracks.**
  Der tatsächlich installierte Picker verlangt einen Ready-Katalogtrack,
  Kundenzugriff und ein passendes AAC-Objekt. Ohne verfügbaren Track kann er
  deshalb auch den fälligen Auftrag nicht auswählen. Der vorhandene private
  Track wird nicht eigenmächtig gelistet oder ersetzt.

Der vollständige Version-3-Bericht wurde um **20:39:31 UTC** erneut direkt
READ ONLY ausgeführt: weiterhin ein Abschluss, drei wartende Aufträge und null
Nachweise. Inzwischen waren zwei Termine fällig und einer noch zukünftig.
Diese Terminverschiebung ist eine Momentaufnahme, keine durch den Bericht
ausgelöste Verarbeitung.

Die aktive Datenbank-Zeitplanung `sma-gallery-soundtrack-v1` ist vorhanden.
Das beweist weder einen erfolgreichen n8n-Lauf noch eine fertige Musikfassung.
Die Untersuchung hat keinen Picker, Zeitplan oder Medienworkflow ausgeführt.

## Warum dem fertigen Clip noch der technische Nachweis fehlt

`publication_gallery_technical_register_v1(jsonb)` ist bereits im privaten
Schema installiert. Nur `service_role` darf sie ausführen; Browserrollen nicht.
Die Tabelle enthält weiterhin null Einträge. Eine Neuinstallation ist nicht nötig.

Das vorgesehene Dienstkonto `sma_gallery_worker_login` und die Gruppe
`sma_gallery_snapshot_reader` stehen weiterhin auf **NOLOGIN**. Das Dienstkonto
erbt die Leseberechtigung für `gallery_worker_snapshot_v1(uuid)`, nicht jedoch
das Recht zur Registrierung. Die Mitgliedschaft darf weder administriert noch
über SET ROLE übernommen werden. Superuser- und BYPASSRLS-Rechte sind aus.

Damit ist der vorgesehene private Server-Leseweg absichtlich noch nicht nutzbar.
Ein Datenbanksnapshot ist **keine erneute Prüfung der tatsächlichen Medienbytes**.
In diesem Schritt wurden weder die Drive-Dateien noch die AAC-Datei heruntergeladen
oder dekodiert. Der frühere Byte-Test ersetzt keinen neu autorisierten Worker-Lauf.

## Präzisierter Startcheck, Version 3

`supabase/sql/launch-readiness-readonly.sql` behält alle bisherigen Felder und
Sperraussagen bei. Im Medienblock trennt er jetzt zusätzlich:

- `gallery_completed_jobs`, `gallery_pending_jobs`, `gallery_other_jobs`;
- `gallery_pending_due_jobs`, `gallery_pending_scheduled_jobs` und
  `gallery_pending_unscheduled_jobs` innerhalb der wartenden Aufträge;
- `gallery_completed_without_record` als Anzahl abgeschlossener Aufträge ohne
  irgendeinen zum selben Auftrag gespeicherten technischen Eintrag;
- `music_listed_tracks` als reine Anzahl gelisteter Katalogtracks.

Ein historischer technischer Eintrag ist **kein Nachweis für die aktuelle
Dateirevision**. Ein gelisteter Track bestätigt weder Lizenz, tatsächliche Bytes,
AAC-Bereitschaft noch Kundenzugriff. Der Bericht liest deshalb keine Registrierung
oder Dispatcherfunktion und behauptet aus diesen Zählern keine Startbereitschaft.
`allows_publication=false` und `initiates_checkout=false` bleiben unverändert.

Die vier Quellcodeprüfungen kontrollieren reine SELECT-Abfrage, fehlende private
Daten und unveränderte Sperren. `tests/run-launch-readiness-sql.mjs` ergänzt die
acht bestehenden Freigabefälle um zwölf isolierte Galerie-/Katalogfälle: leerer
Bestand, ein Abschluss neben drei wartenden Aufträgen, fremde und doppelte
Nachweise, reine Terminunterschiede, fehlende Termine, weitere Zustände,
Kataloglistung und verwaiste historische Nachweise. Jede dieser zwölf
Berichtsabfragen läuft READ ONLY und prüft unveränderte Fixture-Tabellen.
Browserrollen dürfen den Betreiberbericht nicht ausführen.

## Nächster echter Freigabeschritt

Für die wartende Vertonung fehlt zuerst ein ausdrücklich für SMA freigegebener
Track mit geprüftem Master und AAC-Sidecar. Keine Ersatzmusik und keine
Credit-Abbuchung auf Verdacht.

Für den vorhandenen fertigen Clip benötigt der freigegebene Serverbetreiber
zuerst den bereits vorbereiteten privaten Nur-Lesen-Zugang samt Drive-/Storage-
Zugriff und FFmpeg/FFprobe. Passwörter ausschließlich in die private Secret-
Verwaltung; keine neuen Zugangsdaten in Chat oder Repository. Nach gesonderter
Betreiberfreigabe folgt genau ein unabhängiger Nur-Lesen-Bytecheck mit erneuter
Datenbankbindung. Eine spätere Registrierung bleibt ein separat freizugebender
Schritt. Technischer Nachweis ist weder Medienfreigabe noch Veröffentlichung.

Siehe [bestehende Serverübergabe](GALLERY_PRIVATE_SERVER_HANDOFF_PREFLIGHT.md)
und [bestehende Registrierungsgrenze](GALLERY_TECHNICAL_INGESTION.md).
Der Kundenmedienworkflow `aEm2khRhdM6EUdoq` bleibt unverändert.
