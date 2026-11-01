# Dateiversionsgebundene visuelle Sicherheitsprüfung

Stand 2026-11-01. **Aktiv: Bildprüfung. Videoanalyse ist serverseitig gesperrt (`VIDEO_PLAN_REQUIRED`), weil der echte Diensttest fehlenden Zugriff im kostenlosen Sightengine-Tarif meldet. Kein Tarif wurde geändert.** Ergänzt die technische Medienvorprüfung und die Datei-/Portaltextzuordnung. Kein Veröffentlichungsadapter und keine automatische Freigabe.

## Ablauf und Grenzen

`Dateiinhalt prüfen` im Medienbereich einer Portal-Kachel startet eine authentifizierte Prüfung. Die Datenbank reserviert die eigene aktuelle Datei. n8n löst die beiden Kundenordner anhand der überprüften Kontozuordnung auf und kontrolliert Drive-ID, Elternordner, Version, Prüfsumme, MIME, Größe, Dauer und Downloadberechtigung vor dem Download. Ein Range-Header begrenzt den angeforderten Download auf die bekannte Dateigröße. Die erhaltenen Bytes müssen exakt zu Größe und Prüfsumme passen. Ein einfacher Signatur-/Animationsfilter schützt vor offensichtlich falschen Bildformaten. Dies ersetzt keine vollständige Dekodierung.

Die Bytes gehen direkt an den bereits eingerichteten Dienst Sightengine. Kein öffentlicher Medienlink, kein Cloudinary-Upload. Nach der Prüfung wird der Drive-Stand erneut gelesen. Der Datenbankabschluss verlangt den noch gültigen Auftrag und die unveränderte aktuelle Konto-/Dateizuordnung. Die Schnittstelle liefert dem Browser ausschließlich den bereinigten Status.

- Statische JPEG/PNG/WebP-Bilder: SMA-Vorgrenze 12 MB. GIF, APNG und animiertes WebP werden nicht als vollständig geprüft eingestuft.
- Vorbereiteter, noch nicht aktivierter Videopfad: MP4/MOV/WebM: kleiner als 50 MB und kürzer als 60 Sekunden; visuelle Stichproben mit `interval=1`. Die Antwort muss vollständige Modellwerte und zeitliche Abdeckung vom Anfang bis höchstens 1,1 Sekunden vor dem gemeldeten Ende enthalten. Dies ist keine Prüfung jedes Videoframes und enthält keinen Ton.
- Modelle: nudity-2.1, violence, weapon, gore-2.0, offensive-2.0, recreational_drug, self-harm.
- SMA-Prüfgrenze: mindestens ein Modellwert ab 0,35 ergibt `needs_review`. Niedrigere Werte ergeben `clear` für diese visuelle Prüfung. Dies sind SMA-Einstellungen, keine garantierten Portalentscheidungen. Fiktion, Nachrichten, Kultur und sonstiger Kontext können manuelle Beurteilung erfordern. `offensive.asian_swastika` wird nicht als Hasssignal ausgewertet.
- Fehlende, nicht numerische, unendliche oder ungültige Modellwerte führen zu `REVIEW_INCOMPLETE`; niemals Ersatzwert null/0. Aktuelles Nudity-2.1-Feld: `nudity.suggestive_classes.sextoy` (durch echten Diensttest verifiziert).
- Die Klassifizierung läuft einmal je Datei, Dateiversion und Prüfregelversion, nicht einmal je Portal. Ein abgeschlossener Treffer wird wiederverwendet. Dateiaustausch, Änderung der Kontozuordnung oder Regelversion machen das Ergebnis unbrauchbar.
- Maximal eine aktive Prüfung pro Benutzer, 30 Sekunden Abstand, sechs Versuche pro Stunde. Wiederholungsversuche zählen mit. Auftrag vier Minuten gültig, Workflow-Timeout 210 Sekunden.
- Gespeichert werden nur sichere Kategorien, Anzahl/Intervall der Einzelbilder, Status, Zeitpunkte und SHA-256. Keine rohe Anbieterantwort, kein Bild, kein Transkript. n8n-Ausführungsdaten und manuelle Ausführungen nicht speichern.
- `can_publish` bleibt überall `false`. OCR, Sprache, inhaltliche Aussagen, Übereinstimmung mit dem Portaltext, Rechte, Kennzeichnungen, Zielkonto und verbindliche Freigabe bleiben offen.

## Einrichtung

1. Nach `publication-files.sql` / `publication-media-precheck.sql`: `supabase/sql/publication-content-review.sql` anwenden. Alte Basismigrationen später nicht erneut als aktuellen Funktionsstand aufspielen.
2. `python n8n/publishing/build-content-review.py` aus dem Repository-Verzeichnis ausführen und den separaten Workflow importieren. Credentials sind ausschließlich Referenzen auf die vorhandenen Drive-, Sightengine- und Supabase-Verbindungen.
3. Importierte n8n-Einstellungen ausdrücklich kontrollieren: v1, vier Speicheroptionen auf „Do not save“, Timeout 210 Sekunden, Aufruf nur durch eigenen Workflow-Besitzer, keine angehefteten Daten. n8n übernimmt importierte Einstellungen nicht zuverlässig.
4. Separaten Workflow veröffentlichen. Hauptworkflow und tägliche Veröffentlichung bleiben unberührt.

## Verifikation

Node-Tests prüfen fehlende Modellwerte, Abdeckung der Videostichproben, Prüfsummen/Größe/Signatur, animierte Dateien, Versions-/Ordnergrenzen, fixe Dienstziele und Frontend-Zustände. SQL-Tests laufen mit Rollback und prüfen Eigentümergrenzen, Versionswechsel, Cache, Wiederholungsbegrenzung, Rollen, Abschlussberechtigung und Auftragswiederholung. Kein Test legt Medien in überwachten Kundenordnern ab.

Live-Dienstprüfung: selbst erzeugtes neutrales Bild erfolgreich mit vollständiger Modellantwort; neutrales dreisekündiges Video vom Anbieter wegen fehlendem Videozugriff im kostenlosen Tarif abgewiesen. Diese Verbindungstests ersetzen keinen End-to-End-Test mit einer echten Datei aus dem Kundenordner.

## Primärquellen

- https://sightengine.com/pricing
- https://sightengine.com/docs/moderate-stored-video
- https://www.sightengine.com/faq/recommended-video-dimensions-and-length
- https://sightengine.com/docs/advanced-nudity-detection-model-2.1
- https://sightengine.com/docs/violence-detection-model
- https://sightengine.com/docs/self-harm-detection-model
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- https://docs.n8n.io/code/cookbook/code-node/get-binary-data-buffer/
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/

Produktionsworkflow: `mWoUMjzxAsfggRHU` – „SMA – Dateiinhaltsprüfung V1“. Die vorherigen neutralen Prüfknoten wurden vor der Veröffentlichung entfernt. Endpunkt: `POST /webhook/sma-publication-content-review-v1`. Die kostenlose Dienstverbindung wurde tatsächlich geprüft; die Videosperre ist sowohl in der Datenbank als auch im Frontend wirksam.
