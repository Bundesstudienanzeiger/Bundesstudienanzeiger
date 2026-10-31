// Datenimport für den Bundesstudienanzeiger - Onkologie
//
// Holt interventionelle onkologische Studien aus ClinicalTrials.gov und dem
// europäischen Register CTIS, normalisiert sie, führt Dubletten zusammen,
// verortet die deutschen Zentren über die PLZ-Tabelle und schreibt zwei
// Datendateien nach data/.
//
// Lauf: node scripts/import.mjs            (vollständiger Lauf)
//       node scripts/import.mjs --schnell  (nur ClinicalTrials.gov, zum Testen)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const WURZEL = process.cwd();
const DATEN = path.join(WURZEL, 'public', 'data');
const SCHNELL = process.argv.includes('--schnell');

/* ------------------------------------------------------------------ */
/* Tumorentitäten                                                      */
/* ------------------------------------------------------------------ */

const ENTITAETEN = [
  { key: 'mammakarzinom', label: 'Mammakarzinom', suche: 'breast cancer', begriffe: ['breast cancer', 'breast carcinoma', 'mammary carcinoma'] },
  { key: 'prostatakarzinom', label: 'Prostatakarzinom', suche: 'prostate cancer', begriffe: ['prostate cancer', 'prostate carcinoma', 'prostatic'] },
  { key: 'lungenkarzinom', label: 'Lungenkarzinom', suche: 'lung cancer', begriffe: ['lung cancer', 'lung carcinoma', 'nsclc', 'sclc', 'pulmonary carcinoma'] },
  { key: 'kolorektales-karzinom', label: 'Kolorektales Karzinom', suche: 'colorectal cancer', begriffe: ['colorectal', 'colon cancer', 'rectal cancer', 'colon carcinoma'] },
  { key: 'hautmelanom', label: 'Hautmelanom', suche: 'melanoma', begriffe: ['melanoma'] },
  { key: 'harnblasenkarzinom', label: 'Harnblasenkarzinom', suche: 'bladder cancer', begriffe: ['bladder cancer', 'bladder carcinoma', 'urothelial carcinoma'] },
  { key: 'nierenzellkarzinom', label: 'Nierenzellkarzinom', suche: 'renal cell carcinoma', begriffe: ['renal cell', 'kidney cancer', 'renal carcinoma'] },
  { key: 'pankreaskarzinom', label: 'Pankreaskarzinom', suche: 'pancreatic cancer', begriffe: ['pancreatic', 'pancreas carcinoma'] },
  { key: 'magenkarzinom', label: 'Magenkarzinom', suche: 'stomach cancer', begriffe: ['stomach cancer', 'gastric cancer', 'gastric carcinoma', 'gastroesophageal'] },
  { key: 'leberkarzinom', label: 'Leberkarzinom', suche: 'hepatocellular carcinoma', begriffe: ['hepatocellular', 'liver cancer', 'liver carcinoma'] },
  { key: 'endometriumkarzinom', label: 'Endometriumkarzinom', suche: 'endometrial cancer', begriffe: ['endometrial', 'endometrium', 'uterine corpus', 'corpus uteri'] },
  { key: 'zervixkarzinom', label: 'Zervixkarzinom', suche: 'uterine cervical cancer', begriffe: ['cervical cancer', 'cervix cancer', 'uterine cervical', 'cervical carcinoma', 'cervix uteri'] },
  { key: 'ovarialkarzinom', label: 'Ovarialkarzinom', suche: 'ovarian cancer', begriffe: ['ovarian cancer', 'ovarian carcinoma', 'ovary carcinoma'] },
  { key: 'schilddruesenkarzinom', label: 'Schilddrüsenkarzinom', suche: 'thyroid cancer', begriffe: ['thyroid cancer', 'thyroid carcinoma'] },
  { key: 'kopf-hals-karzinom', label: 'Kopf-Hals-Karzinom', suche: 'head and neck cancer', begriffe: ['head and neck', 'head neck', 'oral cavity', 'oropharyn', 'laryn', 'hypopharyn', 'nasopharyn'] },
  { key: 'oesophaguskarzinom', label: 'Ösophaguskarzinom', suche: 'esophageal cancer', begriffe: ['esophageal', 'oesophageal', 'esophagus carcinoma'] },
  { key: 'non-hodgkin-lymphom', label: 'Non-Hodgkin-Lymphom', suche: 'non-hodgkin lymphoma', begriffe: ['non-hodgkin', 'non hodgkin', 'b-cell lymphoma', 't-cell lymphoma', 'follicular lymphoma'] },
  { key: 'leukaemien', label: 'Leukämien', suche: 'leukemia', begriffe: ['leukemia', 'leukaemia'] },
  { key: 'multiples-myelom', label: 'Multiples Myelom', suche: 'multiple myeloma', begriffe: ['myeloma'] },
  { key: 'hirntumoren', label: 'Hirntumoren', suche: 'brain cancer', begriffe: ['brain cancer', 'brain tumor', 'brain tumour', 'glioma', 'glioblastoma'] },
];

