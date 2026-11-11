# Galerie-Musik: geschützte technische Evidenz (Entwurf, 11.11.2026)

## Ziel und derzeitiger Stand

PR #223 erzeugt nach unabhängiger Byte-Prüfung einen **lokalen Kandidaten** mit Dateirevision,
Video- und Audio-Daten. Die bestehende Medienvorprüfung erkennt bislang nur Magic-Effect- bzw.
Editor-Export-Evidenz. Diese Ergänzung führt einen **dritten, eigenen Evidenztyp** ein, ohne
Magic-Effect-Ergebnisse oder Exporte zu fälschen.

Der neue SQL-Entwurf liegt unter `supabase/sql/publication-gallery-technical.sql`.
Er ist **nicht** als produktive Migration ausgeführt, es gibt noch **keinen**
verbundenen produktiven Service-Worker, der die Registrierung ausführt.
Weder die Kundenoberfläche noch Veröffentlichungen oder Credits werden geändert.

## Vertrauensgrenze (unbedingt vor produktiver Aktivierung)

1. Ein autorisierter, privater SMA-Worker liest die aktuelle Datei-/Kundenzuordnung und den
   abgeschlossenen Galerieauftrag aus Supabase. Der Worker besitzt die nötigen
   Service-Berechtigungen; niemals den Service-Key im Browser oder Kunden-Dashboard verwenden.
2. Der Worker ruft **selbst** die aktuelle Original-MP4 und gespeicherte Musik-MP4 aus Google
   Drive ab und kontrolliert SHA-256, Bytezahl, unveränderte Videopakete, vollständige
   Dekodierung und nicht stummen AAC-Ton. Nur anschließend entsteht ein Kandidat über
   `gallery-technical-candidate.mjs`.
3. Die Registrierung `sma_private.publication_gallery_technical_register_v1(jsonb)` ist
   ausschließlich für `service_role` ausführbar. Der Datenbankteil prüft erneut den
   Besitzer, aktiven Paketstatus, abgeschlossenen Galerieauftrag, Originaldatei, Dateirevision,
   Drive-Dateikennung, erwartete Bytezahl, SHA-256, technisch erlaubtes AAC-Profil und
   den Tonpegel. **Datenbankcode allein kann nicht feststellen, ob der Aufrufer die Videobytes
   wirklich unabhängig geprüft hat.** Das muss der vertrauenswürdige Worker garantieren.
4. Der Eintrag ist unveränderlich und revisionsgebunden. Ein zweiter identischer Aufruf darf
   nur denselben Nachweis bestätigen; widersprüchliche Daten werden abgewiesen.
5. `publication_video_technical_v1` liest zuerst den bestehenden Magic-Effect-Nachweis,
   dann den Editor-Export und nur ersatzweise den genau passenden Galerie-Nachweis. Ein
   vorhandenes, aber ungültiges Magic-Ergebnis darf nicht auf Galerie-Nachweise zurückfallen.
6. Die eigentliche Medienvorprüfung behält alle übrigen offenen Punkte: aktuelle Katalog-
   Metadaten, Sicherheits-/Inhaltsprüfung, Untertitel, Rechte, Plattformkonto, menschliche
   Bestätigung und Provider-Freigabe. `can_publish` bleibt unabhängig davon `false`.

## Technische und sicherheitliche Leitplanken

- Private Tabelle mit aktiviertem RLS, ohne Kunden-DML-Rechte und ohne direkten Schreibzugriff
  durch `service_role`; ausschließlich der eng begrenzte private RPC darf einfügen.
- Kein Public-/Anon-/Authenticated-RPC. Kein neuer offener Webhook.
- Keine Übernahme der Tonspur- oder Magic-Effect-Freigabe von der ursprünglichen stummen Datei.
- Ein Ergebnis mit 44,1 bzw. 48 kHz AAC-LC-Stereo kann technische Evidenz liefern.
  Ein stummes oder ungültiges Audioprofil wird abgewiesen.
- Weder ein technischer Erfolg noch ein DB-Eintrag bedeutet eine Portalzertifizierung.

## Prüfung und Rollout-Grenzen

`tests/run-publication-gallery-technical-sql.mjs` läuft gegen PGlite mit **synthetischen**
Dateien, Rollen, Nutzern und Hashes. Getestet werden insbesondere falsche Prüfsummen,
Datei-/Quellrevisionen, fehlende Tonfreigabe, andere Abtastraten, wiederholte Aufrufe,
fehlende Rechte und unveränderte Priorität von Magic Effect.

Vor einem echten Rollout:
- GitHub-CI vollständig bestehen lassen.
- Mit der Supabase-CLI eine neue Migration aus der SQL-Vorlage erzeugen, **nicht** eine
  bestehende Produktionsmigration überschreiben. Die CLI ist in der derzeitigen
  isolierten Umgebung nicht installiert; deshalb wird kein erfundener Migrationsname verwendet.
- Schema- und Sicherheitsprüfung, Tests gegen den exakten SQL-Baseline-Hash und den
  vorhandenen Kunden-/Medienprüfweg in einer isolierten Umgebung wiederholen.
- Privaten Worker erst anbinden, nachdem die unabhängige Drive-Byteprüfung und
  erneute Datenbankbindung dort nachgewiesen sind.
- Vor jeder Live-Migration und Worker-Aktivierung ausdrückliche Betreiberfreigabe einholen.

**Diese Änderung enthält bewusst weder eine Live-Migration noch einen n8n-Deployment-Auftrag.**
