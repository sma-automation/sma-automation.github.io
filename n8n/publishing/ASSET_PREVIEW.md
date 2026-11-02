# Mediengalerie und Optimierungsseite

Das Dashboard zeigt Kundendateien als Bild-/Videokacheln. Dateiname und Metadaten
stehen in eingeklappten Dateidetails. „Optimieren“ öffnet einen vollständigen
Seitenbereich innerhalb des vorhandenen Dashboards; Sidebar und angemeldete
Sitzung bleiben bestehen. Zurück/Vorwärts erhält den jeweiligen Editor-Frame.
Auf breiten Ansichten stehen Medien und Redaktion nebeneinander, auf kleinen
Ansichten untereinander. Das Editor-Iframe meldet nur seine Höhe an das bekannte
Elternfenster; Nachrichten werden nach Origin und tatsächlichem Frame geprüft.

Frische Geräte-Uploads verwenden eine lokale Blob-Vorschau: Bilder direkt,
Videos mit Abspielsteuerung. Beim erneuten Laden zeigt der Kundenordner ein
Vorschaubild, bei Videos ein Standbild. Nicht browserfähige Formate bleiben als
Datei auswählbar, ohne eine funktionierende Wiedergabe vorzutäuschen.

## Geschützter Abruf

- Workflow: **SMA – Medienvorschau – Kundenordner V1** (`c6ncyk7ZTlQzX7z3`)
- Geprüfte Version: `19bd98d5-5739-49de-9679-4fc04f15052a`
- Webhook: `POST sma-publication-asset-preview-v1`
- Input: ausschließlich `asset_id`, `asset_revision`; Bearer aus der SMA-Sitzung.
- `sma_publication_asset_preview_v1`: aktive, eindeutige Kontozuordnung und eigene
  verfügbare Datei, exakte Katalogrevision; kein anonymer Zugriff.
- Der Workflow prüft zusätzlich den aktuellen Kundenordner, die Drive-ID,
  Dateigröße, MIME und Inhaltskennung vor dem Thumbnail-Abruf. Nachgelieferte
  Drive-Metadaten dürfen die Version erhöhen, solange die Bytes gleich bleiben.
- Drive-Thumbnail-Links bleiben serverseitig. Nur HTTPS auf den vorgesehenen
  googleusercontent-Hosts, keine Weiterleitungen. Keine öffentliche Freigabe.
- Die Antwort enthält ausschließlich Bildbytes (JPEG/PNG/WebP, max. 2 MB),
  Dateiidentität, Revision und `can_publish:false`. Kein OAuth-Token/Drive-Link.
- Ausführungsdaten werden für diesen Workflow nicht gespeichert.
- Galerie lädt sichtbare Kacheln mit höchstens drei parallelen Abrufen.
  Speicher-Cache max. 20 Vorschaubilder, 60 Sekunden; kein LocalStorage.
  Abmelden verwirft Bilder, Requests und Objekt-URLs.

Medienprüfung, Magic Effect und Veröffentlichung sind davon unabhängig.
Eine sichtbare Vorschau ist keine Freigabe zur Veröffentlichung.

## Prüfung

`node --test tests/publication-*.test.cjs tests/device-upload.test.cjs tests/asset-preview.test.cjs tests/optimization-navigation.test.cjs`

`tests/asset-preview.sql` prüft Eigentum, fremde Dateien, Revision, inaktive
Konten und fehlende anonyme Grants mit vollständig zurückgerollten Testdaten.
Schema: `supabase/sql/publication-asset-preview.sql`.

Live-Lesetest am 02.11.2026: das vorhandene Kundenvideo lieferte ein gültiges
JPEG-Vorschaubild (6.799 Bytes). Testworkflow `vj5AcgdvtUTL6AtC` bleibt
manuell und unveröffentlicht. Der angemeldete PC-/Handy-Durchlauf der neuen
Gesamtansicht ist damit noch nicht als Benutzerabnahme bestätigt.
