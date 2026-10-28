// Prüfstufe: kontrolliert den Datenimport, bevor etwas veröffentlicht wird.
//
// Lauf: node scripts/validate.mjs
//
// Bricht mit Fehlercode ab, wenn der Datenstand nicht veröffentlicht werden darf.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DATEN = path.join(process.cwd(), 'public', 'data');
const fehler = [];
const warnungen = [];

function pruefe(bedingung, meldung) {
  if (!bedingung) fehler.push(meldung);
}

function warne(bedingung, meldung) {
  if (!bedingung) warnungen.push(meldung);
}

async function lies(name) {
  const datei = path.join(DATEN, name);
  if (!existsSync(datei)) return null;
  return JSON.parse(await readFile(datei, 'utf8'));
}

async function main() {
  const studies = await lies('studies.json');
  const sites = await lies('sites.json');
  const plz = await lies('plz-de.json');

  /* ---------- Grundstruktur ---------- */
  pruefe(studies !== null, 'public/data/studies.json fehlt');
  pruefe(sites !== null, 'public/data/sites.json fehlt');
  pruefe(plz !== null, 'public/data/plz-de.json fehlt');
  if (!studies || !sites || !plz) return abschluss();

  pruefe(studies.stand, 'studies.json enthält keinen Datenstand');
  pruefe(typeof studies.anzahl === 'number', 'studies.json enthält keine Anzahl');
  pruefe(studies.studien && typeof studies.studien === 'object', 'studies.json enthält keine Studienliste');
  pruefe(Array.isArray(studies.entitaeten), 'studies.json enthält keine Entitätenliste');
  pruefe(studies.nachEntitaet && typeof studies.nachEntitaet === 'object', 'studies.json enthält keine Zuordnung nach Entität');

  /* ---------- PLZ-Verzeichnis ---------- */
  const plzAnzahl = Object.keys(plz.koordinaten || {}).length;
  pruefe(plzAnzahl > 7000, 'PLZ-Verzeichnis enthält weniger als 7000 Einträge (' + plzAnzahl + ')');

  /* ---------- Studienplausibilität ---------- */
  const alle = Object.values(studies.studien || {});
  pruefe(alle.length >= 100, 'Zu wenige Studien im Datenstand (' + alle.length + ')');
  pruefe(alle.length === studies.anzahl, 'Anzahl in studies.json stimmt nicht mit der Studienliste überein');

  let ohneKennung = 0;
  let ohneTitel = 0;
  let ohneEntitaet = 0;
  let ohneZentrum = 0;
  let doppelte = 0;
  const gesehen = new Set();

  for (const s of alle) {
    if (!s.nct && !s.euct) ohneKennung++;
    if (!s.titel || s.titel === 'Ohne Titel') ohneTitel++;
    if (!Array.isArray(s.entitaeten) || !s.entitaeten.length) ohneEntitaet++;
    if (!Array.isArray(s.zentren) || !s.zentren.length) ohneZentrum++;
    const schluessel = s.nct ? 'NCT:' + s.nct.toUpperCase() : 'CTIS:' + s.euct;
    if (gesehen.has(schluessel)) doppelte++;
    gesehen.add(schluessel);
  }

  pruefe(ohneKennung === 0, ohneKennung + ' Studien ohne Kennung');
  pruefe(ohneTitel === 0, ohneTitel + ' Studien ohne Titel');
  warne(ohneEntitaet === 0, ohneEntitaet + ' Studien ohne Tumorentität');
  warne(ohneZentrum === 0, ohneZentrum + ' Studien ohne deutsches Zentrum');
  pruefe(doppelte === 0, doppelte + ' doppelte Kennungen im Datenstand');

  /* ---------- Entitäten ---------- */
  const entitaeten = studies.entitaeten.map((e) => e.key);
  pruefe(entitaeten.length === 20, 'Es sind ' + entitaeten.length + ' Tumorentitäten hinterlegt, erwartet werden 20');
  for (const e of studies.entitaeten) {
    const liste = (studies.nachEntitaet || {})[e.key];
    pruefe(Array.isArray(liste), 'Zuordnung für ' + e.label + ' fehlt');
    if (Array.isArray(liste)) warne(liste.length > 0, 'Keine Studien für ' + e.label);
  }

  /* ---------- Verortung ---------- */
  const zentren = sites.zentren || [];
  pruefe(zentren.length > 0, 'sites.json enthält keine Zentren');
  pruefe(zentren.length === sites.anzahl, 'Anzahl in sites.json stimmt nicht mit der Zentrenliste überein');

  let ohneKoordinaten = 0;
  let ausserhalb = 0;
  for (const z of zentren) {
    if (!Number.isFinite(z.lat) || !Number.isFinite(z.lon)) { ohneKoordinaten++; continue; }
    // Deutschland liegt zwischen 47 und 56 Grad Nord sowie 5 und 16 Grad Ost
    if (z.lat < 47 || z.lat > 56 || z.lon < 5 || z.lon > 16) ausserhalb++;
  }
  pruefe(ohneKoordinaten === 0, ohneKoordinaten + ' Zentren ohne Koordinaten');
  pruefe(ausserhalb === 0, ausserhalb + ' Zentren liegen außerhalb Deutschlands');

  /* ---------- Stichprobe München und Kempten ---------- */
  const muenchen = zentren.filter((z) => /münchen|muenchen/i.test(z.stadt || ''));
  const kempten = zentren.filter((z) => /kempten/i.test(z.stadt || ''));
  if (muenchen.length) {
    const daneben = muenchen.filter((z) => !(z.lat > 48.0 && z.lat < 48.3 && z.lon > 11.3 && z.lon < 11.8));
    pruefe(daneben.length === 0, daneben.length + ' Münchner Zentren liegen außerhalb des Stadtgebiets');
  }
  if (kempten.length) {
    const daneben = kempten.filter((z) => !(z.lat > 47.6 && z.lat < 47.8 && z.lon > 10.2 && z.lon < 10.5));
    pruefe(daneben.length === 0, daneben.length + ' Kemptener Zentren liegen außerhalb des Stadtgebiets');
  }

  /* ---------- Quelle erreichbar ---------- */
  const stand = new Date(studies.stand || 0);
  const alterStunden = (Date.now() - stand.getTime()) / 36e5;
  warne(alterStunden < 72, 'Der Datenstand ist ' + Math.round(alterStunden) + ' Stunden alt');

  return abschluss();
}

function abschluss() {
  console.log('');
  if (warnungen.length) {
    console.log('Hinweise (' + warnungen.length + '):');
    for (const w of warnungen) console.log('  · ' + w);
  }
  if (fehler.length) {
    console.log('');
    console.log('FEHLER (' + fehler.length + '):');
    for (const f of fehler) console.log('  · ' + f);
    console.log('');
    console.log('Der Datenstand wird NICHT veröffentlicht.');
    process.exit(1);
  }
  console.log('Prüfung erfolgreich – der Datenstand kann veröffentlicht werden.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Abbruch der Prüfung:', e);
  process.exit(1);
});
