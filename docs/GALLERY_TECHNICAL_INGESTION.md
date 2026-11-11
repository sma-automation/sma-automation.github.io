# Galerie-Musik: geschützte technische Evidenz (Entwurf, 11.11.2026)

## Ziel und derzeitiger Stand

PR #223 erzeugt nach unabhängiger Byte-Prüfung einen **lokalen Kandidaten** mit Dateirevision,
Video- und Audio-Daten. Die bestehende Medienvorprüfung erkennt bislang nur Magic-Effect- bzw.
Editor-Export-Evidenz. Diese Ergänzung führt einen **dritten, eigenen Evidenztyp** ein, ohne
Magic-Effect-Ergebnisse oder Exporte zu fälschen.

Die ursprüngliche SQL-Vorlage liegt unter `supabase/sql/publication-gallery-technical.sql`.
Die **Datenbankregistrierung ist inzwischen installiert**: Supabase-Migration
`20261111151051_gallery_technical_evidence_service_only_v1`. Die Live-Prüfung
vom 11.11.2026 bestätigt `publication_gallery_technical_register_v1(jsonb)` mit
`EXECUTE` nur für `service_role` (nicht `anon` oder `authenticated`) sowie **0**
registrierte Galerie-Nachweise. Es gibt weiterhin **keinen aktiv verbundenen
privaten Worker**, der nach unabhängigem Byte-Check einen Nachweis registriert.
Die Kundenoberfläche, Veröffentlichungen und Credits bleiben unverändert.

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

Vor Aktivierung des privaten Workers:
- **Die Galerie-Registrierung nicht erneut installieren.** Die historische SQL-Vorlage
  dient dem Review und isolierten Tests; die produktive Migration ist bereits erfasst.
- GitHub-CI und die isolierten Sicherheitsregressionen vollständig bestehen lassen.
- Live-Berechtigungen (`service_role` exklusiv, kein Browser-EXECUTE), RLS und den
  tatsächlichen Registrierungszähler erneut rein lesend prüfen.
- Privaten Server, bewusst freigegebene Dienstidentität, Google-Drive-/AAC-Lesezugriff,
  tatsächliche Byteprüfung und erneute Datenbankbindung getrennt abnehmen.
- Erst mit ausdrücklicher Betreiberfreigabe den privaten Worker aktivieren und
  einen echten technischen Nachweis für die exakte Ergebnisrevision registrieren.

**Diese Dokumentationskorrektur installiert nichts, startet keinen Worker und führt keine Registrierung aus.**
