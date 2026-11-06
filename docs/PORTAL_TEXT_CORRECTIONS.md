# Portaltexte einschließlich Hashtags korrigieren

Stand: 06.11.2026. Fortsetzung nach der abgeschlossenen Cover-History.

## Konkrete Lücke

Der gespeicherte YouTube-/TikTok-Abgleich aus PR #57 stellte Rückfragen zu
einer nicht eindeutig belegten Mechanik und einem Ortsbezug im Hashtag.
Titel und Beitragstext waren bearbeitbar; Hashtags wurden unverändert aus
dem ursprünglichen Generatorergebnis übernommen. Deshalb konnte eine
Hashtag-Rückfrage bisher nicht über den normalen Speicherweg behoben werden.

## Änderung

- Im vorhandenen Textbereich steht ein Hashtag-Eingabefeld. Höchstens drei
  unterschiedliche Begriffe mit je 1–50 Buchstaben, Ziffern oder Unterstrichen.
  Leerzeichen trennen Begriffe; ein führendes `#` ist optional. Leer lassen
  entfernt alle Hashtags. Unicode wird in NFC normalisiert.
- Die vollständige Textvorschau und die separate Beitragsvorschau verwenden
  die aktuellen Eingaben. Ungültige Eingaben werden nicht gespeichert;
  Versionskonflikte erhalten die eigenen Änderungen.
- Bestehende authentifizierte Speicher-RPCs erhalten ein optionales
  `hashtags`-Array. Alte Clients ohne dieses Feld behalten ihre Hashtags.
  Die Datenbank validiert das Array selbst und baut die Caption mit dem
  unverändert gebundenen Shop-Link neu auf. Keine frei übergebene Caption.
- Kundenprüfung, Dateifrische, Datei-/Zuordnungs-/Entwurfversionen,
  Wiederholungsprüfung und bestehende Journale bleiben erhalten. Eine
  Änderung erzeugt eine neue Text-/Zuordnungsrevision; vorhandene
  Vergleichsergebnisse oder Auftragsfreigaben werden nicht umgeschrieben.
- Beide privaten Funktionsdefinitionen basieren auf dem verifizierten
  installierten Stand (`publication-files.sql`, `publication-caption-history.sql`).
  Keine neuen Funktionen, Tabellen, Rechte oder n8n-Anschlüsse. Die öffentlichen
  Wrapper bleiben SECURITY INVOKER, die privaten Helfer behalten leeren Suchpfad.
- Kapitelreiter, Schrift und fünf History-Aufträge pro Seite unverändert.

Quelle: `supabase/sql/publication-text-edits.sql`; identische CLI-Migration
`supabase/migrations/20261106201350_publication_text_edits_v1.sql`.
Die Migration ist im bestehenden Projekt installiert. Der Installationsvorgang
prüfte die beiden bisherigen Funktionshashes atomar vor dem Austausch.

## Prüfstand

- 575 Repository-Tests, 71 neue SQL-Prüfungen, sechs neue DOM-Szenarien bestanden.
- Bestehende Text-History-SQL (57), Dateiverlauf-SQL (79) und History-DOM (32)
  bestanden. Alle SQL-Fixtures lokal in PGlite; keine künstlichen Kundeneinträge.
- Geprüft: Ersetzen/Entfernen, alte Clients, Unicode, doppelte/ungültige Tags,
  falsche Kunden, inaktive Zugänge, veraltete Dateien, Versionskonflikte,
  keine Teiländerung bei ungültigem zweiten Portal, Abmeldung und erhaltene
  historische Textstände. Security-Advisor-Kategorien vor/nach unverändert.
  Der bestehende serviceinterne Tabellenzugriff bleibt
  unverändert; Browserrollen erhalten keine direkten Rechte.

## Grenzen

Eine Textkorrektur ist keine automatische Medienfreigabe. Der interne
Inhaltsabgleich aus dem separat offenen PR #57 muss die neue Bindung erneut
bewerten. Alte Rückfragen werden nicht nachträglich als bestanden markiert.
`VIDEO_PLAN_REQUIRED`, vollständige Medienprüfung und die ausdrücklich
freizugebende echte Provider-/Coverabnahme bleiben getrennte Voraussetzungen.
Das bestehende Text-/Dateijournal speichert Textkörper und Revisionswechsel,
keinen vollständigen historischen Hashtag-Snapshot.

