# SMA Dashboard – Veröffentlichungsaufträge im gesamten Verlauf finden

Stand: 11.11.2026. Ergänzung zur bereits umgesetzten
Dateisuche und Bestellsuche.

## Problem

Die History zeigt fünf Aufträge auf einer Seite und unterstützt
Monatsarchive. Ohne Suche ist ein bekannter Auftrag nur schwer
wiederzufinden, insbesondere auf dem Handy.

## Neue Kundensicht

In **History → Aufträge** steht das Feld
**„Auftrag, Titel oder Portal suchen …“**.
Ab zwei Zeichen durchsucht SMA mit dem bereits angemeldeten
Kundenkonto den **gesamten eigenen Auftragsbestand**, nicht nur
die fünf sichtbaren Aufträge. Suchbare Felder sind Titel,
Auftrags-ID, Portal und gespeicherter Zielkontoname.
Es erscheinen höchstens 20 aktuelle Treffer je Suche;
sind weitere vorhanden, wird das ausdrücklich angezeigt
und zu einer genaueren Suche aufgefordert.

Ein Klick auf einen Treffer öffnet den **gespeicherten
Originalauftrag in derselben History**, einschließlich
seiner Status-/Medieninformationen und bestehenden Aktionen.
Es wird kein zweiter Freigabedialog und kein Upload-Endpunkt
erzeugt. Die drei Reiter **Aufträge, Bearbeiten, Analyse**
und die bisherige Monats-/Seiten-Navigation bleiben erhalten.

## Datensicherheit

Die neue `sma_publication_history_find_v1(text)` ist ein
separater Nur-Lesen-RPC mit `auth.uid()`-Prüfung.
Die private Auftragsliste wird nur zurückgegeben, wenn
`publication_orders_v1.user_id`, die zugeordnete Kunden-ID
und eine aktive/zahlungs- oder demo-berechtigte
`sma_kunden`-Zuordnung zusammenpassen.
Diese explizite Eigentumsprüfung ist zwingend, weil die
Funktion im privaten Schema als `SECURITY DEFINER`
auf die Datensätze zugreift.

Die Funktion gibt nur Auftrags-ID, Titel, Portal,
nicht bindenden Auftragszustand und Erstellungszeit zurück.
Keine Caption, Passwörter, Datei-URLs, Bearer-Tokens,
Anmeldedaten, Musikguthaben oder personenbezogenen
Kundeneinträge. Eine Suche verändert keine Datensätze.

Die Zeichenfolge wird als **wörtlicher Text** verglichen,
nicht als SQL-Wildcard oder dynamische Datenbankabfrage.
Maximal 80 Zeichen. Freigegeben ist ausschließlich die
PostgreSQL-Rolle `authenticated`; `anon` und `PUBLIC`
erhalten kein `EXECUTE`.

## Prüfungen

`tests/run-publication-history-find-sql.mjs`: isolierte
PostgreSQL-Auswertung mit synthetischen getrennten
Kundenkonten, alten und aktiven Zuordnungen, Suchbegriffen,
Treffergrenze, wörtlicher Suche und negativen Zugriffs-
und Schreibfällen. Kein bestehender Auftrag wird bearbeitet.

`tests/publication-history-find.test.cjs`: geschlossene
Ergebnisschema-Prüfung für die Browseranzeige.
`tests/run-publication-history-dom.mjs`: Suche im echten
History-Dialog, Öffnen des passenden gespeicherten Auftrags
und Verwerfen verspäteter Ergebnisse beim Kontowechsel.

## Betriebsgrenzen

Der neue RPC ist zunächst nur vorbereitet. Er muss nach
erfolgreichem CI und separater Sicherheitsprüfung installiert
werden, bevor die neue Browser-Suche produktiv genutzt
werden kann. Bis dahin bleiben bestehende History,
Auftragsseiten und Monatsarchiv unverändert funktionsfähig.

Keine Provider-Uploads, Veröffentlichungen, echten Käufe,
Credit-Abbuchungen, Paketänderungen oder n8n-Mutationen.
