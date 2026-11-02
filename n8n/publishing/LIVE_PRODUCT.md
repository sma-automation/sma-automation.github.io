# SMA: Kundenprodukt zuerst, Serverumbau danach

Verbindliche Reihenfolge vom 2. November 2026: Die Kundenversion muss mit dem vorhandenen n8n Cloud, Supabase und den bestehenden Anbindungen funktionieren. Der spätere Serverbetrieb wird getrennt auf einer Workflow-Kopie vorbereitet. Er ist keine Voraussetzung für den Verkauf. Keine zusätzlichen Abonnements oder Tarifwechsel sind durch diese Umsetzung freigegeben.

## Aktiver Textverlauf

Die Migration `supabase/sql/publication-caption-history.sql` und der aktualisierte Textworkflow laufen im vorhandenen System. Neue Entwürfe erhalten maximal 20 eigene frühere Texte als Wiederholungsreferenz. Beim Speichern prüft die Datenbank gegen **alle gespeicherten Versionen desselben Kunden und Portals**, unter einer Transaktionssperre pro Kunde. Großschreibung, Unicode-Darstellungsvarianten, unsichtbare Formatzeichen, Satzzeichen, Emojis und sehr hohe Wortüberschneidung zählen nicht als neue Formulierung. Auch manuelle Änderungen und die Dateizuordnung benutzen diese Prüfung. Ein wiederholter Aufruf mit derselben Anfrage-ID liefert den vorhandenen Entwurf.

Der Verlauf enthält die bei Einführung vorhandenen Entwürfe und alle danach gespeicherten Versionen. Er rekonstruiert keine früher überschriebenen Texte und keine bisher extern veröffentlichten Posts. Der Vergleich ist eine Wiederholungsheuristik, keine vollständige semantische Prüfung. Gleichbleibende Medienbytes bleiben dieselbe Mediendatei.

Aktiver Workflow: `9dNstQ4E2uXpZ18Z`, veröffentlichte Version `d038ba64-d805-4d96-a6b3-2171bf3fe87e`. Exportierte Nodes, Verbindungen, Credential-Verweise und Einstellungen entsprechen exakt der eingecheckten Definition. Ausführungsdaten werden weiterhin nicht gespeichert; keine Testdaten angeheftet. Die geschützten Haupt- und Tagesworkflows wurden hierfür nicht verändert.

Validierung: 137 Node-Tests erfolgreich; SQL-Tests für Normalisierung, Ähnlichkeit, Transaktion, Bearbeitung, Versionsverlauf, gleiche Anfrage-ID und Benutzerzuordnung erfolgreich, ebenso bestehende Vorschau-Regressionen. SQL-Testdaten wurden zurückgerollt. Sicherheitsprüfung: keine zusätzlichen Warnungen; die neue private Tabelle ist absichtlich ohne Client-Policies und ohne direkte Lese-/Schreibrechte für Browserrollen.

## Verbindliche Fertigstellungskriterien

- **Magic Effect:** Tatsächliches Foto erkennen, sichtbare Inhalte und lesbaren Text erfassen, daraus passende Beschreibungen ableiten. Dateiname oder ein frei eingegebener Text ersetzen die Fotoanalyse nicht. Unsicherheiten bleiben sichtbar. Keine erfundenen Produkteigenschaften oder Preise.
- **Neue Veröffentlichung:** Eigene Identität und passende neue Formulierung; technische Wiederholung derselben Veröffentlichung verwendet denselben reservierten Stand. Der Entwurfsverlauf allein ersetzt noch kein Veröffentlichungsjournal.
- **Portalübergabe:** Konkreten Portal-Endpunkt und aktuellen Kontoumfang prüfen; alle dafür erforderlichen Medienparameter, Textfelder, Berechtigungen, Sichtbarkeitsentscheidungen und Kennzeichnungen übergeben. Fehlende notwendige Prüfungen sperren den neuen Freigabeweg. Upload und erfolgreiche Verarbeitung/Veröffentlichung sind getrennte Zustände.
- **Abnahme:** Den vollständigen Weg mit den vorhandenen Anbindungen prüfen. Fehler, veränderte Dateien, Zeitüberschreitungen und Wiederholungen dürfen weder ungeprüfte Freigaben noch Doppelpostings erzeugen.

Die Kundenversion ist noch nicht vollständig abgenommen: Magic Effect ist mit der Fotoquelle verbunden; sein vollständiger Kundendurchlauf muss noch bestätigt werden; OCR/Transkript/Inhaltsabgleich und der endgültige Übergang zu den Portal-Publishern müssen durchgängig nachgewiesen sein. Die getrennten lokalen Worker-Module sind dafür keine Live-Fertigmeldung. Alle neuen Vorbereitungsergebnisse bleiben bis zur vollständigen Freigabe `can_publish:false`.

Die dokumentierten Übertragungsanforderungen sind verbindlich. Eine vollständige Offenlegung oder garantierte Bevorzugung durch interne Empfehlungsalgorithmen wird nicht behauptet.

## Rückkehr zur bisherigen Textvorbereitung

Zuerst die vorherige n8n-Version `a239be17-7071-4e88-9de2-355e818b7e10` wiederherstellen. Bei Bedarf danach ausschließlich die beiden Caption-Trigger deaktivieren und die Definitionen von `publication_preview_request_v1` aus `publication-files.sql` sowie `sma_publication_preview_finish_v1` aus `publication-preview.sql` wiederherstellen. Die private Verlaufstabelle behalten; keine gespeicherten Texte löschen. Die bisherigen SQL-Dateien nicht pauschal erneut über alle bestehenden Funktionen ausführen.

Fotoerkennung, Grenzen und Live-Version: [Magic Effect](MAGIC_EFFECT.md).
# Automatische Dateiaktualisierung im Optimierer – 2. November 2026

Vor Magic Effect, dateibezogener Texterstellung und Speichern prüft das Dashboard den Zeitpunkt der letzten Dateiverifizierung. Ab 14 Minuten sowie bei fehlendem oder ungültigem Zeitstempel synchronisiert es den bestehenden Kundenordner über den authentifizierten n8n-Dateikatalog. Dabei werden keine Formulare oder gespeicherten Texte neu geladen: Eingaben bleiben erhalten. Die ausgewählte Datei muss anschließend dieselbe ID und Revision sowie dieselbe Zuordnungsrevision für das Portal haben. Entfernte oder geänderte Dateien und konkurrierende Textzuordnungen stoppen den Vorgang.

Die bestehende serverseitige 15-Minuten-Prüfung bleibt unverändert. Meldet sie trotz Vorprüfung `FILE_REFRESH_REQUIRED`, aktualisiert das Dashboard einmal und wiederholt genau die betroffene Erkennung oder Zuordnung/Speicherung. Ein bereits erstellter Text bleibt für eine Wiederholung seiner fehlgeschlagenen Dateizuordnung im geöffneten Editor erhalten; dafür wird kein zweiter Text generiert. Ein bewusst neu gestarteter Entwurf nach erfolgreicher Zuordnung bleibt eine neue Generierung. Abmeldung verhindert weitere Aktionen und die erneute Anzeige von Kundeninhalten.

Die Regressionstests verwenden isolierte Antworten für alte Dateistände, fehlende Dateien, Versionskonflikte, Wiederholungen und Abmeldung. Sie belegen keine echte Portalübertragung. Videoerkennung einschließlich Ton, die vollständige Medienfreigabe und der finale Veröffentlichungsablauf bleiben offene Arbeiten.
