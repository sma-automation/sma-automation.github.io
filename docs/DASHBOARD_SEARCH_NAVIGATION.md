# SMA Dashboard – Zentrale Suche und kurze Navigationswege

Stand: 11. November 2026. Ziel: Kunden müssen nicht durch mehrere Seiten
blättern oder von einem Assistenten eine unbekannte Datei suchen lassen.

## Neuer sichtbarer Einstieg

Die existierende Dashboard-Kopfleiste enthält ein Suchfeld
**„Dateien oder Bereiche suchen …“**. Ein Klick oder **Strg+K**
öffnet die kompakte Suche. Auf dem Handy erscheint dieselbe Suchansicht
als Bildschirmdialog.

Mit der Suche werden die **bereits vorhandenen Kapitel** gefunden:
Übersicht, Veröffentlichung/Dateien, History, Content, Social Media,
Musikbibliothek, Shop, Webseiten, Einstellungen und Tutorials.
Die Navigation benutzt die originalen Sidebar-Schaltflächen.
Es wird kein zusätzliches Menü geschaffen und kein neuer Tab geöffnet.

Die Suche findet außerdem die Kundendateien aus dem
**bestehenden** `sma_publication_files_v1('list')`-RPC.
Akzente (z. B. „Küche“/„Kuche“), mehrere Suchwörter und
Teile langer Dateinamen werden berücksichtigt. Treffer werden nach
letzter Dateiänderung sortiert. Es werden höchstens 20 Ergebnisse
auf einmal eingeblendet, damit die Liste nicht endlos lang wird.

## Direkt zur gefundenen Datei

Der Dateitreffer öffnet den bereits bestehenden Optimierer mit der
richtigen gespeicherten Datei-ID im gleichen Dashboard; standardmäßig
im bereits verknüpften Portal. Bei mehreren Portalen wird die
bevorzugte Reihenfolge YouTube, TikTok, Instagram, Facebook verwendet.
Bei Bildern ohne Zuordnung öffnet sich Instagram, bei Videos YouTube.
Das ist ausschließlich **Navigation**, keine Veröffentlichungsfreigabe.

Zusätzlich hat **Veröffentlichung → Dateien** ein eigenes Suchfeld
**„Dateien suchen …“** bekommen. Es filtert alle zurückgelieferten
Dateien **vor** der Paginierung, nicht bloß die aktuell sichtbaren
zehn Kacheln. Nach Auswahl durch die globale Suche wird die Datei
auch in der Galerie selektiert; eine frühere lokale Filtereingabe
wird dabei zurückgesetzt.

## Sicherheits- und Bestandsgrenzen

- Keine zusätzlichen Provider-Schnittstellen, kein Upload, kein Posting.
- Keine neuen Supabase-Tabellen, RPCs oder Freigabe-/OAuth-Aktionen.
- Die bestehende angemeldete SMA-Sitzung ist erforderlich.
- Die Datei-Liste kommt ausschließlich über den bisherigen
  kunden-/eigentümergebundenen RPC. Nach jedem Abruf und vor dem
  Öffnen wird die aktuelle Benutzeridentität erneut geprüft.
- Suchbegriffe werden nicht auf dem Server gespeichert.
  Auch Passwörter, gespeicherte Portaltexte und fremde Dateien
  erscheinen nicht in den Ergebnissen.
- Beim Abmelden, Kontowechsel und Dashboard-Neuladen werden
  die Suchergebnisse gelöscht und die Suchdialoge entfernt.
- Keine stillschweigende Aktualisierung des alten
  15-Minuten-Dateinachweises und keine Umgehung der
  Kontoprüfung oder persönlichen Kundenfreigabe.

## Technische Einordnung und Folgeausbau

Dieses PR ist der erste Navigations-Schritt, **nicht** die
Fertigstellung einer kompletten produktweiten Volltextsuche.
Im nächsten getrennten Ausbauschritt könnten bestehende
Auftrags- und Bestellungsabfragen als weitere, streng
eigentümergeschützte Kategorien hinzukommen.

Die aktuelle Suche umfasst Dashboard-Bereiche und
vorhandene Kunden-Dateinamen, **nicht** fremde Drive-Ordner
oder komplette gespeicherte Produkt-/Auftragstexte.

## Tests

`tests/run-dashboard-global-search-dom.mjs` prüft:
sichtbares Headerfeld; Datei- und Bereichstreffer; das Öffnen
des richtigen Videos in YouTube und TikTok; Unicode;
Tastaturbedienung; Besitzerwechsel und Abmeldung; Fehlerbehandlung;
Direktnavigation; lokale Galerie-Suche ohne neue Endpunkte.

Bestehende Dashboard-Kapitel, Dateigalerie, Originalvideo,
Musik und Shop-Tests bleiben unverändert ausführbar.
