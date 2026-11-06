# Cover-Status in der History

Stand: 06.11.2026; PR #104 zusammengeführt und live. Ergänzt [PORTAL_COVER_HANDOFF.md](PORTAL_COVER_HANDOFF.md).

## Kundenansicht

**History → Aufträge** zeigt den Cover-Status direkt unter dem Auftragstitel
neben Portal und Datum. Auf dem Handy steht er in einer eigenen kurzen Zeile.
Die Erklärung und der gespeicherte Cover-Zeitstand erscheinen erst beim Öffnen
des Auftrags. Bestehende Kapitelreiter, Schrift, Monatswahl und fünf Aufträge
pro Seite bleiben erhalten. Es gibt keinen neuen Versand- oder Wiederholen-Button.

| Anzeige | Bedeutung |
| --- | --- |
| Noch nicht festgehalten | Kein Cover-Snapshot für diesen Auftrag; keine Aussage über eine erfolgreiche Übergabe |
| Nicht vorgesehen | Portal oder Dateityp ohne angeschlossenen Coverweg |
| Ohne eigenes Cover | Beim Start ausdrücklich ohne Cover festgehalten |
| Ausstehend | Cover gebunden; Übergabe noch nicht abgeschlossen |
| Wird übertragen | YouTube-Coveraufruf reserviert, Bestätigung fehlt noch |
| Übertragung bestätigt | YouTube-Coverantwort eindeutig erfolgreich; keine Aussage über öffentliche Videosichtbarkeit |
| Bildzeitpunkt übergeben | TikTok-Init und Videoabschluss bestätigt; kein separat bestätigtes Coverbild |
| Nicht übertragen | Video fehlgeschlagen, blockiert oder abgebrochen, bevor das Cover übertragen wurde |
| Berechtigung fehlt / Abgelehnt | YouTube hat das Cover abgelehnt; das Video bleibt erhalten |
| Ergebnis unklar | Unklare Antwort oder mehr als drei Minuten ohne Abschluss; kein automatischer Neuversand |
| Prüfung erforderlich | Widersprüchliche oder nicht eindeutig gebundene Nachweise |

Der Veröffentlichungsstatus bleibt unabhängig vom Coverstatus. Eine erfolgreiche
Coverübertragung erhöht weder die Zahl öffentlicher Beiträge noch ersetzt sie
eine Veröffentlichungsbestätigung.

## Technik

- Additiver Lese-RPC `sma_publication_history_v3`, öffentlich SECURITY INVOKER,
  ausschließlich `authenticated`. Privater SECURITY-DEFINER-Leser mit leerem
  `search_path`, UID-Prüfung und unveränderter aktiver Kundenprüfung aus v2.
- V2 liefert dieselben Monatsfilter, Wiener Zeitgrenzen, Gesamtzahlen und maximal
  20 Zeilen pro Abruf. V3 ergänzt nur `cover: {status, updated_at}` und bewahrt
  Reihenfolge und Cursor. Eigentümer und Kundenzuordnung werden erneut verknüpft.
- Der private Statushelfer ist SECURITY INVOKER und nicht direkt für Client- oder
  Service-Rollen aufrufbar. Keine direkten Tabellenrechte ergänzt.
- Fingerprint, Plattform, Zielkonto und Sichtbarkeit müssen zum Auftrag passen.
  Positive Zustände erfordern gültigen Snapshot sowie passende Videoantwort und
  abgeschlossenes Statusereignis. TikTok benötigt zusätzlich sein abgeschlossenes
  Init-Ereignis. YouTube benötigt passende Cover-Lease, Zeiten und Ergebniscode.
- Es werden keine Drive-IDs, Hashes, Provider-URLs, Tokens, Leases oder Rohantworten
  an die History gegeben. Kein Provider-RPC, keine Freigabe, kein Dispatcher,
  keine Schreiboperation. Abgelaufene Übertragung wird nur beim Lesen als unklar
  dargestellt; eine später gespeicherte echte Antwort kann dies auflösen.