/* Begriffe, die beim Zervixkarzinom auf nicht-gynäkologische Verwendung deuten */
const ZERVIX_AUS = ['cervical spine', 'cervical verte', 'cervical spinal', 'cervical stiffness', 'cervical lymph node', 'cervical esoph', 'cervical oesoph'];

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function text(wert) {
  if (wert === null || wert === undefined) return '';
  if (typeof wert === 'string') return wert.trim();
  if (typeof wert === 'number' || typeof wert === 'boolean') return String(wert);
  if (Array.isArray(wert)) {
    for (const w of wert) { const t = text(w); if (t) return t; }
    return '';
  }
  if (typeof wert === 'object') {
    for (const k of ['en', 'english', 'value', 'name', 'label', 'text', 'title', 'description', 'oneLine']) {
      const t = text(wert[k]); if (t) return t;
    }
    const at = text(wert.attributeTranslation); if (at) return at;
    for (const w of Object.values(wert)) { const t = text(w); if (t) return t; }
  }
  return '';
}

function entitaetenFuer(...texte) {
  const heu = texte.filter(Boolean).join(' ').toLowerCase();
  const treffer = [];
  for (const e of ENTITAETEN) {
    if (!e.begriffe.some((b) => heu.includes(b))) continue;
    // Zusätzliche Prüfung beim Zervixkarzinom
    if (e.key === 'zervixkarzinom') {
      const gynaekologisch = ['cervical cancer', 'cervix cancer', 'uterine cervical', 'cervical carcinoma', 'cervix uteri'];
      if (ZERVIX_AUS.some((b) => heu.includes(b)) && !gynaekologisch.some((b) => heu.includes(b))) continue;
    }
    treffer.push(e.key);
  }
  return treffer;
}

function ortAusAdresse(adresse) {
  const teile = String(adresse || '').split(',').map((t) => t.trim()).filter(Boolean);
  if (teile.length >= 2) return teile[teile.length - 2].replace(/^\d{5}\s*/, '');
  return '';
}

function plzAusAdresse(adresse) {
  const m = /\b(\d{5})\b/.exec(String(adresse || ''));
  return m ? m[1] : '';
}

/** Postleitzahl aus beliebigen Schreibweisen auf fünf Ziffern bringen. */
function plzNormieren(wert) {
  const t = String(wert || '').trim();
  if (!t) return '';
  let m = /\b(\d{5})\b/.exec(t);
  if (m) return m[1];
  m = /(?:^|\D)(\d{5})(?:\D|$)/.exec(t);
  if (m) return m[1];
  m = /(?:^|\D)(\d{4})(?:\D|$)/.exec(t);
  if (m) return '0' + m[1];
  m = /(?:^|\D)(\d{3})(?:\D|$)/.exec(t);
  if (m) return '00' + m[1];
  return '';
}

/* ------------------------------------------------------------------ */
/* PLZ-Verzeichnis                                                     */
/* ------------------------------------------------------------------ */

async function ladePlz() {
  const datei = path.join(DATEN, 'plz-de.json');
  if (!existsSync(datei)) throw new Error('public/data/plz-de.json fehlt. Bitte die PLZ-Datei ins Repository legen.');
  const inhalt = JSON.parse(await readFile(datei, 'utf8'));
  return inhalt.koordinaten || {};
}

/** Liegt der Punkt in Deutschland? */
function inDeutschland(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 47 && lat <= 56 && lon >= 5 && lon <= 16;
}

/** Merkt sich pro Stadt einen bereits ermittelten Punkt. */
const ortsPunkt = new Map();

