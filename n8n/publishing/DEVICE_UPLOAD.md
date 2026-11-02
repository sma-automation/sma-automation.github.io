# Geräte-Upload im bestehenden n8n-System

`Dateien durchsuchen` opens the native OS chooser in every portal optimizer.
It accepts one image/video from local folders, photo libraries or the phone's
Files provider. No filename is entered into the post title. `Kundenordner öffnen`
continues to show already uploaded customer files. PDF/Word are not supported
social media assets; the Documents folder itself is accessible in the OS chooser.
The browser/OS chooses the initial directory and mobile sources; no camera or
whole-directory permission is requested or forced.

## Live components

- Workflow: `lo3Wt6jem0CxCrJF`, `SMA – Geräte-Upload – Entwürfe V1`.
- Version: `c50c60d0-ed32-4792-80b4-617a6276f803`.
- Endpoint: `POST /webhook/sma-publication-device-upload-v1` (`start` / `finish`).
- Supabase migrations: `publication_device_upload_v1`, `publication_upload_catalog_race_v1`, `publication_upload_google_session_v1`.
- UI cache version 11; native transfer module `app/assets/device-upload.mjs`.
- Workflow code, credentials references and connections checked against live
  export; n8n regenerates node IDs and positions when importing.
- Executions/manual/progress data are not saved; control request timeout 120 s.

## Data flow and authorization

Supabase verifies the existing customer session and active customer record.
An idempotent upload UUID binds owner, filename, declared type and byte length.
Customer quotas are serialized: 30 reservations/hour, 20 GB/day, 4 GB/file.
The trusted n8n DataTable resolves the customer's folders; browser input never
chooses customer ID, folder ID, Drive ID or OAuth credentials.

Uploads go to the existing **02 Verarbeitung** folder. **01 Upload** is watched
by the legacy automatic workflow; a manual dashboard upload must not trigger
that publishing path. The existing catalogue and Magic Effect already recognize
both folders. No portal publishing nodes are connected to this upload workflow.

Drive creates a resumable session for a pre-generated file ID with a server-set
upload marker. Only the single-file upload URL is returned, with no-store and a
fixed SMA origin. That URL is kept in memory by the page and in a private
service-only database table until completion (then cleared). It is never stored
in localStorage or execution logs. API reservation expires after one day; Drive's
underlying upload capability can remain valid until Drive expires it.

The browser transfers 8 MiB chunks directly to Google Drive, with no customer
JWT/OAuth token attached. Progress uses acknowledged bytes. Retries query the
server offset; a missing success response does not create another file. Pause or
logout aborts outstanding browser requests. A retry uses the same upload UUID.
Resume is available while the optimizer remains open; reloading loses the local
File object. Incomplete reservations count against quotas.

Finalization re-reads Drive metadata using server credentials: exact pre-generated
ID, current assigned folder, upload marker, name, MIME, byte length, checksum,
revision and non-trashed state must match. Only then is an owned catalogue asset
registered and selected. An older concurrent catalogue snapshot cannot mark the
new upload unavailable. Dirty captions/source text require explicit discard
before changing the selection. Existing photo analysis is invoked through its
normal authenticated path.

Uploaded media remain **unapproved**: bytes/type declarations alone do not prove
portal compliance, original content, rights or accurate photo descriptions.
HEIC can be stored; Magic Effect still requires static JPEG/PNG/WebP <=12 MB.
No conversion, document publication, video-plan upgrade or social publishing is
added by this change.

## Validation

- `node --test tests/*.test.cjs`: 168 passing tests.
- `tests/device-upload.sql`: isolated transaction fixtures, rolled back; owner
  separation, privileges, retries, mismatches, idempotent registration, account
  suspension, capability clearing and concurrent catalogue refresh verified.
- Live webhook without authentication returns `AUTH_REQUIRED`; CORS preflight
  succeeds for the configured SMA origin.
- Security advisors: existing warnings unchanged; new INFO is the deliberately
  private RLS table without direct client policies.
- Real Drive transport probe `in5yUrxUsmfLk3pb`: preflight 200, allowed origin SMA,
  allowed content-type/content-range, status query 308, PNG upload 200, returned
  Drive ID matches reservation, test file moved to Trash (200). It also caught
  and fixed nested n8n expression delimiters and Google session URL parameters
  (`supportsAllDrives`, `session_crd`). The probe has no published webhook.
- A complete signed-in PC/mobile chooser → upload → photo-analysis acceptance
  run still requires a local user-selected file. The separate cloud SMA session
  is signed out; no customer login was bypassed.

References checked 2026-11-02:
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file
