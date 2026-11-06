# Dateiangaben neuer Videos aktualisieren

Stand: 06.11.2026. Ergänzung zu [MUSIC_AND_EXPORT_COVER.md](MUSIC_AND_EXPORT_COVER.md).

## Verhalten

- Editor und Portaloptimierung zeigen bei fehlender Videolänge oder Bildgröße
  einen kompakten Hinweis und „Dateiangaben aktualisieren“.
- Ein Klick fragt den vorhandenen kundengebundenen Drive-Katalog über
  `sma-publication-files-v1` neu ab und liest danach die Dateiliste.
- Derselbe Datei-/Versionsstand erhält neue Angaben, ohne Texte, Format,
  Schnittangaben, lokale Musikdatei oder gespeicherten Entwurf neu zu laden.
- Der Editor gibt Zeitfelder erst bei bekannter Videolänge frei. Export bleibt
  gesperrt, solange Videolänge oder Bildgröße fehlen. Andere Exportgrenzen gelten weiter.
- Solange Drive noch keine Angaben liefert, bleibt der Hinweis sichtbar.
  Es gibt keine automatische Abfrageschleife. Laufende Anfragen und Ratenlimits
  zeigen eine erneute Versuchsmöglichkeit; ungespeicherte Eingaben bleiben erhalten.
- Geänderte/fehlende Datei oder geänderte Portalzuordnung werden nicht übernommen.
  Der Editor blockiert nach erkanntem Versionswechsel Speichern und Export bis
  zum ausdrücklichen Laden des passenden Standes; Änderungen werden vorher bestätigt.
- Der Editor prüft die Kontozuordnung vor und nach der Anfrage. Beide Ansichten
  verwerfen späte Ergebnisse nach Abmeldung. Der Editor bricht beim Schließen
  den Katalogabruf ab. Parallele Klicks senden nur eine Anfrage.

## Prüfungen vor Bereitstellung

- 559 Node-Tests bestanden, darunter 7 neue Fälle für Metadaten und Portalaktualisierung.
- 11 Editor-DOM-, 9 Export-DOM-, 7 Musik/Cover-DOM-, 29 History-DOM- und
  8 Dashboard-Kapitel-DOM-Szenarien bestanden.
- SQL-Regressionsprüfungen: 62 History, 52 Monatsansicht, 57 Textverlauf,
  79 Dateizuordnung, 120 Editor und 105 Export; alle bestanden.
- Browserprobe mit neutraler Testdatei: fehlende Angaben sichtbar; eigene
  Texteinblendung eingegeben; Aktualisierung ergänzt 3 Sekunden und 320 × 240;
  Texteinblendung bleibt stehen, Schnitt-/Cover-Felder werden freigegeben.

## Umfang

Nur Oberfläche und vorhandener Katalogzugriff; keine neue Datenbankmigration,
kein Workflow-Umbau, keine Medienanalyse und keine Veröffentlichung durch den
Aktualisierungsknopf. Drive-Verarbeitung selbst lässt sich damit nicht beschleunigen.
Bestandsstrecke bleibt abgeschlossen; PR #57/#69 separat, Shopify-Testmodus
und unveröffentlichte n8n-Originalentwürfe bleiben erhalten.

## Bereitstellung und echter Abruf

- PR #98 zusammengeführt nach erfolgreichen GitHub-Prüfungen.
- Feature-Commit `5744650a20f6265cf89ed9c486a8f819388e6474`, Merge
  `80b45bccf1f4a3ffc6158d0b9d49089f097faf0f` auf `website-v1`.
- GitHub Pages Run `42272822460`, Deployment-Job `128081706466`: erfolgreich.
- Im angemeldeten Live-Editor zeigte die vorhandene neutrale Datei
  `SMA-Musik-Cover-Techniktest.mp4` zunächst fehlende Länge/Bildgröße;
  „Vorschau erzeugen“ war gesperrt und verwies auf die Aktualisierung.
- Ein echter Klick auf „Dateiangaben aktualisieren“ hat den Drive-Katalog geladen.
  Drive lieferte inzwischen eine neue Dateiversion. Der Editor hat deshalb die
  ungespeicherte Testeinblendung beibehalten und den Versionswechsel gemeldet.
- „Gespeicherten Stand laden“ verlangte die ausdrückliche Bestätigung zum Verwerfen
  der ausschließlich für diese Probe eingegebenen Einblendung. Danach: Videolänge
  **2,999 Sekunden**, Schnitt-/Cover-Felder bedienbar, Exportknopf freigegeben,
  Hinweis auf fehlende Angaben verschwunden.
- Die Live-Portalvorbereitung derselben Datei zeigte anschließend den normalen
  Kapitelwechsel und einen verfügbaren Magic-Effect-Knopf. Es wurde weder eine
  Analyse noch ein Export, eine Speicherung des Testentwurfs oder ein Posting gestartet.
- Testdatei bleibt ohne gespeicherten Bearbeitungsentwurf; die ungespeicherte
  Testeinblendung ist wieder entfernt. Originaldateien und vorhandene Entwürfe unverändert.

## Nächste getrennte Arbeit

Die Warteanzeige und gezielte Aktualisierung sind abgeschlossen. Als nächster
Baustein bietet sich die dauerhafte eigene Musikbibliothek an. Die automatische
Cover-Übergabe an Portale bleibt ein separater Schritt mit Providerprüfung.
