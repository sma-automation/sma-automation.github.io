# Datei-Auftrag: fester Integrationsvertrag

Stand 16.11.2026. **Lokaler Kandidat, keine produktive Bereitstellung.** SQL:
`supabase/sql/file-command-mailbox.sql`. Das separate `file-resume-mailbox.sql`
ist der bereits offline geprüfte enge Nachfreigabe-Prototyp; die Integration
benutzt ausschließlich die hier beschriebenen `sma_file_job_*`-Schnittstellen.

## Öffentlich: `sma_file_job_v1(p_action text, p_input jsonb)`

Nur authentifizierte Aufrufe. Eigentümer kommt ausschließlich aus `auth.uid()`.
`start`:

```json
{"request_id":"UUIDv4","anchor":{"kind":"asset","asset_id":"UUID","asset_revision":"exakter Dateistand"}}
```

oder:

```json
{"request_id":"UUIDv4","anchor":{"kind":"upload","upload_id":"UUIDv4","name":"Dateiname","mime_type":"video/mp4","size_bytes":2048}}
```

Die bestehende Upload-RPC reserviert den Upload innerhalb derselben Transaktion.
Ihr privater Erstkontext einschließlich Lease wird gespeichert. `upload_start`
darf diesen Kontext später übernehmen, ohne ein zweites `start` auszuführen.
Der Anker ist die echte Upload-Zeile mit ihrem Eigentümer; erst ein geprüftes
`upload_finish` darf `asset_id` und Revision anhängen. Diese Bindung wird atomar
mit der ersten sichtbaren erfolgreichen Finish-Antwort gespeichert, bevor der
separate native `completed`-Schritt folgt. Auch ein vorgezogener Katalog-/Asset-Join
erkennt die tatsächlich abgeschlossene eigene Upload-Zeile und tritt demselben
Auftrag bei. Die Antwortlücke erzeugt keinen zusätzlichen Datei-Auftrag.

`request_id` mit identischem Anker liefert dauerhaft denselben Auftrag.
Anderer Inhalt bei gleicher ID wird abgewiesen. Eine andere Request-ID für
denselben aktiven Upload bzw. dieselbe Datei/Revision tritt dem Auftrag bei.
Die Zuordnung dieser Request-ID wird ebenfalls dauerhaft gespeichert.
Ein abgelaufener Auftrag mit bekannter Request-ID wird nicht neu gestartet.
Eine bewusst neue Arbeit nach Ablauf benötigt eine neue ausdrückliche Aktion
mit neuer Request-ID. Die eigene Frist ist fest **24 Stunden ab Erstellung**;
Join, Bearbeitung und Retry verlängern sie nicht. Dies ist ein begrenzter
Kandidat, kein Nachweis beliebig langer Cloud-Ausführungen.

`command`:

```json
{"job_id":"UUID","command_id":"UUID","operation":"magic_photo","input":{"asset_id":"UUID","asset_revision":"exakter Dateistand"}}
```

`get`: `{"job_id":"UUID","command_id":"optionale UUID"}`.
Alle Antworten sind eigentümergebundene Ansichten:

```json
{"ok":true,"job_id":"UUID","state":"running","deadline_at":"ISO-Zeit","asset_id":"UUID oder null","asset_revision":"Stand oder null","can_publish":false,"commands":[{"command_id":"UUID","operation":"magic_photo","state":"running","response":{"status":200,"body":{"ok":true,"analysis":{"status":"processing"}}},"error_code":null}]}
```

