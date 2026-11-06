# Magic-Effect-Analyseverlauf

Stand: 06.11.2026. Fortsetzung des offenen Analysejournals aus
[PUBLICATION_HISTORY.md](PUBLICATION_HISTORY.md) und
[MEDIA_EDITOR_DRAFTS.md](MEDIA_EDITOR_DRAFTS.md).

## Verhalten

History → **Analysen** zeigt neue Foto-/Video-Magic-Effect-Versuche ab Installation.
Die bestehende Kapitelgestaltung, Monatsauswahl und fünf Zeilen pro Seite bleiben
bestehen. Auftragszahlen und veröffentlichte Beiträge werden nicht aus Analysen
abgeleitet. Details sind zunächst eingeklappt; es gibt keinen Start-, Wiederholen-,
Speicher- oder Veröffentlichungsbutton im Verlauf.

| Status | Bedeutung |
| --- | --- |
| Analyse läuft | Ein neuer Versuch wurde reserviert; ein Abschluss fehlt noch. |
| Analyse abgeschlossen | Ein validiertes Ergebnis wurde für den damaligen Dateistand gespeichert. |
| Analyse fehlgeschlagen | Der bestehende Abschlussweg hat einen Fehler festgehalten. |
| Zeit abgelaufen | Die gespeicherte Laufzeit ist abgelaufen, ohne gespeicherten Abschluss. Kein automatisch gestarteter Wiederholungsversuch. |

Eine abgeschlossene Magic-Effect-Analyse ist keine visuelle Sicherheitsprüfung,
keine vollständige semantische Prüfung und keine Veröffentlichungsfreigabe.
`VIDEO_PLAN_REQUIRED` und die getrennte Provider-/Coverabnahme bleiben offen.
Es wird kein zusätzlicher Analyseaufruf und kein kostenpflichtiger Dienst aktiviert.

## Speicherung und Bindung

- Neue private Tabelle `sma_private.publication_analysis_history_v1` mit RLS und
  ohne direkte Rechte für `anon`, `authenticated` oder `service_role`.
- Ein interner AFTER-Trigger protokolliert Start und terminalen Abschluss als
  getrennte Ereignisse in derselben Transaktion wie der bestehende Ergebnis-Cache.
  Die vier Foto-/Video-Start-/Abschlussfunktionen werden nicht ersetzt; ihre
  geprüften Quellhashes sind eine atomare Installationsvoraussetzung.
- Ein Start gehört zu exakt einer serverseitig erzeugten Lease, Datei-/Prüfversion,
  Benutzer- und Kundenbindung. Der damalige Dateiname wird festgehalten.
  Ein Abschluss muss zum protokollierten Start passen. Pro Versuch gibt es
  höchstens einen Start und einen terminalen Abschluss.
- Wiederholungen nach Fehler oder Zeitüberschreitung erzeugen eine neue Lease.
  Frühere Start-/Abschlussereignisse und erfolgreiche Ergebnissnapshots bleiben
  erhalten. Cache-Lesen und Wiederholen einer noch laufenden oder bereits
  erfolgreichen Anfrage erzeugen kein weiteres Ereignis.
- Der Timeout wird beim Lesen aus der ursprünglichen Lease-Frist abgeleitet;
  dafür wird kein erfundener Abschluss in die Datenbank geschrieben.
- Kein Rückfüllen alter Cache-Einträge, kein nachträglich erfundener Start und
  keine Rekonstruktion bereits überschriebener Ergebnisse. Bei Installation
  läuft kein Versuch. Der vorhandene Cache bleibt unverändert.
- Vollständige validierte Ergebnisse bleiben ausschließlich im privaten Journal.
  Der Kunden-RPC liefert nur Dateiname, Medientyp, Start-/Abschlusszeit, Status,
  bereinigten Fehlercode und eine separate History-ID. Keine Rohtranskripte,
  Analysebeschreibungen, Konto-/Drive-IDs, Prüfsummen, Leases oder Providerdaten.

## Lesestrecke

`public.sma_publication_analysis_history_v1` ist SECURITY INVOKER, STABLE und
nur für `authenticated` freigegeben. Der private Definer prüft `auth.uid()`, genau
einen aktiven berechtigten Kunden, dessen damalige n8n-/E-Mail-Bindung sowie die
aktuellen Datei-Eigentümer. Fremde oder neu zugeordnete Dateien geben keine alten
Kundenereignisse preis. Eine neuere Dateiversion oder nicht mehr verfügbare Datei
löscht den historischen Nachweis des unveränderten Eigentümers nicht.

Monate verwenden Wiener Zeit und den Startzeitpunkt. Der Cursor besteht aus
Startzeit und History-ID; maximal 20 Einträge je Antwort, fünf sichtbar im Browser.
Der Client verwirft ungültige Zustände, falsche Monate, doppelte Seiten und späte
Antworten nach Kontowechsel, Abmeldung, Monatswechsel oder Verlassen der History.
Dateinamen werden ausschließlich als Text angezeigt.

## Prüfung

- 580 Repository-Tests, 107 neue SQL-Prüfungen und 38 History-DOM-Szenarien bestanden.
- Isoliertes PGlite mit den unveränderten echten Foto-/Video-RPCs: validierter
  Foto- und Videoabschluss, Fehler, erneuter Versuch, Cachezugriff, falsche Lease,
  ungültiges Ergebnis, Versions-/Eigentümerwechsel, abgelaufene Lease, Wiener
  Monatsgrenzen, zeitgleiche Cursor, Kundensperre und fehlende Rollenrechte.
- Erzwungener Journalfehler verhindert auch die Cacheänderung; Rollback entfernt
  beide Änderungen. Lesen lässt Cache und Journal unverändert.
- Vier neue DOM-Szenarien prüfen die fünfte Kapitelansicht, fünf Zeilen je Seite,
  separate Auftragszahlen, Textsicherheit, Fehler/Timeout/Leerlauf, Seitenwechsel,
  Kundentrennung, veraltete Antworten und erneutes Laden nach einem Fehler.
- Alle neuen Erfolgs-/Fehlerereignisse sind ausschließlich synthetische lokale
  Fixtures. Kein neuer Magic-Effect-Anbieterlauf als Teil dieser Abnahme.

Quelle: `supabase/sql/publication-analysis-history.sql`, identische Migration
`20261106215510_publication_analysis_history_v1.sql`.

```sh
node --test tests/*.test.cjs
node tests/run-publication-analysis-history-sql.mjs
node tests/run-publication-history-dom.mjs
```

Grundlagen: [Supabase-Trigger](https://supabase.com/docs/guides/database/postgres/triggers)
und [PostgreSQL-Sichtbarkeit nach Triggeränderungen](https://www.postgresql.org/docs/current/trigger-datachanges.html).

Bestandsprüfung abgeschlossen. Die neun Veröffentlichungsaufträge, PR #57/#69,
Shopify-Testmodus und unveröffentlichte n8n-Originalentwürfe bleiben erhalten.
Keine Operatorfreigabe, kein Provider-/Coverversuch und keine Social-Veröffentlichung.
