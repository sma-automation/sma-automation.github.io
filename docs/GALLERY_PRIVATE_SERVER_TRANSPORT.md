# SMA – Private Galerie-Worker-Serveranbindung (isolierter Entwurf, 11.11.2026)

## Wofür

Der bereits geprüfte Galerie-Musikclip kann **manuell** durch denselben
Media-Worker gegen drei private Quelle-Zugänge überprüft werden, ohne
Kundeneingriffe, neue Drive-Tabs oder öffentliche API. Diese Schnittstelle
läuft noch **nicht** auf n8n Cloud oder dem privaten SMA-Server.

Dateien:

- \`n8n/publishing/gallery-private-server-transport.mjs\` – geschützter
  PostgreSQL-Aufruf, echter Google-Drive-API-Download, echter authentifizierter
  Supabase-Storage-Download, HTTP-Größen- und Redirectschutz.
- \`n8n/publishing/gallery-private-google-refresh.mjs\` – optionaler
  Refresh für **vorhandene** Google-Drive-OAuth-Zugangsdaten; keine neue
  interaktive Anmeldung, keine Tokenprotokollierung.
- \`n8n/publishing/gallery-private-server-runner.mjs\` – optionaler einzelner
  CLI-Start für einen internen Administrator. Keine Uhrzeit, kein Webhook,
  keine dauerhafte Aktivierung, kein \`registerEvidence\`.
- \`n8n/private-gallery-runtime/\` – vorhandene Version \`pg@8.16.3\`,
  isoliert mit Lockfile.

Die Datenbankfunktion
\`sma_private.gallery_worker_snapshot_v1(uuid)\` ist bereits in Supabase
installiert und wird vor und nach dem vollständigen FFmpeg-Durchlauf erneut
gelesen. Nur die dort zurückgelieferten Datei-IDs und Audioobjekte
dürfen gelesen werden. Niemals eine Dateiadresse, Track-ID oder URL
aus einem Kundenformular übernehmen.

## Getrennt vom Kundenbetrieb

Die Implementierung enthält keine Veröffentlichungen, keinen Upload,
keine technische Registrierung, keine Musik-Credit-Abbuchung und keinen
Live-Dashboard-Eingriff. Der vorhandene n8n-Musikworkflow bleibt unverändert.
Die private Leseberechtigung ist keine inhaltliche, rechtliche oder
Provider-Freigabe. \`can_upload=false\` und \`can_publish=false\` bleiben gesetzt.

Der Server verfügt noch nicht über alle echten Zugangsdaten oder
FFmpeg-Installationsnachweise. Weder GitHub-CI noch das SMA-Dashboard
dürfen Produktionsgeheimnisse enthalten.

## Geheimnisse und Voraussetzungen für die spätere Inbetriebnahme

Zugangsdaten müssen ausschließlich auf dem freigegebenen
**privaten Server** im Secret-Manager/Umgebungsvariablen hinterlegt sein,
nicht im Chat, im Repository, im Browser oder in GitHub Actions.

Benötigt:

- \`SMA_GALLERY_ALLOW_READONLY=1\` – bewusste Freischaltung **eines manuellen**
  Nur-Lesen-Aufrufs; kein produktiver Zeitplan.
- \`SMA_GALLERY_PG_URL\` – PostgreSQL-Verbindung eines **separat
  berechtigten internen** Serverkontos für den vorhandenen service-only
  Snapshot-RPC; TLS-Zertifikat prüfen. Nur lesende Funktionen erlauben,
  keinen administrativen Dauerzugriff als \`postgres\` verwenden.
- \`SMA_GALLERY_SUPABASE_URL\` – feste Projekt-URL
  \`https://<projekt>.supabase.co\`; nur offizielle Supabase-Subdomain.
- \`SMA_GALLERY_STORAGE_SERVICE_KEY\` – interner Storage-Service-Bearer,
  nie im Dashboard oder einer öffentlichen API verwenden.
- **Entweder** kurzlebig/extern verwaltet:
  \`SMA_GALLERY_GOOGLE_ACCESS_TOKEN\`, **oder** zur automatischen Erneuerung
  eines vorhandenen OAuth-Kontos:
  \`SMA_GALLERY_GOOGLE_CLIENT_ID\`,
  \`SMA_GALLERY_GOOGLE_CLIENT_SECRET\`,
  \`SMA_GALLERY_GOOGLE_REFRESH_TOKEN\`.
- Optional \`SMA_GALLERY_PG_CA_FILE\` für die Server-CA.
  Unsicheres \`rejectUnauthorized:false\` ist ausgeschlossen.
- Node.js 22, \`ffmpeg\` und \`ffprobe\`, eine durch den Betreiber geschützte
  Shell/Job-Umgebung ohne öffentlichen HTTP-Zugriff, genügend RAM.
  Node.js verarbeitet einzelne Medien bis 24 MB/1,5 MB im Arbeitsspeicher;
  Worker-Parallelität muss serverseitig klein begrenzt werden.

Eine neue OAuth-Zustimmung oder Freigabe der ganzen Drive-Ablage ist für
diesen Code **nicht automatisch erforderlich**. Der spätere Dienst muss
allerdings tatsächlich einen schon autorisierten Account mit
\`drive.readonly\` oder gleichwertigem Datei-Leserecht verwenden. Die
jetzige ChatGPT-Google-Drive-Freigabe überträgt keine Tokens zum Server.

Auf einem geeigneten **privaten** Testserver:

\`\`\`bash
npm ci --prefix n8n/private-gallery-runtime --ignore-scripts
node n8n/publishing/gallery-private-server-runner.mjs <interne-galerie-auftrags-uuid>
\`\`\`

Die Zugangsdaten werden dabei nur aus der bereits provisionierten
Serverumgebung gelesen, niemals als Kommandozeilenparameter übergeben.
Es erscheinen ausschließlich technische Ja/Nein-Prüfergebnisse.
Der Node-Aufruf verwirft die temporären Mediendateien wieder.

Eine spätere produktive Aktivierung ist ein **eigener Freigabeschritt**.
Vorher: speziellen Datenbank-Login/Rollenrechte prüfen, Google- und
Storage-Zugriff im **Serverkontext** bestätigen, E2E-Abnahme eines privaten
Testauftrags durchführen, Betriebsgrenzen und Monitoring festlegen.
Erst danach darf eine getrennte Registrierung geprüft werden. Es dürfen
keine bereits vorbereiteten Portalaufträge stillschweigend freigegeben werden.

## Öffentliche Regressionstests – nur synthetische Medien

\`\`\`bash
node --test tests/gallery-private-server-transport.test.cjs
\`\`\`

Enthalten sind gegen private Mocks ausgeführte
PostgreSQL-Abfragen, HTTP-Aufrufe und ein vollständiger FFmpeg-Worker-Test.
Fremde URL, HTTP-Redirect, fehlende Dateiberechtigung, Byte-Limit,
veraltete Revision, geänderte AAC-Zuordnung, gebrochener Token-Refresh
und Versuch einer Registrierung müssen gesperrt bleiben.

Die reale Supabase-Snapshot-Funktion liefert den abgeschlossenen
Galerieauftrag bereits korrekt. Die drei realen Mediendateien wurden mit
passenden Prüfsummen zuvor **lesend** abgeglichen. Ein vollständiger
Test des neuen CLI mit echten privaten Server-Credentials fehlt noch.
