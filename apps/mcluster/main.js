'use strict';
/**
 * M Cluster - the charge gauge, the drive-mode label, the electric range and a consumption widget the M layout leaves out.
 *
 *   charge  Efficiencytainment2.statusChargeOfBatteryHybrid.displayChargingConditionHighVoltageStorage
 *   mode    FES.statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience
 *   speed   Vehicle2.statusCarSpeed2 (distance, for the range estimate)
 *   power   the battery's kW, from the eDrive app (/tmp/mgu-edrive.json) while this app asks for it: kWh/100km = kW / speed
 *
 * The app's screen is one page with tabs, drawn by the kit (as Ambient config): M Cluster (switches and
 * what it reads now), Gauge, Label, Range, Consumption (each: on / off, arrows for the place, size), Colours (a colour
 * per drive mode, from a colour ring) and Profiles (three sets of all of it). Every value is a hidden
 * setting; the profile in use follows each change.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const gauge = require('./gauge');
const gauge2 = require('./gauge2');
const cluster = require('./cluster');
const cons = require('./cons');
const mfont = require('./mfont');

/* ---------- the drive modes ----------
 * key: the colour profile, main / sub: the label's two lines.
 */
const P = {
    ELECTRIC: { key: 'ELECTRIC', main: 'ELECTRIC', sub: '' },
    ELECTRIC_IND: { key: 'ELECTRIC_IND', main: 'ELECTRIC', sub: 'INDIVIDUAL' },
    HYBRID: { key: 'HYBRID', main: 'HYBRID', sub: '' },
    HYBRID_ECO: { key: 'HYBRID', main: 'HYBRID', sub: 'ECO' },
    BATTERY: { key: 'BATTERY', main: 'HYBRID', sub: 'BATTERY CONTROL' },
    SPORT: { key: 'SPORT', main: 'SPORT', sub: '' },
    SPORT_IND: { key: 'SPORT_IND', main: 'SPORT', sub: 'INDIVIDUAL' },
    BOOST: { key: 'BOOST', main: 'SPORT', sub: 'XTRABOOST' },
};
const other = (main, sub) => ({ key: 'OTHER', main: main, sub: sub || '' });
const MODES = {
    1: other('SPORT'), 2: other('SPORT', 'PLUS'), 3: other('SPORT'), 4: other('COMFORT'), 5: other('COMFORT', 'PLUS'),
    6: other('COMFORT'), 7: other('ECO PRO'), 8: other('ECO PRO', 'PLUS'), 9: other('ECO PRO'), 10: other('ADAPTIVE'),
    15: P.SPORT, 16: P.SPORT_IND, 17: P.HYBRID, 18: P.HYBRID_ECO, 19: P.HYBRID,
    20: P.ELECTRIC, 21: P.ELECTRIC_IND, 23: P.BOOST, 28: P.BOOST,
    PHEV_SPORT_STANDARD: P.SPORT, PHEV_SPORT_INDIVIDUAL: P.SPORT_IND, PHEV_SPORT_PLUS: P.BOOST,
    PHEV_HYBRID_STANDARD: P.HYBRID, PHEV_HYBRID_ECO: P.HYBRID_ECO, PHEV_HYBRID_COMFORT: P.HYBRID,
    PHEV_ELECTRIC_STANDARD: P.ELECTRIC, PHEV_ELECTRIC_INDIVIDUAL: P.ELECTRIC_IND, BOOST: P.BOOST,
};
function profileOf(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (MODES[raw]) return MODES[raw];
    const n = Number(raw);
    if (!isNaN(n) && MODES[n]) return MODES[n];
    if (n === 0 || (n >= 61 && n <= 63)) return null;
    const s = String(raw).toUpperCase();
    const ind = /INDIVIDUAL/.test(s);
    if (/BATTERY|CHARGE/.test(s)) return P.BATTERY;
    if (/BOOST/.test(s)) return P.BOOST;
    if (/ELECTRIC|ELEKTR/.test(s)) return ind ? P.ELECTRIC_IND : P.ELECTRIC;
    if (/HYBRID/.test(s)) return P.HYBRID;
    if (/SPORT/.test(s)) return ind ? P.SPORT_IND : P.SPORT;
    if (/ECO/.test(s)) return other('ECO PRO');
    if (/COMFORT|ADAPTIVE/.test(s)) return other('COMFORT');
    return other(s.slice(0, 14));
}

/* ---------- colours ---------- */
const PRESETS = [['BMW blue', '#2bb8ea'], ['Dark blue', '#1f5fbf'], ['White', '#e8f6ff'], ['Silver', '#b4b9bf'],
    ['Grey', '#7c8188'], ['M red', '#e0262a'], ['Green', '#3ad17a'], ['Orange', '#ff8a1f']];
const LEVEL_BAR = '#e0262a';                    // the level bar: always M red
const OLD_IDS = { bmw_blue: '#2bb8ea', dark_blue: '#1f5fbf', ice: '#e8f6ff', m_red: '#e0262a', green: '#3ad17a', orange: '#ff8a1f', purple: '#9b5cff' };
const profName = (n) => (n === 1 ? 'Default' : 'Profile ' + n);   // the first profile: the settings a release ships with
const PROFILES = ['ELECTRIC', 'ELECTRIC_IND', 'HYBRID', 'BATTERY', 'SPORT', 'SPORT_IND', 'BOOST', 'OTHER'];
const PROFILE_NAMES = { ELECTRIC: 'Electric', ELECTRIC_IND: 'Electric Indiv.', HYBRID: 'Hybrid', BATTERY: 'Battery Control',
    SPORT: 'Sport', SPORT_IND: 'Sport Indiv.', BOOST: 'XtraBoost', OTHER: 'Other' };
const hex2 = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
const rgbOf = (c) => { const m = /^#(..)(..)(..)$/.exec(c) || [0, '2b', 'b8', 'ea']; return [1, 2, 3].map((i) => parseInt(m[i], 16)); };
/** h 0-360, s and v 0-1 -> '#rrggbb'. */
function hsv(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = s === undefined ? 1 : Math.max(0, Math.min(1, s));
    v = v === undefined ? 1 : Math.max(0, Math.min(1, v));
    const x = 1 - Math.abs((h / 60) % 2 - 1), k = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h / 60) % 6];
    return '#' + k.map((c) => hex2((1 - s + s * c) * v * 255)).join('');
}
const satOf = (c) => { const v = rgbOf(c), mx = Math.max(...v), mn = Math.min(...v); return mx ? (mx - mn) / mx : 0; };
const valOf = (c) => Math.max(...rgbOf(c)) / 255;
function hueOf(c) {
    const [r, g, b] = rgbOf(c).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}
const nameOf = (c) => { const p = PRESETS.find((x) => x[1] === c); return p ? p[0] : 'Custom'; };

/* ---------- profiles: three sets of every layout and colour setting ---------- */
const KEYS = ['on', 'gauge', 'label', 'range', 'gaugeX', 'gaugeY', 'gaugeScale', 'gaugeDepth', 'gaugeBar', 'pctOn', 'pctSize', 'pctDX', 'pctDY', 'labelX', 'labelY', 'labelScale',
    'rangeX', 'rangeY', 'rangeScale', 'trip', 'tripX', 'tripY', 'tripScale', 'music', 'musicX', 'musicY', 'musicScale', 'musicText', 'music1X', 'music1Y', 'music1Scale', 'musicMoving', 'odoX', 'odoY', 'odoScale', 'gear', 'gearX', 'gearY', 'gearScale', 'units', 'lang', 'cons', 'consX', 'consY', 'consScale', 'consStyle', 'consText', 'gaugeFont', 'labelFont', 'rangeFont', 'consFont', 'tripFont', 'sportRed', 'gaugeStyle', 'ringX', 'ringY', 'ringScale', 'cellX', 'cellY', 'cellScale', 'stripesX', 'stripesY', 'stripesScale'].concat(PROFILES.map((k) => 'col_' + k));

/* ---------- the charge ---------- */
function walk(v, fn, p, depth) {
    if (v === null || v === undefined || (depth || 0) > 4) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, fn, (p || '') + '[' + i + ']', (depth || 0) + 1)); return; }
    if (typeof v === 'object') { Object.keys(v).forEach((k) => walk(v[k], fn, (p ? p + '.' : '') + k, (depth || 0) + 1)); return; }
    fn(v, p || '');
}
const CHARGE_FIELD = 'displayChargingConditionHighVoltageStorage';
const SCALES = { half: 0.5, whole: 1, byte: 100 / 254 };
function chargeOf(v, scale) {
    let raw = null;
    walk(v, (x, p) => { if (raw === null && typeof x === 'number' && p.indexOf(CHARGE_FIELD) >= 0) raw = x; });
    if (raw === null) walk(v, (x, p) => { if (raw === null && typeof x === 'number' && /charge|storage|soc/i.test(p)) raw = x; });
    if (raw === null || raw >= 254) return null;
    const pct = raw * (SCALES[scale] || SCALES.half);
    return { raw: raw, pct: pct < 0 || pct > 100 ? null : pct };
}

/* ---------- the range estimate ----------
 * Kilometres per percent of charge, learned while driving in an electric mode: each
 * time the charge falls by 2 %, the distance covered since is folded into a running
 * average and saved. Charging, or any stretch out of an electric mode, starts over.
 */
const RATE_DEFAULT = 0.42;                      // ~42 km on a full battery until it has learned
function rangeLearner(file, log) {
    let rate = RATE_DEFAULT, learned = 0, ext = false;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j.rate > 0) { rate = j.rate; learned = j.n || 0; ext = !!j.ext; } } catch (e) { /* first run */ }
    let dist = 0, lastT = 0, anchor = null;
    return {
        speed(kmh) {
            const now = Date.now();
            if (lastT && kmh !== null) dist += kmh * Math.min(2, (now - lastT) / 1000) / 3600;
            lastT = now;
        },
        /** The km per % eDrive works out from the past driving; it replaces our own estimate. */
        external(r) {
            if (!(r > 0.1 && r < 2)) return;
            if (ext && Math.abs(r - rate) < 0.003) return;
            rate = r; ext = true;
            try { fs.writeFileSync(file, JSON.stringify({ rate: rate, n: learned, ext: true })); } catch (e) { log.warn('range save: ' + e.message); }
            log.info('range: ' + rate.toFixed(3) + ' km/% from eDrive');
        },
        charge(soc, electric) {
            if (ext) return;
            if (anchor === null || soc > anchor.soc + 0.75 || !electric) { anchor = electric ? { soc: soc, dist: dist } : null; return; }
            if (anchor.soc - soc < 2) return;
            const d = dist - anchor.dist, r = d / (anchor.soc - soc);
            anchor = { soc: soc, dist: dist };
            if (d < 0.3 || !(r > 0)) return;
            rate = rate * 0.8 + Math.max(0.15, Math.min(1.2, r)) * 0.2;
            learned++;
            try { fs.writeFileSync(file, JSON.stringify({ rate: rate, n: learned })); } catch (e) { log.warn('range save: ' + e.message); }
            log.info('range: ' + r.toFixed(2) + ' km/% this stretch, ' + rate.toFixed(3) + ' km/% learned');
        },
        km: (soc) => soc * rate,
        rate: () => rate,
        learned: () => learned,
        fromEdrive: () => ext,
        reset() { rate = RATE_DEFAULT; learned = 0; ext = false; anchor = null; try { fs.unlinkSync(file); } catch (e) { /* none */ } },
    };
}

/**
 * Everything that runs without the screen: the car's signals, the range learning and the cluster layers.
 * app.json "autostart": the platform starts the app with the car, so this runs from then on; opening the
 * app adds its page on top (ctx.background).
 */
