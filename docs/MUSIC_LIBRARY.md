# Eigene Musikbibliothek V1

Stand: 06.11.2026. Eigene MP3-/WAV-Dateien werden im privaten Kundenbereich
dauerhaft gespeichert. Im Dashboard bleiben die Kapitel **Tracks** und
**Meine Playlist** mit der freigegebenen feinen Unterstreichung erhalten.

## Bedienung

- Tracks: Musik hinzufügen, suchen, anhören und zur Playlist hinzufügen.
  Fünf Einträge pro Seite; Playlist ist eine gespeicherte Favoritenauswahl.
- Editor → Ton → Gespeicherte Musik auswählen → Verwenden.
  Alternativ eine lokale Datei wählen und „Musik in Bibliothek speichern“.
- Der Entwurf enthält weiterhin die sechs vorhandenen Musikfelder. Beim
  erneuten Öffnen lädt der Editor die gespeicherten Originalbytes über deren
  SHA-256; Lautstärke und Startpunkt bleiben erhalten. Lokale, noch nicht
  gespeicherte Musik kann wie bisher erneut ausgewählt werden.
- Maximal 8 MB je Datei sowie 100 MB oder 100 Tracks je Kundenkonto.
  Der Export prüft zusätzlich tatsächlichen Codec, maximal zehn Minuten und
  höchstens zwei Audiokanäle. V1 enthält keinen fremden Lizenzkatalog und
  keine Lösch-/Umbenennungsfunktion. Nur Musik mit passenden Nutzungsrechten verwenden.

## Speicherung und Abgrenzung

- Privater Storage-Bucket `sma-musik`, Pfad `auth.uid()/sha256.wav|mp3`.
  Kein öffentlicher Link, keine signierte URL und keine Musikbytes in Rezepten.
- Privates Register `sma_private.music_library_v1`, RLS und keine direkten
  Tabellenrechte. Öffentlicher RPC `sma_music_library_v1` ist SECURITY INVOKER.
  Die privaten Definer prüfen UID und genau ein aktives, berechtigtes Kundenkonto
  bei jedem Zugriff; ihr search_path ist leer.
- Reservierung → unveränderlicher Upload ohne Upsert → Fertigstellung anhand
  endgültiger Storage-Größe und MIME. Storage prüft in der Vorprüfung
  `contentLength`, danach `size`; der Binär-Upload liefert eine eindeutige Länge.
- Identische Bytes werden pro Kunde dedupliziert. Wiederholung nach unterbrochener
  Antwort kann dasselbe Objekt fertigstellen. Reservierungen zählen zur Quote;
  V1 bereinigt abgebrochene Reservierungen noch nicht automatisch.
- Der Server prüft Storage-Metadaten, nicht den Audioinhalt oder dessen Hash.
  Der Client verifiziert Größe und SHA-256 vor Anhören/Verwenden/Export;
  FFmpeg prüft beim Export die wirklichen Audiodaten.
- Restriktive Storage-Regeln verhindern fremden Zugriff, Überschreiben und
  Löschen auch bei später ergänzten allgemeinen permissiven Regeln.
- Abmeldung/Kundenwechsel und verworfene asynchrone Ergebnisse entfernen
  private Ansichten und lokale Objekt-URLs. Keine Token in URLs oder Logs.

## Technische Prüfungen

- 565 Node-Tests; 61 neue SQL-Prüfungen und sechs neue DOM-Szenarien bestanden.
- Bestehende Prüfungen: History-SQL 62/52/57/79/120, Export-SQL 105,
  History-DOM 29, Editor-DOM 11, Export-DOM 9, Musik/Cover-DOM 7 bestanden.
- Lokale Browserprobe: WAV hinzufügen → gespeicherten Track verwenden →
  Editor zeigt „bereit“ sowie Lautstärke 25 % und Start 0.
- Migration `20261106185329_music_library_v1.sql` installiert und Katalog geprüft:
  privater Bucket, fünf Storage-Regeln, RLS, kein anonymer RPC-Zugriff.
