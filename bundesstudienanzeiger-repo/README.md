# Bundesstudienanzeiger - Onkologie

Datenimport und Website für den Bundesstudienanzeiger.

## Aufbau

- `data/plz-de.json` – Postleitzahlverzeichnis mit Koordinaten (8.298 Einträge)
- `data/studies.json` – erzeugter Datenstand der Studien
- `data/sites.json` – erzeugter Datenstand der Studienzentren
- `scripts/import.mjs` – holt die Studien und erzeugt den Datenstand
- `scripts/validate.mjs` – prüft den Datenstand vor der Veröffentlichung
- `.github/workflows/update.yml` – täglicher Lauf um 03:20 UTC
- `public/index.html` – die Website

## Manuell ausführen

    node scripts/import.mjs
    node scripts/validate.mjs

Der Import lädt Studien aus ClinicalTrials.gov und dem Clinical Trials
Information System (CTIS), führt Dubletten zusammen und verortet die
deutschen Zentren über das Postleitzahlverzeichnis.
