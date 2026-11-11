# SMA – Geschütztes Galerie-Dienstkonto (vorerst gesperrt)

Stand: 11. November 2026. Dies ist ein **separater, zunächst inaktiver**
Serveridentitäts-Schritt; keine Authentifizierung, Veröffentlichung oder
Credit-Veränderung.

## Bereits bestätigt

- Supabase PostgreSQL 17: Die interne Gruppe `sma_gallery_snapshot_reader`
  existiert bereits, ist `NOLOGIN` und darf nur die private
  `sma_private.gallery_worker_snapshot_v1(uuid)` lesen.
- Der Galerie-Snapshot des echten Testauftrags funktioniert.
- Ein Benutzer `sma_gallery_worker_login` existierte beim Vorabcheck
  noch nicht.

## Diese Vorlage

`supabase/sql/gallery-worker-dormant-account.sql` erstellt
`sma_gallery_worker_login` mit **NOLOGIN, PASSWORD NULL** und
maximal einer Verbindung. Die Rolle ist
`NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
NOBYPASSRLS`. Sie erbt ausschließlich die Leseberechtigung
der bestehenden Gruppe. Die Gruppe kann damit nicht per `SET ROLE`
angenommen werden (`SET FALSE`); Admin-Vergabe ist ebenfalls gesperrt.

Zusätzliche Standards: Read-only-Transaktionen, Statement-Timeout
15 Sekunden und Idle-Transaktions-Timeout 10 Sekunden.
Außerdem prüft `gallery-private-server-runner.mjs` vor jeder Ausführung,
ob genau die Identität `sma_gallery_worker_login` angemeldet ist.
Fremde und privilegierte Konten werden auch bei bekanntem
Snapshot-Funktionsnamen gesperrt.

**Die Rolle besitzt absichtlich weder Passwort noch LOGIN.**
Der Migrationslauf ist damit noch kein einsatzfähiger Server-Zugang.

## Erst beim tatsächlichen Serverumzug

Der freigegebene Serverbetreiber muss das Passwort über einen eigenen
lokalen Secret-Manager generieren und geschützt bereitstellen. Kein
Passwort in Chat, Screenshots, GitHub, GitHub Actions oder Migrations-SQL.

Ein späterer Administrator aktiviert und rotiert die Identität
ausschließlich auf einem geprüften Server-Verbindungsweg. Eine
interaktive `psql \password sma_gallery_worker_login`-Abfrage im
geschützten Admin-Terminal vermeidet ein Passwortliteral im SQL-Verlauf.
LOGIN wird erst **danach und erst mit eigener Freigabe** aktiviert.

Vor dem ersten privaten Durchlauf müssen folgende Punkte kontrolliert
werden: Benutzerrolle hat kein BYPASSRLS, keine Tabellenrechte,
ausschließlich die ererbte Snapshot-Funktion, valide Server-TLS-
Verbindung, bestehender Drive-/Storage-Zugriff, FFmpeg und
ffprobe, schreibgeschützte Sitzung, genau ein Galerie-Testauftrag.

Danach wird der private Worker manuell im Nur-Lesen-Modus getestet;
keine automatische Registrierung, Musik-Credit-Abbuchung,
Social-Media-Veröffentlichung oder Aktivierung eines n8n-Triggers.

## Rücknahme

Solange die neue Rolle inaktiv ist und keine anderen Rollen sie
verwenden, lässt sie sich später separat entfernen. Die bereits
installierte Lesergruppe und die existierenden SMA-Kundendaten
werden bei einer Rücknahme ausdrücklich nicht verändert.

## Tests

`tests/run-gallery-worker-snapshot-sql.mjs` prüft in
einer synthetischen PostgreSQL-Instanz die neue NOLOGIN-Rolle,
das fehlende Passwort, die vererbte Freigabe, gesperrte direkte
Tabellenrechte und die expliziten Membership-Optionen.
`tests/gallery-private-db-role.test.cjs` prüft die Runner-Sperren.

Keine Tests enthalten echte Provider-Tokens oder echte Kundendateien.
