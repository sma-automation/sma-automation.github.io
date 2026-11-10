# YouTube/TikTok – Offline-Abnahme der Provider-Rückmeldungen

Stand: 10. November 2026, 10:30–11:00 Uhr (Europe/Vienna). Diese Prüfung
arbeitet nur mit synthetischen HTTP-Antworten und der bereits im Repository
gespeicherten Dispatcher-Testkopie aus PR #57. Sie öffnet weder einen
Providerkanal noch eine Kundenfreigabe.

## Neu

`tests/publication-provider-offline-replay.test.cjs` führt den tatsächlichen
JavaScript-Inhalt des gespeicherten n8n-Code-Nodes
`Providerantwort auswerten` im isolierten Node-VM-Kontext aus.
Die einzige bereitgestellte Node-Abhängigkeit ist `crypto`.
Es gibt **keine** Netzwerkfunktion, Browser-Session, Token, n8n-Ausführung,
Supabase-Schreibfunktion oder echte Mediendatei.

Die synthetischen Szenarien verifizieren:
- YouTube: bestätigter privater Abschluss bleibt privat; fremder Kanal,
  geänderte Sichtbarkeit und unklare Antworten werden nicht als Erfolg gezählt.
- TikTok: abgeschlossene öffentliche Übertragung **ohne** öffentliche ID wird
  nicht als öffentlich bestätigt; eine korrekte int64-ID bleibt verlustfrei.
- TikTok: Inbox, Ablehnung und unbekannte Statuswerte werden getrennt behandelt.
- YouTube: der 308-Probe meldet nur bestätigte Bytes; ohne gültigen Bereich
  entsteht kein vermeintlich sicherer Wiederholungsupload.
- Fehlermeldungen und fragliche Providerantworten geben keine Rohdaten weiter.
- Die Testkopie enthält genau einen internen Start; Provider-HTTP-Nodes
  dürfen weder Redirects verfolgen noch automatische Retries verwenden.
  `begin` und `finish` verwenden dasselbe private Providerjournal und
  `finish` ist an die Lease gebunden.

Reproduktion aus dem Repository:

```sh
node --test tests/publication-provider-offline-replay.test.cjs
node --test tests/*.test.cjs
```

Die bestehende GitHub-Actions-Prüfung `publication-history-tests.yml`
führt bei Pull Requests gegen `website-v1` die zweite Zeile aus.

## Live-Bestandsprüfung (rein lesend)

Die verbundene Supabase-Datenbank `sma-automation` war bei der Prüfung
`ACTIVE_HEALTHY`, PostgreSQL 17.11. Der Stand in den privaten
Veröffentlichungstabellen:

| Wert | Anzahl |
| --- | ---: |
| Bestehende Aufträge | 10 |
| Abschließend freigegebene Aufträge | 0 |
| Freigabejournal/Reservierungen | 0 |
| Operator-Uploadberechtigungen | 0 |
| Providerversuche | 0 |
| Providerereignisse | 0 |
| Provider-Cover-Snapshots | 0 |

RLS ist für Provider- und Berechtigungstabelle aktiviert.
`anon` und `authenticated` dürfen den Provider-RPC nicht ausführen;
`authenticated` hat kein INSERT in Versuche; `service_role` hat kein
INSERT in Operator-Uploadberechtigungen. Die privaten Funktionsquellen
stimmen mit den zuvor dokumentierten Hashes überein:
`publication_provider_fingerprint_v1`: `5867545f1bdb0e8a7523609fdbbb4a57`;
`sma_publication_provider_v1`: `a407894984fc400aa440bdb7bcbaa683`.

Diese Momentaufnahme ist **kein** Beleg für einen erfolgreichen echten Upload.

## Noch offen vor der ersten echten Abnahme

1. Für genau eine unveränderte Datei/Portalbindung frische Zielkontoprüfung,
   geltende Portaloptionen und vollständige technische Mediennachweise prüfen.
2. Verbindliche persönliche Kunden-Erklärungen und separate finale
   Auftragsfreigabe einholen; keine Assistenzsich­tung darf diese ersetzen.
3. **Nur nach ausdrücklicher Zustimmung des Betreibers** eine einzelne
   auftrags- und fingerprintgebundene Operatorfreigabe administrativ setzen.
   Diese kann nicht vom Kunden oder der gewöhnlichen Service-Rolle erzeugt werden.
4. Zuerst einen ausdrücklich genehmigten **privaten** YouTube-Versuch
   ausführen. TikTok `SELF_ONLY` getrennt genehmigen; bei inkompatibler
   Werbekennzeichnung oder Portaleinstellung nicht automatisch ausweichen.
5. Echte Providerstatus- und Cover-Rückmeldungen mit Auftrags-/Zielkonto-/Dateibindung
   vergleichen; unbekannte Uploads manuell klären, niemals blind erneut senden.
6. Erst danach die öffentliche History-/Erfolgsanzeige fachlich abnehmen.

Der Source-PR #57 und WordPress-PR #69 bleiben separat offen.
Es wurden keine Kundenaufträge, n8n-Originalworkflows, Musikdateien,
Kredite, Käufe oder Social-Media-Posts verändert. Diese Prüfung ersetzt
keine reale Providerabnahme.
