# SMA – Gespeicherte n8n-Ausführungen kostenfrei und rein lesend zählen

Stand: 18.11.2026. **Neuer Operator-Prüfpfad, keine Kunden- oder Zahlungsfreigabe.**

## Zweck

Die bisherige Rechnung mit **26 Executions je Datei** war ausdrücklich eine Annahme.
In n8n zählen einzelne Nodes nicht als eigenständige Workflow-Ausführung;
manuell gestartete Tests und reguläre Execute-Subworkflow-Aufrufe zählen bei
den dokumentierten n8n-Cloud-Tarifen ebenfalls nicht als neue abrechenbare
Top-Level-Starts. Eine typische Webhook- oder Schedule-Auslösung zählt
dagegen als externer Start. Der echte Tarif- und Verbrauchszähler bleibt
die maßgebliche Abrechnungsquelle.

Der neue private Prüfer `n8n/consolidation/read-execution-metadata.cjs`
liest **nur gespeicherte Ausführungs-Metadaten**, um die Hypothese zur
Anzahl und Verteilung der Top-Level-Läufe gegen die tatsächlich noch
vorhandene Historie zu prüfen. Weder eine Ausführung noch ein
Webhook wird gestartet. Es werden keine Node-Resultate, Dateinamen,
Medien, Kundendaten oder Tokens angefordert.

## Privater Aufruf

Das n8n-API-Token muss vorab in einer privaten Betreiberumgebung als
`SMA_N8N_READ_API_KEY` gesetzt sein, idealerweise mit ausschließlich
`execution:list`-Recht. **Nicht** in Chat, GitHub, Shellargumente,
Browserkonsole oder Testprotokolle kopieren.

```sh
# Aktueller UTC-Kalendermonat
node n8n/consolidation/read-execution-metadata.cjs

# Alternativ festes UTC-Fenster, Ende exklusiv:
node n8n/consolidation/read-execution-metadata.cjs \
  2026-11-18T00:00:00.000Z 2026-11-19T00:00:00.000Z

# Synthetische Regression – ohne API-Token und ohne n8n-Zugriff:
node --test tests/n8n-read-execution-metadata.test.cjs
```

Der Prüfer verwendet ausschließlich `GET /api/v1/executions` auf der
festgelegten SMA-n8n-Cloud-Instanz, mit `includeData=false` und
`limit=100`. Maximal zehn Seiten im normalen Aufruf, ein gemeinsames
Zeitbudget von 15 Sekunden und maximal 2 MiB JSON je Antwort. Er speichert
keine n8n-Antwortdaten. Das Ergebnis nennt ausschließlich geprüfte
Zeiträume, Seiten-/Datensatzzahlen sowie Summen nach Modus,
Status und Workflow-ID. Unbekannte Felder werden ignoriert; unzulässige
Zeitstempel, Antworten und Seitenzustände führen ohne Klartextdaten
zu festen Fehlercodes.

## Aussagekraft – bewusst begrenzt

- `records_in_window`: Noch gespeicherte, in das ausgewählte Fenster
  fallende Ausführungen, **nicht** Monatsverbrauch laut Rechnung.
- `production_mode_candidates`: Gespeicherte Starts mit Modus
  `webhook` oder `trigger`, **keine** bestätigte Abrechnungszahl.
- `more_saved_pages_available=true`: Abbruch durch die feste Seitenbegrenzung.
  Auch bei `false` können ältere oder gelöschte Ausführungen fehlen.
- `records_without_start_time`: Datensätze ohne einordbaren Startzeitpunkt;
  sie werden nicht einem Kunden oder Tag zugerechnet.
- `by_workflow`: Hilft bei der Suche nach häufig gestarteten
  Workflows, ist **kein** Nachweis eines Zusammenhangs mit einer Datei.
- `billed_n8n_executions_measured=false`,
  `per_file_cost_measured=false` und
  `real_customer_e2e_verified=false` bleiben **immer** gesetzt.

Vor einer Kundenzahl-Kalkulation muss ein **ausdrücklich freigegebener**
einzelner echter Dateidurchlauf von Anfang bis zum sicheren Ende mit den
Produktionsstarts, den damaligen n8n-Kontozahlen und der Basislast
abgeglichen werden. Eine Social-Veröffentlichung ist dadurch nicht
freigegeben. Danach kann die vorhandene Modellrechnung in
`n8n/consolidation/execution-budget.cjs` mit beobachteten
Annahmen für 20, 40, 100 oder mehr Kunden gefüllt werden.
Keine Tarifänderung ohne Freigabe.

## Quellen

- [n8n: How executions count towards quotas](https://docs.n8n.io/workflows/executions/)
- [n8n: Public API, Pagination](https://docs.n8n.io/api/pagination/)
- [n8n: API authentication and execution:list permission](https://docs.n8n.io/api/authentication/)
- [Bestehender SMA-Planungsleitfaden](SMA_N8N_EXECUTION_CAPACITY.md)

Der erste echte n8n-API-Read und der Live-Zählervergleich sind weiterhin
**ausstehend**, solange kein bestätigter privater `execution:list`-Zugang
verwendet wurde. Kein positiver Simulationstest kann diesen Nachweis ersetzen.
