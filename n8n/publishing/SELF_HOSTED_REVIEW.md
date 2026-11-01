# Übergabe: eigener visueller Prüfdienst

## Stand und Grenze

Der gemeinsame Auswerter und der lokale Anfrage-/Antwortvertrag sind implementiert und mit synthetischen Daten getestet. Produktiv bleibt ausschließlich das bisherige Sightengine-Bildprofil aktiv. Ein eigener Modellserver ist **nicht** eingerichtet. Es gibt keine konfigurierbare öffentliche Ziel-URL und keinen bezahlten Fallback. Der Vertrag selbst verursacht keine Anbieteraufrufe.

Die Aufgaben Dateizuordnung, Eigentümerprüfung, Dateiversion, Prüfsumme, Wiederholungsbegrenzung und Statusanzeige bleiben beim SMA-System. Ein eigener Dienst liefert nur Modellresultate für die übergebenen Bytes. Er entscheidet weder über Kontoberechtigung noch über Veröffentlichungen.

## Vertrag `sma.visual-review.v1`

`buildLocalRequest(context, verifiedSha256, profile)` erzeugt ausschließlich diese Metadaten:

| Feld | Bedeutung |
|---|---|
| `schema` | Fest `sma.visual-review.v1` |
| `request_id` | Zufällige, kurzlebige Auftrags-ID aus der serverseitigen Reservierung |
| `content_sha256` | SHA-256 der bereits geprüften tatsächlichen Dateibytes |
| `policy_version` | Eigenes Profil mit Präfix `local-`; niemals das Sightengine-Profil |
| `model_revision` | Fest freigegebene Modell-/Adapterrevision, kein frei wechselndes `latest` |
| `media_kind`, `mime_type`, `size_bytes`, `duration_ms` | Geprüfte Medienangaben |
| `sampling_ms` | Bild: 0; vorbereiteter Videovertrag: 1000 |
| `required_categories` | `nudity`, `violence`, `weapons`, `gore`, `hate`, `drugs`, `self_harm` |

Die binären Medien werden erst durch einen später einzurichtenden authentifizierten Transport übertragen. Der Dienst muss selbst Länge, SHA-256 und tatsächlich dekodierten Medientyp prüfen. Keine Drive-URLs, Kundennamen, Kunden-E-Mail-Adressen, Shop-Adressen oder SMA-Sitzungen gehören in diese Anfrage. n8n reserviert weiterhin getrennt die Datenbankberechtigung; die Auftrags-ID allein erlaubt keinen Abschluss.

Die Antwort spiegelt `schema`, `request_id`, `content_sha256`, `policy_version`, `model_revision`, `media_kind`, `sampling_ms` unverändert zurück und enthält `frames`. Jeder Frame hat `position_ms` und `scores` mit **allen sieben** Kategorien als endlichen Zahlen zwischen 0 und 1. Bilder benötigen genau einen Frame bei 0 ms. Der vorbereitete Videovertrag verlangt höchstens 125 Frames, Beginn bis 100 ms, steigende Positionen, höchstens 1100 ms Abstand und Abdeckung bis höchstens 1100 ms vor Ende. Es ist eine visuelle Stichprobe, keine Audioanalyse und keine vollständige Frameprüfung.

`normalizeLocalResponse(response, originalRequest, approvedProfile)` prüft die Bindung und wertet die Scores selbst aus. Falsche Datei, alte Auftrags-ID, andere Modellrevision, fehlende Kategorie oder lückenhafte Zeitabdeckung ergeben `REVIEW_INCOMPLETE`. Fremde Behauptungen wie `outcome: "clear"` oder `can_publish: true` werden nicht übernommen. Das Ergebnis enthält immer `can_publish: false`.

Der gemeinsame Auswerter hat derzeit die Grenze 0,35. Scores verschiedener Modelle sind nicht automatisch vergleichbar. Vor einem realen lokalen Profil muss die Eignung dieser Grenze anhand repräsentativer erlaubter/problematischer Inhalte geprüft werden. Eine Modellkombination oder ein neuer versionierter Auswerter kann erforderlich sein. Fehlende Kategorien dürfen niemals durch 0 ersetzt werden.

## Inbetriebnahme durch den Serverbetreiber

1. Modelle, Lizenz, Hardwarebedarf und Abdeckung aller Kategorien festlegen; Modellrevisionen fixieren und Qualität mit repräsentativen Daten messen. Testdaten und Grenzfälle dürfen keine automatische Freigabe vortäuschen.
2. Authentifizierten Dienst mit fester Betreiberadresse, TLS, Größen-/Zeitlimits, deaktivierten Redirects und begrenzter Parallelität einrichten. Keine Medien-/Tokenprotokolle speichern. Betreiberzugriff und Löschverhalten festlegen.
3. Transportadapter für binäre Datei plus Metadaten implementieren. Es darf kein Ziel aus einer Benutzeranfrage übernommen werden. Fehler/Timeouts bleiben offen; kein stiller externer Ersatzaufruf.
4. Neues `local-…`-Prüfprofil in Reservierung, Cache, Abschlussvalidierung und Oberfläche gemeinsam ausrollen. Aktuell akzeptieren Datenbank und Oberfläche bewusst nur das bisherige Sightengine-Profil. Das Ändern einer JavaScript-Konstante allein aktiviert keinen Serverbetrieb.
5. Vertragstests, echte Dekodierung, Fehlerfälle, Datei-/Modellwechsel, Rollen- und Abschlussprüfungen sowie einen isolierten End-to-End-Test durchführen. Erst danach das serverseitige Profil aktivieren. Video gesondert freigeben; die bestehende Tarifsperre darf keine ungeprüfte lokale Abdeckung ersetzen.

Die bestehenden Produktionsworkflows und Portal-Publisher sind kein Teil dieser Schnittstelle. OCR, Sprache, Aussagenprüfung, Rechte, Kennzeichnungen und finale Freigabe bleiben eigene Aufgaben. Der eigene Server ersetzt mögliche Anbietergebühren durch eigenen Betriebs-, Rechen- und Wartungsaufwand; diese Implementierung enthält keine Kostenschätzung oder gebuchte Infrastruktur.

## Prüfung und Rücknahme

`node --test tests/publication-content-review.test.cjs tests/publication-review-providers.test.cjs tests/publication-page.test.cjs`

Die Tests decken Kategoriegrenzen, unvollständige Modelle, Dateibindung, Antwortverwechslungen, unbekannte Anbieter, unveränderte Sightengine-Auswertung sowie die tatsächlich in den n8n-Export eingebetteten Knoten ab. Sie verwenden synthetische Antworten und rufen keinen Anbieter auf. Die getrennte lokale Vertragsprüfung belegt keine Qualität eines realen lokalen Modells.

Die vorherige veröffentlichte n8n-Version `ea499a75-aa12-410e-b5cb-4de841adaf29` bleibt als Rücknahmepunkt erhalten. Für diese Aufteilung sind keine Datenbankmigrationen und keine Oberflächenänderungen notwendig.
