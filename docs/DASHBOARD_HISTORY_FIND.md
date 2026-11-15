# SMA Dashboard – Veröffentlichungsaufträge im gesamten Verlauf finden

Stand: 13.11.2026. Ergänzung zur bereits umgesetzten
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
Die Dashboard-Adresse verweist auf den gewählten Auftrag. Auch nach
dem Neuladen öffnet sich derselbe Eintrag, selbst wenn mehrere Aufträge
den gleichen Titel haben. Die Monatsauswahl entfernt den Auftragsverweis.
Es wird kein zweiter Freigabedialog und kein Upload-Endpunkt
erzeugt. Die drei Reiter **Aufträge, Bearbeiten, Analyse**
und die bisherige Monats-/Seiten-Navigation bleiben erhalten.

Die Trefferliste und der geöffnete Auftrag zeigen denselben Freigabestand.
„Freigabe ausstehend“ bedeutet, dass die Vorbereitung gültig ist und der Kunde
noch bestätigen muss. „Kontoprüfung erforderlich“ verweist auf die erneute
Prüfung des Zielkontos. Endet die Frist bei geöffneter Suche, wechselt auch der
Treffer zu „Vorbereitung abgelaufen“. Ein Klick öffnet den Auftrag mit seinem
nächsten Schritt. Ältere Datensätze ohne dokumentierte Frist behalten ihren
gespeicherten Status.

Wenn die Dateiversion eines abgelaufenen YouTube- oder TikTok-Auftrags ersetzt
wurde, führt **Aktuelle Dateiversion öffnen** zum regulären Optimierer für
dieselbe Datei und dasselbe Portal. Dort liest SMA den aktuellen Kundenkatalog.
Ist die frühere Textzuordnung veraltet, kann der Kunde einen neuen Beitragstext
erstellen. **Zurück zum Auftrag** öffnet in der History den ursprünglichen
Eintrag auf der zugehörigen Seite. Die ID im URL-Fragment dient ausschließlich
diesem Rücklink. Der Optimierer lädt den aktuellen Entwurf unabhängig von
der abgelaufenen Vorbereitung.

## Datensicherheit

Die öffentliche `sma_publication_history_find_v1(text)` ist ein
separater **SECURITY-INVOKER**-RPC. Die benötigte, stark begrenzte
**SECURITY-DEFINER**-Lesefunktion liegt ausschließlich in
`sma_private.publication_history_find_core_v1(text)` und prüft
`auth.uid()` sowie die aktive, passende Kundenberechtigung.
Die private Auftragsliste wird nur zurückgegeben, wenn
`publication_orders_v1.user_id`, die zugeordnete Kunden-ID
und eine aktive/zahlungs- oder demo-berechtigte
`sma_kunden`-Zuordnung zusammenpassen.
Diese explizite Eigentumsprüfung ist zwingend, weil die
Funktion im privaten Schema als `SECURITY DEFINER`
auf die Datensätze zugreift.

Die Funktion gibt Auftrags-ID, Titel, Portal, Status und Erstellungszeit zurück.
Bei einem eindeutig zugeordneten Kunden kann ein vorbereiteter Auftrag zusätzlich
den Zustand und das Ende der Vorbereitung enthalten. Bei eindeutiger Kundenzuordnung nutzt
die Suche dieselbe Auswertung wie die Auftragsansicht. Ein unklarer
Übertragungsversuch erscheint als „Ergebnis unklar“. Eine erfolgreich
abgeschlossene private Übertragung erfordert den passenden gespeicherten
Beleg. Bei älteren Anmeldungen mit mehreren Kundenzuordnungen zeigt
die Suche weiterhin nur den bisherigen Auftragszustand.
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

Die produktive Suche liest den gespeicherten Verlauf. Eine Suche
oder das Öffnen eines Treffers startet keine neue Übertragung.

Keine Provider-Uploads, Veröffentlichungen, echten Käufe,
Credit-Abbuchungen, Paketänderungen oder n8n-Mutationen.

## Sicherheitsnachbesserung

Die anfänglich installierte Suchfunktion löste eine neue Supabase-Warnung
für öffentliche SECURITY-DEFINER-Funktionen aus. Die separate
Migrationsvorlage `publication-history-find-invoker-wrapper.sql`
prüft den exakt installierten Quellhash und ersetzt den öffentlichen
Einstieg durch einen reinen SECURITY-INVOKER-Wrapper. Die privilegierte
Funktion wandert in das **nicht exponierte** Schema `sma_private`.
Der Aufruf hat dieselbe Eigentümer- und Ergebnisprüfung;
Kundentabellen bleiben unverändert und nicht direkt lesbar.