function verorte(zentrum, plzTabelle) {
  const plz = plzNormieren(zentrum.plz) || plzNormieren(zentrum.adresse);
  if (plz && plzTabelle[plz]) {
    const [lat, lon] = plzTabelle[plz];
    if (inDeutschland(lat, lon)) {
      const stadt = String(zentrum.stadt || '').trim().toLowerCase();
      if (stadt && !ortsPunkt.has(stadt)) ortsPunkt.set(stadt, { lat, lon });
      return { lat, lon, genauigkeit: 'PLZ' };
    }
  }
  // Rückfall: derselbe Ort wurde bei einem anderen Zentrum schon verortet
  const stadt = String(zentrum.stadt || '').trim().toLowerCase();
  if (stadt && ortsPunkt.has(stadt)) {
    const p = ortsPunkt.get(stadt);
    return { lat: p.lat, lon: p.lon, genauigkeit: 'Ort' };
  }
  return { lat: null, lon: null, genauigkeit: 'unbekannt' };
}

/* ------------------------------------------------------------------ */
/* ClinicalTrials.gov                                                  */
/* ------------------------------------------------------------------ */

async function ladeNct(entitaet) {
  const ergebnisse = [];
  let token = null;
  let seite = 0;
  do {
    const p = new URLSearchParams({
      'query.cond': entitaet.suche,
      'query.locn': 'Germany',
      'filter.overallStatus': 'RECRUITING,NOT_YET_RECRUITING',
      'filter.advanced': 'AREA[StudyType](INTERVENTIONAL) AND (AREA[Phase](PHASE2) OR AREA[Phase](PHASE3))',
      pageSize: '100',
      format: 'json',
    });
    if (token) p.set('pageToken', token);
    const r = await fetch('https://clinicaltrials.gov/api/v2/studies?' + p.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('ClinicalTrials.gov HTTP ' + r.status);
    const j = await r.json();
    ergebnisse.push(...(j.studies || []));
    token = j.nextPageToken || null;
    seite++;
    if (token) await schlaf(500);
  } while (token && seite < 10);
  return ergebnisse;
}

function nctStudie(rohdaten, plzTabelle) {
  const p = rohdaten.protocolSection || {};
  const d = p.designModule || {};
  const phasen = d.phases || [];
  const status = p.statusModule && p.statusModule.overallStatus;
  const orte = ((p.contactsLocationsModule && p.contactsLocationsModule.locations) || []).filter((x) => /^(Germany|Deutschland)$/i.test(x.country || ''));

  if (d.studyType !== 'INTERVENTIONAL') return null;
  if (!(phasen.includes('PHASE2') || phasen.includes('PHASE3'))) return null;
  if (phasen.includes('PHASE4')) return null;
  if (!['RECRUITING', 'NOT_YET_RECRUITING'].includes(status)) return null;
  if (!orte.length) return null;

  const kennung = p.identificationModule && p.identificationModule.nctId;
  if (!kennung) return null;

  const bedingungen = (p.conditionsModule && p.conditionsModule.conditions) || [];
  const schlagworte = (p.conditionsModule && p.conditionsModule.keywords) || [];
  const titel = (p.identificationModule && p.identificationModule.briefTitle) || 'Ohne Titel';

  const zentren = orte.map((o) => {
    const geo = o.geoPoint || {};
    const glat = Number(geo.lat);
    const glon = Number(geo.lon);
    const punkt = { plz: String(o.zip || ''), stadt: o.city || '', adresse: [o.facility, o.city, o.zip, o.country].filter(Boolean).join(', '), name: o.facility || 'Studienzentrum', kontakt: '', email: '', telefon: '', abteilung: '', status: o.status || '' };
    // Zuerst die PLZ-Tabelle, sonst die Registerkoordinate – aber nur innerhalb Deutschlands
    const pos = verorte(punkt, plzTabelle);
    if (pos.lat !== null) return { ...punkt, lat: pos.lat, lon: pos.lon, genauigkeit: pos.genauigkeit };
    if (glat !== 0 && glon !== 0 && inDeutschland(glat, glon)) return { ...punkt, lat: glat, lon: glon, genauigkeit: 'Register' };
    if (glat !== 0 && glon !== 0 && inDeutschland(glon, glat)) return { ...punkt, lat: glon, lon: glat, genauigkeit: 'Register' };
    return { ...punkt, lat: null, lon: null, genauigkeit: 'unbekannt' };
  });

  return {
    quellen: ['CTGOV'],
    nct: kennung,
    euct: '',
    titel,
    offiziellerTitel: (p.identificationModule && p.identificationModule.officialTitle) || '',
    phase: phasen.join(' / '),
    status,
    statusDeutsch: status,
    bedingungen,
    schlagworte,
    zwischensumme: (p.descriptionModule && p.descriptionModule.briefSummary) || '',
    beschreibung: (p.descriptionModule && p.descriptionDescription) || '',
    auftraggeber: (p.sponsorCollaboratorsModule && p.sponsorCollaboratorsModule.leadSponsor && p.sponsorCollaboratorsModule.leadSponsor.name) || '',
    einschluss: (p.eligibilityModule && p.eligibilityModule.eligibilityCriteria) || '',
    zentren,
    entitaeten: entitaetenFuer(titel, ...bedingungen, ...schlagworte),
    link: 'https://clinicaltrials.gov/study/' + kennung,
    aktualisiert: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* CTIS                                                                */
/* ------------------------------------------------------------------ */

async function ladeCtis(entitaet) {
  const ergebnisse = [];
  let seite = 1;
  let weiter = true;
  while (weiter && seite <= 5) {
    const body = {
      pagination: { page: seite, size: 100 },
      sort: { property: 'decisionDate', direction: 'DESC' },
      searchCriteria: {
        containAll: '', containAny: '', containNot: '',
        medicalCondition: entitaet.suche,
        status: [2, 3, 4],
        trialPhaseCode: [4, 5, 7, 8, 9, 10],
        msc: [276],
      },
    };
    const r = await fetch('https://euclinicaltrials.eu/ctis-public-api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('CTIS HTTP ' + r.status);
    const j = await r.json();
    ergebnisse.push(...(j.data || []));
    weiter = Boolean(j.pagination && j.pagination.nextPage);
    seite++;
    if (weiter) await schlaf(600);
  }
  return ergebnisse;
}

/** Sucht rekursiv alle Knoten, die wie ein Länderblock aussehen. */
function sammleLänderblöcke(knoten, tiefe = 0, raus = []) {
  if (!knoten || typeof knoten !== 'object' || tiefe > 12) return raus;
  if (Array.isArray(knoten)) {
    for (const e of knoten) sammleLänderblöcke(e, tiefe + 1, raus);
    return raus;
  }
  const name = text(knoten.mscName || knoten.countryName);
  if (name && Array.isArray(knoten.trialSites)) raus.push(knoten);
  for (const wert of Object.values(knoten)) {
    if (wert && typeof wert === 'object') sammleLänderblöcke(wert, tiefe + 1, raus);
  }
  return raus;
}

function ctisDeutschlandBlock(raw) {
  const blöcke = sammleLänderblöcke(raw);
  return blöcke.find((b) => /germany|deutschland/i.test(text(b.mscName || b.countryName))) || null;
}

/** Status für Deutschland aus den Anwendungsinformationen. */
function ctisDeutschlandStatus(raw) {
  const blöcke = sammleLänderblöcke(raw);
  const de = blöcke.find((b) => /germany|deutschland/i.test(text(b.mscName || b.countryName)));
  if (!de) return '';
  const status = text(de.trialStatus) || text(de.currentStatus) || text(de.recruitmentStatus) || text(de.status);
  if (status) return status;
  const verlauf = de.ctStatuses || de.statusHistory || [];
  if (Array.isArray(verlauf) && verlauf.length) return text(verlauf[verlauf.length - 1].trialStatus);
  return '';
}

function ctisZentren(raw) {
  const de = ctisDeutschlandBlock(raw);
  if (!de) return [];
  const listen = [de.trialSites, de.sites, de.siteList].filter(Array.isArray);
  const raus = [];
  const gesehen = new Set();
  for (const liste of listen) {
    for (const s of liste) {
      const info = s.organisationAddressInfo || {};
      const org = info.organisation || {};
      const adresse = info.address || {};
      const person = s.personInfo || {};
      if (!/germany|deutschland/i.test(text(adresse.countryName || adresse.country))) continue;
      const strasse = text(adresse.oneLine) || [text(adresse.addressLine1), text(adresse.addressLine2)].filter(Boolean).join(', ');
      const stadt = text(adresse.city);
      const plz = text(adresse.postcode);
      const name = text(org.name) || 'Studienzentrum';
      const schluessel = [name, plz, stadt].join('|').toLowerCase();
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      raus.push({
        name, plz, stadt, strasse,
        adresse: [strasse, [plz, stadt].filter(Boolean).join(' '), text(adresse.countryName)].filter(Boolean).join(', '),
        kontakt: [text(person.firstName), text(person.lastName)].filter(Boolean).join(' '),
        email: text(person.email) || text(info.email),
        telefon: text(person.telephone) || text(info.phone),
        abteilung: text(s.departmentName) || text(info.departmentName),
        omsId: text(org.businessKey) || text(s.businessKey),
        status: '',
      });
    }
  }
  return raus;
}

function ctisPhase(raw) {
  const p1 = (raw.authorizedApplication && raw.authorizedApplication.authorizedPartI) || {};
  const det = p1.trialDetails || raw.trialDetails || {};
  const kat = (det.trialInformation && det.trialInformation.trialCategory) || det.trialCategory || {};
  const karte = { 4: 'PHASE2', 5: 'PHASE3', 7: 'PHASE1/PHASE2', 8: 'PHASE1/PHASE2', 9: 'PHASE1/PHASE2', 10: 'PHASE2/PHASE3' };
  return karte[Number(kat.trialPhase)] || '';
}

function ctisStudie(rohzeile, rohdaten, plzTabelle) {
  const p1 = (rohdaten.authorizedApplication && rohdaten.authorizedApplication.authorizedPartI) || {};
  const det = p1.trialDetails || rohdaten.trialDetails || {};
  const ids = det.clinicalTrialIdentifiers || {};
  const de = ctisDeutschlandBlock(rohdaten);
  const statusDeutsch = ctisDeutschlandStatus(rohdaten);
  const nctRoh = JSON.stringify(ids.secondaryIdentifyingNumbers || {});
  const nctTreffer = /NCT\d+/i.exec(nctRoh);

  const zentren = ctisZentren(rohdaten).map((z) => {
    const pos = verorte(z, plzTabelle);
    if (pos.lat === null) return { ...z, lat: null, lon: null, genauigkeit: 'unbekannt' };
    return { ...z, lat: pos.lat, lon: pos.lon, genauigkeit: pos.genauigkeit };
  });

  const titel = text(ids.fullTitle) || text(ids.fullTitleTranslations) || text(rohzeile && rohzeile.ctTitle) || 'Ohne Titel';
  const bedingungen = (function () {
    const block = det.conditions || (det.trialInformation && det.trialInformation.conditions);
    const liste = Array.isArray(block) ? block : (block ? [block] : []);
    return liste.map((c) => text((c && (c.conditionName || c.meddraTerm || c.termName)) || c)).filter(Boolean);
  })();

  return {
    quellen: ['CTIS'],
    nct: nctTreffer ? nctTreffer[0].toUpperCase() : '',
    euct: text(rohdaten.ctNumber) || text(rohzeile && rohzeile.ctNumber),
    titel,
    offiziellerTitel: titel,
    phase: ctisPhase(rohdaten),
    status: statusDeutsch || 'Authorised, recruiting',
    statusDeutsch,
    bedingungen,
    schlagworte: [],
    zwischensumme: '',
    beschreibung: text((det.trialInformation && det.trialInformation.trialObjective && det.trialInformation.trialObjective.mainObjectives) || ''),
    auftraggeber: text(ids.sponsorName) || text(p1.sponsorName),
    einschluss: '',
    zentren,
    entitaeten: entitaetenFuer(titel, ...bedingungen),
    link: 'https://euclinicaltrials.eu/ctis-public/view/' + (text(rohdaten.ctNumber) || ''),
    aktualisiert: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Hauptlauf                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  await mkdir(DATEN, { recursive: true });
  const plzTabelle = await ladePlz();
  console.log('PLZ-Verzeichnis geladen:', Object.keys(plzTabelle).length, 'Einträge');

  const alleStudien = new Map();
  const nachNct = new Map();
  const fehler = [];

  for (const entitaet of ENTITAETEN) {
    console.log('— ' + entitaet.label);

    // ClinicalTrials.gov
    try {
      const rohdaten = await ladeNct(entitaet);
      let uebernommen = 0;
      for (const r of rohdaten) {
        const s = nctStudie(r, plzTabelle);
        if (!s) continue;
        if (!s.entitaeten.length) s.entitaeten = [entitaet.key];
        if (!s.entitaeten.includes(entitaet.key)) continue;
        if (alleStudien.has(s.nct)) continue;
        alleStudien.set(s.nct, s);
        nachNct.set(s.nct.toUpperCase(), s);
        uebernommen++;
      }
      console.log('  ClinicalTrials.gov:', rohdaten.length, 'Treffer,', uebernommen, 'übernommen');
      await schlaf(400);
    } catch (e) {
      fehler.push({ quelle: 'CTGOV', entitaet: entitaet.key, meldung: String(e) });
      console.log('  ClinicalTrials.gov Fehler:', String(e));
    }

    // CTIS
    if (!SCHNELL) {
      try {
        const zeilen = await ladeCtis(entitaet);
        let uebernommen = 0;
        let ohneDetails = 0;
        for (const z of zeilen) {
          const nummer = text(z.ctNumber);
          if (!nummer) continue;
          if (alleStudien.has(nummer)) continue;
          try {
            const r = await fetch('https://euclinicaltrials.eu/ctis-public-api/retrieve/' + encodeURIComponent(nummer), { headers: { Accept: 'application/json' } });
            if (!r.ok) { ohneDetails++; continue; }
            const roh = await r.json();
            if (!roh || !roh.ctNumber) { ohneDetails++; continue; }
            const s = ctisStudie(z, roh, plzTabelle);
            if (!s.entitaeten.length) s.entitaeten = [entitaet.key];
            if (!s.entitaeten.includes(entitaet.key)) continue;
            // Dublettenabgleich: gleiche NCT-Nummer bereits vorhanden?
            if (s.nct && nachNct.has(s.nct.toUpperCase())) {
              const vorhandene = nachNct.get(s.nct.toUpperCase());
              if (!vorhandene.euct) vorhandene.euct = s.euct;
              if (!vorhandene.quellen.includes('CTIS')) vorhandene.quellen.push('CTIS');
              continue;
            }
            alleStudien.set(nummer, s);
            if (s.nct) nachNct.set(s.nct.toUpperCase(), s);
            uebernommen++;
          } catch (e) {
            ohneDetails++;
          }
          await schlaf(350);
        }
        console.log('  CTIS:', zeilen.length, 'Treffer,', uebernommen, 'übernommen,', ohneDetails, 'ohne Detaildaten');
        await schlaf(400);
      } catch (e) {
        fehler.push({ quelle: 'CTIS', entitaet: entitaet.key, meldung: String(e) });
        console.log('  CTIS Fehler:', String(e));
      }
    }
  }

  // Nach Entität gruppieren
  const nachEntitaet = {};
  for (const e of ENTITAETEN) nachEntitaet[e.key] = [];
  for (const s of alleStudien.values()) {
    for (const key of s.entitaeten) {
      if (nachEntitaet[key]) nachEntitaet[key].push(s.nct || s.euct || '');
    }
  }

  const alleZentren = [];
  for (const s of alleStudien.values()) {
    for (const z of s.zentren) {
      if (z.lat === null || z.lat === 0) continue;
      alleZentren.push({ name: z.name, stadt: z.stadt, plz: z.plz, lat: z.lat, lon: z.lon, studie: s.nct || s.euct || '' });
    }
  }

  const studies = {
    stand: new Date().toISOString(),
    anzahl: alleStudien.size,
    entitaeten: ENTITAETEN.map((e) => ({ key: e.key, label: e.label })),
    nachEntitaet,
    studien: Object.fromEntries(alleStudien),
    fehler,
  };

  const sites = {
    stand: new Date().toISOString(),
    anzahl: alleZentren.length,
    zentren: alleZentren,
  };

  await writeFile(path.join(DATEN, 'studies.json'), JSON.stringify(studies), 'utf8');

  // Kleine Prüfübersicht für den schnellen Blick
  const uebersicht = {
    stand: studies.stand,
    anzahl: alleStudien.size,
    zentren: alleZentren.length,
    fehler: fehler.length,
    proEntitaet: ENTITAETEN.map((e) => ({ key: e.key, label: e.label, anzahl: nachEntitaet[e.key].length })),
    ersteKennungen: {},
  };
  const beispiel = Object.keys(studies.studien).slice(0, 3);
  for (const k of beispiel) {
    const s = studies.studien[k];
    uebersicht.ersteKennungen[k] = {
      titel: (s.titel || '').slice(0, 80),
      entitaeten: s.entitaeten,
      quellen: s.quellen,
      zentren: (s.zentren || []).length,
    };
  }
  await writeFile(path.join(DATEN, 'uebersicht.json'), JSON.stringify(uebersicht, null, 2), 'utf8');
  await writeFile(path.join(DATEN, 'sites.json'), JSON.stringify(sites), 'utf8');

  console.log('');
  console.log('Fertig.');
  console.log('  Studien:', alleStudien.size);
  console.log('  Zentren mit Koordinaten:', alleZentren.length);
  console.log('  Fehler:', fehler.length);
  for (const e of ENTITAETEN) console.log('   ', e.label + ':', nachEntitaet[e.key].length);
}

main().catch((e) => {
  console.error('Abbruch:', e);
  process.exit(1);
});
