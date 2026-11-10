# SMA – aufgeräumte Dateigalerie und Vorschau-Aktionen

Stand: 10. November 2026. UI-Anpassung für die Portaloptimierungen YouTube, TikTok, Instagram und Facebook. Der normale separate Datei-Auswahldialog außerhalb der breiten Optimierungsansicht bleibt unverändert.

## Verhalten

- **„Deine Dateien“:** Nur Titel, eigentliche Vorschaubilder und „Dateien aktualisieren“ im Kopfbereich; keine Schaltfläche „Datei hinzufügen“ mehr in der Galerie.
- **Dateikacheln:** Bild-/Videovorschau, Titel und kurze Variante bleiben. Der doppelte ausklappbare Block **„Dateidetails“** unter den Titeln entfällt. Die gesamte Kachel öffnet wie bisher die große Vorschau; nicht geeignete Dateien bleiben für das jeweilige Portal gesperrt.
- **Große Vorschau:** Im Kopfbereich „Vorschau für YouTube/TikTok/Instagram/Facebook“ steht die **bestehende Schaltfläche „Datei hinzufügen“**. Ihr ursprünglich vorhandener Dateiauswahldialog, der Uploadhandler, Status, Fortschrittsanzeige, Abbrechen und Fortsetzen werden ausschließlich umgehängt, nicht ersetzt. Sie bleiben auch erreichbar, während der Reiter „Dateidetails“ offen ist.
- **Dateidetails:** Der bestehende Vorschau-Reiter zeigt Dateiname, Größe, Abmessungen, Dauer, Portal und weitere Prüfhinweise. Keiner dieser Nachweise wird entfernt oder automatisch als bestanden markiert.
- **Rückweg:** „← Datei“ führt zurück zur Galerie. „Dateien aktualisieren“ bleibt sichtbar. Die Portal-/Entwurf-/Sicherheitsfreigaben werden nicht verändert.

## Separat mitgetestete Metadatenkorrektur

Wenn ein frisch verifizierter Google-Drive-Katalog für exakt dieselbe Datei **neue Versionsnummer, aber identischen SHA-256-Inhalt und Größe** meldet und der neue Stand Videolänge sowie Abmessungen hat, darf SMA **ausschließlich bei vollständig leerem, ungespeichertem Auftrags-/Textzustand** die neue Version übernehmen. Bestehende Zuweisungen, Entwürfe, Änderungsstände, ungültige Prüfhinweise oder echte Inhaltsänderungen dürfen damit niemals umgangen werden. Die nach wie vor erforderliche Medienprüfung und die explizite Freigabe bleiben offen.

## Technische Abnahme

- `tests/optimizer-workspace.test.cjs`: tatsächliche Knoten wiederverwendet; Uploadknopf ist nur in der großen Vorschau platziert, auch beim Wechsel zum Detailreiter.
- `tests/publication-gallery-preview.test.cjs`: isolierte Ausführung der echten Galerie-Renderfunktion für YouTube: keine Details unter Vorschaubildern; normale Auswahlansicht behält Dateidetails.
- `tests/run-optimizer-layout.mjs`: bestehende Chromium-Viewport-Prüfungen für YouTube, TikTok, Instagram und Facebook inklusive neuer Uploadposition.
- `tests/media-metadata.test.cjs`: Versionswechsel nur für identische Videobytes, aktuelle Metadaten und ungebundenen Zustand.
- Repository-Gesamttests und bestehende SQL-Prüfungen via GitHub Actions.

Keine Anbieteranmeldung, keine Supabase-Migration, kein n8n-Workflow-Update, keine Benutzerdatei hochgeladen, keine Social-Media-Veröffentlichung, kein kostenpflichtiger Vorgang. PR #57, #69 und #185 bleiben getrennt.

## Nachtrag – Erststart ohne Dateien (10.11.2026)

Nach dem Entfernen von „Datei hinzufügen“ aus der Galerie war der Knopf im Vorschaukopf ohne vorhandenes Medium unerreichbar. Für **neue Konten ohne portalgeeignete Dateien** gibt es deshalb nun genau eine dezente leere Platzhalterkachel „Noch keine passende Datei – Vorschau öffnen und Datei vorbereiten“. Sie öffnet die große Vorschau im **Uploadmodus**. Erst dort steht der bestehende Button **„Datei hinzufügen“**, inklusive unverändertem Upload-Handler und Fortschrittsanzeige. Die Galerie selbst erhält **keinen** „Datei hinzufügen“-Button zurück.

Der Uploadmodus zeigt ausdrücklich **keine** erfundenen Videodaten, Portalbeiträge, Dateidetails oder Freigaben. Beim Zurückgehen ist wieder nur die Galerie sichtbar; nach dem tatsächlichen Upload einer geeigneten Datei greift wie zuvor die normale Dateiauswahl. Die Platzhalterkachel erscheint nicht, wenn bereits mindestens eine kompatible Datei vorhanden ist, und bleibt während einer Suchfilterung ausgeblendet.

Regressionen: DOM-Test für Uploadmodus ohne Datei, tatsächlicher Galerie-Renderer mit leerem/ungeeignetem/normalem Bestand, vorhandene Editor- und Versionssperrentests, Smartphone-/Desktop-Layout. Keine Social-Media-Veröffentlichung und keine n8n-Änderung.
