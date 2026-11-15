# SMA – Privater Galerie-Worker: geschützter Datenabruf (Entwurf vom 11.11.2026)

## Stand

Die tatsächlich gespeicherte 10-Sekunden-MP4 wurde mit den originalen, leseberechtigten
Google-Drive-Dateien lokal geprüft: Original-SHA, Ergebnis-SHA, Paketgleichheit,
vollständige Dekodierung und AAC-Tonsignal stimmen. Dieser Test **registrierte nichts**.

Der SQL-Nachweisspeicher aus PR #224 ist bereits in Supabase installiert;
die Registrierungsfunktion ist nur für service_role ausführbar. Der bisherige
Worker-Kern aus PR #225 ist im Repository und standardmäßig nicht registrierend.
**Ein automatisch laufender Produktivworker ist noch nicht angeschlossen.**

## Dieser Entwurf: zwei fehlende Bausteine

- `supabase/sql/gallery-worker-private-snapshot.sql`: Eine rein lesende
  private Funktion `sma_private.gallery_worker_snapshot_v1(uuid)`, nur für
  `service_role` ausführbar. Sie liefert für *einen* abgeschlossenen Auftrag
  nur den dazugehörigen Kunden-, Source-/Ergebnis- und AAC-Sidecar-Stand.
  Die Funktion lehnt fremde, inaktive, veränderte oder mehrdeutige
  Dateizuordnungen ab. Kein neues Browser-/Dashboard-Recht.
- `n8n/publishing/gallery-private-transport-adapters.mjs`: Ein privater
  Adapter-Kern mit injizierten, authentifizierten Leseoperationen
  für die SQL-Snapshot-Funktion, Google Drive und Supabase Storage.
  Die Video- und AAC-Streams werden *während des Einlesens* auf die
  aus dem geprüften Datenbankstand abgeleitete Größe begrenzt.
  Der Adapter liest weder URLs noch Datei-IDs aus Browserparametern.
  Bei veränderter AAC-Sidecar-Zuordnung wird der zweite Snapshot abgewiesen.

## Vertrauensgrenze

Die Adapterschnittstellen `getSnapshotFromDB`, `streamDriveFile` und
`streamStorageFile` werden später **serverseitig** mit bestehenden
Credentials implementiert. Sie fehlen bewusst in diesem PR. Der Adapter
bekommt nur serverseitige Funktionen, keine Client-Tokens; der öffentliche
Shop und das Kunden-Dashboard können ihn nicht starten.

```js
const transport=createGalleryPrivateAdapters({
  getSnapshotFromDB,    // serverseitig: private RPC, ausschließlich service_role
  streamDriveFile,      // authentifizierter Google-Drive-Stream
  streamStorageFile     // privater Storage-Stream
});
await runPrivateGalleryEvidenceWorker({
  galleryJobId, ...transport,
  enableRegistration:false
});
```

Der Worker kontrolliert zusätzlich SHA-256 aller tatsächlichen Bytes,
Videopakete, AAC-Ton und den erneut gelesenen Auftragsstand. Erst ein
**gesondert freigegebener** Serverprozess darf später die Registrierung
aktivieren. Der SQL-RPC aus PR #224 stellt ausdrücklich keine inhaltliche
Freigabe oder Veröffentlichung dar.

## Tests und Betriebsgrenzen

`tests/run-gallery-worker-snapshot-sql.mjs` prüft die tatsächliche
private SQL-Vorlage ausschließlich in PGlite mit synthetischen Aufträgen.
Es werden fehlende Seiten, falsche Revisionen, inaktive Nutzer, ungültige
Sidecar-Metadaten, mehrere AAC-Treffer und unberechtigte Rollen geprüft.

`tests/gallery-private-transport-adapters.test.cjs` führt denselben
bestehenden Worker gegen simulierte DB-/Google-Drive-/Storage-Streams aus,
ohne Netzwerk oder Kundendateien. Eingriff in irgendeine produktive Datenbank,
Music-Credits, Upload oder n8n ist ausgeschlossen.

Noch offen: Ein freigegebener interner Server-/n8n-Service-Adapter mit
bestehenden Zugangsdaten, echte Ende-zu-Ende-Leseprüfung auf diesem Dienst,
danach gegebenenfalls Freigabe für die **nur technische** Registrierung.
Keine Vorwegnahme der Provider-, Content-, Rechts- oder Kundenfreigabe.
