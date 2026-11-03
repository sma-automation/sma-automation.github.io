# Dashboard-Auftrag und gebundene Freigabe

Stand: 3. November 2026. Diese Erweiterung verbindet den angemeldeten Dashboard-Benutzer, seine konkrete Datei-/Textversion, das tatsächliche n8n-Zielkonto und seine ausdrückliche Freigabe mit der vorhandenen Publisher-Arbeitskopie. Der Ausführungsweg endet weiterhin bei einer protokollierten Prüfung: **kein Provider-Upload und kein Social-Media-Posting**.

## Komponenten

| Aufgabe | Datei / n8n-ID |
| --- | --- |
| Dashboard-Dialog und wiederholbare API-Anfragen | `app/assets/publication-order.mjs` |
| Authentifizierter Eingang | `RdtCqCWRi7P4W7B0` · `publication-order-api-workflow.json` |
| Interne Ausführungsprüfung | `zLlhr1I1vKm2AiiU` · `publication-order-execution-workflow.json` |
| Bestehende Publisher-Arbeitskopie | `JZwPbzCpgIByxk94` |
| Bestehende gespeicherte Textübergabe | `LxayneKkUusok0Q8` |
| Aufträge, Bestätigungen, Reservierung und Leasing | `supabase/sql/publication-orders.sql` |

POST `/webhook/sma-publication-order-v1` akzeptiert `{action,input}` mit `prepare`, `approve` oder `get`. Der Kunden-JWT wird bei jedem Aufruf von Supabase geprüft. Der Client sendet weder Kunden-ID, Drive-ID noch Konto-ID. Die serviceberechtigte n8n-Abfrage ist erst nach der Eigentümerprüfung erreichbar. Antworten enthalten keine Provider-Zugangsdaten oder interne Kundenbindung.

Die geschützten Originale `GHBsYQcyt0JLFvRP`, `LeeH7IigyGRRUuxS` und `qwdTLh2rVmMkwhxb` werden nicht geändert. Alle 160 alten Knoten in der Publisher-Kopie bleiben deaktiviert. Der neue interne Pfad erreicht nur die fünf bereits geprüften Vorbereitungsknoten.

## Ablauf

1. In der bestehenden Beitragsvorschau öffnet „Freigabe vorbereiten“ einen zusätzlichen Dialog. Galerie, Navigation, Schrift und die bisherigen Optimierungsfunktionen bleiben erhalten. Ungespeicherte Änderungen verhindern einen Auftrag.
2. Der Kunde wählt Sichtbarkeit und die erforderlichen kanalbezogenen Kennzeichnungen ausdrücklich. Es gibt keine vorausgewählte Veröffentlichungseinstellung.
3. `prepare` speichert die exakte Datei-, Zuordnungs- und Textversion samt Shop-Link. n8n liest das Zielkonto ausschließlich aus der eindeutig zugeordneten aktiven Kundenzeile. Name und ID werden vor der Bestätigung angezeigt, ebenso der gespeicherte Beitrag und die ausgewählten Einstellungen.
4. `approve` benötigt ein nicht vorausgewähltes Bestätigungsfeld und den auftragsspezifischen Freigabetoken. Eigentümer, aktiver Zugang, Dateikatalog und unveränderte Zuordnung werden erneut geprüft. Die Vorbereitung läuft nach 30 Minuten ab.
5. Eine Datenbanktransaktion reserviert `(Kunde, Datei, Dateiversion, Portal, Zielkonto)`. Eine andere Anfrage-ID oder ein veränderter Text umgeht diese Reservierung nicht. Ein verlorener API-Response erzeugt keinen zweiten freigegebenen Auftrag.
6. Der interne Worker übernimmt nur eine Auftrags-ID und erhält eine exklusive Lease. Er prüft Kontoidentität und Kundenordner erneut, liest die aktuelle Drive-Version samt Prüfsumme und ruft dann die vorhandene Portaltext-Arbeitskopie mit der serverseitig gespeicherten Bindung auf.
7. `finish_check` akzeptiert nur die aktuelle Lease, prüft die gespeicherte Bindung erneut und erhält alle offenen Medienprüfungen. Fehlende Kontoberechtigungsprüfung bleibt ausdrücklich ein Blocker. `can_upload` und `can_publish` bleiben immer `false`.