`response` bleibt null bis zur originalen öffentlichen Antwortstelle. Die
Command-Zustände sind `queued`, `offered`, `accepted`, `running`, `completed`,
`failed`, `uncertain`. Ein identischer Command-Key/Inhalt ist idempotent;
derselbe Key mit verändertem Inhalt wird abgewiesen. Maximal 64 Commands pro
Auftrag. Ein aktiver Upload-Start/-Abschluss wird auch bei neuer Command-ID
kanonisch dedupliziert. Jede angefragte Command-ID bekommt dabei einen dauerhaften
Alias auf den kanonischen Command, gebunden an denselben Job und Inhalts-Hash.
`get` mit der ursprünglich angefragten ID und ein identischer `command`-Replay
lösen diesen Alias auf. So ist auch eine verlorene Edge-Antwort ohne erneutes
Enqueue wiederauffindbar. Aliase zählen nicht zum Limit von 64 echten Commands.
Reads erzeugen keinen n8n-Aufruf.
Ein gespeicherter Upload-Capability-Link wird bei `get` nicht erneut ausgegeben,
wenn der Upload bereits abgeschlossen oder die eigene Auftragsfrist abgelaufen ist.
Ein abgeschlossener Upload projiziert stattdessen die originale öffentliche
`completed`-Antwort mit der tatsächlich gespeicherten Asset-ID. So erkennt die
bestehende Upload-Wiederholung nach verlorener Finish-Antwort den Abschluss,
ohne dieselben Bytes erneut hochzuladen. Das gespeicherte erste Result bleibt
unverändert; diese Zustandsprojektion betrifft nur den veralteten Upload-Link.

| Operation | Gespeicherter `input` | Originale feste Reservierungsfunktion |
| --- | --- | --- |
| `upload_start` | `upload_id,name,mime_type,size_bytes` | Bereits atomar ausgeführtes `publication_upload_request_v1('start',input)` |
| `upload_finish` | `upload_id` | `publication_upload_request_v1('finish',input)` |
| `magic_photo` | `asset_id,asset_revision` | `publication_magic_request_v1('start',input)` |
| `magic_video` | `asset_id,asset_revision` | `publication_video_magic_request_v1('start',input)` |
| `review` | `asset_id,asset_revision` | `publication_review_request_v1('start',input)` |
| `preview_prepare` | `request_id,source_text,audience,goal,language,media_kind,platforms` | `publication_preview_request_v1('prepare',input,null)` |
| `account` | `id,platform` | `publication_account_context_v1(input.platform)`; externer Kontocheck bleibt im Worker |
| `order_prepare` | Vollständiger bisheriger Prepare-Input, optional `expected_target_id` | `publication_order_request_v1('prepare',input)` |
| `order_approve` | `id,approval_token,confirm,review` | **Ausschließlich** `publication_order_request_v1('approve',input)` mit unveränderten Token-/Consent-Prüfungen |

## Privat: `sma_file_job_worker_v1(p_action text, p_input jsonb)`

Nur `service_role` darf diese RPC ausführen. Alle Tabellen sind privat und für
anon/authenticated/service_role direkt gesperrt. Kein Browser-JWT wird gehalten.

### Einmaliger Hauptstart

- `claim_start`: `{"job_id":"UUID"}` → `{"ok":true,"start":{"job_id":"UUID","start_ticket":"privater 64hex-Wert","deadline_at":"ISO","claim_expires_at":"ISO"}}`. Das Ticket ist maximal 60 Sekunden bindbar. Jeder weitere Claim liefert `start:null` plus `bound` und `state`. Ein unbestätigter Claim nach 60 Sekunden wird auch in der öffentlichen Ansicht `uncertain`; er bekommt keinen Ersatzstart.
- Edge sendet ausschließlich `job_id,start_ticket` an den festen eigenen Start-Webhook. Kein frei übergebbarer URL-/Workflowparameter.
- Erster nativer Parent-Schritt `bind`: `{"job_id":"UUID","start_ticket":"64hex","execution_id":"tatsächliche $execution.id"}` → `{"ok":true,"already_bound":false,"job_id":"UUID","deadline_at":"ISO"}`. Identische Wiederholung derselben Execution liefert `already_bound:true`; andere Execution wird abgewiesen.
- `start_receipt`: `{"job_id":"UUID","start_ticket":"64hex"}` → `{"ok":true,"job_id":"UUID","bound":true,"execution_id":"native ID","state":"running"}`. Diese Quittung ist auch nach Job-Ablauf lesbar.
- Verlorene Startantwort: zuerst `start_receipt`. Bei bestätigter Bindung kein weiterer POST. Bei unbekanntem Ausgang `start_uncertain` mit denselben beiden Feldern; **kein neuer Startclaim und kein POST-Retry**. Eine verspätete erste Bindung bleibt innerhalb der ursprünglichen 60 Sekunden möglich.

