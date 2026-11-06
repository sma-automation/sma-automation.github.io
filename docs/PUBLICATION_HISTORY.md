# Veröffentlichungsaufträge in der Dashboard-History

Stand: 6. November 2026. Die History zeigt die gespeicherten
Veröffentlichungsaufträge des angemeldeten Kunden mit Monatswahl und Kennzahlen. Sie ergänzt den
bestehenden Dashboard-Frame; die n8n-Dashboardvorlage wird nicht geändert.

## Kundenablauf

Dashboard → **History** → **Veröffentlichungsaufträge**. Die Liste zeigt Titel,
Portal, gespeicherten Zielkontonamen, Status sowie Erstellungs- und Änderungszeit.
Beim Öffnen ist der aktuelle Monat in **Europe/Vienna** ausgewählt. Im
**Monatsarchiv** oberhalb der Liste kann der Kunde einen beliebigen Monat von
2000 bis 2099 auswählen, zum aktuellen Monat zurückkehren oder **Alle Monate**
öffnen. Die zwölf jüngsten Monate mit vorhandenen Aufträgen sind zusätzliche
Direktknöpfe mit ihrer Auftragszahl; ältere Monate bleiben über die Monatswahl
erreichbar. Die bisherigen festen Beispielmonate sind entfernt.

Neueste Aufträge stehen oben. **Verlauf aktualisieren** beginnt im gewählten
Zeitraum wieder mit den neuesten 20 Einträgen; **Weitere Aufträge laden** ergänzt die nächste Seite.
Leere Listen, Ladefehler und erneute Anmeldung haben eigene Meldungen.

Die drei vorhandenen Kennzahlenkarten zählen den **gesamten gewählten Zeitraum**,
nicht nur die bereits geladenen Zeilen:

| Kennzahl | Bedeutung |
| --- | --- |
| Aufträge | Eigene Aufträge, die im gewählten Monat erstellt wurden, einschließlich abgebrochener Aufträge |
| Davon öffentlich bestätigt | Diese Aufträge mit passender, bestätigter öffentlicher Providerantwort nach unveränderter v1-Prüfung |
| Portale in den Aufträgen | Anzahl verschiedener bekannter Portale in diesen Aufträgen, zusätzlich als Namen angezeigt |

Die Monatszuordnung basiert auf **Erstellung**, nicht auf dem späteren
Veröffentlichungszeitpunkt. „Davon öffentlich bestätigt“ ist damit der heute
gespeicherte Ergebnisstand dieser Auftragsgruppe, keine Statistik der in diesem
Monat veröffentlichten Beiträge. Monatsgrenzen und angezeigte Zeitpunkte
verwenden Wiener Zeit einschließlich Sommerzeit. Die frühere Platzhalterkarte
„Bearbeitete Inhalte“ wird nicht mit erfundenen Bearbeitungszahlen gefüllt.

„Prüfung abgeschlossen“ bedeutet ausdrücklich noch keine Veröffentlichung.
Öffentlich bestätigte, private, nicht gelistete und eingeschränkt sichtbare
Ergebnisse werden getrennt dargestellt. Fehlende oder widersprüchliche
Providerbestätigungen bleiben unbestätigt bzw. prüfpflichtig. Die Anzeige ist
der gespeicherte Stand, keine aktuelle Live-Abfrage bei YouTube oder TikTok.

## Ausschließlich lesender Zugriff

- `public.sma_publication_history_v2(p_input)` ist ein stabiler Invoker-Wrapper.
  Nur `authenticated` erhält Ausführungsrecht. Der private Definer prüft
  `auth.uid()`, genau eine Kundenzuordnung und aktiven bezahlten oder Demo-Zugang.
- Jede Auswahl ist zugleich an `user_id` und `customer_id` gebunden. Der Client
  kann weder Besitzer noch Kunden auswählen. Dieselben Grenzen gelten für
  Kennzahlen und Monatsübersicht. Keyset-Paginierung verwendet
  `created_at` und `id`, mit 20 Einträgen pro Seite und einem Überhangdatensatz.