Die Auftragsreservierung wird bei Fehlern oder Zeitüberschreitungen nicht freigegeben. Eine abgelaufene Lease darf nur die idempotente Leseprüfung erneut starten. Eine Provider-Übertragung ist damit noch nicht implementiert. Es gibt bewusst keinen automatischen Neuversuch für einen Provider-Upload.

## Betrieb

Die additive Migration `publication_orders_bound_approval_v1` ist in SMA-Supabase angewendet. Beide privaten Tabellen haben RLS und keine direkten Rechte für `anon` oder `authenticated`. Der Kunden-RPC erzwingt `auth.uid()`. Der Worker-RPC ist ausschließlich für `service_role` ausführbar.

Die n8n-Version verlangt veröffentlichte Unterworkflows beim Veröffentlichen eines Elternworkflows. Die reine Übergabeprüfung und die bisher unveröffentlichte Publisher-Arbeitskopie wurden deshalb als interne Abhängigkeiten veröffentlicht. Dies aktiviert keine deaktivierten Provider-Knoten und erzeugt keinen zusätzlichen öffentlichen Trigger.

Die neuen Workflows haben 15 bzw. 14 Knoten, leere `pinData`, keine Speicherung erfolgreicher, fehlgeschlagener oder manueller Nutzdaten und 150 Sekunden Laufzeitlimit. Ausführungsfortschritte werden nicht gespeichert; Unterworkflow-Aufrufe sind auf denselben Eigentümer beschränkt; MCP ist deaktiviert. Nach n8n-UI-Import die Einstellungen ausdrücklich setzen: der Import übernimmt sie nicht zuverlässig. Im Abschlussexport entfernt n8n die Standardwerte `source:database`, `mode:once` und gegebenenfalls `saveExecutionProgress:false`.

```sh
python n8n/publishing/build-publication-orders.py --worker-id zLlhr1I1vKm2AiiU
node --test tests/*.test.cjs
```

Die beiden JSON-Dateien enthalten nur Workflowcode, öffentliche Projektangaben und vorhandene Credential-Referenzen. Private Gesamtexporte werden nicht ins öffentliche Repository übernommen.

## Validierung und Grenzen

262 Node-Tests bestehen. Die neuen Fälle prüfen unter anderem Authentifizierung, alle vier Zielkontotypen, fremde/mehrdeutige Konten, geänderte Drive-Dateien, exakte gespeicherte Texte, ausschließlich lesende Workflowkanten, verlorene Antworten, doppelte Anfragen, ausdrückliche Zustimmung sowie ungespeicherte Änderungen und Abmeldung im Dashboard.

`tests/publication-orders.sql` wurde gegen die echte Datenbank innerhalb von `BEGIN`/`ROLLBACK` ausgeführt. Synthetische Testdaten wurden nicht behalten. Geprüft wurden Eigentümerisolation, fehlende Bestätigung, zweite Anfrage-ID für denselben Veröffentlichungsschlüssel, Lease-Wiederholungen, unveränderte Text-/Dateiversionen, nicht löschbare Medienblocker und Rollenrechte. Auch die komplette Migration wurde zuerst zusammen mit diesen Tests zurückgerollt und anschließend sauber angewendet.

Weiterhin erforderlich vor einem tatsächlichen Posting: vollständige Byte-/Medien-/Inhaltsprüfung, aktuelle Providerberechtigungen und kontospezifische Vorgaben (einschließlich TikTok-Creator-Optionen), sowie ein einzelner kontrollierter Upload-Dispatcher mit Provider-Belegen und Behandlung unklarer Übertragungsergebnisse. Das vorhandene Journal reserviert Aufträge, es ist noch kein vollständiges Provider-Ergebnisjournal. Die alten Publisher-Knoten dürfen deshalb nicht pauschal eingeschaltet werden. Serverumbau bleibt außerhalb dieses Schritts.