### Native Fortsetzung

- `parent_context`: `{"job_id":"UUID","execution_id":"native Parent-ID"}` → `ok,job_id,execution_id,phase_seq,deadline_at,state,terminal,has_pending`. `phase_seq` ist der letzte tatsächlich registrierte Wait; nur daraus die nächste Phase berechnen. `terminal` gilt bei Ablauf, beendetem/unklarem Job oder 64 registrierten Phasen. Diese interne Ansicht ist auch nach Frist lesbar.
- `wait`: `{"job_id":"UUID","execution_id":"native Parent-ID","phase_seq":1,"resume_url":"private native URL"}`. Sind unter demselben Joblock bereits Commands queued, wird der älteste direkt für denselben Parent angenommen: `{"ok":true,"wait":false,"phase_seq":0,"deadline_at":"ISO","dispatch":<vollständiges accept-Objekt>}`. Dabei bleibt `phase_seq` unverändert. Ohne queued Command wird atomar der Wait registriert: `{"ok":true,"wait":true,"phase_seq":1,"deadline_at":"ISO"}`. Der Parent ruft dies nach jedem tatsächlichen Kindabschluss auf. So geht ein während der Kindarbeit eingereihtes Command ohne Browserpoll und ohne neuen Hauptstart weiter. Ein Enqueue nach der Wait-Registrierung benutzt den privaten Resume-Zusteller.
- URL muss exakt `https://johnmusic.app.n8n.cloud/webhook-waiting/<execution_id>/file-command-<phase_seq>?signature=<native Signatur>` sein. Phasen 1 bis 64, streng aufsteigend. Ein laufendes Kind verhindert den nächsten Wait.
- `claim_delivery`: `{"job_id":"UUID"}` → `{"ok":true,"delivery":null}` oder `delivery` mit `job_id,event_id,phase_seq,execution_id,lease_id,expires_at,resume_url,ticket`. `event_id` ist die Command-ID; `expires_at` ist höchstens 60 Sekunden entfernt und nie hinter der Job-Frist.
- Resume-POST enthält exakt `job_id,event_id,phase_seq,ticket`.
- Erster nativer Schritt `accept`: dieselben vier Felder plus **tatsächliche** `execution_id`. Erste Annahme → `{"ok":true,"accepted":true,"already_accepted":false,"job_id":"UUID","command_id":"UUID","operation":"magic_photo","command_ticket":"64hex","parent_execution_id":"ID","deadline_at":"ISO"}`. Replay liefert `already_accepted:true` ohne Kindticket. Dann nicht nochmals ausführen.
- `receipt`: `{"job_id":"UUID","event_id":"Command-UUID"}` → `ok,job_id,event_id,accepted,phase_seq,execution_id,state`. Nach Annahme bleibt `state:"accepted"` als Transportquittung erhalten, auch wenn das Fachkommando später fertig ist.
- `uncertain`: `{"job_id":"UUID","event_id":"UUID","lease_id":"UUID"}` → `{"ok":true,"accepted":false}` oder bei gewonnener Annahmerace `accepted:true`.
- Nur eindeutiges HTTP404 **und** passende negative Receipt erlauben bis zu zwei Wiederholungen nach 1/3 Sekunden mit unverändertem Ticket/URL/Event innerhalb derselben Lease. Kein Retry bei Timeout, 409, 429, 5xx oder fehlender Receipt. Kein neuer Parent.
- Verlorene interne `accept`-Antwort: Parent darf `context` mit `job_id,command_id,execution_id` lesen, solange das Command noch `accepted` ist. Diese Rückgabe enthält dasselbe Kindticket. Der folgende `claim` bindet es an genau eine native Kind-Execution.

### Native Worker

