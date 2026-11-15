# SMA – Private Galerie: Server-Übergabe ohne neue Benutzeranmeldung

Stand 11.11.2026. Die Kernfunktionen und Rollen wurden vorbereitet;
**der private Server ist noch nicht mit ChatGPT verbunden**. Dieses
Paket nimmt weder n8n Cloud noch den produktiven Kundenworkflow in Betrieb.

## Bereits in Supabase bestätigt

- `sma_private.gallery_worker_snapshot_v1(uuid)` liest den abgeschlossenen
  Galerieauftrag mit den gebundenen Original-/Ergebnisdateien und AAC-Sidecar.
- `sma_gallery_snapshot_reader`: **NOLOGIN**, ausschließlich EXECUTE
  auf die private Snapshot-Funktion.
- `sma_gallery_worker_login`: **NOLOGIN**, **PASSWORD NULL**, maximal
  eine Verbindung, erbt nur die Leserolle; Standardtransaktionen read-only,
  Timeout 15 Sekunden.
- Der echte Galerie-Testauftrag wurde mit seinen Originalbytes, SHA-256
  und hörbarer AAC-Tonspur lokal geprüft.
- **Es existiert noch keine nutzbare Serveranmeldung.**

## Was der Serverbetreiber als Erstes ausführen kann

Nach Einrichten der vorhandenen, freigegebenen Serverumgebung:

```bash
npm ci --prefix n8n/private-gallery-runtime --ignore-scripts
node n8n/publishing/gallery-private-server-readiness.mjs
```

Die letzte Zeile ist **nur eine lokale Bestandsaufnahme**. Sie führt
keinen OAuth-Refresh, keine Datenbankabfrage, keinen Google-Drive-Download,
keinen Upload, keinen Galerieauftrag, keinen n8n-Trigger und
keine Registrierung aus. Ihre JSON-Ausgabe enthält nur Prüfnamen und
`true`/`false`, **keine** Geheimnisse, Nutzer-, Datei- oder Drive-IDs.

Die Kontrollen prüfen:
- Node.js >=22 und FFmpeg/FFprobe erreichbar
- PostgreSQL-Testclient installiert
- Server-Option `SMA_GALLERY_ALLOW_READONLY=1` bewusst gesetzt
- feste Supabase-Projektadresse und passende **sichere**
  PostgreSQL-Zieladresse (direkte DB oder offizieller Pooler)
- ausschließlich `sma_gallery_worker_login` als Datenbankbenutzer
  (Pooler ggf. mit Projektreferenzsuffix)
- vorhandener serverinterner Storage-Schlüssel
- vorhandener Google-Zugang: zeitlich befristetes Access-Token
  oder bestehende OAuth-Client-ID, -Secret und Refresh-Token
- optionales lokales CA-Zertifikat als tatsächlich vorhandene Datei

`configuration_complete=true` bedeutet **nur**, dass die lokalen
Voraussetzungen plausibel vorhanden sind, nicht dass sich der Dienst
anmelden darf oder der End-to-End-Test erfolgreich war.
`server_connection_verified` und `worker_executed` bleiben immer
`false` in dieser Offline-Prüfung.

## Noch gesperrt

Der private Serverbetreiber braucht eine ausdrückliche separate
Freigabe, um `sma_gallery_worker_login` mit Passwort im eigenen
Secret-Manager zu versehen und LOGIN einzuschalten. Passwörter
dürfen **nicht in Chat, Screenshots, GitHub oder Build-Logs**.
Es wird keine kostenpflichtige Infrastruktur bestellt.
Vor dem ersten echten Nur-Lesen-Test sind Zugriffsberechtigungen
von Supabase Storage und Google Drive sowie TLS/FFmpeg am Zielserver
nachzuweisen. Keine falsche Behauptung eines bestandenen Serverlaufs.

Erst danach ist manuell ein **einzelner** autorisierter Galerieauftrag
mit `gallery-private-server-runner.mjs` zu prüfen. Der Runner
akzeptiert keine freien Datei-URLs, keine beliebigen DB-Logins,
keine öffentlichen Webhooks und keine Registrierungsoption.
Die Funktion `runGalleryPrivateServerReadOnly` erzwingt
`enableRegistration:false`.

## Betreiberregel

Keine Aktivierung bestehender n8n-Workflows, keine Website-/Shop-
Veröffentlichung, keine Musik-Credit-Abbuchung, keine Providerfreigabe
oder automatische Ausführung durch dieses Paket.

## Rücknahme

Der neue Offline-Preflight ist unabhängig vom Kundenbetrieb.
Wird er entfernt, bleiben die bereits installierten Rollen,
alle Kundendaten und die Musikautomatik unberührt.

## Prüffälle

`node --test tests/gallery-private-server-readiness.test.cjs`
wird in der bestehenden GitHub-CI ausgeführt; es werden ausschließlich
synthetische Umgebungswerte und keine realen Zugangsdaten verwendet.