Keine Wiederholung der Bestandsprüfung. PR #57/#69 separat offen,
Shopify-Testmodus und unveröffentlichte n8n-Originalentwürfe erhalten.
Keine Operatorfreigabe, kein Provider-/Coverversuch und keine Social-Veröffentlichung.

## Bereitstellung und echte Textabnahme

- [PR #106](https://github.com/sma-automation/sma-automation.github.io/pull/106)
  zusammengeführt auf `website-v1`: Feature
  `e676520a24b198a7c4e28d86a09417b567562bd9`, Merge
  `51365493252ec53d27cfb2d6433984bd26b131cb`.
  Beide PR-Prüfungen und die History-Prüfung nach dem Merge erfolgreich.
  Pages-Lauf `42287648694` erfolgreich; neue Eingabefelder live geprüft.
- Die beiden vorhandenen YouTube-/TikTok-Entwürfe wurden über den angemeldeten
  Editor gespeichert und nach Neuladen erneut geprüft. Aussagen zur nicht
  eindeutig belegten Mechanik wurden auf beobachtbare Handlungen begrenzt;
  nicht belegte Orts-/Reise-Hashtags entfernt. Der gebundene Shop-Link blieb
  erhalten. Es entstand je eine neue Textrevision, kein neuer Auftrag.
- Ein separater unveröffentlichter Vier-Knoten-Prüfworkflow
  `kfz4pubGtwSwzyHV` ruft den bestehenden Vergleich `1qMj37a5gXlrbCWd` je
  aktueller Kanalbindung auf. Er enthält keine Providerknoten und keine
  kopierten Beitragstexte. Nach dem UI-Import wurden die Einstellungen gesetzt
  und per Export geprüft: keine Speicherung erfolgreicher, fehlgeschlagener
  oder manueller Ausführungsdaten, kein Fortschrittsprotokoll, nur derselbe
  Eigentümer, MCP aus, Laufzeitlimit 450 Sekunden, keine angehefteten Daten.
  Die flüchtige Ergebnisanzeige wurde anschließend geleert.
- Echter erneuter Abgleich am **06.11.2026**: TikTok **21:27:55 MEZ**,
  YouTube **21:28:03 MEZ**. Beide `consistent_with_evidence`, leere
  Rückfragenliste, aktuelle Versionsbindung und keine offene Lease.
  Die Medienprojektion bestätigt für beide `PORTAL_TEXT_COMPARISON=pass`.
  Alte Vergleichsergebnisse und alte Auftragsbindungen wurden nicht verändert.
- Dies bestätigt nur den Vergleich mit den vorhandenen Video-Beobachtungen,
  Bildtexten und gegebenenfalls Transkripten. `CONTENT_REVIEW_PENDING` und
  `SEMANTIC_REVIEW_PENDING` bleiben offen; die vollständige visuelle und
  semantische Medienprüfung ist damit nicht ersetzt. Der separate
  Sightengine-Blocker `VIDEO_PLAN_REQUIRED` bleibt bestehen.
  `can_upload` und `can_publish` bleiben `false`.
- Abschlussabfrage: **9 Aufträge unverändert**, Digest
  `a19d817047175d3e2fe2315ff5f9b21b`; **0 Operatorfreigaben, 0 Provider-
  und 0 Coverversuche**. PR #57/#69 sind weiterhin offen und ungemergt.
  Unveröffentlichte n8n-Originalentwürfe und Shopify-Testmodus erhalten.

## Nächster offener Kernschritt

Die vollständige Medienprüfung für den gebundenen Dateistand vervollständigen,
einschließlich der noch offenen visuellen Sicherheitsprüfung. Die konkreten
Textfragen dieser beiden Entwürfe sind abgeschlossen und müssen nicht erneut
bearbeitet werden. Kostenpflichtige Änderungen sind nicht freigegeben.
Echte Provider-/Coverbestätigung bleibt anschließend eine getrennte Abnahme
mit ausdrücklicher Freigabe; bisher fand kein Upload oder Posting statt.
