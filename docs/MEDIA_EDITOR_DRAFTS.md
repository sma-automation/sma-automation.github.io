# Bearbeitungsentwürfe und Änderungsverlauf

Stand: 6. November 2026. Zielbranch: `website-v1`.

## Tatsächlicher Ausgangspunkt

Der aktuelle Content Optimizer war ein statischer Platzhalter mit deaktiviertem
Knopf. Weder im Repository noch in den produktiven Tabellen bestand ein
Speicherweg für Editor-Einstellungen. Eine ältere Annahme über einen fertigen
Editor mit Zuschnitt, Cover, Overlay und Musik war daher nicht bestätigt.
Diese Lieferung schafft zuerst speicherbare Bearbeitungsentwürfe und deren
unveränderliches Änderungsjournal; sie behauptet keinen fertigen Medienexport.

## Kundenablauf

Dashboard → **Content** → **Content Optimizer** → **Bearbeitungsentwurf öffnen**.
Die separate Seite nutzt die bestehende Anmeldung und den eigenen Dateikatalog.
Das Laden der Dateiliste liest gespeicherte Katalogdaten; neue Dateien werden
weiterhin über Veröffentlichung hinzugefügt/aktualisiert.

| Kapitel | Verfügbar | Grenze |
| --- | --- | --- |
| Format & Ausschnitt | Original, 9:16, 1:1, 16:9; Einpassen/Ausfüllen; horizontale/vertikale Position | Standbild-Vorschau, keine neue Mediendatei |
| Schnitt & Cover | Beginn, Ende, Cover-Zeitpunkt in Sekunden | Nur für Videos mit bekannter Dauer; vorgemerkte Zeitpunkte, kein Schnitt-/Cover-Rendering |
| Text | Bis 160 Unicode-Zeichen, oben/Mitte/unten, sichtbare Einblendung | Vorschau und gespeicherter Entwurf |
| Ton | Originalton 0–100 % | Vorgemerkt; keine Hörprobe oder zusätzliche Musik |

Nur **Entwurf speichern** schreibt. Ohne Änderung entsteht kein Eintrag.
Kapitelwechsel bewahren ungespeicherte Angaben. Ein Datewechsel mit ungespeicherten
Änderungen wird blockiert; **Gespeicherten Stand laden** verlangt dann das
bewusste Verwerfen. Authentifizierungswechsel löschen Felder und Vorschaubild.
Vorschaudaten bleiben im Speicher; alte Blob-URLs werden freigegeben.

Dashboard → **History** → **Bearbeitungen** zeigt je fünf Speicherstände mit
aufklappbaren Vorher-/Nachher-Werten, Zeit und Entwurfversion. Gemeinsame Monatswahl
in Europe/Vienna, 20 Einträge pro Serverabruf, unabhängige Vor-/Zurückseiten.
Es gibt keinen Schreib- oder Veröffentlichungsbutton im History-Kapitel.

## Speicherung und Schutz

- Private Tabellen `publication_editor_drafts_v1` und `publication_editor_history_v1`.
  RLS ist aktiv; PUBLIC, anon, authenticated und service_role haben keine direkten
  Tabellenrechte. Kein Backfill, keine Trigger auf vorhandenen Daten.
- Public Invoker-RPCs `sma_publication_editor_v1` (get/save) und
  `sma_publication_editor_history_v1` (rein lesend), nur für authenticated.
  Private Definer prüfen auth.uid, eindeutigen aktiven bezahlten/Demo-Kunden,
  Eigentümer und Dateiversion. Leerer search_path, keine fremden Zugangsdaten.
- Einstellungen sind strikt auf zehn Felder beschränkt. Keine beliebigen URLs,
  externen Musikreferenzen oder HTML-Inhalte. Zeitbereiche müssen zur bekannten
  Videolänge passen. Bilder und Videos ohne Dauer akzeptieren keine Schnittzeiten.
- Entwurf gilt für `(asset_id, asset_revision)` und bekommt eine eigene Version.
  Datei wird beim Speichern gesperrt; erwartete Entwurfversion verhindert verlorene
  parallele Änderungen. Wiederholung derselben request_id ist idempotent;
  wiederverwendete IDs mit anderem Inhalt und veraltete Versionen werden abgelehnt.
- Aktueller Entwurf und Journal entstehen atomar. Journal enthält vorherige und
  neue Einstellungen, tatsächlich geänderte Felder und damaligen Dateinamen.
  Unveränderte Speicherung erzeugt keine Version. Bis 120 Änderungen pro Stunde
  und Kunde; harmlose Wiederholung einer bestätigten Anfrage bleibt möglich.
- Das Journal prüft gespeicherte Besitzer/Kunden gegen den aktuellen Dateieintrag.
  Verwaiste/umgehängte Dateien sind für beide Konten nicht sichtbar. Frühere
  Dateiversionen bleiben für den unveränderten Besitzer im Verlauf lesbar.