- Security-Advisor: bestehende Warnungen unverändert 4/6/1. INFO 41 → 42 wegen
  der absichtlich nicht direkt freigegebenen privaten Tabelle mit RLS ohne Policy;
  Zugriff ausschließlich über die geprüften Funktionen.

## Bereitstellung und echter Durchlauf

- PR #100 zusammengeführt, Feature `1fbb5d01559973f5b47f401a95bf9b626f395ff7`,
  Merge `2dc773d74b8fc6d6486d5e5eab61fde4d07ed4f8` auf `website-v1`.
  Beide PR-Prüfungen erfolgreich; Pages Run `42276275355`, Deployment-Job
  `128093526825` erfolgreich. Die zusätzliche Prüfung nach dem Merge ebenfalls grün.
- Im angemeldeten Dashboard echte WAV hochgeladen: selbst erzeugter neutraler
  660-Hz-Ton, eine Sekunde, 48 kHz mono, 96044 Bytes. Kein fremdes Musikmaterial.
  `SMA-Bibliothek-Techniktest.wav`, SHA-256
  `d45c1bdd447a842caeb04516b942a6e775fb863a5376b7be1fb05bf570a315ce`.
- Track `864f58cf-a303-45f0-952d-d7d14db70fbc`: Status `ready`, genau ein privates
  Storage-Objekt mit passender Größe/MIME. Identische Datei erneut hochgeladen:
  weiterhin genau ein Registereintrag und ein Objekt.
- Zur Playlist hinzugefügt, Kapitel gewechselt und Seite neu geladen: Auswahl
  bleibt erhalten. Entfernen leert nur die Playlist; Track bleibt verfügbar.
  Hörprobe erfolgreich geladen: eine Sekunde, readyState 4, kein Medienfehler.
- Neutrales Video `f8c861e2-d4ee-427a-9056-463ea56b4080` im Editor geöffnet,
  gespeicherte Musik gewählt, 26 % Lautstärke und Startpunkt 0,125 s gespeichert.
  Editor vollständig neu geladen: automatisch „bereit“, dieselben Einstellungen,
  kein erneutes Auswählen einer lokalen Datei nötig.
- Aus diesem wieder geöffneten Entwurf echte Browser-MP4 erzeugt und heruntergeladen:
  H.264/AAC, 320×240, drei Sekunden, 326332 Bytes, SHA-256
  `ab3a0c252bfb96813e4e038e0eec8d33ea4074787d92f7b755d6f89c80bf76cf`.
  Native Audioanalyse bestätigt Originalton (440 Hz) und Bibliotheksmusik (660 Hz):
  Amplituden bei 0,3 s 0,124310 / 0,025345; bei 2,2 s 0,124246 / 0,000037.
  Kürzere Musik endet, Video/Originalton laufen weiter.
- Testentwurf anschließend vollständig auf Standardwerte zurückgesetzt und
  gespeichert: Version 2, Datenbankvergleich mit Standardrezept `true`, nur die
  beiden Musikänderungen in der History. Playlist wieder leer; neutraler Track
  bleibt als Testdatei in der Bibliothek. Kein Export im Kundenordner gespeichert,
  kein zusätzlicher Provider-Auftrag und keine Social-Veröffentlichung.

## Weiterarbeit

Die eigene Musikbibliothek einschließlich erneutem Öffnen und Export ist abgeschlossen.
Die portalspezifische Cover-Übergabe für YouTube/TikTok ist technisch angeschlossen;
Prüfstand und verbleibende echte Providerbestätigung stehen in
[PORTAL_COVER_HANDOFF.md](PORTAL_COVER_HANDOFF.md).
Bestandsstrecke abgeschlossen; PR #57/#69 separat offen. Shopify-Testmodus
und unveröffentlichte n8n-Originalentwürfe erhalten. Keine Tarifänderung,
kein Kauf und keine Social-Media-Veröffentlichung.