- V1/V2 bleiben unverändert verfügbar. Bei fehlendem/ungültigem Coverfeld verwirft
  der neue Client die Antwort; kein erfundener Erfolgsstatus. Kundenauswahlwechsel,
  Abmeldung und veraltete Antworten werden mit den bestehenden Schutzpfaden behandelt.

Migration `20261106195832_publication_cover_history_v1.sql` installiert;
identisch mit `supabase/sql/publication-cover-history.sql`.
Keine Änderungen an n8n-Workflows, Providerfreigaben oder Schreibfunktionen.

## Prüfstand

- 573 Node-Tests, 124 neue SQL-Prüfungen, 32 History-DOM-Szenarien bestanden.
  Bestehende History-SQL-Prüfungen 62 und Monatsprüfungen 52 ebenfalls bestanden.
- Statusmatrix einschließlich fehlender/falscher Belege, Fingerprint-/Zielwechsel,
  Zeitüberschreitung, verspätetem Ergebnis, fehlender Berechtigung, TikTok ohne
  separates Coverergebnis und unveränderten öffentlichen Gesamtzahlen geprüft.
- Isolierte PGlite-Prüfung mit synthetischen Daten; keine Testaufträge oder
  erfundenen Coverbestätigungen in der echten Datenbank angelegt.
- Authentifizierte Kundenisolation, inaktive/mehrdeutige Konten, fremde Kunde/UID-
  Kombinationen, Monatsfilter, Paginierung, fehlende Tabellen-/Helferrechte und
  identische Journale vor/nach Lesezugriff geprüft.
- Live-Funktionskatalog bestätigt STABLE/INVOKER und die vorgesehenen ACLs.
  V2-Quellhash `d777f527095140f9ab83f230d8ade059` und Provider-Fingerprintfunktion
  `5867545f1bdb0e8a7523609fdbbb4a57` unverändert.
  Security-Advisor-Kategorien vor/nach unverändert.
- Ausgangsstand: 9 Aufträge, 0 Operatorfreigaben, 0 Provider- und Coverversuche.
  Auftragsdigest `a19d817047175d3e2fe2315ff5f9b21b` für den Abschlussvergleich.

## Bereitstellung und Live-Prüfung

- Feature `6927a85e327d1783c170842133d56c0d29cf67ae`, Merge
  `070354cb0821b7381bb48b0db756104c710ba8b9` auf `website-v1`.
  Beide PR-Prüfungen und die History-Prüfung nach dem Merge erfolgreich.
  Pages Run `42285156918`, Deployment-Job `128124146476` erfolgreich.
- Bestehendes angemeldetes Dashboard neu geladen: History → Aufträge zeigt
  weiterhin 9 Aufträge, 0 öffentlich bestätigt, 2 Portale. Erster Bildschirm
  1–5, zweiter 6–9; zurück zur ersten Seite erfolgreich. Kapitelwechsel
  Portaltexte → Aufträge erfolgreich, Details standardmäßig eingeklappt.
- Die bestehenden abgebrochenen Aufträge zeigen korrekt **Cover: Noch nicht
  festgehalten**, da kein Cover-Snapshot vorliegt. Aufgeklappt erscheint die
  Erklärung ohne Versandaktion. Keine künstliche Erfolgsanzeige angelegt.
- Abschlussabfrage: weiterhin 9 Aufträge, 0 Operatorfreigaben, 0 Provider- und
  Coverversuche; Auftragsdigest unverändert `a19d817047175d3e2fe2315ff5f9b21b`.
- PR #57/#69 erneut als offen und ungemergt bestätigt. Keine n8n-Änderung in
  diesem Arbeitsschritt und keine Social-Veröffentlichung.

Die echte Coverbestätigung durch YouTube/TikTok bleibt bis zu einer ausdrücklich
autorisierten Veröffentlichung offen. Bestandsprüfung abgeschlossen; PR #57/#69,
Shopify-Testmodus und unveröffentlichte n8n-Originalentwürfe bleiben erhalten.