- Jede Auftragszeile enthält weiterhin nur sieben Anzeige-Felder. Die v2-Antwort
  ergänzt ausgewählten Monat, Zeitzone, Kennzahlen und zwölf Monatsabkürzungen. Keine Upload-Session,
  Token, Kunden-/Benutzerkennung, Freigabekennung oder internen Providerantworten.
  Titel und Kontoname werden im Browser ausschließlich als Text eingesetzt.
- Der Reader ruft weder die n8n-Auftrags-API noch den vorhandenen Auftrags-
  `get`-Pfad auf. Dieser kann einen Dispatcher anstoßen und ist daher für die
  History ungeeignet. Keine Auftragsänderung, Lease, Freigabe, Wiederholung,
  HTTP-Anfrage an ein Portal oder automatische Abfrage im Hintergrund.
- Verlassen der History, ausgeblendeter Browser, Abmeldung und Kontowechsel
  entfernen Zeilen, Kennzahlen und Monatsabkürzungen. Besitzerprüfungen vor/nach
  der Antwort und eine Generationskennung verwerfen verspätete Antworten;
  auch ein schneller Monatswechsel kann keine alte Seite oder alte Kennzahlen
  in die neue Auswahl übernehmen.

## Voraussetzung und Installation

Die bereits installierten Tabellen `publication_orders_v1` und
`publication_provider_attempts_v1` sowie `publication_provider_fingerprint_v1`
werden lesend verwendet. Das Providerjournal stammt aus dem **separat offenen
[PR #57](https://github.com/sma-automation/sma-automation.github.io/pull/57)**;
dessen Quellbranch wird nicht zusammengeführt. Für eine neue Datenbank muss
dieses Journal zuerst installiert sein. Der isolierte Test enthält dessen
Schema-/Fingerprint-Ausschnitt mit Quellcommit, keinen produktiven Dispatcher.

Quelle: `supabase/sql/publication-history.sql`. Identische, mit Supabase CLI
erzeugte Migration: `supabase/migrations/20261106115708_publication_history_v1.sql`.
Die Migration `publication_history_v1` ist in `bnvnmdxosbnuzedokqgh` angewendet.
Die zwei zusätzlichen v2-Funktionen stammen aus
`supabase/sql/publication-history-months.sql` und der identischen CLI-Migration
`supabase/migrations/20261106122052_publication_history_months_v1.sql`.
`publication_history_months_v1` ist ebenfalls im bestehenden Projekt angewendet.
Die v1-Reader und der bestehende Ergebnisprüfer bleiben unverändert, damit
bereits geöffnete ältere Dashboardversionen weiter funktionieren. Bestehende
Tabellen werden nicht geändert. Die vorhandenen Indizes auf Besitzer/Erstellung
und Provider-Auftrags-ID unterstützen die Leseabfragen.
Ein Frontend-Rollback kann die neuen Reader ungenutzt
belassen; es ist kein Daten-Rollback erforderlich.

## Nachweise

- [PR #85](https://github.com/sma-automation/sma-automation.github.io/pull/85)
  ist in `website-v1` zusammengeführt. GitHub-Prüfungen und Pages-Bereitstellung
  sind erfolgreich. Im bestehenden angemeldeten Dashboard erscheinen alle
  neun Aufträge mit „Abgebrochen“. „Verlauf aktualisieren“ lädt erneut genau
  neun Einträge. Die geerbte Zentrierung der bisherigen leeren Fläche wird
  durch Entfernen ihrer Platzhalterklasse aufgehoben.
- Vor/nach Installation und Live-Lesen bleibt der vollständige Zeilenhash
  aller neun Aufträge identisch (`a19d817047175d3e2fe2315ff5f9b21b`). Weiterhin
  null Provider-Versuche, Ereignisse und Uploadfreigaben sowie zehn Bestellungen.
- **532 Repository-Tests bestanden.**
- **62 isolierte SQL-Prüfungen bestanden:** Kundentrennung, Zugangssperren,
  identische Zeitstempel über Seitengrenzen, Eingabe-/Rechtegrenzen,
  YouTube-/TikTok-Ergebniszuordnung und unveränderte Journale.
- **52 zusätzliche Monats-SQL-Prüfungen bestanden:** Wiener Monatsgrenzen im
  Winter und nach Sommerzeitumstellung, leere/ältere/alle Monate, Kundentrennung
  in Aggregaten, konstante Gesamtzahl über Seitengrenzen, bestätigte Ergebnisse
  und Fingerabdruckänderung, unveränderte Journale sowie v1-Kompatibilität.
- **14 DOM-Szenarien bestanden:** tatsächliche Textausgabe, Nachladen,
  Fehler/Wiederholung, Konto-/Seiten-/Monatswechsel, Kennzahlen unabhängig von
  Seitenlänge, echte Monatsknöpfe, verspätete Antworten und Teardown.
- Produktiver Aufruf unter `authenticated` mit bestehendem Testkunden:
  `ok:true`, **9 Aufträge**, alle **`cancelled`**, keine weitere Seite.
  Die Rollen-/Claim-Simulation erfolgte in einer zurückgerollten Transaktion;
  es wurden keine Testaufträge eingefügt.
- Produktiver v2-Leseaufruf unter derselben Rolle: **November 2026 = 9 Aufträge,
  0 öffentlich bestätigt, 2 Portale (TikTok/YouTube)**. Oktober liefert **0/0/0**;
  „Alle Monate“ wieder **9/0/2**. Die echte Monatsübersicht enthält ausschließlich
  November 2026 mit neun Aufträgen. Keine synthetischen Aktivitätsdaten wurden
  in der produktiven Datenbank angelegt.
- Security-Advisors unverändert: 37 INFO-Einträge für RLS ohne Policies,
  vier bestehende anonyme und sechs bestehende authentifizierte
  Definer-Warnungen sowie die bestehende Passwortschutz-Warnung.
  Keine neue Warnung durch den History-Reader.

```sh
npm ci --prefix tests/sql-runtime --ignore-scripts
npm ci --prefix tests/dom-runtime --ignore-scripts
node --test tests/*.test.cjs
node tests/run-publication-history-sql.mjs
node tests/run-publication-history-months-sql.mjs
node tests/run-publication-history-dom.mjs
```

## Grenzen und nächste Schritte

Die tatsächlichen vorhandenen Aufträge sind abgebrochene Vorbereitungs-/Test-
aufträge. Erfolgreiche öffentliche oder private Providerergebnisse wurden hier
**nur mit isolierten Fixtures** geprüft. Ein echter Upload ist weiterhin eine
gesonderte Abnahme und wurde nicht gestartet. Medienblocker und Meta bleiben
separate Themen. Monatskennzahlen und Monatsarchiv sind jetzt an die vorhandenen
Aufträge angeschlossen. Gespeicherte Portaltext-Stände sind jetzt als erster Teil der
Bearbeitungshistorie angeschlossen. Ein vollständiges Änderungsjournal für
Editor-Einstellungen, Zuordnungen und Analyseversuche sowie Analytics für
Reichweite, Zielgruppen und Plattformresonanz bleiben offen. Die bestehenden
Magic-Effect-Ergebnisse werden bei Wiederholung überschrieben; sie sind kein
unveränderliches Ereignisjournal. Aus Aufträgen werden keine Analytics-Werte
abgeleitet.

Die abgeschlossene Bestandsstrecke wird nicht wiederholt. Shopify-Testmodus,
zehn Bestellungen, die offenen PRs #57/#69 und der unveröffentlichte
n8n-Originalentwurf bleiben erhalten. Diese Lieferung enthält keine
kostenpflichtige Änderung, keinen Kauf und keine Social-Media-Veröffentlichung.


## Gespeicherte Portaltexte (2026-11-06)

Die History zeigt zusätzlich den vorhandenen Textverlauf aus
`sma_private.publication_caption_history_v1`. Jeder Eintrag enthält den damals
aufgezeichneten Textkörper, das Portal, die Entwurf-ID, die Revision und
`recorded_at`. Der Text lässt sich aufklappen. Aktuelle Titel oder heutige
Entwurftexte werden nicht als historische Werte ausgegeben. Eine Revision ist
ein gespeicherter Stand, kein Beleg, dass jeder Portaltext tatsächlich geändert
wurde. Früher überschriebene Versionen werden nicht nachträglich rekonstruiert.

- Gemeinsame Monatsauswahl mit den Aufträgen; Textstände werden nach
  **Erfassung in Europe/Vienna** eingeordnet. „Alle Monate“ umfasst alle
  zuordenbaren gespeicherten Stände. Die bestehenden Monats-Schnellknöpfe
  beziehen sich weiterhin auf Monate mit Aufträgen; andere Monate sind über
  das Monatsfeld auswählbar.
- Eigene Liste und eigene Seitennavigation (20 Einträge). Die drei
  Auftragskennzahlen bleiben unverändert und zählen keine Textstände mit.
- Neuer rein lesender RPC `public.sma_publication_text_history_v1(p_input)`
  mit stabilem Invoker-Wrapper und privatem Definer-Reader. Authentifizierung,
  eindeutig zugeordnetes aktives Kundenkonto und bezahlter/Demo-Zugang werden
  vor jedem Lesen geprüft. `customer_id` des Textverlaufs muss zur Vorschau
  passen, deren `user_id` wiederum zum angemeldeten Kunden gehört.
- Kein direkter Tabellenzugriff für Browserrollen. Anonyme und Service-Rollen
  dürfen den neuen RPC nicht aufrufen. Es werden keine Tokens, aktuellen
  Fremddaten oder Provider-Rohantworten ausgegeben.
- Keyset-Cursor: `before_at`, `before_id`, `before_revision`,
  `before_platform`; alle vier Felder sind gemeinsam erforderlich. Ein Index
  auf Kunde, Erfassung, Entwurf, Revision und Portal unterstützt die Sortierung.
- `app/assets/publication-text-history-dashboard.mjs` übernimmt Darstellung
  und Seitennavigation. Die übergeordnete History steuert Monat, Sichtbarkeit
  und Abmeldung. Verspätete Antworten werden verworfen, Konto und Leserecht
  werden vor und nach dem Abruf geprüft. Inhalte werden nur als Text gerendert.
- Migration: `20261106123906_publication_text_history_v1.sql`; SQL-Quelle:
  `supabase/sql/publication-text-history.sql`. Die bisherigen History-RPCs v1/v2
  und Schreibwege bleiben unverändert. Es wird keine neue Aktivität erzeugt.

Validierung:

- **535 Repository-Tests**, **57 zusätzliche Textverlaufs-SQL-Prüfungen**,
  **20 gemeinsame DOM-Szenarien** bestanden. Die bestehenden **62 + 52**
  Auftrags-/Monats-SQL-Prüfungen bestehen weiterhin.
- SQL prüft Kunden-/Elternzuordnung einschließlich verwaister Datensätze,
  Rollenrechte, gespeicherte statt heutige Texte, Wiener Monatsgrenzen mit
  Sommerzeit, Seitengrenzen bei gleicher Entwurf-ID/Zeit, ungültige Cursor und
  unveränderte Quelltabellen. Fixtures ausschließlich lokal in PGlite.
- Produktiver Leseaufruf unter authentifizierter Kundenrolle, in einer
  zurückgerollten Transaktion: **November 2026 = 14 Textstände aus acht
  Entwürfen**, Oktober = 0, alle Monate = 14. Zehn Stände haben Revision 1,
  vier Stände Revision 2; nicht alle älteren Versionen sind erhalten.
- Security-Advisors unverändert; keine zusätzliche Warnung.

Zusätzlicher Testaufruf:

```sh
node tests/run-publication-text-history-sql.mjs
```
