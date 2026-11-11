# SMA – Startcheck zum 1. Dezember 2026 (rein lesend)

Stand: **11. November 2026**, Österreich. Dieser Bericht ist eine
Momentaufnahme und **keine** automatisierte Kunden- oder Uploadfreigabe.

## Ziel

Der wiederholbare SQL-Check
`supabase/sql/launch-readiness-readonly.sql` fasst nur Zahlen und
Sperrstatus aus den vorhandenen SMA-Tabellen zusammen. Er ist für
berechtigte technische Betreiber bestimmt und wird **nicht** als
öffentliches Browser-RPC angeboten. Er verlangt keine Anmeldedaten,
schreibt nichts und macht keinen Provider- oder Zahlungsaufruf.

Die Ausgabe enthält absichtlich weder Kundennamen/Kunden-IDs,
E-Mail-Adressen, Medienbytes, Dateipfade noch Tokens. **Eine Anzahl
gilt nie als Beweis für den unveränderten Freigabe-Fingerprint oder
einen erfolgreich veröffentlichten Beitrag.**

## Live-Momentaufnahme vom 11.11.2026

| Bereich | Beobachtung | Konsequenz |
| --- | --- | --- |
| SMA-Konten | 4 Kundeneinträge, 3 berechtigt; 0 bestätigt bezahlt, 3 nur Demo | Zahlender Kunden-E2E steht aus |
| Aufträge | 10 gesamt, 9 storniert, 1 vorbereitet, 0 genehmigt | Kein Auftrag für Veröffentlichung freigegeben |
| Provider | 0 Operatorberechtigungen, 0 Versuche, 0 Ereignisse | **Kein echter Provider-E2E nachgewiesen** |
| Medien | 8 verfügbare Dateien, 0 Katalogeinträge in den letzten 15 Minuten frisch bestätigt | Exakte Datei vor einem neuen Auftrag erneut echt prüfen |
| Galerie-Audio | 2 vorhandene Musikjobs; 0 registrierte technische Galerie-Nachweise | Tondatei wurde unabhängig geprüft; Übernahme in sichere Medienprüfung weiter offen |
| Kundenwebseiten | 0 veröffentlichte SMA-Kundenwebseiten, 0 Providerverbindungen | Delta-Webseite/Domain gesondert abnehmen |
| Shop | 10 Bestellungen, davon 6 offiziell als Test gekennzeichnet | Shopify und SMA stimmen bei der Anzahl überein; aktueller Payments-Testmodus unbekannt |

**Galerie-Registrierung (zusätzliche Live-Prüfung am 11.11.2026):**
Die private Registrierungsfunktion ist über die bereits erfasste Migration
`20261111151051_gallery_technical_evidence_service_only_v1` in Supabase
installiert und ausschließlich für `service_role` ausführbar. Die private
Snapshot-Leserolle und die vorbereitete Worker-Identität sind `NOLOGIN`
ohne Passwort; der Server-Worker
ist noch nicht aktiviert. **0** technische Galerie-Einträge bedeuten:
kein abgenommenes Registrierungs-E2E. Die SQL-Vorlage **nicht erneut**
installieren; die nächste Abnahme betrifft den unabhängigen privaten Worker.

Zu den bereits bestätigten Modulen gehören die Dashboard-Suche,
die mobile Navigation, die Shopify-Bestellklassifizierung,
der geschützte Warenkorb-Vorbereitungsweg, Galerievertonung
und einzelne YouTube-/TikTok-Vorbereitungsschritte. Daraus folgt
**keine** vollständige End-to-End-Veröffentlichungsfähigkeit.

## Reihenfolge bis zu ersten Kunden

1. **Freigabekette:** Konto- und Mediennachweis für eine konkrete
   Kunden-Dateirevision frisch abrufen. Persönliche Inhalts-,
   Rechte-, Musik-, Werbung- und ggf. KI-Kennzeichnung bestätigen
   lassen. Alte Aufträge/Fristen nicht automatisch verlängern.
2. **Ein einzelner privater Provider-Test:** Erst nach ausdrücklicher
   Betreiberfreigabe, kundenseitiger Zustimmung, gültigem Auftrags-
   Fingerprint und separater Operatorberechtigung. YouTube privat
   und TikTok nur für die freigegebene Sichtbarkeit, niemals
   stillschweigend öffentlich. Provider- und Cover-Ergebnisse
   einschließlich eindeutiger externer IDs nachweisen.
3. **Galerie- und Video-Nachweise:** Vertrauenswürdige Übernahme
   der bereits unabhängig geprüften gespeicherten Musik-MP4
   vorbereiten, ohne Operator-Receipt zu fälschen. Für die derzeit
   gesperrte visuelle Videoanalyse (`VIDEO_PLAN_REQUIRED`)
   keine kostenpflichtige Tarifänderung ohne Zustimmung.
4. **Webseite und Verkauf:** Eine vollständige fiktive
   Kundenwebseite einschließlich WordPress-/Domain-Anbindung
   zunächst isoliert abnehmen. Den Shopify-Payments-Testmodus
   im Admin kontrollieren, **ohne** Kauf oder Zahlungen.
5. **Produktfreigabe:** Testnutzer kann ohne Anleitung Datei,
   Text, Portal, Freigabe, Shop und History finden. Fehler und
   ausstehende Nachweise werden sichtbar als solche markiert,
   niemals als erfolgreich.

## Wiederholen

Den SQL-Inhalt in der **berechtigten Supabase SQL-Ansicht** oder
über eine autorisierte interne, rein lesende Verbindung ausführen:

Für die konkret vorbereiteten YouTube-Aufträge gibt es außerdem
den separaten [Nur-Lesen-Abnahmecheck](YOUTUBE_PRIVATE_RELEASE_PREFLIGHT_20261111.md)
mit dem Prüf-SQL `supabase/sql/youtube-private-release-preflight-readonly.sql`.
Er zeigt fehlende frische Dateinachweise, Freigabefenster und
Teilprüfungen, **ohne** Auftrag, Zielkonto oder Rechte zu ändern.

```text
supabase/sql/launch-readiness-readonly.sql
```

Der Ausdruck `files_verified_last_15m` ist ein **globaler
Momentzähler**, kein Dateibeweis für einen konkreten Auftrag.
Er ist besonders nach längeren Arbeitspausen normalerweise null.
Ein aktueller Nachweis muss immer zur **exakten Datei- und
Auftragsrevision** passen.

Die Felder `external_e2e_status=NOT_VERIFIED_BY_THIS_QUERY`,
`allows_publication=false` und
`initiates_checkout=false` werden absichtlich nie durch
einfache Zählerüberschreitungen auf »bereit« gesetzt.
TikTok-KI-Pflichtwahl bleibt im offenen, nicht freigegebenen
Entwurf #199. Die visuelle weitere Vereinfachung der Vorschau
(Issue #198) ist ausdrücklich **erst nach der Kernabnahme**
vorgesehen.

## Technische Absicherung

`tests/launch-readiness-readonly.test.cjs` kontrolliert,
dass die Datei ausschließlich eine lesende SQL-Abfrage enthält,
keine persönlichen Daten ausgibt und Veröffentlichungs- sowie
Checkout-Sperren nicht aufhebt. Die SQL wurde am 11.11.2026
auf dem vorhandenen SMA-Supabase-Projekt rein lesend ausgeführt.

Keine neuen Tabellen, Rollen, Berechtigungen, Workflows,
Provider-Aufrufe, Echtkäufe oder Kosten.
