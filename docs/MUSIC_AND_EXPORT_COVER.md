# Eigene Musik und Cover-Zuordnung

Stand: 06.11.2026; baut auf dem abgeschlossenen Medienexport (PR #94/#95) auf.

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
- Supabase-Migration installiert. Security-Advisor unverändert gegenüber vorher:
  41 INFO, bestehende Warnungen 4/6/1; keine neue Warnung.

## Weiterarbeit

Nach Live-Übernahme den angemeldeten Ablauf Musik → Export → Kundenordner →
Portalvorbereitung mit Cover prüfen und hier ergänzen. Danach dauerhafte eigene
Musikbibliothek und portalspezifische Cover-Übergabe anhand der tatsächlichen
Provider-Fähigkeiten getrennt bearbeiten. Bestandsstrecke abgeschlossen;
PR #57/#69 separat, Shopify-Testmodus und n8n-Originalentwürfe erhalten.