Input des nativen Kindes: `job_id,command_id,command_ticket,parent_execution_id`.

- `claim`: Input plus **tatsächliche** `child_execution_id`. Antwort `ok,operation,input,action,request:{body,headers:{}},deadline_at`. `operation` ist ein Name aus obiger Tabelle. `request.body`: Upload `{action,...input}`, Order/Account `{action,input}`, sonst `input`. Nur der intern geprüfte Claim-Marker darf im Adapter die reine Bearer-Präsenzprüfung ersetzen; alle ursprünglichen Bodyprüfungen bleiben erhalten.
- `reserve`: `job_id,command_id,command_ticket,child_execution_id`. Liefert **direkt die originale Fach-RPC-Antwort**. RPC und Speicherung laufen atomar. Derselbe native Worker erhält bei verlorener Antwort denselben Reservierungsbeleg. Keine vom Worker übergebenen Ersatzargumente, Owner oder RPC-Namen.
- `order_continue`: dieselben vier Bindungsfelder, nur für ein laufendes `order_approve` nach erfolgreicher Originalfreigabe. Liest frisch `publication_order_request_v1('get',{id: gespeicherte Order-ID})` unter dem gespeicherten Eigentümer. Erfolg: `{ok:true,order:<Original-get>,provider:{state,updated_at,lease_until,last_operation,has_provider_id,has_session,cover_state,has_cover_plan,permission_valid}}`. Ohne Attempt lautet `state` `not_started`; Zeiten/Operation/Coverzustand sind null. `permission_valid` liest nur den vorhandenen gültigen Operatorpermit mit genau dem aktuellen Fingerprint. Keine IDs/Session-URLs/Tokens im Providerteil. Abweichender Attempt-/Cover-Fingerprint ergibt `ORDER_CHANGED`; Fehler des Original-get werden unverändert zurückgegeben. Keine frei übergebbare Order-ID, kein öffentlicher `order_get`, kein erneutes approve, keine Fristverlängerung. Der native Worker kann damit seine vorhandenen Providerjournalschritte begrenzt in derselben Kind-/Hauptkette fortsetzen.
- `result`: dieselbe Bindung plus `status` und `body` der **originalen öffentlichen Antwort**. Antwort `{"ok":true}`. Erste Antwort ist unveränderlich; identischer Replay idempotent. Privater Kontext, Credentials und Leases sind im öffentlichen Ergebnis verboten.
- `completed`: dieselbe Bindung plus `outcome:"completed"|"failed"`, bei Fehler optional `error_code:"WORKER_FAILED"`. Erfolgreich/no-work → completed; fachlicher Fehlerterminal → failed. Unknown/HTTP-Ausfall darf nicht als completed markiert werden.
- Die aktuell exportierten Foto-/VideoMagic- und Review-Worker antworten früh **HTTP200**, danach läuft Facharbeit weiter. Dieser 200-Body wird exakt gespeichert; `result` beendet den Command **nicht**. Ein äußerer Resume-202 ist nur Transportannahme. Erst tatsächlicher terminaler Workerabschluss erlaubt den nächsten Wait.
- Feste aktive Operationsfristen gemäß den vorhandenen Exports: Upload 120 Sekunden, FotoMagic/Review 210 Sekunden, VideoMagic 600 Sekunden, Preview/Zielkonto 150 Sekunden, Ordervorbereitung/-freigabe 600 Sekunden. Immer durch die unveränderliche Job-Frist begrenzt. Wiederholungen verlängern nichts; native Unteroperationen behalten zusätzlich ihre jeweils kürzeren Originalgrenzen.
- `finish`: `job_id,execution_id`; nur bei laufendem Parent und ohne offene Commands. Bedeutet Ende des Datei-Auftrags, keine Behauptung über Provider-Veröffentlichung.
- `fail`: `job_id,execution_id,error_code:"WORKER_FAILED"`. Friert den gebundenen Job und aktive Commands als `uncertain` ein; keine neue Startchance und kein erfundenes Providerergebnis. Bereits gespeicherte öffentliche Antworten bleiben lesbar.

