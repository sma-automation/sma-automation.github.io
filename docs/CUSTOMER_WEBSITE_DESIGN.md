# Individuelle Gestaltung der SMA-Kundenwebseite

Stand: 4. November 2026. Ausgangspunkt ist `website-v1` nach dem zusammengeführten und live geprüften PR #70 (`6de7a26`). Die abgeschlossene Profilpflege und automatische Vorschauaktualisierung werden weiterverwendet. Die hier beschriebene Gestaltung ist vorbereitet und lokal geprüft, **noch nicht bereitgestellt**.

## Nächster Kundenschritt

Der bisherige Editor kann Texte und gemeinsame Firmendaten übernehmen, bietet aber für alle Betriebe dieselbe blaue Darstellung mit SHK-Hausmotiv. Unter **Webseite bearbeiten → Gestaltung** kann der Kunde jetzt wählen:

| Einstellung | Auswahl |
| --- | --- |
| Akzentfarbe | Blau, Grün, Violett, Terrakotta |
| Startseitenmotiv | Haus & Technik, Abstrakt, Ohne Motiv |

Der Bereich ist zunächst zugeklappt. Geöffnet erscheinen zwei kurze Auswahlfelder, auf dem Handy untereinander. Die vorhandene Schrift, Texteingaben und kompakte Dashboard-Übersicht bleiben erhalten. Der Editor selbst behält die SMA-Farbe; die gewählte Farbe gilt für die Kundenwebseite.

**Änderungen speichern** speichert Texte und Gestaltung gemeinsam im privaten Entwurf. Die offene private Vorschau übernimmt den gespeicherten Stand beim Zurückwechseln über die vorhandene Funktion aus PR #70. Ein öffentliches Angebot bleibt beim ausdrücklich veröffentlichten Snapshot. Die bestehende Aktion zum Veröffentlichen übernimmt später auch die gewählte Gestaltung; dieser Schritt wurde ausschließlich mit isolierten SQL-Testdaten geprüft.

Bestehende Entwürfe und veröffentlichte Seiten ohne Gestaltungsfelder erscheinen weiterhin in Blau mit Hausmotiv. Neue freie CSS-, HTML-, URL- oder Bild-Uploadfelder werden nicht eingeführt. Eigene Fotos/Logos und individuelle Domains bleiben gesonderte Erweiterungen.

## Speicherung und Bereitstellung

Die vorhandenen JSON-Inhalte erhalten zwei optionale, streng begrenzte Zeichenketten: `accent` und `hero`. JavaScript und die bestehende SQL-Inhaltsprüfung akzeptieren ausschließlich die oben aufgeführten Werte. Keine neue Tabelle, keine neuen Rechte oder externen Abrufe. Profilübernahme, Revisionen, Wiederholung und Besitzerprüfung bleiben auf dem vorhandenen Weg.

Ältere Schreibanfragen ohne Gestaltungsfelder erhalten bereits gespeicherte Werte. Die neue Oberfläche liest auch alte Inhalte. Alte, bereits geöffnete Browserseiten müssen bei Bereitstellung neu geladen werden, da deren bisherige Inhaltsprüfung zusätzliche Felder noch nicht kennt. Die geänderten HTML-Einstiege und ihre Modul-/Stylesheet-Abhängigkeiten erhalten neue Cache-Versionen.

**Erst nach Freigabe:**

1. Die aktualisierte Fassung von `supabase/sql/customer-websites.sql` im bestehenden Projekt bereitstellen. Die Änderungen betreffen die Inhaltsvalidierung und die Beibehaltung optionaler Gestaltungsfelder bei älteren Schreibanfragen. Kein Kundeninhalt wird durch das Installationsskript geändert.
2. Den PR in `website-v1` übernehmen und die Oberflächenbereitstellung prüfen. Die neue Oberfläche darf nicht vor dem SQL-Update ausgeliefert werden, da der alte Validator Gestaltungsfelder ablehnt.
3. Den angemeldeten privaten Ablauf prüfen. Der vorhandene fiktive SHK-Entwurf bleibt privat; keine öffentliche Kundenwebseite wird dafür benötigt.

Nach Speicherung neuer Felder nicht allein die alte, strengere JavaScript-/SQL-Version zurückrollen: Diese kann neue Inhalte nicht lesen beziehungsweise akzeptieren. Eine Korrektur muss die optionalen Felder weiter unterstützen. Vor einer späteren Veröffentlichung bleiben echte Firmendaten und Seitenangaben eine eigene Kundenentscheidung.

## Nachweise

- **362 Node-Tests bestanden** (359 bestehende plus drei neue): optionale Felder, alle zwölf Kombinationen, Ablehnung freier CSS-/URL-/HTML-Werte und Wiederholung eines unterbrochenen Speichervorgangs.
- **Sieben neue DOM-Szenarien bestanden:** bisherige Darstellung, zwölf Renderkombinationen, kompakter Einstieg, Speichern/Wiederaufruf, Fehler/Wiederholung, Übernahme in die offene private Vorschau bei unverändertem öffentlichen Snapshot und Leeren beim Kontowechsel.
- Lokales PostgreSQL über PGlite: Inhaltsgrenzen, dauerhafte Speicherung innerhalb der Testdatenbank, Wiederholung, ältere Schreibanfragen, Revisionskonflikt sowie getrennte private/öffentliche Gestaltung und Offline-Schaltung. Alle Fixtures zurückgerollt. Bestehende Webseiten-/Profil-SQL-Prüfungen einschließlich Rollen und Direktrechten bestanden ebenfalls.
- Bestehende Webseiten-/Firmenprofil-/WordPress-/WordPress-Sync-DOM-Prüfungen und die zwölf Vorschauaktualisierungs-Szenarien bestanden. `git diff --check` sauber.
- Browserlauf mit den tatsächlichen Editor-/Modell-/Vorschau-/Renderer-Modulen, fiktiven Daten und simuliertem Speicherweg im lokalen Browserspeicher: Grün + Abstrakt speichern, Fokus zur bereits offenen Vorschau wechseln, geänderte Darstellung sichtbar. Danach Terrakotta + Ohne Motiv speichern, Vorschau ohne SVG und wieder geöffnete Desktopansicht bestätigt.
- Zwei 390-Pixel-Handyrahmen: jeweils 375 Pixel nutzbare Breite und 375 Pixel Inhaltsbreite. Desktopansicht: 1348 Pixel nutzbare Breite und Inhaltsbreite. Kein horizontaler Überlauf. Kein neuer angemeldeter Supabase-Livetest und keine reale Veröffentlichung aus dieser Browserprüfung abzuleiten.

![Lokale Gestaltungsauswahl und automatisch aktualisierte private Vorschau](evidence/customer-website-design-2026-11-04.jpg)

```sh
node --test tests/*.test.cjs
node tests/run-customer-websites-sql.mjs
node tests/run-customer-website-design-dom.mjs
node tests/run-customer-website-dom.mjs
node tests/run-customer-website-refresh-dom.mjs
node tests/run-company-profile-dom.mjs
node tests/run-wordpress-dom.mjs
node tests/run-wordpress-sync-dom.mjs
```

Keine Produktionsdaten verändert, keine Migration installiert, keine Veröffentlichung, Hostingbuchung oder DNS-/Tarifänderung ausgeführt. PR #69 bleibt als lokaler WordPress-Praxistest separat offen; keine externe Testadresse vorhanden und weiterhin nur Produktbereich, keine Firmenprofiltexte. PR #57 bleibt separat. Sightengine: `VIDEO_PLAN_REQUIRED`; Meta und Serverumbau bleiben zurückgestellt.
