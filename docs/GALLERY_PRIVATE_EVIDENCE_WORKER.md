# SMA – Privater Galerie-Medienprüfer (Entwurf, 11.11.2026)

## Ziel

Der verifizierte Galerie-Musikclip soll auch ohne Magic-Effect-Lauf einen
**separaten technischen Nachweis** bekommen können. PR #223 liefert einen
rein lokalen Byte-/Audio-Prüfer. PR #224 enthält die **noch unveröffentlichte**
private SQL-Evidenzregistrierung. Dieser Entwurf ergänzt die **verifizierende
Worker-Kernlogik**, aber startet keinen produktiven Job.

Der Worker-Kern liegt in:
`n8n/publishing/gallery-private-evidence-worker.mjs`

Er ist weder ein aktiver n8n-Workflow noch ein öffentlicher Webhook. Keine
Anmeldedaten, privaten Dateiinhalte, Kunden-E-Mails, Drive-URLs oder Tokens
werden in das öffentliche Repository geschrieben.

## Ablauf

1. Der private Backend-Aufrufer übergibt **nur die Galerie-Auftrags-UUID**.
2. Ein authentifizierter DB-Adapter liest den aktuellen abgeschlossenen
   Galerieauftrag, den Kundenstatus, die Source- und Ergebnis-Dateirevision,
   SHA-256 und Dateigrößen sowie den Track und den privaten AAC-Sidecar-Hash.
   Die Datei-IDs dürfen nicht vom Endkunden stammen.
3. Ein autorisierter Drive-Adapter holt die **Originaldatei und das tatsächliche
   gespeicherte Ergebnis** jeweils anhand der DB-Datei-ID. Ein privater
   Musik-Adapter holt die AAC-Bytes passend zur Track-SHA.
4. Der Worker vergleicht **alle drei Bytepuffer** mit den aus der DB und
   privaten Musikablage bezogenen SHA-256-Werten. Dateigrößen sind begrenzt
   (Original/MP4 höchstens 24 MB; AAC höchstens 1,5 MB).
5. Die bereits geprüfte lokale Verifikation entschlüsselt die Medien,
   vergleicht Original-Videopakete mit den Ausgabepaketen und misst, ob die
   AAC-Spur ein echtes Signal hat. Erst danach erzeugt sie einen
   revisionsgebundenen technischen Nachweis.
6. Nach der Dekodierung liest der Worker den **aktuellen DB-Stand erneut**.
   Jede zwischenzeitliche Änderung von Konto, Auftrag, Dateirevision, Hash,
   Datei-ID oder Musikspur führt zum Abbruch.
7. **Standardmäßig nur Testbetrieb:** Ergebnis ist
   `verified_not_registered`. Es wird **kein** Registrierungsadapter
   aufgerufen. Erst eine spätere, ausdrücklich genehmigte private
   Serverkonfiguration dürfte `enableRegistration: true` setzen und
   den SQL-RPC aus PR #224 benutzen. Auch dann wird die finale Zuordnung im
   RPC erneut geprüft.

Die registrierte Evidenz darf nur die technische Video-/Audio-Prüfung stützen.
Sicherheitsprüfung, Nutzungsrechte, Inhalte, Portalprofile, Freigabe, Credits,
Upload und Veröffentlichung sind unabhängige Schritte.

## Adapter-Schnittstelle

Der Kern benötigt explizit übergebene serverseitige Funktionen:

```js
await runPrivateGalleryEvidenceWorker({
  galleryJobId,  // UUID, keine Datei-URL oder frei gewählte Kunden-ID
  getSnapshot,   // (jobId) => autoritativer, kundengebundener DB-Snapshot
  readDriveFile, // (id) => authentifizierte MP4-Bytes (Buffer)
  readTrackAudio,// (trackSha) => authentifizierte AAC-Bytes (Buffer)
  // registerEvidence, // privat; derzeit NICHT angeschlossen
  enableRegistration: false
});
```

Der Snapshot muss `gallery_job_id`, `state=completed`, `customer_id`,
`user_id`, `customer_active`, `source_key`, `expected_sha`,
`expected_size`, `track_sha`, `audio_sha256` sowie `source` und
`result` enthalten. Beide Dateien besitzen `asset_id`, `drive_file_id`,
`revision`, `size_bytes`, `available=true`, `media_kind=video` und
`mime_type=video/mp4`. Die Quelle/Ergebnisrevision muss zum gespeicherten
SHA-256 und der abgeschlossenen Galerie-Receipt-Kette passen.

**Produktive Adapter existieren in diesem PR ausdrücklich noch nicht.**
Der aktuelle Dienst darf nicht behaupten, der Worker wäre bereits in Supabase,
Google Drive oder n8n angeschlossen. Der Service benötigt eigene Zugangsdaten,
einen ausschließlich internen Aufrufweg und eine abgewogene Ausführungszeit:
FFmpeg/FFprobe werden serverseitig benötigt und dürfen nicht ohne Eignungsprüfung
in eine kurzlebige Edge Function übernommen werden.

Ein produktiver Drive-Adapter muss die maximale Bytezahl **bereits während
der Übertragung** erzwingen, vor dem vollständigen Puffern. Die lokale
Buffer-Prüfung ist die zweite Sicherheitsgrenze.

## Tests

`tests/gallery-private-evidence-worker.test.cjs` verwendet ausschließlich
synthetische Fixtures und simuliert DB-/Drive-/Musik-/Registrierungsadapter.
Die Tests prüfen unter anderem:

- echte erneute Original- und Ergebnis-SHA-Verifikation plus Audio-Decoder;
- Verhinderung der Registrierung bei geänderter Datei oder Konto;
- abgewiesene falsche Drive-IDs, SHA-Werte und Dateirevisionen;
- kein Registrierungsaufruf im Standardmodus;
- Ablehnung unerwarteter Antworten, die Upload/Publishing erlauben wollen;
- die im Test ausdrücklich simulierte Registrierung (keine echte Datenbank).

Das GitHub-CI testet den neuen Worker ohne echte externe Konten. Alle
öffentlichen Tests laufen mit einem synthetischen Track, nicht mit einem
Kundenfilm.

## Noch offen

Die **serverseitige, autorisierte Adapter-Anbindung** für die Private-DB-Abfrage,
die Google-Drive-Downloads, die private AAC-Sidecar-Lesung und den
service-role-geschützten Registrierungs-RPC ist ein eigener Freigabeschritt.
Die noch offene SQL-Vorlage aus PR #224 wird nicht ohne Freigabe in Supabase
ausgeführt. Keine produktive Aktivierung, kein Dashboard-Eingriff.