## Bestehende Regeln bleiben wirksam

Der Zugangslookup vom 16.11.2026 bestätigte die vorhandene Prüfung:
genau ein Kunde, aktiv und Demo aktiv oder bezahlt, eigener verfügbarer
Dateistand, vorhandene n8n-/E-Mail-Bindung. `publication_asset_preview_v1`
wird direkt wiederverwendet. Für die Phase vor der Datei gelten exakt die
bestehenden Upload-Regeln; keine erfundene Demo-Ablauffrist.

Aktuelle Eigentümer-/Datei-/Account-/Consent-/Freigabefristen bleiben in den
Original-RPCs. Eine inzwischen abgelaufene Kontoprüfung wird nicht durch einen
alten Command erneuert. Jeder Portalkanal benötigt seine ursprüngliche explizite
Freigabe. Direkte Datenreads, Entwurfsbearbeitung und bestehende Status-RPCs
bleiben direkte Supabase-Aufrufe. Provideroperationen und Statusfortsetzungen
müssen tatsächlich in derselben nativen Parent-Kette angeschlossen werden;
diese SQL allein reduziert noch keinen produktiven Execution-Verbrauch.

Noch getrennt nachzuweisen: vollständiger nativer Parent/Child/Wait-Loop,
öffentliches UI/Edge-Routing ohne Legacy-Doppelstart, alle Terminalzweige,
gültige Zieladapter für alle vier Portale und reale Abrechnungszähler.

## Gezielte Offline-Prüfungen und Live-Vergleich

```sh
npm ci --prefix tests/sql-runtime --ignore-scripts --no-audit --no-fund
node --test tests/file-command-mailbox.sql.test.mjs
node --test tests/file-command-resume.test.mjs
node --test tests/file-job-client.review.test.mjs
```

Die SQL-Suite führt echte unveränderte Repository-Funktionen in einer
wegwerfbaren PGlite-Datenbank aus. Ihre neun direkt verwendeten privaten
Fachfunktionen wurden am 16.11.2026 lesend mit Produktion verglichen: Signatur,
`md5(prosrc)`, Definer, Suchpfad, Volatilität und ACL stimmen vollständig überein.
Die 31 Spalten der drei Providertabellen und die Signaturen/Execute-Grants aller
neun benötigten öffentlichen Service-RPCs stimmen ebenfalls überein.
`tests/sql-runtime/file-job-live-schema-20261116.json` enthält ausschließlich
diesen Metadatenbeleg. Aktuelle Textverlauf-/Hashtag-, Consent-, Abbruch- und
TikTok-AIGC-Originaldefinitionen gehören zum Testaufbau; kein permissiver Ersatz
dieser Fachprüfungen wird benutzt.

Die SQL-Suite hat 15 Szenarien (16 TAP-Tests einschließlich der Suite), unter
anderem echte Upload-Reservierung/-Abschluss, atomaren Asset-Join, Command-Aliase,
vier einzelne Portalfreigaben, ursprüngliche Operationsfristen, beide möglichen
Queue-/Wait-Transaktionsreihenfolgen, verlorene Start-/Resume-Antworten, fremde
Eigentümer und widerrufenen Zugang. Die beiden Transaktionsreihenfolgen werden
deterministisch geprüft; PGlite ist kein Nachweis mehrerer paralleler nativer
PostgreSQL-Sessions oder der n8n-Engine.

15 Relayfälle laufen gegen die tatsächlich zu integrierende
`supabase/functions/sma-file-job/resume.mjs`, einschließlich des letzten
zulässigen Phasenzählers. Vier Browser-Regressionsfälle belegen, dass ein
abgelaufener Retry keine neue Request-ID erhält und `clear()` verspätete
Session-/Body-Ergebnisse invalidiert. `beginNewWork(anchor)` entfernt nur nach
ausdrücklicher Dateiauswahl eine bereits abgelaufene Bindung des aktuellen
Eigentümers und startet selbst keine Netzwerkanfrage.
