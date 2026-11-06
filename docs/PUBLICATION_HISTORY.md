# Veröffentlichungsaufträge in der Dashboard-History

Stand: 6. November 2026. Die bisher leere Aktivitätsfläche erhält die gespeicherten
Veröffentlichungsaufträge des angemeldeten Kunden. Die Lieferung ergänzt den
bestehenden Dashboard-Frame; die n8n-Dashboardvorlage wird nicht geändert.

## Kundenablauf

Dashboard → **History** → **Veröffentlichungsaufträge**. Die Liste zeigt Titel,
Portal, gespeicherten Zielkontonamen, Status sowie Erstellungs- und Änderungszeit.
Neueste Aufträge stehen oben. **Verlauf aktualisieren** beginnt wieder mit den
neuesten 20 Einträgen; **Weitere Aufträge laden** ergänzt die nächste Seite.
Leere Listen, Ladefehler und erneute Anmeldung haben eigene Meldungen.

„Prüfung abgeschlossen“ bedeutet ausdrücklich noch keine Veröffentlichung.
Öffentlich bestätigte, private, nicht gelistete und eingeschränkt sichtbare
Ergebnisse werden getrennt dargestellt. Fehlende oder widersprüchliche
Providerbestätigungen bleiben unbestätigt bzw. prüfpflichtig. Die Anzeige ist
der gespeicherte Stand, keine aktuelle Live-Abfrage bei YouTube oder TikTok.

## Ausschließlich lesender Zugriff

- `public.sma_publication_history_v1(p_input)` ist ein stabiler Invoker-Wrapper.
  Nur `authenticated` erhält Ausführungsrecht. Der private Definer prüft
  `auth.uid()`, genau eine Kundenzuordnung und aktiven bezahlten oder Demo-Zugang.
- Jede Auswahl ist zugleich an `user_id` und `customer_id` gebunden. Der Client
  kann weder Besitzer noch Kunden auswählen. Keyset-Paginierung verwendet
  `created_at` und `id`, mit 20 Einträgen pro Seite und einem Überhangdatensatz.
- Die Ausgabe beschränkt sich auf sieben Anzeige-Felder. Keine Upload-Session,
  Token, Kunden-/Benutzerkennung, Freigabekennung oder internen Providerantworten.
  Titel und Kontoname werden im Browser ausschließlich als Text eingesetzt.
- Der Reader ruft weder die n8n-Auftrags-API noch den vorhandenen Auftrags-
  `get`-Pfad auf. Dieser kann einen Dispatcher anstoßen und ist daher für die
  History ungeeignet. Keine Auftragsänderung, Lease, Freigabe, Wiederholung,
  HTTP-Anfrage an ein Portal oder automatische Abfrage im Hintergrund.
- Verlassen der History, ausgeblendeter Browser, Abmeldung und Kontowechsel
  entfernen Daten. Besitzerprüfungen vor/nach der Antwort und eine
  Generationskennung verwerfen verspätete Antworten.

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
Die drei neuen Funktionen sind additiv; bestehende Funktionen und Tabellen
werden nicht geändert. Ein Frontend-Rollback kann die neuen Reader ungenutzt
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
- **528 Repository-Tests bestanden.**
- **62 isolierte SQL-Prüfungen bestanden:** Kundentrennung, Zugangssperren,
  identische Zeitstempel über Seitengrenzen, Eingabe-/Rechtegrenzen,
  YouTube-/TikTok-Ergebniszuordnung und unveränderte Journale.
- **8 DOM-Szenarien bestanden:** tatsächliche Textausgabe, Nachladen,
  Fehler/Wiederholung, Konto-/Seitenwechsel, verspätete Antworten und Teardown.
- Produktiver Aufruf unter `authenticated` mit bestehendem Testkunden:
  `ok:true`, **9 Aufträge**, alle **`cancelled`**, keine weitere Seite.
  Die Rollen-/Claim-Simulation erfolgte in einer zurückgerollten Transaktion;
  es wurden keine Testaufträge eingefügt.
- Security-Advisors unverändert: 37 INFO-Einträge für RLS ohne Policies,
  vier bestehende anonyme und sechs bestehende authentifizierte
  Definer-Warnungen sowie die bestehende Passwortschutz-Warnung.
  Keine neue Warnung durch den History-Reader.

```sh
npm ci --prefix tests/sql-runtime --ignore-scripts
npm ci --prefix tests/dom-runtime --ignore-scripts
node --test tests/*.test.cjs
node tests/run-publication-history-sql.mjs
node tests/run-publication-history-dom.mjs
```

## Grenzen und nächste Schritte

Die tatsächlichen vorhandenen Aufträge sind abgebrochene Vorbereitungs-/Test-
aufträge. Erfolgreiche öffentliche oder private Providerergebnisse wurden hier
**nur mit isolierten Fixtures** geprüft. Ein echter Upload ist weiterhin eine
gesonderte Abnahme und wurde nicht gestartet. Medienblocker und Meta bleiben
separate Themen. Die übrigen History-Flächen für Monatskennzahlen,
Bearbeitungshistorie, Monatsarchiv und Analytics sind weiterhin Platzhalter.

Die abgeschlossene Bestandsstrecke wird nicht wiederholt. Shopify-Testmodus,
zehn Bestellungen, die offenen PRs #57/#69 und der unveröffentlichte
n8n-Originalentwurf bleiben erhalten. Diese Lieferung enthält keine
kostenpflichtige Änderung, keinen Kauf und keine Social-Media-Veröffentlichung.