async function background(bg) {
    const { settings, log } = bg;
    const live = { tripE: null, bcAvg: null, rpm: null, trip: null, tripEst: null, carAvg: null, carRangeE: null, carRangeKey: null, kwGain: null, fus: null, prevNeedle: null, ac: 0, acT: 0, soc: null, socT: 0, socRaw: null, prof: null, modeRaw: null, speed: null, seen: {}, rel: null, cons: { value: null, avg: null, kw: null, src: null } };
    const range = rangeLearner(path.join(bg.dataDir || __dirname, 'range.json'), log);
    // findings kept in a file of their own (the app's log is cut short): pulled by the laptop's "logs"
    const DIAG = path.join(bg.dataDir || __dirname, 'mcluster_diag.txt');
    const diag = (line) => {
        try {
            let n = 0; try { n = fs.statSync(DIAG).size; } catch (e) { /* none yet */ }
            if (n > 400 * 1024) fs.writeFileSync(DIAG, '');
            fs.appendFileSync(DIAG, new Date().toISOString() + ' ' + line + '\n');
        } catch (e) { /* not writable */ }
    };
    try { diag('start ' + require('./app.json').version); } catch (e) { diag('start'); }

    /* ---------- what the trip in the iDrive's "values from" is: the car sends a date only ----------
     * No date: the factory (with km: the car's total) or the last charge (no km: none recorded). A date: matched
     * against what the app saw happen - a charge, a refuelling, a new trip begun as the car started (that date
     * turning up then, near the time it is); the newest date of the last day is taken for the trip start; any
     * other date is shown as it is. Times compared allowing whole hours (the head unit's clock may run in UTC).
     */
    const KFILE = path.join(bg.dataDir || __dirname, 'tripkinds.json');
    let kinds = { charges: [], refuels: [], starts: [], seen: {} };
    try { kinds = Object.assign(kinds, JSON.parse(fs.readFileSync(KFILE, 'utf8'))); } catch (e) { /* none yet */ }
    const appStart = Date.now();
    const saveKinds = () => {
        const old = Date.now() - 90 * 86400000;
        ['charges', 'refuels'].forEach((k) => { kinds[k] = kinds[k].filter((t) => t > old).slice(-20); });
        kinds.starts = kinds.starts.slice(-20);
        Object.keys(kinds.seen).forEach((k) => { if (kinds.seen[k] < old) delete kinds.seen[k]; });
        try { fs.writeFileSync(KFILE, JSON.stringify(kinds)); } catch (e) { /* not writable */ }
    };
    // a car date (local) and a time of ours: the same moment within tol ms, give or take whole hours of clock offset
    const near = (d, t, tol) => { for (let h = -14; h <= 14; h++) if (Math.abs(d + h * 3600000 - t) <= tol) return true; return false; };
    live.noteCharge = (why) => { kinds.charges.push(Date.now()); saveKinds(); diag('trip kinds: charge noted (' + why + ')'); };
    live.noteRefuel = (why) => { kinds.refuels.push(Date.now()); saveKinds(); diag('trip kinds: refuelling noted (' + why + ')'); };
    const pad2 = (n) => ('0' + n).slice(-2);
    // the words on the cluster: Greek or English (setting "lang")
    const W = (el, en) => (settings.get('lang') === 'el' ? el : en);
    live.tripKind = () => {
        const sd = live.tripDate;
        if (!sd) {
            if (live.tripDate === undefined) return null;
            return live.trip === null ? W('Φόρτιση', 'Charging') : W('Εργοστάσιο', 'Factory');
        }
        const key = [sd.y, sd.m, sd.d, sd.h, sd.min].join('-'), d = Date.UTC(sd.y, sd.m - 1, sd.d, sd.h, sd.min), now = Date.now();
        const date = pad2(sd.d) + '.' + pad2(sd.m) + '.' + sd.y;
        if (kinds.starts.indexOf(key) >= 0) return W('Έναρξη διαδρομής', 'Trip start');
        if (kinds.refuels.some((t) => near(d, t, 20 * 60000))) return W('Ανεφοδιασμός', 'Refuelling') + ' (' + date + ')';
        if (kinds.charges.some((t) => near(d, t, 4 * 3600000))) return W('Φόρτιση', 'Charging') + ' (' + date + ')';
        // the newest date seen, of the last day and a half: the trip begun last
        const keys = Object.keys(kinds.seen), stamp = (k) => { const a = k.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4]); };
        const newest = keys.length && keys.every((k) => stamp(k) <= d);
        if (newest && Math.abs(now - d) < 36 * 3600000) return W('Έναρξη διαδρομής', 'Trip start');
        return date;
    };
    // a date seen: a new one turning up in the car's first minutes, near the time it is, is a trip just begun
    live.noteTripDate = (sd) => {
        if (!sd) return;
        const key = [sd.y, sd.m, sd.d, sd.h, sd.min].join('-'), now = Date.now();
        const fresh = !kinds.seen[key];
        kinds.seen[key] = now;
        if (fresh && now - appStart < 5 * 60000 && near(Date.UTC(sd.y, sd.m - 1, sd.d, sd.h, sd.min), now, 10 * 60000) && kinds.starts.indexOf(key) < 0) {
            kinds.starts.push(key); diag('trip kinds: trip start ' + key);
        }
        if (fresh) saveKinds();
    };

    const t0 = Date.now();
    const demoOn = () => settings.get('demo') === 'on'
        || (settings.get('demo') === 'auto' && !live.socT && Date.now() - t0 > 5000);
    const DEMO = [P.ELECTRIC, P.HYBRID, P.SPORT, P.SPORT_IND, P.BOOST];
    const demoSoc = () => 72 - ((Date.now() - t0) / 1000 / 4) % 60;
    const demoProf = () => DEMO[Math.floor((Date.now() - t0) / 8000) % DEMO.length];

    // demo: a drive that goes up through the blue, stands, and then recovers into the green
    const demoCons = () => {
        const s = (Date.now() - t0) / 1000, w = Math.sin(s / 6);
        return { value: w >= 0 ? w * 38 : w * 24, avg: 12.6, unit: 'kwh' };
    };

    const colourOf = (key) => {
        const v = settings.get('col_' + key);
        if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
        return OLD_IDS[v] || '#2bb8ea';
    };

    /** What the cluster layers draw. */
    const state = () => {
        const demo = demoOn();
        const fresh = live.socT && Date.now() - live.socT < 120000;
        const soc = demo ? demoSoc() : fresh ? live.soc : null;
        const prof = demo ? demoProf() : live.prof;
        const key = prof ? prof.key : 'OTHER';
        const color = colourOf(key);
        const electric = /^ELECTRIC/.test(key);
        // SPORT in M red when asked: the mode word, and XTRABOOST under it; INDIVIDUAL stays as it is
        const sportRed = settings.get('sportRed') === true && /^(SPORT|SPORT_IND|BOOST)$/.test(key);
        return {
            demo: demo, soc: soc, known: soc !== null,
            main: prof ? prof.main : '', sub: prof ? prof.sub : '',
            color: color, key: key,
            arrow: LEVEL_BAR,
            labelColor: electric ? color : sportRed ? LEVEL_BAR : '#f2f5f7',
            subColor: sportRed && key === 'BOOST' ? LEVEL_BAR : null,
            // the car's own electric range when it gives one (as the stock cluster), else the km per % worked out
            range: settings.get('range') !== false ? (live.carRangeE !== null && !demo ? live.carRangeE : soc !== null ? range.km(soc) : null) : null,
            cons: demo ? demoCons() : { value: live.cons.value, avg: live.cons.src === 'fuel' ? live.cons.avg : live.carAvg !== null ? live.carAvg : live.cons.avg, unit: live.cons.unit },
            trip: demo ? 3.6 : live.ekm,             // the electric km since the last charge (own count, reset by a charge)
            page: demo ? 0 : settings.get('music') === false ? (live.bcPage === 3 ? 3 : 0) : live.bcPage,
            odo: {                                     // the total and trip km page (3)
                total: live.odo,
                trip: live.trip === null && live.tripFactory ? live.odo : live.tripEst !== null ? live.tripEst : live.trip,
                from: live.tripKind(),                         // the trip chosen in the iDrive: factory, charge, trip start, refuelling, or its date
            },   // the knob tilted down: 0 consumption + trip, 1 the song in their place, 2 the song + the consumption
            gear: live.gear || null,                 // { text: 'D3', manual, raw } once the car's gear signal is wired
            moving: live.moving !== false,           // false after 3 s standing, true again from 3 km/h
            song: live.song,                               // { title, artist, duration, position, at, playing } or null
            art: live.art,                                 // the cover: { id, w, h, d } or null
        };
    };

    /* ---------- the car's signals ---------- */
    const once = (name, v) => {
        if (live.seen[name]) return;
        live.seen[name] = true;
        try { log.info(name + ' first reading: ' + JSON.stringify(v)); } catch (e) { /* circular */ }
    };
    bg.signals.watch('de.bmw.infotainment.drivingexcitement.Efficiencytainment2', '1', {
        statusChargeOfBatteryHybrid: (v) => {
            once('charge', v);
            const hit = chargeOf(v, settings.get('chargeScale'));
            if (!hit) return;
            live.socRaw = hit.raw;
            if (hit.pct !== null) {
                live.soc = hit.pct; live.socT = Date.now();
                range.charge(hit.pct, !!(live.prof && /^ELECTRIC/.test(live.prof.key)));
            }
        },
    }, log, { pollMs: 5000 }).then((s) => log.info('charge ' + (s.error ? 'error: ' + s.error : 'subscribed')));

    // the eDRIVE needle: how much of the electric drive / recuperation is used now, in percent (0 when parked); read fast
    bg.signals.watch('de.bmw.infotainment.drivingexcitement.Efficiencytainment2', '1', {
        statusPowerRelativHybrid: (v) => {
            once('power', v);
            const num = (k) => (v && typeof v[k] === 'number' ? Math.max(0, Math.min(100, v[k])) : null);
            const d = num('displayActualValuePowerRelativeDrivingElectric'), r = num('displayActualValuePowerRelativeRecuperation');
            if (d !== null || r !== null) live.rel = { drive: d || 0, recup: r || 0, t: Date.now() };
        },
    }, log, { pollMs: 50 }).then((s) => log.info('needle ' + (s.error ? 'error: ' + s.error : 'subscribed')));

    // the A/C compressor (W in the raw value, as eDrive reads it): part of the power while standing
    bg.signals.watch('de.bmw.infotainment.climate.Climate2', '1', {
        statusActualValuePowerACCompressor: (v) => {
            once('compressor', v);
            let r = v && v.actualValuePowerACCompressor;
            if (r === undefined && v && typeof v === 'object') walk(v, (x, p) => { if (r === undefined && /PowerACCompressor/i.test(p)) r = x; });
            live.ac = typeof r === 'number' && r !== 65535 ? Math.max(0, Math.min(8, r * 0.001)) : 0;
            live.acT = Date.now();
        },
    }, log, { pollMs: 1000 }).then((s) => log.info('compressor ' + (s.error ? 'error: ' + s.error : 'subscribed')));

    /* ---------- the electric km since the last charge ----------
     * The car gives apps no electric distance, so it is counted here: the distance driven with the engine
     * stopped (speed x time while the engine speed is under 300 rpm). Kept on file with the charge level; a
     * charge (the level up 3 points or more while standing, or since the last run: the car is off while it
     * charges) starts it again at 0.
     */
    {
        const EFILE = path.join(bg.dataDir || __dirname, 'ekm.json');
        let ek = { km: 0, soc: null, t: 0 };
        try { const j = JSON.parse(fs.readFileSync(EFILE, 'utf8')); if (typeof j.km === 'number' && j.km >= 0) ek = j; } catch (e) { /* none yet */ }
        live.ekm = ek.km;
        let base = null, checked = false, lastT = 0, savedTxt = '', savedT = 0;
        const reset = (why) => { log.info('electric km reset (' + why + ') at ' + ek.km.toFixed(1) + ' km'); ek.km = 0; live.ekm = 0; };
        setInterval(() => {
            const now = Date.now(), dt = lastT ? Math.min(1, (now - lastT) / 1000) : 0;
            lastT = now;
            const soc = live.soc !== null && now - live.socT < 30000 ? live.soc : null, v = live.speed || 0;
            if (soc !== null) {
                // charged while the app was off (the car stays off while it charges)
                if (!checked) { checked = true; if (typeof ek.soc === 'number' && soc >= ek.soc + 3) { reset('charged while off: ' + ek.soc.toFixed(1) + ' -> ' + soc.toFixed(1) + ' %'); live.noteCharge('while off'); } }
                // charged while the app runs: the level up 3 points with the car standing
                if (v > 2 || base === null) base = soc; else if (soc < base) base = soc;
                if (v < 1 && soc >= base + 3) { reset('charged: ' + base.toFixed(1) + ' -> ' + soc.toFixed(1) + ' %'); base = soc; live.noteCharge('while on'); }
                ek.soc = soc;
            }
            if (v > 0 && dt > 0 && !((live.rpm || 0) > 300)) { ek.km += v * dt / 3600; live.ekm = ek.km; }
            if (now - savedT > 2000) {
                savedT = now;
                const txt = JSON.stringify({ km: Math.round(ek.km * 1000) / 1000, soc: ek.soc, t: now });
                if (txt.replace(/"t":\d+/, '') !== savedTxt) { savedTxt = txt.replace(/"t":\d+/, ''); try { fs.writeFileSync(EFILE, txt); } catch (e) { /* not writable */ } }
            }
        }, 100);
        log.info('electric km since the last charge: ' + ek.km.toFixed(1) + ' (charge level then ' + ek.soc + ')');
    }

    /* ---------- the car's total km and the gear: fields found in the head unit's catalog, read and written to the diag file ----------
     * Total km: a mileage field read in km (1000 .. 3 000 000) is taken; before that, the factory trip's km
     * (the iDrive's "values from: factory" shows the car's total) kept on file. The gear: values only logged
     * until their meaning is known (a test drive through P R N D M).
     */
    {
        const OFILE = path.join(bg.dataDir || __dirname, 'odo.json');
        // the car's figure (km) and the distance driven since (from the speed): the total counts on between two readings
        let ob = { km: null, extra: 0 }, oSaved = '';
        try { const j = JSON.parse(fs.readFileSync(OFILE, 'utf8')); if (typeof j.km === 'number') ob = { km: j.km, extra: typeof j.extra === 'number' ? j.extra : 0 }; } catch (e) { /* none yet */ }
        const oSave = () => { const t = JSON.stringify({ km: ob.km, extra: Math.round(ob.extra * 1000) / 1000 }); if (t !== oSaved) { oSaved = t; try { fs.writeFileSync(OFILE, t); } catch (e) { /* not writable */ } } };
        const oShow = () => { live.odo = ob.km === null ? null : Math.floor(ob.km + ob.extra); };
        oShow();
        live.setOdo = (km, from) => {
            if (typeof km !== 'number' || !(km >= 1000 && km < 3000000)) return;
            if (from === 'factory' && live.odoSrc === 'signal') return;            // the signal, once read, wins
            // a figure of another trip (read as the menu changes) is far lower: only the total, or a little under our count, is taken
            if (from === 'factory' && ob.km !== null && km < ob.km + ob.extra - 5) return;
            if (km !== ob.km || ob.extra) { ob = { km: km, extra: 0 }; oSave(); oShow(); }
            if (from === 'signal') live.odoSrc = 'signal';
        };
        let oT = 0;
        setInterval(() => {
            const now = Date.now(), dt = oT ? Math.min(2, (now - oT) / 1000) : 0;
            oT = now;
            if (ob.km !== null && live.speed > 0 && dt > 0) { ob.extra += live.speed * dt / 3600; oShow(); }
            if (now % 10000 < 1000) oSave();
        }, 1000);
        const PROBES = [
            ['de.bmw.infrastructure.MileageSupreme', /mileage/i, 'odo'],
            ['de.bmw.infrastructure.SecureMileage', /mileage/i, 'odo'],
            ['de.bmw.infotainment.misc.MDrive', /gear/i, 'gear'],
            ['de.bmw.infrastructure.VehicleInformation', /gear/i, 'gear'],
            ['de.bmw.infotainment.vehicle.CDS', /gear/i, 'gear'],
        ];
        const NP = require('./nowplaying');
        const nLog = {};
        setTimeout(() => PROBES.forEach(([iface, re, what]) => {
            let cfg = null;
            try { cfg = bg.signals.loadConfig(iface); } catch (e) { diag('probe ' + iface + ': ' + e.message); return; }
            const fields = NP.fieldsOf(cfg).filter((f) => re.test(f)), insts = NP.instancesOf(cfg, ['1']).slice(0, 4);
            diag('probe ' + iface + ': fields ' + JSON.stringify(fields) + ', instances ' + JSON.stringify(insts) + ', getter ' + JSON.stringify(fields.map((f) => !!(cfg.fields && cfg.fields[f] && cfg.fields[f].getter))));
            insts.forEach((inst) => {
                const h = {};
                fields.forEach((f) => {
                    const k = iface.split('.').pop() + '/' + inst + '.' + f;
                    let last = '';
                    h[f] = (v) => {
                        const t = JSON.stringify(v);
                        if (t !== last && (nLog[k] = (nLog[k] || 0) + 1) <= 80) diag(what + ' ' + k + ': ' + String(t).slice(0, 500));
                        last = t;
                        if (what === 'odo') {
                            let km = null;
                            walk(v, (x, pth) => { if (km === null && typeof x === 'number' && /mileage|km|value/i.test(pth) && !/qualifier|alive|crc|unit/i.test(pth)) km = x; });
                            if (km === null && typeof v === 'number') km = v;
                            if (km !== null && km >= 1000 && km < 3000000) live.setOdo(Math.floor(km), 'signal');
                        }
                    };
                });
                if (fields.length) bg.signals.watch(iface, inst, h, log, { pollMs: what === 'gear' ? 1000 : 10000 })
                    .then((r) => diag('probe ' + iface + '/' + inst + ': ' + (r.error ? 'error ' + r.error : 'watching, available ' + r.available)))
                    .catch((e) => diag('probe ' + iface + '/' + inst + ': ' + e.message));
            });
        }), 25000);
    }

    /* ---------- the car's own trip data: what the stock widget shows ----------
     * The figures follow the "reset trip data" choice in the iDrive (since the start of the trip, the last refuelling,
     * the last charge, factory, a chosen point). KombiIF statusBordcomputerTravelData.wayPassed is the distance in km,
     * statusConsumptionAverageElectricVehicle the average electric consumption (tenths of a kWh/100km).
     */
    {
        let last = '', rangeLast = '', rangeLogT = 0;
        // each change of the trip computer's other data, logged (at most 120 lines)
        const bcLast = {}; let bcN = 0;
        const bcLog = (name, v) => {
            const t = JSON.stringify(v);
            if (t === bcLast[name]) return;
            bcLast[name] = t;
            if (bcN++ < 120) log.info('bc ' + name + ': ' + String(t).slice(0, 600));
            diag('bc ' + name + ': ' + String(t).slice(0, 600));
        };
        // the car gives whole km: the tenths are the speed's distance between two steps of it, kept inside the half km around the car's figure
        let tripT = 0;
        // the tenths are kept on file, so a restart (a deploy, the head unit waking) carries on from them while the car's figure is the same
        const TFILE = path.join(bg.dataDir || __dirname, 'trip.json');
        let saved = null, savedT = 0, savedTxt = '';
        try { saved = JSON.parse(fs.readFileSync(TFILE, 'utf8')); } catch (e) { /* none yet */ }
        setInterval(() => {
            const now = Date.now(), dt = tripT ? Math.min(1, (now - tripT) / 1000) : 0;
            tripT = now;
            if (live.trip === null || live.tripEst === null) return;
            if (live.speed > 0 && dt > 0) live.tripEst = Math.min(live.trip + 0.499, Math.max(live.trip - 0.5, live.tripEst + live.speed * dt / 3600));
            // the electric km: the distance with the engine stopped (no engine speed), within the car's trip
            if (live.tripE === null) live.tripE = 0;
            if (live.speed > 0 && dt > 0 && !((live.rpm || 0) > 300)) live.tripE = Math.min(live.tripEst, live.tripE + live.speed * dt / 3600);
            if (now - savedT > 2000) {
                savedT = now;
                const txt = JSON.stringify({ way: live.trip, est: Math.round(live.tripEst * 1000) / 1000, e: live.tripE === null ? null : Math.round(live.tripE * 1000) / 1000 });
                if (txt !== savedTxt) { savedTxt = txt; try { fs.writeFileSync(TFILE, txt); } catch (e) { /* not writable */ } }
            }
        }, 100);
        bg.signals.watch('de.bmw.infotainment.KombiIF', '1', {
            statusBordcomputerTravelData: (v) => {
                const w = v && v.wayPassed, prev = live.trip;
                live.trip = typeof w === 'number' && w >= 0 && w < 65000 ? w : null;          // 65533-65535: no figure (e.g. charging, a reset trip)
                // a new trip (a reset, another trip chosen, a charge): the electric km start again
                if (live.trip !== null && live.lastWay !== undefined && live.lastWay !== null && live.trip < live.lastWay) live.tripE = 0;
                if (live.trip !== null) live.lastWay = live.trip;
                if (live.trip !== null && prev === null && live.tripE === null && saved && typeof saved.e === 'number' && saved.way !== undefined && live.trip >= saved.way) live.tripE = saved.e;
                if (live.trip !== null && live.tripDate === null) live.setOdo(live.trip, 'factory');   // "values from: factory": the car's total
                if (live.trip === null) live.tripEst = null;
                else if (live.trip === prev && live.tripEst !== null) { /* the same figure read again (polled every second): keep the tenths */ }
                else if (prev === null && saved && saved.way === live.trip && typeof saved.est === 'number' && Math.abs(saved.est - live.trip) <= 0.5) live.tripEst = saved.est;   // after a restart: the tenths kept on file
                else if (prev === null || live.tripEst === null || live.trip !== prev + 1) live.tripEst = live.trip;       // first reading, another trip chosen, a reset
                else live.tripEst = live.trip - 0.5;                                                                          // the whole km has just turned over
                const str = JSON.stringify(v); if (str !== last) { last = str; log.info('trip data ' + str); diag('trip data ' + str); }
            },
            // the trip computer's other data (looked into: the electric km of the trip, the trip chosen, the BC's operation)
            statusBordcomputerElectricData: (v) => bcLog('electricData', v),
            statusBordcomputerStatus2: (v) => bcLog('status2', v),
            statusBordcomputerTravelStart: (v) => {
                bcLog('travelStart', v);
                // the start of the trip chosen in the iDrive: none (65533) for the factory one
                const y = v && v.yearDepartureBC, m = v && v.monthDepartureBC, dd = v && v.dayDepartureBC;
                const ok = typeof y === 'number' && y > 2000 && y < 2200 && m >= 1 && m <= 12 && dd >= 1 && dd <= 31;
                live.tripFactory = !ok;
                live.tripDate = ok ? { y: y, m: m, d: dd, h: v.hourDepartureBC, min: v.minuteDepartureBC } : null;
                if (ok) live.noteTripDate(live.tripDate);
            },
            statusConsumptionAverageElectricVehicle: (v) => {
                const a = v && v.consumptionAverageElectricVehicleBC1;
                live.carAvg = typeof a === 'number' && a >= 0 && a < 2000 ? a / 10 : null;
            },
            // the ranges the cluster shows: logged whole (to find the electric one); a field named for the electric
            // drive is taken as the electric range the stock cluster shows
            statusRangeTankStatus: (v) => {
                const str = JSON.stringify(v);
                if (str !== rangeLast && Date.now() - rangeLogT > 30000) { rangeLast = str; rangeLogT = Date.now(); log.info('range data ' + str); }
                let e = null, ek = null;
                walk(v, (x, p) => { if (e === null && typeof x === 'number' && /elec|elek|hybrid|hv|battery|ebat|\bev/i.test(p) && !/fuel|tank/i.test(p)) { e = x; ek = p; } });
                live.carRangeE = typeof e === 'number' && e >= 0 && e < 1000 ? e : null;
                if (ek && ek !== live.carRangeKey) { live.carRangeKey = ek; log.info('range: the electric range is ' + ek); }
            },
        }, log, { pollMs: 1000 }).then((s) => log.info('trip signals ' + (s.error ? 'error: ' + s.error : 'subscribed')));
    }

    const modeLog = {};
    bg.signals.watch('de.bmw.infotainment.drivingexcitement.FES', '1', {
        statusFESVehicleDynamicSwitchHMI: (v) => {
            once('mode', v);
            let raw = v && v.actualValueModeDrivingExperience;
            if (raw === undefined) walk(v, (x, p) => { if (raw === undefined && /ModeDrivingExperience/i.test(p)) raw = x; });
            live.modeRaw = raw;
            const p = profileOf(raw);
            if (p) live.prof = p;
            // every new raw value once, so the codes for Individual / XtraBoost / Battery Control can be checked
            if (!modeLog[String(raw)]) { modeLog[String(raw)] = 1; log.info('mode raw ' + JSON.stringify(raw) + ' -> ' + (p ? p.main + ' ' + p.sub : '?')); }
        },
    }, log, { pollMs: 5000 }).then((s) => log.info('mode ' + (s.error ? 'error: ' + s.error : 'subscribed')));

    /* ---------- the iDrive knob tilted down (S) switches the trip cell between the trip and a Spotify placeholder ---------- */
    live.bcPage = 0; live.ccuS = false; live.ccuLast = undefined;
    let nCcu = 0;
    bg.signals.watch('de.bmw.infotainment.controlelements.FrontCCU', '1', {
        statusRotaryEncoderState: (v) => {
            const d = v && v.frontRotaryEncoderDeflection;
            if (d !== live.ccuLast && nCcu < 40) { nCcu++; log.info('knob deflection: ' + JSON.stringify(d)); }
            live.ccuLast = d;
            const isS = typeof d === 'number' ? (d === 7 || d === 8) : typeof d === 'string' && /SUED/i.test(d);   // SUED_KURZ_GEDRUECKT / SUED_LANG_GEDRUECKT: tilted down (south)
            if (isS && !live.ccuS) { live.bcPage = settings.get('music') === false ? 0 : (live.bcPage + 1) % 4; log.info('knob tilt down: page ' + live.bcPage); }
            live.ccuS = isS;
        },
    }, log, { pollMs: 200 }).then((s) => log.info('knob signals ' + (s.error ? 'error: ' + s.error : 'subscribed')));

    /* ---------- the song playing (CarPlay, Android Auto, Bluetooth, USB), read from the head unit's media interfaces as HUD Lyrics does ---------- */
    live.song = null;
    try {
        const NP = require('./nowplaying');
        const MEDIA = [
            { iface: 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer', instances: [] },
            { iface: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', instances: [] },
            { iface: 'de.bmw.infotainment.entertainment.dynamicmediaplayer.DynamicMediaPlayer', instances: [] },
            { iface: 'de.bmw.infotainment.a4a.carplay.CarPlayManager', instances: ['CarPlayManagerInst1'] },
            { iface: 'de.bmw.infotainment.sdi.aap.androidautoprojectedmanager.AndroidAutoProjectedManager', instances: ['AndroidAutoProjectedManagerInst1'] },
        ];
        const np = new NP.NowPlaying(bg.signals, log, MEDIA);
        np.start().then(() => log.info('nowplaying: ' + JSON.stringify(np.status()))).catch((e) => log.warn('nowplaying start: ' + e.message));
        let lastState = null, lastSong = '', rawPos = null, posAt = 0, nPos = 0, artKey = '', artN = 0, nArt = 0;
        live.art = null;
        const loadArt = (file, key) => {
            live.art = null;
            if (!file) { if (nArt < 30) { nArt++; log.info('cover: none'); } return; }
            if (/missing$/.test(key)) { if (nArt < 30) { nArt++; log.info('cover: ' + file + ' (not there)'); } return; }
            const t0 = Date.now();
            try {
                const buf = fs.readFileSync(file);
                let w = 0, h = 0, d = null, kind = '?';
                if (buf[0] === 0xff && buf[1] === 0xd8) {
                    kind = 'jpeg';
                    const im = require('./coverjpeg')(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64, maxResolutionInMP: 8 });
                    w = im.width; h = im.height; d = im.data;
                } else if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
                    kind = 'png';
                    const im = require('./coverpng').decode(buf);
                    w = im.w; h = im.h; d = im.rgba;
                } else throw new Error('not a jpeg or png (' + buf.slice(0, 4).toString('hex') + ')');
                // kept at most 240 px: the cluster shows it at 150 px or so
                const m = Math.min(1, 240 / Math.max(w, h)), nw = Math.max(1, Math.round(w * m)), nh = Math.max(1, Math.round(h * m));
                if (m < 1) { d = cluster.shrink(d, w, h, nw, nh); w = nw; h = nh; }
                live.art = { id: ++artN, w: w, h: h, d: d };
                if (nArt < 30) { nArt++; log.info('cover: ' + file + ' ' + kind + ' ' + buf.length + ' B -> ' + w + 'x' + h + ' in ' + (Date.now() - t0) + ' ms'); }
            } catch (e) { if (nArt < 30) { nArt++; log.warn('cover: ' + file + ': ' + e.message); } }
        };
        setInterval(() => {
            let t = null;
            try { t = np.track(); } catch (e) { /* next second */ }
            // the position counts on from the last figure the car sent; one that stays put 5 s or more means paused
            // (without a position at all it counts as playing)
            const now = Date.now(), p = t && typeof t.position === 'number' && t.position >= 0 ? t.position : null;
            if (p !== rawPos) { rawPos = p; posAt = now; if (p !== null && nPos < 15) { nPos++; log.info('song position: ' + p + ' / ' + (t && t.duration)); } }
            // the cover: the file the head unit keeps for the song (decoded again when its path, size or time changes)
            const cov = t && t.cover ? String(t.cover).replace(/^file:\/\//, '') : '';
            let ck = '';
            if (cov) { try { const st = fs.statSync(cov); ck = cov + '|' + st.size + '|' + st.mtime.getTime(); } catch (e) { ck = cov + '|missing'; } }
            if (ck !== artKey) { artKey = ck; loadArt(cov, ck); }
            live.song = t ? { title: t.title, artist: t.artist || '', album: t.album || '', duration: typeof t.duration === 'number' && t.duration > 0 ? t.duration : null,
                position: p, at: posAt, playing: p !== null ? now - posAt < 3000 : t.state ? t.playing !== false : true } : null;   // the time moving on = playing (the player state reads oddly from Android Auto)
            if (t && t.state !== lastState) { lastState = t.state; log.info('song player state: ' + JSON.stringify(t.state) + ' (playing per state: ' + t.playing + ')'); }
            const k = t ? t.title + ' / ' + (t.artist || '-') + ' (' + t.from + ')' : 'none';
            if (k !== lastSong) { lastSong = k; log.info('song: ' + k); diag('song from ' + (t ? t.from : '-')); }
        }, 1000);
        // once, the names (not the values) of the media fields seen: which interface carries the song
        setTimeout(() => { try { log.info('nowplaying fields: ' + np.values().map((v) => v.key).slice(0, 120).join(', ')); } catch (e) { /* none */ } }, 90000);
    } catch (e) { log.warn('nowplaying: ' + e.message); }

    bg.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
        statusCarSpeed2: (v) => {
            const k = v && v.speedVehicleCentreOfGravity;
            live.speed = k == null || k * 0.015625 > 400 ? null : k * 0.015625;
            range.speed(live.speed);
        },
    }, log, { pollMs: 300 }).then((s) => log.info('speed ' + (s.error ? 'error: ' + s.error : 'subscribed')));

    /* ---------- the cluster-render status: the slots that change when the BC button is pressed ----------
     * /run/cluster-render/status.txt, every 2 s: log a line when one of the watched slots changes (up to 300 lines).
     */
    {
        const STATUS = '/run/cluster-render/status.txt';
        const lastSlot = {};
        let nSlot = 0, warned = false;
        setInterval(() => {
            let txt;
            try { txt = fs.readFileSync(STATUS, 'utf8'); } catch (e) { if (!warned) { warned = true; log.info('status.txt: ' + e.message); } return; }
            for (const line of txt.split('\n')) {
                const m = /^slot 0x([0-9a-fA-F]+) (.*)$/.exec(line.trim());
                if (!m) continue;
                const key = m[1].toLowerCase();
                if (lastSlot[key] !== undefined && lastSlot[key] !== m[2] && nSlot < 300) {
                    nSlot++;
                    log.info('slot change 0x' + key + ': ' + lastSlot[key] + ' -> ' + m[2]);
                }
                lastSlot[key] = m[2];
            }
        }, 2000);
    }

    /* ---------- the car's own consumption displays: read and logged, to learn their scales ----------
     * ResetLogic currentConsumption / averageConsumption (what the iDrive's trip page shows, l/100km or kWh/100km),
     * KombiIF statusBordcomputerAverage (the trip averages), statusDisplayElectricalPowerDistribution and the whole
     * statusConsumptionAverageElectricVehicle, and the engine speed (the engine on or off). Nothing is drawn from
     * them yet: every 5 s while the car moves or the engine runs, one line with them and our own figures.
     */
    {
        const raw = {};
        // log each change of these signals (up to 300 lines), to see which one moves when the BC button is pressed
        const lastJ = {};
        let nChg = 0;
        const chg = (name, v) => {
            let j; try { j = JSON.stringify(v); } catch (e) { j = String(v); }
            if (j === lastJ[name]) return;
            if (lastJ[name] !== undefined && nChg < 300) { nChg++; log.info('change ' + name + ': ' + String(lastJ[name]).slice(0, 160) + ' -> ' + String(j).slice(0, 160)); }
            lastJ[name] = j;
        };
        const keep = (name) => (v) => { raw[name] = v; chg(name, v); };
        const sub = (iface, handlers, ms, what) => bg.signals.watch(iface, '1', handlers, log, { pollMs: ms })
            .then((s) => log.info(what + ' ' + (s.error ? 'error: ' + s.error : 'subscribed')));
        sub('de.bmw.infotainment.resetlogic.ResetLogic', { currentConsumption: keep('rlNow'), averageConsumption: keep('rlAvg') }, 1000, 'car consumption signals');
        sub('de.bmw.infotainment.KombiIF', { statusBordcomputerAverage: (v) => { raw.bcAvg = v; chg('bcAvg', v); const a = v && v.consumptionAverage1BC1; live.bcAvg = typeof a === 'number' && a > 0 && a < 1000 ? a / 10 : null; }, statusDisplayElectricalPowerDistribution: keep('powerDist'),
            statusConsumptionAverageElectricVehicle: keep('evAvg') }, 1000, 'trip average signals');
        sub('de.bmw.infotainment.vehicle.CDS', {
            statusEngineSpeed2: (v) => {
                const r = v && v.actualValueRPMEngineCrankshaft;
                live.rpm = typeof r === 'number' && r < 65535 ? r * 0.25 : null;
            },
        }, 500, 'engine speed');
        let sigLogT = 0;
        setInterval(() => {
            const now = Date.now();
            if (now - sigLogT < 5000) return;
            if (!((live.speed || 0) > 1 || (live.rpm || 0) > 300)) return;
            sigLogT = now;
            try {
                log.info('car consumption: ' + JSON.stringify({ rlNow: raw.rlNow, rlAvg: raw.rlAvg, bcAvg: raw.bcAvg, powerDist: raw.powerDist, evAvg: raw.evAvg,
                    rpm: live.rpm, speed: live.speed === null ? null : Math.round(live.speed), mode: live.prof ? live.prof.key : null,
                    ours: { value: live.cons.value === null ? null : Math.round(live.cons.value * 10) / 10, unit: live.cons.unit, kw: live.cons.kw, src: live.cons.src } }));
            } catch (e) { /* circular */ }
        }, 1000);
    }

    /* ---------- the head unit's catalog of interfaces (/etc/oap/someip): looked up once, names logged ----------
     * Every service and field an app can read is named there (no values). Logged, in few long lines (the log
     * pulled is its last 150 lines): the fields about an electric distance (the stock trip widget's electric km),
     * the trip computer (BC) and its button, the steering wheel's buttons, and every field of the cluster's
     * interfaces (KombiIF and the like). Then the text files elsewhere that name the BC button.
     */
    {
        const FLAG = path.join(bg.dataDir || __dirname, 'catalog12.done');
        if (!fs.existsSync(FLAG)) setTimeout(() => {
            try {
                const RE_E = /mileage|odometer|kilometerstand|kmstand|totaldistance|distancetotal|gesamtkm|totalkm|kilometer|gesamtweg|odo[A-Z_]/i;   // the car's total km
                const RE_BC = /gear|gangstufe|gangwahl|istgang|getriebe|selectorlever|wahlhebel|waehlhebel|gwsposition|driveposition|gearlever|drivelogic|shiftpaddle|schaltwippe/i;   // the gear
                const RE_KOMBI = /^$/;
                const hits = {};
                const add = (iface, tag, what) => { const k = (iface || '?') + ' [' + tag + ']'; (hits[k] = hits[k] || {})[what] = 1; };
                let nIf = 0;
                const walk = (node, iface, depth) => {
                    if (depth > 40 || node === null || typeof node !== 'object') return;
                    for (const k of Object.keys(node)) if (/^de\.bmw\.[\w.]+$/.test(k)) { nIf++; walk(node[k], k, depth + 1); }
                    const all = iface && RE_KOMBI.test(iface);
                    for (const k of Object.keys(node)) {
                        const v = node[k];
                        if (/^de\.bmw\.[\w.]+$/.test(k)) continue;
                        if (typeof v === 'string' && v.length < 100) {
                            if (RE_E.test(v)) add(iface, 'odometer', v);
                            if (RE_BC.test(v)) add(iface, 'gear', v);
                            if (all && k === 'name') add(iface, 'all', v);
                        } else if (v && typeof v === 'object') walk(v, iface, depth + 1);
                        if (!Array.isArray(node)) { if (RE_E.test(k)) add(iface, 'odometer', k); if (RE_BC.test(k)) add(iface, 'gear', k); }
                    }
                };
                const files = [];
                const look = (d, n) => { try { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); const st = fs.statSync(q); if (st.isDirectory() && n < 4) look(q, n + 1); else if (/\.json$/i.test(f) && st.size < 80 * 1024 * 1024) files.push(q); } } catch (e) { /* not there */ } };
                look('/etc/oap', 0);
                for (const f of files) { try { walk(JSON.parse(fs.readFileSync(f, 'utf8')), null, 0); } catch (e) { log.warn('catalog11: ' + f + ': ' + e.message); } }
                const keys = Object.keys(hits).sort();
                diag('catalog12: ' + files.length + ' json files, ' + nIf + ' interfaces, ' + keys.length + ' with matches');
                log.info('catalog11: ' + files.length + ' json files, ' + nIf + ' interfaces, ' + keys.length + ' with matches');
                let lines = 0;
                for (const k of keys) { diag('catalog12 ' + k + ': ' + Object.keys(hits[k]).sort().join(' ').slice(0, 3500)); if (lines++ >= 80) continue; log.info('catalog11 ' + k + ': ' + Object.keys(hits[k]).sort().join(' ').slice(0, 3500)); }
                // the BC button named in text files elsewhere (not only the app catalog)
                require('child_process').exec('true',
                    { timeout: 150000, maxBuffer: 1 << 20 }, (err, out) => {
                        const list = String(out || '').trim().split('\n').filter(Boolean);
                        log.info('catalog11 BC files (' + list.length + '): ' + list.join(' ').slice(0, 3500));
                        try { fs.writeFileSync(FLAG, String(Date.now())); } catch (e) { /* not writable */ }
                    });
            } catch (e) { log.warn('catalog11: ' + e.message); diag('catalog12 failed: ' + e.message); }
        }, 20000);
    }

    /* ---------- fuel: l/100km while the engine runs outside ELECTRIC ----------
     * The trip average comes from the car (KombiIF statusBordcomputerAverage, tenths of a l/100km). The car gives no
     * figure of the fuel used now, so it comes from the engine's fuel injection counter (CDS2 statusInjectionVolume:
     * a 16-bit count of injected fuel): counts a second x litres per count. The litres per count are learned from
     * the car's own average: with d = the km since the first sample, C = the counts since then and a = the
     * average, a(D0 + d) / 100 - a0 D0 / 100 = k C for every sample, D0 (the trip's km before) and k unknown -
     * solved by least squares once the average has moved enough, kept on file. Until then the figure reads "--".
     */
    const FUEL_FILE = path.join(bg.dataDir || __dirname, 'fuel.json');
    const fuel = { k: null, last: null, rate: null, rateT: 0, acc: 0, accT: 0, counts: 0, km: 0, samples: [], lastSolve: null, engineT: 0, on: false, avg: null, ema: null };
    try { const f = JSON.parse(fs.readFileSync(FUEL_FILE, 'utf8')); if (f.k > 0) fuel.k = f.k; } catch (e) { /* not learned yet */ }
    if (!fuel.k) {
        // the Live Data app may have learned the same counter's scale from the engine unit: take it when it is there
        try {
            const root = path.dirname(path.dirname(bg.dataDir || __dirname));
            for (const d of fs.readdirSync(root)) {
                for (const sub of ['', 'data']) {
                    try { const j = JSON.parse(fs.readFileSync(path.join(root, d, sub, 'signals.json'), 'utf8')); if (j.fuelK > 0) { fuel.k = j.fuelK; log.info('fuel: litres per count from Live Data ' + j.fuelK); } } catch (e) { /* none */ }
                    if (fuel.k) break;
                }
                if (fuel.k) break;
            }
        } catch (e) { /* not readable */ }
    }
    bg.signals.watch('de.bmw.infotainment.vehicle.CDS2', '1', {
        statusInjectionVolume: (v) => {
            const raw = v && v.injectionVolumeFuelEngine, t = Date.now();
            if (typeof raw !== 'number' || !isFinite(raw)) return;
            if (fuel.last && t > fuel.last.t) {
                const d = (raw - fuel.last.raw + 65536) % 65536, dt = t - fuel.last.t;
                if (dt > 5000 || d > 40000) fuel.win = [];
                else {
                    fuel.counts += d;
                    // the rate over the last ~1.2 s, worked out at every reading (no waiting for a whole second)
                    fuel.win = (fuel.win || []).concat([{ t: t, c: fuel.counts }]).filter((p) => t - p.t <= 1200);
                    const a = fuel.win[0];
                    if (fuel.win.length >= 2 && t - a.t >= 400) { fuel.rate = (fuel.counts - a.c) / (t - a.t) * 1000; fuel.rateT = t; }
                }
            }
            fuel.last = { raw: raw, t: t };
        },
    }, log, { pollMs: 200 }).then((s) => log.info('fuel counter ' + (s.error ? 'error: ' + s.error : 'subscribed')));
    const solveK = () => {
        const S = fuel.samples, a0 = S[0].a;
        let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;      // x = (a - a0), y = -100 C, z = -a d
        for (const p of S) { const x = p.a - a0, y = -100 * p.C, z = -p.a * p.d; sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z; }
        const det = sxx * syy - sxy * sxy;
        if (Math.abs(det) < 1e-9) return null;
        const D0 = (sxz * syy - syz * sxy) / det, k = (sxx * syz - sxy * sxz) / det;
        return { D0: D0, k: k };
    };
    let fuelLogT = 0;
    setInterval(() => {
        const now = Date.now(), bc = live.bcAvg;
        // the engine: on above 300 rpm, off after 3 s below 100
        if ((live.rpm || 0) > 300) { fuel.on = true; fuel.engineT = now; } else if (fuel.on && now - fuel.engineT > 3000) fuel.on = false;
        fuel.avg = bc;
        fuel.km += (live.speed || 0) / 3600 * 0.5;
        // learning: a sample every 5 s while the engine runs and the car moves
        if (fuel.on && (live.speed || 0) > 10 && bc !== null && (!fuel.samples.length || now - fuel.samples[fuel.samples.length - 1].t >= 5000)) {
            if (!fuel.samples.length) { fuel.c0 = fuel.counts; fuel.km0 = fuel.km; }
            fuel.samples.push({ t: now, a: bc, d: fuel.km - fuel.km0, C: fuel.counts - fuel.c0 });
            if (fuel.samples.length > 720) fuel.samples.splice(1, 1);
            const S = fuel.samples, span = Math.max.apply(null, S.map((p) => p.a)) - Math.min.apply(null, S.map((p) => p.a));
            if (S.length >= 24 && span >= 0.3 && S[S.length - 1].C > 2000) {
                const r = solveK();
                if (r && r.k > 0 && r.D0 > 0.2 && r.D0 < 5000) {
                    const prev = fuel.lastSolve;
                    fuel.lastSolve = r;
                    // taken when two solutions in a row agree within 10 %
                    if (prev && Math.abs(r.k - prev.k) / prev.k < 0.1 && (!fuel.k || Math.abs(r.k - fuel.k) / fuel.k > 0.02)) {
                        fuel.k = r.k;
                        log.info('fuel: learned ' + r.k.toPrecision(4) + ' l per count (trip km before ' + r.D0.toFixed(1) + ', ' + S.length + ' samples)');
                        try { fs.writeFileSync(FUEL_FILE, JSON.stringify({ k: fuel.k, at: now })); } catch (e) { /* not writable */ }
                    }
                }
            }
        }
        if (now - fuelLogT > 30000 && fuel.on) {
            fuelLogT = now;
            log.info('fuel: ' + JSON.stringify({ rate: fuel.rate === null ? null : Math.round(fuel.rate * 10) / 10, k: fuel.k, avg: bc, counts: fuel.counts, samples: fuel.samples.length, solve: fuel.lastSolve }));
        }
    }, 500);

    /* ---------- consumption: kWh per 100 km ----------
     * The battery's power comes from the eDrive app, which shares it (kW, plus = the battery gives power, minus =
     * it takes it) for as long as another app asks in /tmp/mgu-edrive-wanted.json; this app asks while the widget is on.
     * The figure is the power over the speed, smoothed over a couple of seconds; the average (the diameter sign)
     * is the energy over the distance since the app started, counted while moving.
     */
    const SHARED = '/tmp/mgu-edrive.json', WANTED = '/tmp/mgu-edrive-wanted.json';
    const NEEDLE_A = 1.0, NEEDLE_B = 0.6, NEEDLE_C = 0.8;
    // moving or standing, with some slack (the song + consumption page hides its song while standing):
    // standing = under 1 km/h for 3 s, moving again from 3 km/h; checked twice a second (no new speed while standing)
    live.moving = true; live.stillT = 0;
    setInterval(() => {
        const v = live.speed, now = Date.now();
        if (v === null) return;
        if (v >= 3) { live.moving = true; live.stillT = 0; }
        else if (v < 1) { if (!live.stillT) live.stillT = now; else if (now - live.stillT > 3000) live.moving = false; }
    }, 500);
    let badKw = 0;   // eDrive kW figures dropped as garbage
    // the kW per % of the power needle, learned while eDrive runs: kept on file, so the needle alone stays right without eDrive
    const GFILE = path.join(bg.dataDir || __dirname, 'kwgain.json');
    try { const g = JSON.parse(fs.readFileSync(GFILE, 'utf8')).gain; if (typeof g === 'number' && g > 0.3 && g < 5) { live.kwGain = g; log.info('kW per % from file: ' + g.toFixed(3)); } } catch (e) { /* none yet */ }
    let gainSaved = live.kwGain;
    setInterval(() => {
        if (live.kwGain !== null && (gainSaved === null || Math.abs(live.kwGain - gainSaved) > 0.005)) {
            gainSaved = live.kwGain;
            try { fs.writeFileSync(GFILE, JSON.stringify({ gain: Math.round(live.kwGain * 10000) / 10000, t: Date.now() })); } catch (e) { /* not writable */ }
        }
    }, 60000);   // eDrive's starting values: kW per % drive, per % recuperation, and the base load
    let consLogT = 0, rangeT = 0;
    const acc = { t: 0, ema: null, kwh: 0, km: 0, kwEma: null, still: true };
    const consPoll = () => {
        try {
            const on = settings.get('on') !== false && settings.get('cons') !== false;
            if (!on) { live.cons = { value: null, avg: null, kw: null, src: null, unit: 'kwh' }; return; }
            const now = Date.now();
            try { fs.writeFileSync(WANTED, JSON.stringify({ t: now, power: true, soc: true }), { mode: 0o644 }); } catch (e) { /* not writable: eDrive reads the power slowly */ }
            let j = null;
            try { j = JSON.parse(fs.readFileSync(SHARED, 'utf8')); } catch (e) { /* eDrive is not running */ }
            // eDrive's km per % of charge, whatever the age of its file: it learns from the past driving
            if (j && typeof j.rangeKm === 'number' && typeof j.soc === 'number' && j.soc >= 15 && now - rangeT > 20000) {
                rangeT = now; range.external(j.rangeKm / j.soc);
            }
            {
                // outside ELECTRIC the widget shows fuel: worked out first, the battery part is skipped
                const key = live.prof ? live.prof.key : '';
                if (key && !/^ELECTRIC/.test(key)) {
                    const dt0 = acc.t ? Math.min(1, (now - acc.t) / 1000) : 0;
                    acc.t = now;
                    const mv = live.speed || 0;
                    if (acc.still && mv >= 8) acc.still = false; else if (!acc.still && mv < 4) acc.still = true;
                    fuelCons(now, mv, Math.min(1, dt0 / 0.5));
                    acc.ema = null; acc.kwEma = null;
                    return;
                }
            }
            // eDrive's kW, when it is a real one: now and then it gives garbage (e.g. -7.2e+32), which pinned the gauge
            // to its ends; anything not finite or beyond 150 kW either way is dropped (the needle carries on meanwhile)
            let ek = j && now - j.t < 3000 && typeof j.kw === 'number' ? j.kw : null;
            if (ek !== null && !(isFinite(ek) && Math.abs(ek) <= 150)) {
                badKw++;
                if (badKw <= 20 || badKw % 500 === 0) log.warn('consumption: eDrive kW dropped (' + badKw + '): ' + ek);
                ek = null;
            }
            // the car's power needle, read every 50 ms: drive % x the kW per % (learned from eDrive), recuperation, the A/C and a base load
            const ac = now - live.acT < 15000 ? live.ac : 0, gain = live.kwGain || NEEDLE_A;
            const nk = live.rel && now - live.rel.t < 12000 ? live.rel.drive * gain - live.rel.recup * NEEDLE_B + ac + NEEDLE_C : null;
            // the kW per % of the needle, learned while both read and the drive is clear of zero
            if (ek !== null && live.rel && live.rel.drive >= 8 && !j.fast) {
                const g = (ek - ac - NEEDLE_C) / live.rel.drive;
                if (g > 0.3 && g < 5) live.kwGain = live.kwGain === null ? g : live.kwGain + (g - live.kwGain) * 0.01;
            }
            let kw = null, src = null;
            if (ek !== null && j.fast) { kw = ek; src = 'edrive'; }                       // eDrive reads fast itself
            else if (ek !== null && nk !== null) {
                // the needle's moves at once, pulled to eDrive's figure within about half a second
                if (live.fus === null || live.prevNeedle === null) live.fus = ek;
                else live.fus += nk - live.prevNeedle;
                live.fus += (ek - live.fus) * Math.min(1, (acc.t ? (now - acc.t) / 1000 : 0) / 0.5);
                kw = live.fus; src = 'edrive+needle';
            } else if (ek !== null) { kw = ek; src = 'edrive'; live.fus = null; }
            else if (nk !== null) { kw = nk; src = 'needle'; live.fus = null; }
            live.prevNeedle = nk;
            if (now - consLogT > 30000) {
                consLogT = now;
                log.info('consumption: ' + (src ? 'power from ' + src + ' ' + kw.toFixed(1) + ' kW' : 'no power') + ', eDrive file '
                    + (j ? 'age ' + (now - j.t) + ' ms, kw ' + j.kw + ', rangeKm ' + j.rangeKm + ', soc ' + j.soc : 'not readable') + ', needle ' + (live.rel ? JSON.stringify(live.rel) : 'none') + ', ac ' + live.ac.toFixed(2) + ', speed ' + live.speed + ', kW per % ' + (live.kwGain === null ? '-' : live.kwGain.toFixed(2)));
            }
            const dt = acc.t ? Math.min(1, (now - acc.t) / 1000) : 0;
            acc.t = now;
            const v = live.speed;
            const moving = v !== null && v !== undefined ? v : 0;
            // standing (below ~4 km/h) the power itself in kW; back to kWh/100km above ~8 km/h
            if (acc.still && moving >= 8) acc.still = false; else if (!acc.still && moving < 4) acc.still = true;
            // a light smoothing on the road (a quarter second), a heavier one at low speed where kW / speed jumps
            const k = Math.min(1, dt / ((live.speed || 0) < 30 ? 0.8 : 0.25));
            if (kw === null) { live.cons = { value: null, avg: live.cons.avg, kw: null, src: null, unit: 'kwh' }; acc.ema = null; acc.kwEma = null; fuelCons(now, moving, k); return; }
            acc.kwEma = acc.kwEma === null ? kw : acc.kwEma + (kw - acc.kwEma) * k;
            if (acc.still) {
                acc.ema = null;
                live.cons = { value: Math.max(-60, Math.min(120, acc.kwEma)), avg: null, kw: kw, src: src, unit: 'kw' };
            } else {
                const inst = kw / Math.max(20, moving) * 100;                    // below 20 km/h as at 20: no 120 when moving off
                acc.ema = acc.ema === null ? 0 : acc.ema + (inst - acc.ema) * k;     // moving off: rise from 0, not straight to the first figure
                if (moving >= 3 && dt > 0) { acc.kwh += kw * dt / 3600; acc.km += moving * dt / 3600; }
                live.cons = { value: Math.max(-60, Math.min(120, acc.ema)), avg: acc.km > 0.5 ? acc.kwh / acc.km * 100 : null, kw: kw, src: src, unit: 'kwh' };
            }
            fuelCons(now, moving, k);
            once('consumption', { kw: kw, src: src, speed: v });
        } catch (e) { log.warn('consumption: ' + e.message); }
    };
    // fuel: outside ELECTRIC while the engine runs, the fuel used instead of the battery
    const fuelCons = (now, moving, k) => {
            const key = live.prof ? live.prof.key : '';
            // as the stock widget: kW / kWh only in ELECTRIC; every other mode in l/100km, 0.0 while the engine is off
            if (key && !/^ELECTRIC/.test(key)) {
                if (!fuel.on) {
                    fuel.ema = null; fuel.unit = 'l';
                    live.cons = { value: 0, avg: fuel.avg, kw: null, src: 'fuel', unit: 'l' };
                    return;
                }
                const kk = fuel.k || 1e-6;     // 1 microlitre a count until learned (what the counter showed on the road)
                const lph = fuel.rate !== null && now - fuel.rateT < 3000 ? fuel.rate * kk * 3600 : (fuel.last && now - fuel.last.t > 3000 ? 0 : null);
                if (lph === null) { fuel.ema = null; live.cons = { value: null, avg: fuel.avg, kw: null, src: 'fuel', unit: acc.still ? 'lh' : 'l' }; }
                else {
                    const inst = acc.still ? lph : lph / Math.max(10, moving) * 100;
                    fuel.ema = fuel.ema === null || fuel.unit !== (acc.still ? 'lh' : 'l') ? inst : fuel.ema + (inst - fuel.ema) * k;
                    fuel.unit = acc.still ? 'lh' : 'l';
                    live.cons = { value: Math.max(0, Math.min(60, fuel.ema)), avg: acc.still ? null : fuel.avg, kw: null, src: 'fuel', unit: fuel.unit };
                }
            } else fuel.ema = null;
    };
    setInterval(consPoll, 50);

    /* ---------- the cluster ---------- */
    const panel = cluster.start({ settings: settings, log: log, state: state });

    return { live, range, state, panel, colourOf };
}

