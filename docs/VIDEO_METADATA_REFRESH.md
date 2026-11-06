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
- Anmeldung wird vor und nach der Anfrage geprüft; späte Ergebnisse nach
  Abmeldung/Ansichtswechsel werden verworfen. Parallele Klicks senden nur eine Anfrage.

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

Die Bereitstellung und der echte Katalogabruf werden nach dem Merge ergänzt.
