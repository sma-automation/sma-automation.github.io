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

## Prüfstand vor Bereitstellung

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
- Der echte angemeldete Upload und erneute Abruf werden nach Pages-Bereitstellung
  separat protokolliert. Die lokale Probe allein belegt keine Cloud-Persistenz.

## Weiterarbeit

Die portalspezifische automatische Cover-Übergabe bleibt separat offen.
Bestandsstrecke abgeschlossen; PR #57/#69 separat offen. Shopify-Testmodus
und unveröffentlichte n8n-Originalentwürfe erhalten. Keine Tarifänderung,
kein Kauf und keine Social-Media-Veröffentlichung.