- Keine Änderung an Quelldatei, Portaltexten, Zuordnungen, Veröffentlichungspfaden
  oder n8n-Workflows. Die bestehende authentifizierte Thumbnail-Funktion wird
  wiederverwendet. Alle Antworten tragen `can_publish:false`.

Quelle: `supabase/sql/publication-editor-history.sql`; identische CLI-Migration:
`supabase/migrations/20261106160210_publication_editor_history_v1.sql`.
Frontend-Rollback: neue Einstiegs-/History-Module entfernen und die zusätzliche
Speicherung erhalten. Kein destruktiver Daten-Rollback notwendig.

## Prüfung

- 543 Repository-Tests; 120 neue SQL-Prüfungen in echtem PostgreSQL (PGlite).
- 8 Editor-DOM-Szenarien, 29 History-DOM-Szenarien und 8 Dashboard-Kapitel-Szenarien.
- Bisherige History-SQL-Suiten: 62 Aufträge, 52 Monate, 57 Portaltexte,
  79 Dateizuordnungen weiterhin erfolgreich.
- Neuer SQL-Nachweis: atomare Speicherung/Rollback, unveränderliche Snapshots,
  Versionskonflikt, idempotente Wiederholung, ungültige Einstellungen, Medienart,
  fremde/umgehängte/fehlende Dateien, Zugangsstatus, Rollenrechte, Rate-Limit,
  Wiener Monats-/Sommerzeitgrenzen und Seitenübergang ohne doppelte Einträge.
- Bedienung: kein automatisches Schreiben, Einstellungen/Tabwechsel, Zeiten,
  bewusster Entwurfswechsel, verlorene Antwort und identische Wiederholung,
  Konflikt ohne Überschreiben, Konto-/Sichtbarkeitswechsel, verspätete Antworten,
  Vorschau-Abbruch/URL-Freigabe, History-Seiten und sichere Textausgabe.
- Browserprüfung mit isolierten Beispieldaten: Desktop-Vorschau, Text/Format,
  Entwurf speichern und 390-px-Ansicht mit funktionierenden Kapitelreitern.

```sh
node --test tests/*.test.cjs
node tests/run-publication-editor-history-sql.mjs
node tests/run-media-editor-dom.mjs
node tests/run-publication-history-dom.mjs
```

Produktive Migration im bestehenden Projekt `bnvnmdxosbnuzedokqgh` angewendet.
Unter authentifizierter Kundenrolle in einer anschließend **zurückgerollten
Transaktion**: echten vorhandenen Dateistand laden, Texteinblendung speichern,
Versionszuwachs und einen neuen Journaleintrag lesen, identische Wiederholung
ohne Dopplung. `can_publish:false`. Danach beide neuen Tabellen wieder leer.
Keine künstlichen Testentwürfe bleiben im Kundenverlauf.

Vollständige Originaldaten unverändert vor/nach Migration und Rückrollprüfung:
Dateikatalog (2 Dateien) `b2cd2f3c9448bf4cab89c745eba80360`;
Portalzuordnungen `2f5ce5d1e642e747826283e45381d3b1`.
Security-Advisors: weiterhin 4 anonyme und 6 authentifizierte bestehende
Definer-Warnungen sowie 1 Passwortschutz-Warnung. Zwei zusätzliche INFO-Einträge
(jetzt 40) betreffen die absichtlich direkt gesperrten privaten Tabellen.
Keine neue Warnung; beide öffentlichen neuen Wrapper sind Invoker.

## Offene Anschlussarbeiten

1. Tatsächliche Medienverarbeitung und Export mit Bezug auf Dateiversion und
   Entwurfversion; Ergebnisvorschau und wiederholbare Exportaufträge.
2. Zusätzliche Musik erst mit geeigneter Quelle, Nutzungsrechten und tatsächlicher
   Audioverarbeitung anschließen. Die bestehende Musikbibliothek ist kein
   Nachweis einer funktionierenden Editor-Musikauswahl.
3. Fertige Medienvariante erst nach eigener Prüfung und Freigabe in die vorhandene
   Veröffentlichungsstrecke aufnehmen. Speichern eines Entwurfs ist keine Freigabe.
4. Magic-Effect-Analyseversuche brauchen separat ein eigenes Journal; bestehende
   Ergebnisse werden bei Wiederholung überschrieben.

Bestandsprüfung abgeschlossen, nicht erneut beginnen. Shopify-Testmodus bleibt
aktiv; PR #57/#69 und der unveröffentlichte n8n-Originalentwurf bleiben separat.
Keine Tarifänderung, kein Kauf und keine Social-Media-Veröffentlichung.

Weiterführung: [Echter Medienexport V1](MEDIA_EDITOR_EXPORT.md). Der dort dokumentierte Stand ergänzt die Entwurfsfunktion um gerenderte Dateien.
