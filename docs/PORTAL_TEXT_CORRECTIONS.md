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
