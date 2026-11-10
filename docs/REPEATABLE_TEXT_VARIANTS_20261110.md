# SMA · Wiederholbare Textvarianten (10.11.2026)

## Freigegebenes Kundenverhalten

Nach einem **gespeicherten** Portalbeitrag erscheint in der großen Portalvorschau und unter **„Inhalt und Ziel“** der Button **„Neue Textvariante erstellen“**. Die neue Variante verwendet genau die bereits ausgewählte Datei, ihre identische Revision und die gespeicherte, kundengebundene Inhaltsbeschreibung. Bei fertiger Magic-Effect-Analyse wird das Video **nicht** erneut extrahiert oder analysiert. Keine neue Datei muss hochgeladen werden.

1. **Neue Textvariante erstellen**: SMA verwendet die vorhandene Caption-Erstellung mit einer neuen, einmaligen Request-ID. Daraus entstehen neue Titel, Beitragstext und bis zu drei passende Hashtags; die geprüfte Shop-Adresse wird wie gewohnt ergänzt.
2. **Vorschau prüfen**: Das Ergebnis erscheint als **„Neue Textvariante“** im Texteditor. Die vorher gespeicherte Fassung und ihre Portalbindung bleiben dabei unverändert. Die Vorschau zeigt den neuen Titel, Beschreibung und Hashtags ohne HTML-Einfügung.
3. **Weitere Variante erstellen**: Ein erneuter Klick erzeugt eine neue Anfrage mit neuer Request-ID, statt die vorherige wiederzugeben. Die letzte erfolgreiche Kandidatin bleibt sichtbar, wenn ein späterer Versuch fehlschlägt.
4. **Variante übernehmen**: Nur ein **ausdrücklicher Klick** ersetzt die bisherige Datei-/Portalzuordnung über die bestehende serverseitige Vergleich-und-Tausch-Revision. Vor dem Zuordnen prüft SMA erneut die Kundensitzung, Dateirevision, Bearbeitungsstände und den aktuellen Katalog. Alte Zuordnungen werden weiterhin in der bestehenden History protokolliert.
5. **Verwerfen**: Der Kandidat wird verworfen; der vorherige Entwurf bleibt erhalten.

## Schutz und Grenzen

- Offene eigene Änderungen, unbestätigte Speicherstände und geänderte Inhaltsangaben stoppen sowohl eine weitere Generierung als auch das Übernehmen; nichts wird stillschweigend überschrieben.
- Ein fremdes Konto, geänderte Dateiversion, abweichender Entwurf oder eine zwischenzeitlich veränderte Portalzuordnung führt zum unveränderten Serverkonflikt; eine Wiederholung darf nicht an fremde Dateien gebunden werden.
- Das bestehende Caption-Backend erhält frühere Texte aus der authentifizierten History; gleichartige oder lediglich kosmetisch geänderte Beschreibungen werden als `CAPTION_TOO_SIMILAR` zurückgewiesen. Für begrenztes Belegmaterial kann SMA nicht beliebig viele wirklich unterschiedliche Aussagen garantieren.
- Die bestehenden Schutzlimits bleiben bestehen: mindestens **30 Sekunden** zwischen neu gestarteten Textanfragen und maximal **20 Textvorschauen pro Stunde**. Eine begrenzte Wiederholung statt einer endlosen Anfrageschleife.
- Modellgenerierung kann bestehende API-Kosten je Anfrage verursachen; es werden keine Tarife geändert oder Käufe ausgelöst. Die Funktion läuft ausschließlich auf Kundenklick.
- Der Button erstellt **keinen** Veröffentlichungsauftrag und kann keine Upload-, Betreiber- oder Medienfreigabe erteilen. Etwaige zuvor vorbereitete Aufträge werden **nicht** automatisch neu gebunden.

## Technische Änderungen

- `app/assets/publication-preview.js`: getrennte, wiederholbare Variant-Requests, UI-Vorschau ohne Datenbankschreibzugriff, explizite Übernahme mit revisionsgebundenem `sma_publication_files_v1('assign')`; weiterhin kein zweiter Magic-Lauf.
- `app/assets/optimizer-workspace.mjs`: Wiederholungs-Buttons in großer Vorschau und Editor; kompakte Auswahlansicht und `Weitere Variante erstellen`, `Variante übernehmen`, `Verwerfen`.
- `app/assets/optimizer-workspace.css`: vorhandener SMA-Layoutstil auch für schmale Ansichten.
- Regressionstests: bestehende 4 Portalwege, unveränderte Entwurfsfreigaben, selektierter Kandidat, doppelter Klick, Schutz vor ungespeicherten Eingaben, keine Provideraufrufe.

**Nicht enthalten:** Änderung von n8n-Produktionsworkflows, GitHub-PR #57/#69/#185, Kundenrechten, Diensttarifen oder Social-Provider-Uploads.
