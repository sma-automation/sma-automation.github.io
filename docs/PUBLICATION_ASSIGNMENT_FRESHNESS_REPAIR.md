# SMA – YouTube-Test: abgelaufener Dateinachweis statt behaupteter Dateiveränderung

Stand: 11.11.2026, nur lesende Prüfung des tatsächlichen Auftrags. Kein Upload.

## Konkret ermittelter Fehler

Der vorhandene private YouTube-Auftrag `f1717e97-34a1-46fe-a9b4-a5c9c1533a71`
wurde am 07.11.2026 vorbereitet und ist **nicht genehmigt**.
Die gespeicherte Datei `SMA-Export-283abd16-3b72-4224-ab66-81b30afdab13.mp4`
hat in Auftrag und SMA-Dateikatalog weiterhin dieselbe SHA-256-gebundene
Revision. Das beweist noch **nicht** die aktuelle Bytegleichheit der
Google-Drive-Datei; hierzu ist eine neue echte Drive-Prüfung erforderlich.

Die Quellfunktion `public.sma_publication_assignment_v1` verwendete bisher
denselben Fehler `FILE_CHANGED` für zwei unterschiedliche Ursachen:

- `f.revision is distinct from p_asset_revision`: tatsächliche Differenz
  zwischen der gespeicherten und der verlangten Katalogrevision.
- `f.verified_at < now()-interval '15 minutes'`: lediglich ein zu alter
  vom internen Dienst gespeicherter Datei-Nachweis.

Damit erschien auch bei abgelaufenem Verifizierungszeitpunkt die falsche
Handlungsanweisung „Die Datei wurde geändert“.

## Sichere Korrektur

`supabase/sql/publication-assignment-stale-file-reason.sql` ändert nur
diese Unterscheidung. Die exakte **produktive** Originalfunktions-SHA
`874e294631f9b69f3dfa616899438843` (MD5 von `pg_proc.prosrc`) wird
vor jeder Installation überprüft. Ein abweichender Datenbankstand
verhindert das Einspielen.

- Eine tatsächlich ungleiche Revision bleibt `FILE_CHANGED`.
- Ein nicht mehr frischer Nachweis wird `FILE_REFRESH_REQUIRED`.
- Datei nicht vorhanden, Kunde inaktiv, veränderte Zuordnung,
  veränderter Produktlink und Portaltextbedingungen bleiben erhalten.
- `can_publish=false` und service-only Funktionsrechte bleiben erhalten.
- Der 15-Minuten-Grenzwert wird **nicht erhöht**.
- Es wird kein `verified_at` aktualisiert oder fingiert.
- Das vorhandene Dashboard kennt bereits die Meldung
  „Bitte aktualisiere die Dateiliste und versuche es erneut.“

**Die SQL-Vorlage ist zunächst nur ein GitHub-Entwurf.** Ohne gesonderte
Freigabe wird sie nicht in die produktive Datenbank eingespielt.

## Nächster echter Bedienweg, ohne neue Browser-Tabs

Im bestehenden SMA-Dashboard beim betroffenen Video
**Dateien aktualisieren** verwenden. Der vorhandene n8n-Drive-Dateiabgleich
muss dabei die Datei tatsächlich mit berechtigtem Google-Drive-Zugang
erneut prüfen und den korrekt gebundenen Dateistand speichern.

Danach unter **History → Aufträge** den alten vorbereiteten Test öffnen
und bewusst **Vorbereitung neu starten**. Die YouTube-Zielkonto-Optionen
müssen neu abgerufen werden; die alte Kontoprüfung lief am 07.11.2026 ab.

Die alte Vorbereitung erhält **nicht** automatisch eine neue Frist oder
eine Zustimmung. Medien-, Nutzungsrechte- und Musikbestätigungen müssen
vom Kunden selbst stammen. Eine gesonderte Betreiberfreigabe bleibt
Voraussetzung für einen echten, auch privaten YouTube-Upload.

## Aktuelle technische Grenzen

Der verbundene ChatGPT-Google-Drive-Account kann die in diesem Auftrag
gespeicherte Originaldatei noch nicht direkt lesen (Drive `404`).
Das bedeutet für diesen Account fehlenden Zugriff oder eine
nicht verfügbare Datei, nicht nachweislich gelöschte Videobytes.
Es wird weder eine neue Freigabe verlangt noch der bestehende
Dateikatalog blind aktualisiert.

Die aktuell verfügbaren Verbindungen ermöglichen Supabase- und
GitHub-Leseprüfungen, aber keinen bestätigten Zugriff auf die
geschützte n8n-Konto-Refresh-Ausführung. Ein Echt-Nachweis der
YouTube-Uploadberechtigung muss im vorhandenen Kundenassistenten
durchgeführt werden. Kein zusätzliches Hosting, kein Kauf.
