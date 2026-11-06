# Hashtags im gespeicherten Textverlauf

Stand: 06.11.2026. Ergänzt die bearbeitbaren Hashtags aus
[PORTAL_TEXT_CORRECTIONS.md](PORTAL_TEXT_CORRECTIONS.md).

## Verhalten

Beim Speichern eines neuen Textstands werden dessen Hashtags zusammen mit
Entwurf, Revision und Portal festgehalten. **History → Portaltexte** zeigt sie
erst in den aufgeklappten Details. Die fünf Einträge pro Seite, Kapitelreiter,
Schrift, Monatsfilter und Auftragskennzahlen bleiben erhalten.

| Gespeicherter Wert | Anzeige |
| --- | --- |
| Liste mit Hashtags | Die damaligen Hashtags in ihrer gespeicherten Reihenfolge |
| Leere Liste | Hashtags: Keine gespeichert. |
| Nicht erfasst | Hashtags: Für diesen Textstand nicht erfasst. |

Alle bisherigen Einträge bleiben ohne Hashtag-Nachweis. Heutige Entwurfswerte
werden nicht in ältere Textstände kopiert. Eine neue Revision enthält auch die
unveränderten Tags der übrigen Portale dieses Entwurfs; das behauptet keine
Änderung jedes einzelnen Portaltextes. Historische Titel und vollständige
Captions werden weiterhin nicht ergänzt. Dies ist keine Veröffentlichungsfreigabe.

## Technik

- Nullable JSONB-Spalte `hashtags` in der bestehenden privaten Tabelle
  `publication_caption_history_v1`. Kein Backfill, keine zusätzlichen Tabellen.
- Der bestehende Aufzeichnungstrigger erfasst die Tags im selben Vorgang wie den
  Textkörper. `ON CONFLICT DO NOTHING` erhält bereits aufgezeichnete Revisionen.
  Fehlende Tags alter Schreibwege bleiben unbekannt, eine leere Liste bleibt leer.
- Privater, unveränderlicher Invoker-Validator für höchstens drei unterschiedliche
  NFC-Tags mit je 1–50 Buchstaben, Ziffern oder Unterstrichen. Keine direkten
  Ausführungsrechte für `PUBLIC`, `anon`, `authenticated` oder `service_role`.
- Der vorhandene Lese-RPC v1 ergänzt ausschließlich das Feld `hashtags`.
  Öffentlicher Invoker-Wrapper, privater Definer, leerer Suchpfad, UID-/Kunden-
  und Zugangskontrollen sowie Sortierung und zusammengesetzter Cursor bleiben
  erhalten. Kein neuer öffentlicher Endpunkt und kein direkter Tabellenzugriff.
- Alte Clients ignorieren das Zusatzfeld. Der neue Client behandelt alte
  Antworten ohne Feld als „nicht erfasst“ und verwirft ungültige Snapshots.
  Die Darstellung verwendet ausschließlich Textknoten.
- Quelle `supabase/sql/publication-text-history-hashtags.sql`, identische
  CLI-Migration `20261106211903_publication_text_history_hashtags_v1.sql`.

## Prüfstand

578 Repository-Tests, 82 neue SQL-Prüfungen und 34 History-DOM-Szenarien bestanden.
Zusätzlich 57 bestehende Textverlaufs-, 71 Textänderungs- und 79 Dateiverlaufs-
SQL-Prüfungen sowie sechs Texteditor-DOM-Szenarien bestanden.

Die neue SQL-Reihe verwendet die echten Speicherwege in einer isolierten
PGlite-Datenbank: erste Generierung, spätere Hashtag-Korrektur, ältere Clients,
Entfernen aller Tags, unveränderte Altstände, kein Überschreiben derselben
Revision, Kunden-/Elternzuordnung, Monatsfilter, 20er-Serverseiten und Rollenrechte.
Die DOM-Prüfung unterscheidet unbekannte und leere Snapshots, verwirft ungültige
Tags und bestätigt die weiterhin eingeklappte Anzeige mit fünf Einträgen.

Die Migration ist installiert. Beide ersetzten Funktionen wurden unmittelbar
vor dem Austausch anhand ihrer bisherigen Quellhashes atomar geprüft. Die
installierten neuen Funktionshashes stimmen mit der getesteten SQL-Datei überein;
ACLs, Suchpfade und RLS bleiben erhalten. Security-Advisor-Kategorien unverändert.
Alle 16 bisherigen Textstände haben `hashtags = NULL`; ihr ursprünglicher
Datensatzdigest bleibt `62a1ed268168e121b5a2efeda31feae3`. Kein Beitragstext wurde
für den Test gespeichert oder geändert. Weiterhin neun Aufträge und jeweils null
Operatorfreigaben, Provider- und Coverversuche. Ohne UID bleibt der RPC gesperrt.

Keine Provider-, n8n-, Tarif- oder Shopify-Änderung. Die echte Coverbestätigung
und vollständige Videoprüfung bleiben die getrennt dokumentierten offenen Punkte.
PR #57/#69 und unveröffentlichte n8n-Originalentwürfe bleiben erhalten.
