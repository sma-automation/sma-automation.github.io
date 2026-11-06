# Persönliche Medienprüfung für die Kernversion

Stand: 06.11.2026. Ohne neuen Prüfdienst oder Tarifwechsel. Der Auftrag kann
fehlende vollständige visuelle und semantische Prüfung durch eine ausdrücklich
gewählte **Kundenselbstauskunft** belegen. Das ist weder ein automatisches
Analyseergebnis noch eine unabhängige Prüfung oder Annahmegarantie des Portals.

## Bedienung

In **Datei → Ausgewählte Datei ansehen → Beitragsvorschau** steht für unterstützte
Videos **Originalvideo laden** zur Verfügung. Bereits gespeicherte Videos hatten
zuvor ausschließlich ein Vorschaubild. Der neue Player lädt auf ausdrücklichen
Klick die unveränderte Originaldatei über den vorhandenen Editor-Quellweg:
Eigentümer, Kundenordner, Dateistand, Größe und Prüfsumme werden geprüft.
MP4 bis 24 MB/60 Sekunden; native Wiedergabesteuerung, kein automatisches Abspielen.
Es wird weder ein Export noch eine Analyse oder Prüfbestätigung angelegt.
Datei-/Kontowechsel brechen laufende Abrufe ab und entfernen geladene Videodaten.
Zusätzlich zu den unten genannten Prüfungen: 60 Originalvideo-DOM-Prüfungen.

Im vorbereiteten YouTube-/TikTok-Auftrag erscheint **Persönliche Inhaltsprüfung**,
wenn die Voraussetzungen erfüllt sind. Nichts ist vorausgewählt. Der Kunde muss
die vollständige konkrete Datei selbst ansehen und vier Aussagen bestätigen:

1. Vollständiges Abspielen einschließlich Ton.
2. Alle Szenen ohne die ausdrücklich genannten visuellen Risiken. Bei Unsicherheit
   nicht bestätigen: Nacktheit/sexualisierte Inhalte, Gewalt, Waffen, drastische
   Verletzungen, Hasssymbole, Drogen oder Selbstverletzung.
3. Sprache, Musiktext und Einblendungen auf diese Inhalte geprüft.
4. Aussagen und Versprechen auf Richtigkeit und Übereinstimmung von Video,
   Titel und gespeichertem Beitrag geprüft.

Die bestehenden Rechte-, Musik- und TikTok-Erklärungen bleiben erforderlich.
Die persönliche Prüfung wird erst gemeinsam mit der **separaten endgültigen
Veröffentlichungsfreigabe** gespeichert. Kein Klick auf eine Prüfaussage sendet
eine Anfrage. Umschalten und Statusaktualisierung setzen die Auswahl zurück.
Weder der Assistent noch die Migration bestätigen echte Kundeninhalte.

## Voraussetzungen und unveränderte Sperren

V1 ist auf YouTube/TikTok, MP4 bis 24 MB/60 Sekunden und einen SHA-256-gebundenen
Dateistand begrenzt. Die vollständige technische Dekodierung und der bestehende
Portaltextvergleich müssen bestanden sein. Bei TikTok müssen zusätzlich die
aktuell geprüften Kontooptionen und die erlaubte Dauer passen.

Nur diese zwei fehlenden Prüfungen werden im konkreten Auftrag ersetzt:

| Bisher offen | Nach gültiger persönlicher Bestätigung |
| --- | --- |
| `CONTENT_REVIEW_PENDING` | `HUMAN_VISUAL_REVIEW`, ausdrücklich Kundenselbstauskunft |
| `SEMANTIC_REVIEW_PENDING` | `HUMAN_SEMANTIC_REVIEW`, ausdrücklich Kundenselbstauskunft |

Zulässiger automatischer Ausgangsstand: unversucht oder `VIDEO_PLAN_REQUIRED`;
bei bereits unauffälliger visueller Prüfung wird nur die semantische Lücke
ersetzt. Laufende Prüfungen, andere Dienstfehler, gemeldete Auffälligkeiten,
fehlende technische Nachweise, offene Textfragen und unbekannte Prüfergebnisse
bleiben gesperrt. Ein späterer negativer oder noch offener Maschinenbefund
blockiert erneut. Die automatische Sightengine-Videoprüfung bleibt deaktiviert.
Allgemeine Dateiprüfungen außerhalb des konkreten Auftrags werden nicht umgefärbt.

## Speicherung und Anschluss

`approval_review.human_review` enthält die geschlossene Richtlinie
`human-video-2026-11-06.1`, vier echte Booleans und einen SHA-256-Fingerabdruck
über Auftrags-ID, Eigentümer, Kunde, Datei-/Textbindung, Entwurf, Zielkonto und
Optionen. Eigentümer und Zeitpunkt stammen aus dem bestehenden serverseitigen
Auftrag (`user_id`, `approved_at`), nicht aus frei eingegebenen Namen/Zeiten.
Datei, Text, Konto oder Optionen ändern den Fingerabdruck. Die Freigabe-API prüft
die aktuelle Eignung vor der Reservierung; Worker und Providerjournal prüfen sie
erneut. Bestehende reine Rechtebestätigungen erhalten keinen neuen Prüfnachweis.

Es gibt keine neue Tabelle oder öffentliche RPC und keine zusätzliche n8n-
Ausführung. Die bestehende API transportiert das begrenzte Review-Objekt.
`publication-manual-review.sql` erweitert vier vorhandene Funktionen und ergänzt
vier private Hilfsfunktionen; Installationsschutz prüft fünf Live-Funktionshashes.
Die lokale Baseline enthält nur Funktionsdefinitionen, keine Kundendaten.
Migration: `20261106221606_publication_manual_media_review_v1.sql`.

Die vorhandene Providerberechtigung ist weiter eine getrennte Voraussetzung.
`can_upload:false` und `can_publish:false` bleiben in Kundenantworten erhalten.
Die Migration legt weder Aufträge noch Rechte, Prüfbestätigungen oder
Provider-/Coverversuche an. PR #57 und #69 bleiben separat offen.

## Prüfungen und nächster Schritt

- 581 Repository-Tests, 128 neue SQL-Prüfungen, 75 neue DOM-Prüfungen bestanden.
- Lokale SQL-Tests verwenden die tatsächlichen Freigabe-, Konto-, Worker- und
  Providerjournal-Funktionen mit synthetischen Mediennachweisen. Beide Portale,
  Mandantentrennung, Wiederholung, veränderte Bindung, nachträgliche Auffälligkeiten
  und die weiterhin nötige Operatorfreigabe sind abgedeckt.
- Keine echte Kundenselbstauskunft oder Veröffentlichung wurde ausgeführt.

Die Assistenzsichtung des vorhandenen 10-s-Originals ist seit PR #117 erledigt;
sie ist keine persönliche Kundenerklärung. Die konkrete Vorbereitung der
Provider-/Coverabnahme samt separat geprüftem 3-s-Export, passendem Testtext und
noch fehlenden Nachweisen steht in
[PROVIDER_COVER_ACCEPTANCE.md](PROVIDER_COVER_ACCEPTANCE.md).
Der Kurzexport braucht eigene gebundene Nachweise; eine Uploadfreigabe allein
genügt dafür noch nicht. Zusätzliche Analysewerkzeuge bleiben bis zur Finanzierung
vertagt; die Selbstauskunft darf nicht als automatische Vollanalyse beworben werden.
