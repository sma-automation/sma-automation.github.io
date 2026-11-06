# Eigene Musik und Cover-Zuordnung

Stand: 06.11.2026; PR #96 zusammengeführt und live. Baut auf dem abgeschlossenen Medienexport (PR #94/#95) auf.

## Kundenablauf

Content → Content Optimizer → Bearbeitungsentwurf → **Ton**. Eigene MP3/WAV
wählen, anhören, Lautstärke und Startpunkt setzen, Entwurf speichern. Export
enthält Originalton und Musik mit getrennten Lautstärken; ein kürzerer Track
endet vor dem Video, ein längerer wird auf die Videolänge gekürzt. Kein Loop.

Maximal 8 MB, 10 Minuten, Mono/Stereo, 8–96 kHz; MP3 oder PCM-WAV. Die Musikdatei
bleibt lokal. Gespeichert werden Name, Format, Bytezahl, SHA-256, Lautstärke und
Startpunkt. Nach erneutem Öffnen muss dieselbe Datei wieder gewählt werden;
fehlende oder andere Bytes stoppen den Export ausdrücklich. Bestehende
Entwürfe ohne Musik bleiben unverändert gültig. Hinzufügen, Ändern und Entfernen
erscheinen als **Musikspur** in der History.

**Gespeicherte Ergebnisse** bietet eine Portalwahl und **Für Portal vorbereiten**
für genau die fertige Datei. Bei exportierten Videos mit Cover zeigt die
Portalvorbereitung das zugehörige Cover eingeklappt unter **Inhalt und Ziel**.
Die Zuordnung wird aus dem abgeschlossenen Export gelesen und an Eigentümer,
Kundenkonto, Dateirevision, Bytezahl und SHA-256 gebunden. Keine frei übergebene
Cover-ID; kein fremdes oder geändertes Bild.

## Technik und Grenzen

- Browser-FFmpeg: zusätzliches geprüftes Audioinput; trim, volume, apad, amix
  ohne Normalisierung und Limiter; AAC im MP4. Originalton 0 % und Musik 0 %
  ergeben keine Audiospur. MP3-Covergrafiken werden als attached_pic toleriert.
- Optionale `music`-Eigenschaft erweitert die bestehenden zehn Rezeptfelder.
  Die Historie vergleicht die Vereinigung alter/neuer Schlüssel, sodass auch
  das Entfernen protokolliert wird. Wiederholungen behalten ihre Request-ID.
- Migration `20261106181129_publication_editor_music_cover_v1.sql`; öffentliches
  `sma_publication_editor_result_v1` ist ein reiner SECURITY-INVOKER-Lesezugriff.
  Privater Helfer mit leerem search_path und expliziter aktiver Kundenbindung.
- Bestehender Export/Upload bleibt maßgeblich; Ablage in **02 Verarbeitung**.
  Musikoriginal wird nicht zusätzlich in Drive gespeichert. Keine neue Musik-
  Bibliothek, Lizenzkatalog- oder n8n-Verbindung behauptet.
- **Die automatische Cover-Übertragung an YouTube/TikTok/Meta ist noch nicht
  angebunden.** Die Oberfläche kennzeichnet die Vorbereitung. Keine Änderung
  an Aufträgen, Freigaben oder Provider-Publishing. Keine Social-Veröffentlichung.

## Prüfstand

- 552 Node-Tests, 105 Export-/Musik-/Cover-SQL-Prüfungen, 120 bestehende
  Editor-SQL-Prüfungen; 8 Export-, 8 Editor-, 7 Musik/Cover- und 29 History-
  DOM-Szenarien bestanden.
- Echter Browser-WASM-Export mit 3-s-Testvideo (440 Hz Originalton) und
  1,5-s-WAV (880 Hz, Musik 25 %). MP4 mit H.264/AAC, 320×240, exakt 3 s,
  326023 Bytes; Cover erzeugt. Heruntergeladene Audiospur nativ dekodiert:
  Amplituden bei 0,3 s: 440 Hz 0,12439, 880 Hz 0,03125. Bei 2,2 s:
  Originalton 0,12455, Musik 0. Kürzerer Track endet ohne Videoabbruch.
- Zweiter Browser-WASM-Test: Originalton 0 %, Musikstart 0,5 s. Bei 0,3 s
  ist nur 880 Hz vorhanden (0,03121); bei 1,3 s beide Testfrequenzen 0.
  Die MP4 bleibt exakt 3 s lang.
- GitHub Pages: erster Bereitstellungsversuch mit transientem Providerfehler;
  erneuter Deploy desselben geprüften Commits erfolgreich.
- Supabase-Migration installiert. Security-Advisor unverändert gegenüber vorher:
  41 INFO, bestehende Warnungen 4/6/1; keine neue Warnung.

- Angemeldeter Live-Durchlauf erfolgreich: bestehendes Video → Entwurf mit
  3-s-Schnitt, Cover bei 1 s und WAV bei 25 % → Browserexport → Kundenordner →
  direkte YouTube-Vorbereitung. Genau ein abgeschlossener Export
  `283abd16-3b72-4224-ab66-81b30afdab13` und genau zwei abgeschlossene Uploads.
  MP4 938425 Bytes, SHA-256
  `863f7af8215231381a0431b7ab4d6b831a974f92001eace2a8e45f24f51592ed`;
  PNG-Cover 465264 Bytes, SHA-256
  `0c85f685e4332544c080b5c9fe6375b74b06f50568f1f98fcb2538647ece7d7b`.
- Erneutes Öffnen des Entwurfs zeigt die gespeicherte Musik und fordert die
  lokale Datei erneut an. Ausgangseinstellungen anschließend vollständig
  wiederhergestellt (Version 2); Originalrevision/Prüfsumme unverändert.
  Das abgeschlossene Ergebnis behält sein damaliges Musik-/Cover-Rezept.
- Cover in **Inhalt und Ziel** aufgeklappt: authentifizierte Bildvorschau geladen,
  passend zum exportierten Video und bei Sekunde 1. Kein neuer Beitragstext,
  kein Auftrag und kein Posting ausgelöst. Das neutrale zusätzliche Testvideo
  `SMA-Musik-Cover-Techniktest.mp4` bleibt als technische Testdatei erhalten.

## Weiterarbeit

Musik → Export → Kundenordner → Portalvorbereitung mit Cover ist abgeschlossen.
Die gezielte Aktualisierung fehlender Drive-Länge/Bildgröße ist in
[VIDEO_METADATA_REFRESH.md](VIDEO_METADATA_REFRESH.md) umgesetzt und geprüft.
Als getrennte nächste Erweiterungen dauerhafte eigene Musikbibliothek und portalspezifische Cover-Übergabe anhand
der tatsächlichen Provider-Fähigkeiten getrennt bearbeiten. Bestandsstrecke abgeschlossen;
PR #57/#69 separat, Shopify-Testmodus und n8n-Originalentwürfe erhalten.
