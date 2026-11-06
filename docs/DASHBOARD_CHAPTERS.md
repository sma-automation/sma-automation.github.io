# Dashboard-Kapitel

Stand: 06.11.2026. Zielbranch: `website-v1`.

Die freigegebene Kapitel-Darstellung der YouTube-Optimierung wird auf alle zwölf Dashboard-Bereiche übertragen: feine graue Grundlinie, blaue aktive Unterstreichung, graue inaktive Reiter, ein sichtbares Kapitel. Die Reiter stehen unmittelbar unter der Bereichsüberschrift. Bestehende Inhalte, Formulare, Aktionen und Ereignis-Handler bleiben erhalten.

| Bereich | Kapitel |
| --- | --- |
| Übersicht | Arbeitsbereich · Konto & Paket |
| Veröffentlichung | Portale · Dateien |
| Portaloptimierung | Datei · Inhalt und Ziel (bestehender Ablauf) |
| Social Media | YouTube · TikTok · Instagram · Facebook |
| Content | Meine Dateien · Content Optimizer · Magic Effect |
| Musikbibliothek | Tracks · Meine Playlist |
| History | Aufträge · Portaltexte · Dateiverlauf · Bearbeitungen |
| Einstellungen | Kundenkonto · Firmendaten · Paket & Credits · Schnittstellen |
| Tutorials | Schnellstart · Anleitungen · Hilfe |
| 24/7 Verkäufer | Beratung · Produkte & Content |
| Shop | Produkte · Bestellungen |
| Kundenassistent | Einrichtung · Assistenz |
| Webseite & Domain | Webseite · Firmendaten · Shop-Button · Domain · WordPress |

## Umsetzung

- `dashboard-chapters.mjs` verschiebt vorhandene DOM-Elemente mit Wiederherstellungsankern. Es kopiert keine Formularfelder und liest/schreibt keine Kundendaten.
- Gemeinsame Reiterdarstellung in `dashboard-chapters.css`; Maus- und Tastaturbedienung (Pfeiltasten, Pos1, Ende), ARIA-Zuordnung und Fokusmarkierung.
- Die vier ursprünglichen Veröffentlichungszeilen, native Optimierer-Galerie, Magic Effect, Textfelder und separate Dateivorschau bleiben bestehen. Im Optimierer sind die übergeordneten Kapitel ausgeblendet.
- Shop-Reiter bedienen die vorhandenen Schalter im bestehenden Shop-iframe. Bestellseiten, Filter und Auswahl bleiben erhalten; die iframe-Höhe folgt dem Inhalt. Beim Laden eines neuen iframe-Dokuments werden alte Listener entfernt.
- History behält Monatsfilter, Zahlen, fünf Einträge pro Seite und alle bisherigen Berechtigungs- und Aktualisierungsprüfungen.
- Die bestehende Webseitenverwaltung bietet optional Kapitelmodus. Interne Domain-/WordPress-Verweise synchronisieren den aktiven Reiter. Ungespeicherte Angaben bleiben beim Kapitelwechsel erhalten. Die Firmendaten erhalten einen eigenen Reiter; der Webseitenentwurf bleibt im Webseitenkapitel.
- Paket-Sperren bleiben sichtbar. Nur bereits freigeschaltete Statusbanner werden kompakter dargestellt.

## Prüfung vor Veröffentlichung

- 536 Repository-Tests bestanden.
- 8 neue DOM-Szenarien: alle zwölf Bereiche; Originalelemente und Eingaben; Tastaturbedienung; Veröffentlichung/Optimierer; Shop-Delegation und Neuladen; Webseiten-Kapitel und interne Verweise; Webseitenübersicht; Wiederherstellung und erneutes Einbinden.
- 21 bestehende History-DOM-Szenarien bestanden, einschließlich Paginierung, Eigentümerwechsel und verspäteter Antworten.
- Webseiten-Setup-DOM-Prüfung, 8 Domain-DOM-Szenarien und 12 Webseitenübersicht-DOM-Szenarien bestanden.
- CI: `.github/workflows/dashboard-chapter-tests.yml`.

Die Bestandsstrecke wird hierfür nicht erneut geprüft. Keine Bestellungen, Bestände, n8n-Workflows, Shopify-Modi oder Veröffentlichungsaufträge werden geändert. PR #57 und #69 bleiben separat.


## Ergänzung: Bearbeitungsentwurf

Content → Content Optimizer öffnet jetzt einen separaten **Bearbeitungsentwurf**.
Nur die bisher deaktivierte Platzhalterkarte wird ersetzt; äußeres Content-Kapitel,
Magic Effect und Veröffentlichung bleiben erhalten. Der Entwurf verwendet die
freigegebenen feinen Kapitelreiter für Format & Ausschnitt, Schnitt & Cover, Text
und Ton. Vorschau und gespeicherte Einstellungen sind verfügbar; Medienexport
und zusätzliche Musik sind noch offen. Details: `MEDIA_EDITOR_DRAFTS.md`.