mgu.run({
    background,
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const { live, range, state, panel, colourOf } = ctx.background || await background(ctx);

        /* ---------- profiles ---------- */
        const PFILE = path.join(ctx.dataDir || __dirname, 'profiles.json');
        let prof = { active: 1, slots: {} };
        try { prof = Object.assign(prof, JSON.parse(fs.readFileSync(PFILE, 'utf8'))); } catch (e) { /* first run */ }
        const snapshot = () => { const o = {}; KEYS.forEach((k) => { o[k] = settings.get(k); }); return o; };
        const saveProfiles = () => { try { fs.writeFileSync(PFILE, JSON.stringify(prof)); } catch (e) { log.warn('profiles: ' + e.message); } };
        if (!prof.slots[prof.active]) { prof.slots[prof.active] = snapshot(); saveProfiles(); }
        let loading = false, saveTimer = null;
        // the profile in use follows every change, a second after the last one
        settings.onChange((k) => {
            if (loading || KEYS.indexOf(k) < 0) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => { prof.slots[prof.active] = snapshot(); saveProfiles(); if (prof.active === 1) logDefault(); }, 1000);
        });
        const useProfile = (n) => {
            clearTimeout(saveTimer);
            prof.slots[prof.active] = snapshot();
            const s = prof.slots[n];
            loading = true;
            try { if (s) KEYS.forEach((k) => { if (s[k] !== undefined && s[k] !== settings.get(k)) settings.set(k, s[k]); }); } finally { loading = false; }
            prof.active = n;
            if (!s) prof.slots[n] = snapshot();
            saveProfiles();
            log.info('profile ' + n + ' in use');
        };
        const saveHere = (n) => { prof.slots[n] = snapshot(); saveProfiles(); if (n === 1) logDefault(); };
        // the Default profile's settings in one log line: what a release takes for the app's defaults
        const logDefault = () => { try { const d = prof.active === 1 ? snapshot() : prof.slots[1]; if (d) log.info('default profile: ' + JSON.stringify(d)); } catch (e) { /* none */ } };
        setTimeout(logDefault, 15000);
        const describe = (s) => {
            if (!s) return 'Empty';
            const on = (k) => s[k] !== false;
            const parts = [];
            const gs = ['ring', 'cell', 'stripes'].indexOf(s.gaugeStyle) >= 0 ? s.gaugeStyle : 'classic';
            if (on('gauge')) parts.push((gs === 'stripes' ? 'M Stripes' : gs.charAt(0).toUpperCase() + gs.slice(1)) + ' ' + s[(gs === 'classic' ? 'gauge' : gs) + 'Scale'] + ' %');
            if (on('label')) parts.push('label');
            if (on('range')) parts.push('range');
            if (on('cons')) parts.push('consumption');
            if (on('trip')) parts.push('trip km');
            return (parts.join(', ') || 'Everything off') + (s.on === false ? ' (M Cluster off)' : '');
        };

        /* ---------- the page: tabs drawn by the kit ---------- */
        const TABS = ['M Cluster', 'Gauge', 'Drive Mode', 'Range', 'Consumption', 'Trip', 'Total km', 'Music', 'Gear', 'Profiles'];
        let page = 0, dirty = true, lastDraw = 0, editing = null, gaugePart = 'gauge', musicWhich = 'music1';   // the Music page: 'music1' the song alone, 'music' beside the consumption
        const redraw = () => { dirty = true; return null; };
        const set = (k, v) => { settings.set(k, v); return redraw(); };
        const flip = (k) => set(k, settings.get(k) === false);
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const STEPS = [2, 10, 40];
        // the gauge's place and size belong to its style: classic gaugeX..., ring ringX..., cell cellX..., stripes stripesX...
        const style = () => cluster.styleOf(settings);
        const gp = () => cluster.prefixOf(style());
        const keyOf = (which) => (which === 'gauge' ? gp() : which);
        const SIZE = {
            gauge: () => cluster.gaugeSize(settings.get(gp() + 'Scale')),
            label: () => cluster.labelSize(settings.get('labelScale')),
            range: () => cluster.rangeSize(settings.get('rangeScale')),
            cons: () => cluster.consSize(settings.get('consScale'), settings.get('consStyle')),
            trip: () => cluster.tripSize(settings.get('tripScale')),
            music: () => cluster.musicSize(settings.get('musicScale')),
            music1: () => cluster.musicSize(settings.get('music1Scale')),
            odo: () => cluster.odoSize(settings.get('odoScale')),
            gear: () => cluster.gearSize(settings.get('gearScale')),
        };
        const nudge = (which, dx, dy) => {
            if (which === 'pct') {          // the percentage: moved inside the gauge, by layer pixels
                const st = Number(settings.get('step')) || 10;
                settings.set('pctDX', clamp(Number(settings.get('pctDX')) + dx * st, -200, 200));
                return set('pctDY', clamp(Number(settings.get('pctDY')) + dy * st, -200, 200));
            }
            const st = Number(settings.get('step')) || 10, sz = SIZE[which](), kk = keyOf(which);
            settings.set(kk + 'X', clamp(Number(settings.get(kk + 'X')) + dx * st, 0, 1920 - sz.w));
            return set(kk + 'Y', clamp(Number(settings.get(kk + 'Y')) + dy * st, 0, 720 - sz.h));
        };
        const nextStep = () => set('step', STEPS[(STEPS.indexOf(Number(settings.get('step'))) + 1) % STEPS.length]);
        const target = (cv, x, y, w, h, run, key) => { if (cv.target) cv.target(x, y, w, h, run, key); };
        const alpha = (c, a) => rgbOf(c).concat(Math.round(a * 255));

        /** A row: the name (and a line under it) on the left, an ON / OFF switch on the right. */
        function sw(cv, t, x, y, on, label, sub, run, key) {
            cv.text(label, x, y + 30, 24, t.text, { font: 'bold' });
            if (sub) cv.text(sub, x, y + 56, 17, t.dim);
            const X = x + 560, W = 92, H = 44, S = t.sel || t.accent;
            cv.roundRect(X, y + 6, W, H, H / 2, on ? alpha(S, 0.9) : [255, 255, 255, 30]);
            if (!on) cv.strokeRoundRect(X, y + 6, W, H, H / 2, 1.5, [255, 255, 255, 77]);
            cv.circle(on ? X + W - H / 2 : X + H / 2, y + 6 + H / 2, H / 2 - 5, '#ffffff');
            cv.text(on ? 'ON' : 'OFF', on ? X + 26 : X + W - 24, y + 35, 15, on ? '#ffffff' : t.dim, { align: 'center', font: 'bold' });
            target(cv, x, y, 660, 60, run, key);
        }
        function tri(cv, cx, cy, d, s, c) {
            const p = { l: [[cx - s, cy], [cx + s * 0.7, cy - s], [cx + s * 0.7, cy + s]], r: [[cx + s, cy], [cx - s * 0.7, cy - s], [cx - s * 0.7, cy + s]],
                u: [[cx, cy - s], [cx - s, cy + s * 0.7], [cx + s, cy + s * 0.7]], d: [[cx, cy + s], [cx - s, cy - s * 0.7], [cx + s, cy - s * 0.7]] }[d];
            cv.fill(p, c);
        }
        /** The four arrows round the step (press it: 2 / 10 / 40 px), and where the layer is. */
        function pad(cv, t, x, y, which) {
            const b = (bx, by, d, dx, dy) => {
                G.button(cv, t, bx, by, 70, 56, ' ', () => nudge(which, dx, dy), { key: which + d });
                tri(cv, bx + 35, by + 28, d, 11, t.text);
            };
            b(x + 80, y, 'u', 0, -1); b(x, y + 62, 'l', -1, 0); b(x + 160, y + 62, 'r', 1, 0); b(x + 80, y + 124, 'd', 0, 1);
            G.button(cv, t, x + 80, y + 62, 70, 56, String(settings.get('step')), nextStep, { primary: true, key: which + 'step' });
            cv.text('Position', x + 260, y + 40, 20, t.dim);
            const pos = which === 'pct' ? 'x ' + settings.get('pctDX') + '   y ' + settings.get('pctDY') + '  (from the stock place)'
                : 'x ' + settings.get(keyOf(which) + 'X') + '   y ' + settings.get(keyOf(which) + 'Y');
            cv.text(pos, x + 260, y + 74, which === 'pct' ? 22 : 28, t.text, { font: 'bold' });
            cv.text('Middle button: step 2 / 10 / 40 px', x + 260, y + 110, 17, t.dim);
        }
        function stepper(cv, t, x, y, label, val, minus, plus, key) {
            cv.text(label, x, y + 34, 22, t.text);
            G.button(cv, t, x + 300, y, 64, 52, '-', minus, { key: key + '-' });
            cv.text(val, x + 430, y + 36, 26, t.text, { align: 'center', font: 'bold' });
            G.button(cv, t, x + 496, y, 64, 52, '+', plus, { key: key + '+' });
        }
        const sizeStep = (k, d, lo, hi) => () => set(k, clamp(Number(settings.get(k)) + d, lo, hi));
        /** The lettering of a widget: the kit's (Simple) or the M dials' (M). */
        function fontRow(cv, t, x, y, key) {
            const f = mfont.fontOf(settings.get(key));
            cv.text('Font', x, y + 26, 18, t.dim);
            [['simple', 'Simple'], ['m', 'M']].forEach(([v, n], i) => G.button(cv, t, x + 50 + i * 104, y, 96, 38, n,
                () => set(key, v), { primary: f === v, key: key + '-' + v }));
        }
        /** The gauge as the cluster gets it, drawn on the page at (x, y). */
        function gaugeAt(cv, x, y, o) {
            const mv = (pts) => pts.map((p) => [p[0] + x, p[1] + y]);
            const shim = {
                polyline: (pts, w, c) => cv.polyline(mv(pts), w, c),
                fill: (pts, c) => cv.fill(mv(pts), c),
                line: (xa, ya, xb, yb, w, c) => cv.line(xa + x, ya + y, xb + x, yb + y, w, c),
                text: (str, tx, ty, size, c, op) => cv.text(str, tx + x, ty + y, size, c, op),
                textWidth: (str, size, op) => cv.textWidth(str, size, op),
                arc: (cx, cy, r0, r1, a0, a1, c, op) => cv.arc(cx + x, cy + y, r0, r1, a0, a1, c, op),
                fillRect: (rx, ry, w, h, c) => cv.fillRect(rx + x, ry + y, w, h, c),
                strokeRoundRect: (rx, ry, w, h, rr, lw, c) => cv.strokeRoundRect(rx + x, ry + y, w, h, rr, lw, c),
                roundRect: (rx, ry, w, h, rr, c) => cv.roundRect(rx + x, ry + y, w, h, rr, c),
            };
            const st = o.style || style(), gcv = mfont.wrap(shim, mfont.fontOf(settings.get('gaugeFont')));
            if (st === 'classic') gauge.draw(gcv, Object.assign({ arrow: LEVEL_BAR }, gauge.optsFrom((k) => settings.get(k)), o));
            else gauge2.draw(st, gcv, Object.assign({ arrow: LEVEL_BAR }, o));
        }

        function drawHome(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'On the cluster');
            sw(cv, t, 48, 100, settings.get('on') !== false, 'M Cluster', 'Everything below, on or off at once', () => flip('on'), 'sw-on');
            sw(cv, t, 48, 172, settings.get('gauge') !== false, 'Charge gauge', 'Bottom right, where the PHEV layout has it', () => flip('gauge'), 'sw-g');
            sw(cv, t, 48, 244, settings.get('label') !== false, 'Drive Mode', 'HYBRID, SPORT / XTRABOOST ...', () => flip('label'), 'sw-l');
            sw(cv, t, 48, 316, settings.get('range') !== false, 'Electric range', 'The km left, on its own', () => flip('range'), 'sw-r');
            sw(cv, t, 48, 388, settings.get('cons') !== false, 'Consumption', 'kWh/100km on a half circle, takes the stock widget\'s place', () => flip('cons'), 'sw-c');
            const uk = settings.get('units') === 'uk';
            sw(cv, t, 48, 446, uk, 'UK units', uk ? 'Miles, mpg (UK gallon), mi/kWh' : 'Off: Europe (km, l/100km, kWh/100km)', () => set('units', uk ? 'eu' : 'uk'), 'sw-units');
            cv.text('Profile in use:  ' + profName(prof.active), 300, 92, 18, t.dim);
            // the words on the cluster (total km widget, the trip's name): English or Greek
            const lg = settings.get('lang') === 'el' ? 'el' : 'en';
            [['en', 'English'], ['el', 'Greek']].forEach(([v, n], i) => G.button(cv, t, 556 + i * 108, 62, 100, 38, n,
                () => set('lang', v), { primary: lg === v, key: 'lang-' + v }));
            G.panel(cv, t, 800, 52, 776, 460, 'Now');
            gaugeAt(cv, 830, 120, { soc: s.known ? s.soc : null, color: s.color, arrow: s.arrow, scale: 1, dim: !s.known });
            const x = 1110;
            cv.text('Charge', x, 150, 20, t.dim);
            cv.text(s.known ? Math.round(s.soc) + ' %' : '--', x, 196, 44, t.text, { font: 'bold' });
            cv.text(live.socRaw === null ? 'no reading yet' : 'raw ' + live.socRaw + ' x ' + settings.get('chargeScale'), x + 170, 196, 16, t.dim);
            cv.text('Drive mode', x, 250, 20, t.dim);
            cv.text(s.main ? s.main + (s.sub ? ' ' + s.sub : '') : '--', x, 292, 32, t.text, { font: 'bold' });
            cv.text(live.modeRaw === null || live.modeRaw === undefined ? 'no reading yet' : 'raw ' + String(live.modeRaw), x, 318, 16, t.dim);
            cv.text('Electric range', x, 356, 20, t.dim);
            cv.text(s.range === null ? '--' : Math.round(s.range) + ' km', x, 398, 36, t.text, { font: 'bold' });
            cv.text('Cluster: ' + (panel.connected() ? 'connected' : panel.available() ? 'connecting' : 'no renderer')
                + (s.demo ? '   (demo values)' : ''), x, 456, 20, t.dim);
        }
        const STYLE_NAMES = { classic: 'Classic', ring: 'Ring', cell: 'Cell', stripes: 'M Stripes' };
        /** The gauge's sub-pages: the gauge itself, the percentage in it (classic), the colours. */
        function partButtons(cv, t, x, y, st) {
            const parts = st === 'classic' ? [['gauge', 'Gauge'], ['pct', 'Percentage'], ['colours', 'Colours']] : [['gauge', 'Gauge'], ['colours', 'Colours']];
            parts.forEach(([k, n], i) => G.button(cv, t, x + (3 - parts.length + i) * 126, y, 120, 38, n,
                () => { gaugePart = k; return redraw(); }, { primary: gaugePart === k, key: 'part-' + k }));
        }
        function drawGauge(cv, t, s) {
            const st = style(), p = gp();
            if (gaugePart === 'colours') { drawColours(cv, t, s); partButtons(cv, t, 1196, 62, st); return; }
            G.panel(cv, t, 24, 52, 760, 460, 'Gauge');
            partButtons(cv, t, 400, 62, st);
            if (st === 'classic' && gaugePart === 'pct') {
                sw(cv, t, 48, 104, settings.get('pctOn') !== false, 'Show the percentage', '', () => flip('pctOn'), 'sw-p');
                pad(cv, t, 48, 176, 'pct');
                stepper(cv, t, 48, 366, 'Size', settings.get('pctSize') + ' %', sizeStep('pctSize', -5, 50, 200), sizeStep('pctSize', 5, 50, 200), 'ps');
                G.button(cv, t, 48, 436, 300, 48, 'Back to the stock place', () => { settings.set('pctDX', 0); return set('pctDY', 0); }, { key: 'p0' });
            } else {
                sw(cv, t, 48, 104, settings.get('gauge') !== false, 'Show the gauge', STYLE_NAMES[st] + ': its own place and size', () => flip('gauge'), 'sw-g2');
                pad(cv, t, 48, 168, 'gauge');
                stepper(cv, t, 48, 346, 'Size', settings.get(p + 'Scale') + ' %', sizeStep(p + 'Scale', -5, 60, 150), sizeStep(p + 'Scale', 5, 60, 150), 'gs');
                if (st === 'classic') {
                    stepper(cv, t, 48, 402, 'Fade depth', settings.get('gaugeDepth') + ' %', sizeStep('gaugeDepth', -5, 20, 100), sizeStep('gaugeDepth', 5, 20, 100), 'gd');
                    stepper(cv, t, 48, 458, 'Level bar thickness', String(settings.get('gaugeBar')), sizeStep('gaugeBar', -2, 4, 60), sizeStep('gaugeBar', 2, 4, 60), 'gb');
                }
            }
            G.panel(cv, t, 800, 52, 776, 460, 'Style');
            ['classic', 'ring', 'cell', 'stripes'].forEach((k, i) => G.button(cv, t, 950 + i * 154, 62, 144, 38, STYLE_NAMES[k],
                () => { gaugePart = 'gauge'; return set('gaugeStyle', k); }, { primary: st === k, key: 'style-' + k }));
            gaugeAt(cv, 1010, 116, { soc: s.known ? s.soc : 72, color: s.color, arrow: s.arrow, scale: 1.35 });
            fontRow(cv, t, 1340, 456, 'gaugeFont');
        }
        function drawLabelPage(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'Drive Mode');
            fontRow(cv, t, 520, 62, 'labelFont');
            sw(cv, t, 48, 104, settings.get('label') !== false, 'Show the drive mode', '', () => flip('label'), 'sw-l2');
            pad(cv, t, 48, 176, 'label');
            stepper(cv, t, 48, 366, 'Size', settings.get('labelScale') + ' %', sizeStep('labelScale', -5, 60, 300), sizeStep('labelScale', 5, 60, 300), 'ls');
            sw(cv, t, 48, 432, settings.get('sportRed') === true, 'SPORT in red', 'SPORT and XTRABOOST red, INDIVIDUAL stays white', () => set('sportRed', settings.get('sportRed') !== true), 'sw-sr');
            G.panel(cv, t, 800, 52, 776, 460, 'As on the cluster');
            const k = 1.4, lt = mfont.wrap(cv, mfont.fontOf(settings.get('labelFont')));
            lt.text(s.main || 'HYBRID', 850, 190, 36 * k, s.labelColor, { font: 'bold' });
            if (s.sub) lt.text(s.sub, 852, 235, 20 * k, s.subColor || '#b9c0c6', { font: 'bold', spacing: 2 });
            cv.text('Two lines where the mode has a variant: SPORT over XTRABOOST.', 850, 330, 20, t.dim);
        }
        function drawRangePage(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'Electric range');
            fontRow(cv, t, 520, 62, 'rangeFont');
            sw(cv, t, 48, 104, settings.get('range') !== false, 'Show the km left', '', () => flip('range'), 'sw-r2');
            pad(cv, t, 48, 176, 'range');
            stepper(cv, t, 48, 356, 'Size', settings.get('rangeScale') + ' %', sizeStep('rangeScale', -5, 60, 200), sizeStep('rangeScale', 5, 60, 200), 'rs');
            cv.text((range.fromEdrive() ? 'From eDrive: ' : 'Learned: ') + (range.rate() * 100).toFixed(0) + ' km per full battery' + (range.fromEdrive() || range.learned() ? '' : ' (not yet)'), 48, 458, 19, t.dim);
            G.button(cv, t, 420, 432, 340, 44, 'Forget what it learned', () => { range.reset(); return redraw(); }, { key: 'rreset', confirm: true });
            G.panel(cv, t, 800, 52, 776, 460, 'As on the cluster');
            {
                const rt = mfont.wrap(cv, mfont.fontOf(settings.get('rangeFont'))), rn = s.range === null ? '--' : String(Math.round(s.range));
                rt.text(rn, 860, 230, 88, '#40bee0', { font: 'num' });
                rt.text('km', 860 + rt.textWidth(rn, 88, { font: 'num' }) + 12, 230, 52, '#40bee0', { font: 'num' });
            }
            cv.text('The km per % of charge come from eDrive (your past driving).', 860, 330, 20, t.dim);
        }
        /** The consumption widget as the cluster gets it, drawn on the page at (x, y): no clearing the page. */
        function consAt(cv, x, y, o) {
            const shim = {
                clear: () => {},
                polyline: (pts, w, c) => cv.polyline(pts.map((p) => [p[0] + x, p[1] + y]), w, c),
                fill: (pts, c) => cv.fill(pts.map((p) => [p[0] + x, p[1] + y]), c),
                line: (xa, ya, xb, yb, w, c) => cv.line(xa + x, ya + y, xb + x, yb + y, w, c),
                text: (str, tx, ty, size, c, op) => cv.text(str, tx + x, ty + y, size, c, op),
                textWidth: (str, size, op) => cv.textWidth(str, size, op),
            };
            cons.draw(mfont.wrap(shim, mfont.fontOf(settings.get('consFont')), 1, (Number(settings.get('consText')) || 100) / 100), o);
        }
        function drawConsPage(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'Consumption');
            fontRow(cv, t, 520, 62, 'consFont');
            sw(cv, t, 48, 104, settings.get('cons') !== false, 'Show the consumption', 'kWh/100km: blue using, green giving back', () => flip('cons'), 'sw-c2');
            pad(cv, t, 48, 176, 'cons');
            stepper(cv, t, 48, 350, 'Size', settings.get('consScale') + ' %', sizeStep('consScale', -1, 20, 120), sizeStep('consScale', 1, 20, 120), 'cs');
            stepper(cv, t, 48, 410, 'Text size', (Number(settings.get('consText')) || 100) + ' %', sizeStep('consText', -5, 50, 150), sizeStep('consText', 5, 50, 150), 'ct');
            cv.text(live.cons.kw === null ? 'No power reading yet (eDrive and the car\'s power needle).' : 'Battery power ' + live.cons.kw.toFixed(1) + ' kW ' + (live.cons.src === 'edrive' ? '(from eDrive)' : '(estimated from the power needle and the A/C)'), 48, 496, 17, t.dim);
            G.panel(cv, t, 800, 52, 776, 460, 'Style');
            const cst = cons.styleOf(settings.get('consStyle'));
            [['classic', 'Classic'], ['oem', 'OEM']].forEach((st, i) => G.button(cv, t, 1104 + i * 154, 62, 144, 38, st[1],
                () => set('consStyle', st[0]), { primary: cst === st[0], key: 'cstyle-' + st[0] }));
            const c = s.cons || {};
            consAt(cv, 1010, 108, { value: typeof c.value === 'number' ? c.value : 24.0, avg: typeof c.avg === 'number' ? c.avg : (c.unit === 'kw' ? null : 12.6), unit: c.unit, scale: cst === 'oem' ? 60 : 52, style: cst });
        }
        function drawTripPage(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'Trip distance');
            fontRow(cv, t, 520, 62, 'tripFont');
            sw(cv, t, 48, 104, settings.get('trip') !== false, 'Show the distance', 'Km of the trip chosen in the iDrive (since start, refuelling, charge ...)', () => flip('trip'), 'sw-t2');
            pad(cv, t, 48, 176, 'trip');
            stepper(cv, t, 48, 366, 'Size', settings.get('tripScale') + ' %', sizeStep('tripScale', -1, 40, 300), sizeStep('tripScale', 1, 40, 300), 'ts');
            cv.text(live.trip === null ? 'No trip reading yet.' : 'The car reports ' + live.trip + ' km (whole km); the tenths are worked out from the speed.', 48, 458, 19, t.dim);
            G.panel(cv, t, 800, 52, 776, 460, 'As on the cluster');
            {
                const tt = mfont.wrap(cv, mfont.fontOf(settings.get('tripFont'))), tn = typeof s.trip === 'number' ? s.trip.toFixed(1) : '--';
                tt.text(tn, 860, 230, 88, '#40bee0', { font: 'num' });
                tt.text('km', 860 + tt.textWidth(tn, 88, { font: 'num' }) + 12, 230, 52, '#40bee0', { font: 'num' });
            }
            cv.text('Follows "Reset trip data" in the iDrive.', 860, 330, 20, t.dim);
        }
        function drawGearPage(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'Gear');
            sw(cv, t, 48, 104, settings.get('gear') !== false, 'Gear', 'P R N D1..D8, M1..M8 (the M red), the M lettering', () => flip('gear'), 'sw-gear');
            pad(cv, t, 48, 176, 'gear');
            stepper(cv, t, 48, 366, 'Size', (Number(settings.get('gearScale')) || 100) + ' %', sizeStep('gearScale', -5, 30, 300), sizeStep('gearScale', 5, 30, 300), 'gs');
            const g = s.gear;
            cv.text(g && g.text ? 'Now: ' + g.text + (g.raw ? '   (' + g.raw + ')' : '') : 'No gear from the car yet: it shows once the car gives one.', 48, 470, 17, t.dim);
            G.panel(cv, t, 800, 52, 776, 460, 'As on the cluster');
            try {
                const { Canvas } = require('./kit/canvas');
                [[{ text: g && g.text ? g.text : 'D3', manual: g ? g.manual : false }, 860], [{ text: 'M3', manual: true }, 1200]].forEach(([gg, x]) => {
                    const pv = new Canvas(230, 110); cluster.drawGear(pv, gg); cv.drawImage(pv.d, 230, 110, x, 220, 230, 110);
                });
            } catch (e) { cv.text('No preview: ' + e.message, 830, 140, 17, t.dim); }
        }
        function drawMusicPage(cv, t, s) {
            const w = musicWhich === 'music' ? 'music' : 'music1';
            G.panel(cv, t, 24, 52, 760, 460, 'Music');
            [['music1', 'Alone'], ['music', 'With consumption']].forEach(([k, n], i) => G.button(cv, t, 360 + i * 186, 62, 178, 38, n,
                () => { musicWhich = k; return redraw(); }, { primary: w === k, key: 'mw-' + k }));
            sw(cv, t, 48, 104, settings.get('music') !== false, 'Song pages', 'iDrive knob down: trip -> song -> song + consumption -> total km', () => flip('music'), 'sw-m2');
            pad(cv, t, 48, 176, w);
            stepper(cv, t, 48, 366, 'Size', (Number(settings.get(w + 'Scale')) || 100) + ' %', sizeStep(w + 'Scale', -5, 40, 200), sizeStep(w + 'Scale', 5, 40, 200), 'ms-' + w);
            if (w === 'music') sw(cv, t, 48, 432, settings.get('musicMoving') !== false, 'Only while moving', 'Off: the song + consumption page shows its song when standing too', () => flip('musicMoving'), 'sw-mmv');
            else cv.text('The song alone: knob down once. With consumption: twice.', 48, 470, 17, t.dim);
            const so = live.song;
            G.panel(cv, t, 800, 52, 776, 460, 'As on the cluster');
            try {
                const { Canvas } = require('./kit/canvas');
                const mw = 360, mh = 330, pv = new Canvas(mw, mh);
                cluster.drawMusic(pv, so || { title: 'Song title', artist: 'Artist', duration: 200000, playing: true }, so ? null : 75000, live.art,
                    { text: Number(settings.get('musicText')) || 125, color: cluster.MUSIC_BAR[s.key] || cluster.MUSIC_BAR.OTHER });
                cv.drawImage(pv.d, mw, mh, 1008, 104, mw, mh);
            } catch (e) { cv.text('No preview: ' + e.message, 830, 140, 17, t.dim); }
            stepper(cv, t, 830, 448, 'Text size', (Number(settings.get('musicText')) || 125) + ' %', sizeStep('musicText', -5, 70, 170), sizeStep('musicText', 5, 70, 170), 'mt');
        }
        function drawOdoPage(cv, t, s) {
            G.panel(cv, t, 24, 52, 760, 460, 'Total km');
            cv.text('Knob down three times: the total km, where the values are from, and the trip km.', 48, 124, 17, t.dim);
            pad(cv, t, 48, 176, 'odo');
            stepper(cv, t, 48, 366, 'Size', (Number(settings.get('odoScale')) || 100) + ' %', sizeStep('odoScale', -5, 40, 200), sizeStep('odoScale', 5, 40, 200), 'os');
            G.panel(cv, t, 800, 52, 776, 460, 'As on the cluster');
            try {
                const { Canvas } = require('./kit/canvas');
                const pv = new Canvas(420, 300);
                cluster.drawOdo(pv, s.odo || {}, settings.get('units') === 'uk', settings.get('lang') === 'el' ? 'el' : 'en');
                cv.drawImage(pv.d, 420, 300, 978, 130, 420, 300);
            } catch (e) { cv.text('No preview: ' + e.message, 830, 140, 17, t.dim); }
        }
        const RING = { cx: 600, cy: 270, r: 118, R: 168 };
        function drawColours(cv, t, s) {
            const m = editing || (s.key || 'HYBRID'), c = colourOf(m);
            G.panel(cv, t, 24, 52, 330, 460, 'Mode');
            PROFILES.forEach((k, i) => G.button(cv, t, 44, 104 + i * 50, 290, 42, PROFILE_NAMES[k], () => { editing = k; return redraw(); },
                { primary: k === m, key: 'mode-' + k }));
            G.panel(cv, t, 370, 52, 600, 460, 'Colour for ' + PROFILE_NAMES[m]);
            cv.arc(RING.cx, RING.cy, RING.r, RING.R, 0, 360, '#ff0000', { ramp: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'], rampFrom: 0, rampTo: 360 });
            const h = hueOf(c), a = (90 - h) * Math.PI / 180, rm = (RING.r + RING.R) / 2;
            const kx = RING.cx + Math.cos(a) * rm, ky = RING.cy - Math.sin(a) * rm;
            cv.circle(kx, ky, 22, '#ffffff'); cv.circle(kx, ky, 16, hsv(h));
            cv.circle(RING.cx, RING.cy, RING.r - 14, c);
            const light = rgbOf(c).reduce((p, v) => p + v, 0) > 600;
            cv.text(nameOf(c), RING.cx, RING.cy + 10, 32, light ? '#000000' : '#ffffff', { align: 'center', font: 'bold' });
            // hue from the ring (or < >); how much colour and how bright from the steppers: down to greys and white
            const keepSV = (h2) => { const sv = satOf(c) < 0.1 ? 1 : satOf(c); return hsv(h2, sv, valOf(c) || 1); };
            const stepHue = (d) => () => set('col_' + m, keepSV(hueOf(colourOf(m)) + d));
            G.button(cv, t, 392, 446, 60, 48, '<', stepHue(-10), { key: 'h-' });
            G.button(cv, t, 748, 446, 60, 48, '>', stepHue(10), { key: 'h+' });
            cv.text('Quick', 832, 100, 18, t.dim);
            PRESETS.forEach(([n, pc], i) => {
                const y = 112 + i * 47;
                cv.roundRect(832, y, 120, 38, 19, pc);
                if (pc === c) cv.strokeRoundRect(828, y - 4, 128, 46, 23, 3, '#ffffff');
                cv.text(n, 892, y + 25, 15, rgbOf(pc).reduce((p, v) => p + v, 0) > 480 ? '#000000' : '#ffffff', { align: 'center', font: 'bold' });
                target(cv, 832, y, 120, 38, () => set('col_' + m, pc), 'pre-' + i);
            });
            G.panel(cv, t, 986, 52, 590, 460, 'Preview');
            gaugeAt(cv, 1030, 110, { soc: 72, color: c, arrow: LEVEL_BAR, scale: 1.2 });
            const sv = (label, y, val, d, fn, key) => {
                cv.text(label, 1384, y, 20, t.dim);
                G.button(cv, t, 1384, y + 14, 52, 46, '-', () => set('col_' + m, fn(-d)), { key: key + '-' });
                cv.text(Math.round(val * 100) + '%', 1474, y + 46, 22, t.text, { align: 'center', font: 'bold' });
                G.button(cv, t, 1512, y + 14, 52, 46, '+', () => set('col_' + m, fn(d)), { key: key + '+' });
            };
            const h0 = hueOf(c), s0 = satOf(c), v0 = valOf(c);
            sv('Colour', 150, s0, 0.1, (d) => hsv(h0, Math.round((s0 + d) * 10) / 10, v0), 'sat');
            sv('Brightness', 260, v0, 0.1, (d) => hsv(h0, s0, Math.max(0.2, Math.round((v0 + d) * 10) / 10)), 'val');
            cv.text('Colour 0% = grey', 1384, 380, 16, t.dim);
        }
        function drawProfiles(cv, t) {
            G.panel(cv, t, 24, 52, 1552, 460, 'Profiles');
            [1, 2, 3].forEach((n, i) => {
                const x = 48 + i * 510, on = prof.active === n, S = t.sel || t.accent, sl = prof.slots[n];
                cv.roundRect(x, 96, 486, 396, 14, on ? alpha(S, 0.14) : [255, 255, 255, 13]);
                cv.strokeRoundRect(x, 96, 486, 396, 14, 1.5, on ? alpha(S, 0.8) : [255, 255, 255, 51]);
                cv.text(profName(n), x + 24, 140, 30, t.text, { font: 'bold' });
                if (on) cv.text('IN USE', x + 462, 138, 16, S, { align: 'right', font: 'bold' });
                cv.text(on ? describe(snapshot()) : describe(sl), x + 24, 176, 18, t.dim);
                if (sl) {
                    const col = (on ? snapshot() : sl)['col_HYBRID'] || '#2bb8ea';
                    gaugeAt(cv, x + 30, 200, { soc: 72, color: OLD_IDS[col] || col, scale: 0.62, style: (on ? snapshot() : sl).gaugeStyle || 'classic' });
                    const dots = PROFILES.map((k) => { const v = (on ? snapshot() : sl)['col_' + k]; return OLD_IDS[v] || v || '#2bb8ea'; });
                    dots.forEach((dc, j) => cv.circle(x + 250 + (j % 4) * 44, 260 + Math.floor(j / 4) * 44, 14, dc));
                }
                G.button(cv, t, x + 24, 424, 210, 50, on ? 'In use' : 'Use', () => { if (!on) useProfile(n); return redraw(); }, { primary: on, key: 'use' + n });
                G.button(cv, t, x + 250, 424, 210, 50, 'Save here', () => { saveHere(n); return redraw(); }, { key: 'save' + n, confirm: !on && !!sl });
            });
        }

        const PAGES = [drawHome, drawGauge, drawLabelPage, drawRangePage, drawConsPage, drawTripPage, drawOdoPage, drawMusicPage, drawGearPage, drawProfiles];
        async function render() {
            const t = ctx.theme(), s = state();
            s.key = live.prof ? live.prof.key : null;
            const cv = ctx.canvas(1600, 520).clear(t.bg);
            try { PAGES[page](cv, t, s); } catch (e) {
                // a page that fails still shows (with the reason) and leaves the tabs working
                log.warn('page ' + TABS[page] + ': ' + (e && e.stack || e));
                cv.text('This page could not be drawn: ' + (e && e.message), 48, 140, 22, t.text);
            }
            G.frame(cv, t, TABS, page, [s.demo && { text: 'DEMO' }]);
            dirty = false; lastDraw = Date.now();
            await ui.image('MAIN_GFX', cv);
        }
        if (ctx.onTap) {
            ctx.onTap((x, y) => {
                if (page !== 1 || gaugePart !== 'colours') return null;
                const dx = x - RING.cx, dy = y - RING.cy, d = Math.sqrt(dx * dx + dy * dy);
                if (d < RING.r - 12 || d > RING.R + 12) return null;
                const m = editing || (live.prof ? live.prof.key : 'HYBRID');
                const c0 = colourOf(m), sv = satOf(c0) < 0.1 ? 1 : satOf(c0);
                return set('col_' + m, hsv((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, sv, valOf(c0) || 1));
            });
        }
        if (ctx.onTab) ctx.onTab((i) => { page = i; if (i !== 1) { editing = null; gaugePart = 'gauge'; } dirty = true; return render(); });
        settings.onChange(() => { dirty = true; });
        // what changed redraws at once; the live values (charge, mode, range) once a second
        ctx.loop('MAIN', 4, () => (dirty || Date.now() - lastDraw > 1000 ? render() : null));

        log.info('M Cluster started');
    },
});
