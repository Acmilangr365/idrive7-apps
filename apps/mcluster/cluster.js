'use strict';
/**
 * cluster.js - the two layers this app keeps on the instrument cluster.
 *
 * cluster-render (robertnisipeanu/idrive-apps, native/cluster-render) owns the
 * cluster; an app asks it for a layer on a target and writes RGBA into it. Ours
 * are two image layers on 'panel' (1920 x 720 on iDrive 7): the charge gauge and
 * the drive-mode label. Both are 'overlay' and don't contend, so they wait for a
 * free slot instead of taking one from the stock HMI.
 *
 * A layer's size is fixed when it is made, so a new size setting drops the layer
 * and makes it again. Pixels are only written when the picture changes.
 */
const { Canvas } = require('./kit/canvas');
const gauge = require('./gauge');
const gauge2 = require('./gauge2');
const cons = require('./cons');
const mfont = require('./mfont');
const gr = require('./grfont');

/**
 * The gauge has four styles (classic / ring / cell / stripes), each with its own place and size:
 * classic keeps the gaugeX / gaugeY / gaugeScale settings, the others ringX ..., cellX ..., stripesX ...
 */
const styleOf = (settings) => (['ring', 'cell', 'stripes'].indexOf(settings.get('gaugeStyle')) >= 0 ? settings.get('gaugeStyle') : 'classic');
const prefixOf = (style) => (style === 'classic' ? 'gauge' : style);

let ClusterRender = null;
try { ClusterRender = require('./cluster_render_client').ClusterRender; } catch (e) { /* reported at start */ }

const LABEL_W = 360, LABEL_H = 54;               // as tall as the text: the label can go right down to the bottom
const RANGE_W = 150, RANGE_H = 48;              // just the figure: '150 km' fits in the widened letters
const labelSize = (pct) => {
    const k = (Number(pct) || 100) / 100;
    return { w: Math.round(LABEL_W * k), h: Math.round(LABEL_H * k) };
};
const rangeSize = (pct) => {
    const k = (Number(pct) || 100) / 100;
    return { w: Math.round(RANGE_W * k), h: Math.round(RANGE_H * k) };
};
const gaugeSize = (pct) => gauge.size((Number(pct) || 100) / 100);
const consSize = (pct, style) => cons.size(pct, style);
const TRIP_W = 244, TRIP_H = 48;               // room for the widened letters
const tripSize = (pct) => {
    const k = (Number(pct) || 100) / 100;
    return { w: Math.round(TRIP_W * k), h: Math.round(TRIP_H * k) };
};

/**
 * o.settings  the app's settings (get, onChange)
 * o.log       ctx.log
 * o.state()   -> { soc, known, main, sub, range, color, arrow, labelColor }
 *
 * Four layers: the gauge, the drive-mode label, the electric range and the consumption widget (the km
 * left, a figure on its own with no sign in front), each with its own place and size.
 */
function start(o) {
    const log = o.log, settings = o.settings;
    let cr = null, timer = null, targetState = null, lastTarget = '';
    const L = {
        gauge: { ref: 0, w: 0, h: 0, cv: null, last: null },
        label: { ref: 0, w: 0, h: 0, cv: null, last: null },
        range: { ref: 0, w: 0, h: 0, cv: null, last: null },
        cons: { ref: 0, w: 0, h: 0, cv: null, last: null },
        trip: { ref: 0, w: 0, h: 0, cv: null, last: null },
        song: { ref: 0, w: 0, h: 0, cv: null, last: null },
        odo: { ref: 0, w: 0, h: 0, cv: null, last: null },
        gear: { ref: 0, w: 0, h: 0, cv: null, last: null },
    };
    let gearKnown = false;   // the gear widget shows once the car gives a gear
    let moving = true;   // the car moving: the song + consumption page shows its song only then
    let page = 0;     // the knob tilted down: 0 consumption + trip, 1 the song in their place, 2 the song (own place) + the consumption, 3 the total and trip km in their place
    const buf = (cv) => Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
    const safe = (what, fn) => (...a) => {
        try { return fn(...a); } catch (e) { log.warn('cluster: ' + what + ': ' + (e && e.message)); }
    };

    const drop = (l) => { if (cr && l.ref) cr.drop(l.ref); l.ref = 0; l.last = null; };

    /** Make, move, resize or drop one layer to match the settings. */
    const placeOne = (name, want, x, y, sz, fps) => {
        const l = L[name];
        if (!want) { drop(l); return; }
        if (l.ref && (l.w !== sz.w || l.h !== sz.h)) drop(l);
        x = Math.max(0, Math.min(1920 - sz.w, Number(x) || 0));
        y = Math.max(0, Math.min(720 - sz.h, Number(y) || 0));
        if (!l.ref) {
            l.ref = cr.image({ target: 'panel', klass: 'overlay', contend: false, exclusive: false,
                x: x, y: y, w: sz.w, h: sz.h, iw: sz.w, ih: sz.h, fps: fps || 5, z: 10 });
            if (!l.ref) { log.warn('cluster: the ' + name + ' layer was refused'); return; }
            l.w = sz.w; l.h = sz.h; l.cv = new Canvas(sz.w, sz.h); l.last = null;
        } else cr.set(l.ref, { x: x, y: y });
    };

    const place = safe('place', () => {
        if (!cr) return;
        const on = settings.get('on') !== false;
        const gp = prefixOf(styleOf(settings));
        placeOne('gauge', on && settings.get('gauge') !== false, settings.get(gp + 'X'), settings.get(gp + 'Y'), gaugeSize(settings.get(gp + 'Scale')));
        placeOne('label', on && settings.get('label') !== false, settings.get('labelX'), settings.get('labelY'), labelSize(settings.get('labelScale')));
        placeOne('range', on && settings.get('range') !== false, settings.get('rangeX'), settings.get('rangeY'), rangeSize(settings.get('rangeScale')));
        const cz = consSize(settings.get('consScale'), settings.get('consStyle')), tz = tripSize(settings.get('tripScale'));
        const cx = Number(settings.get('consX')) || 0, cy = Number(settings.get('consY')) || 0, tx = Number(settings.get('tripX')) || 0, ty = Number(settings.get('tripY')) || 0;
        placeOne('cons', on && (page === 0 || page === 2) && settings.get('cons') !== false, cx, cy, cz, 20);
        placeOne('trip', on && (page === 0 || page === 2) && settings.get('trip') !== false, tx, ty, tz);   // the trip stays with the song + consumption page
        placeOne('odo', on && page === 3, settings.get('odoX'), settings.get('odoY'), odoSize(settings.get('odoScale')), 2);
        placeOne('gear', on && settings.get('gear') !== false && gearKnown, settings.get('gearX'), settings.get('gearY'), gearSize(settings.get('gearScale')), 10);
        // page 1: the song alone, page 2: the song beside the consumption (standing, if so set: hidden, the cluster's own messages show there)
        if (page === 1) placeOne('song', on, settings.get('music1X'), settings.get('music1Y'), musicSize(settings.get('music1Scale')), 5);
        else placeOne('song', on && page === 2 && (moving || settings.get('musicMoving') === false), settings.get('musicX'), settings.get('musicY'), musicSize(settings.get('musicScale')), 5);
    });

    /** Redraw and write only what changed. */
    const tick = safe('tick', () => {
        if (!cr) return;
        const s = o.state() || {};
        const pg = s.page === 1 || s.page === 2 || s.page === 3 ? s.page : 0;
        const mv = s.moving !== false, gk = !!(s.gear && s.gear.text);
        if (pg !== page || mv !== moving || gk !== gearKnown) { page = pg; moving = mv; gearKnown = gk; place(); }
        const ge = L.gear;
        if (ge.ref) {
            const key = [s.gear.text, s.gear.manual, ge.w].join('|');
            if (key !== ge.last) { drawGear(ge.cv, s.gear); if (cr.pixels(ge.ref, null, buf(ge.cv))) ge.last = key; }
        }
        const g = L.gauge;
        if (g.ref) {
            const style = styleOf(settings), gp = prefixOf(style);
            const scale = (Number(settings.get(gp + 'Scale')) || 100) / 100, opts = gauge.optsFrom((k) => settings.get(k));
            const gf = mfont.fontOf(settings.get('gaugeFont'));
            const key = [style, s.known ? Math.round(s.soc * 2) / 2 : 'none', s.color, s.arrow, scale, gf, style === 'classic' ? JSON.stringify(opts) : ''].join('|');
            if (key !== g.last) {
                g.cv.clear([0, 0, 0, 0]);
                const base = { soc: s.known ? s.soc : null, color: s.color, arrow: s.arrow, scale: scale, dim: !s.known };
                const gcv = mfont.wrap(g.cv, gf);
                if (style === 'classic') gauge.draw(gcv, Object.assign(base, opts));
                else gauge2.draw(style, gcv, base);
                if (cr.pixels(g.ref, null, buf(g.cv))) g.last = key;
            }
        }
        const l = L.label;
        if (l.ref) {
            const lf = mfont.fontOf(settings.get('labelFont'));
            const key = [s.main, s.sub, s.labelColor, s.subColor, l.w, lf].join('|');
            if (key !== l.last) {
                drawLabel(l.cv, s.main, s.sub, s.labelColor, l.w / LABEL_W, lf, s.subColor);
                if (cr.pixels(l.ref, null, buf(l.cv))) l.last = key;
            }
        }
        const r = L.range;
        if (r.ref) {
            const uk = settings.get('units') === 'uk';
            const text = s.range === null || s.range === undefined ? '' : String(Math.round(s.range * (uk ? KM_MI : 1)));
            const rf = mfont.fontOf(settings.get('rangeFont'));
            const key = [text, r.w, rf, uk].join('|');
            if (key !== r.last) {
                drawRange(r.cv, text, r.w / RANGE_W, rf, uk ? 'mi' : 'km');
                if (cr.pixels(r.ref, null, buf(r.cv))) r.last = key;
            }
        }
        const tr = L.trip;
        if (tr.ref) {
            const uk = settings.get('units') === 'uk';
            const text = typeof s.trip === 'number' ? (s.trip * (uk ? KM_MI : 1)).toFixed(1) : '';
            const tf = mfont.fontOf(settings.get('tripFont'));
            const key = [text, tr.w, tf, uk].join('|');
            if (key !== tr.last) {
                drawTrip(tr.cv, text, tr.w / TRIP_W, tf, uk ? 'mi' : 'km');
                if (cr.pixels(tr.ref, null, buf(tr.cv))) tr.last = key;
            }
        }
        const od = L.odo;
        if (od.ref) {
            const d = s.odo || {}, uk = settings.get('units') === 'uk';
            const lang = settings.get('lang') === 'el' ? 'el' : 'en';
            const key = [d.total, d.trip, d.from, od.w, od.h, uk, lang].join('|');
            if (key !== od.last) { drawOdo(od.cv, d, uk, lang); if (cr.pixels(od.ref, null, buf(od.cv))) od.last = key; }
        }
        const sg = L.song;
        if (sg.ref) {
            const song = s.song || null, now = Date.now();
            const pos = song && typeof song.position === 'number' ? song.position + (song.playing ? now - song.at : 0) : null;
            const sec = pos === null ? '' : Math.floor(Math.min(pos, song.duration || pos) / 1000);
            const art = s.art || null;
            const mo = { text: Number(settings.get('musicText')) || 125, color: MUSIC_BAR[s.key] || MUSIC_BAR.OTHER };
            const key = (song ? [song.title, song.artist, song.album, song.playing, song.duration, sec, art ? art.id : 0].join('|') : 'none') + '|' + [sg.w, sg.h, mo.text, mo.color].join('|');
            if (key !== sg.last) {
                drawMusic(sg.cv, song, pos, art, mo);
                if (cr.pixels(sg.ref, null, buf(sg.cv))) sg.last = key;
            }
        }
        const c = L.cons;
        if (c.ref) {
            const cs = s.cons || {}, sc = Number(settings.get('consScale')) || 100;
            const num = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 10) / 10 : 'none');
            // the figure follows the value every 500 ms, the band and the mark every tick
            const now = Date.now();
            if (!c.figT || now - c.figT >= 500 || typeof cs.value !== 'number') { c.figT = now; c.fig = cs.value; }
            // the band glides to the value (about 0.3 s), so it never jumps without showing the fill in between
            const gdt = c.bandT ? Math.min(0.5, (now - c.bandT) / 1000) : 0;
            c.bandT = now;
            if (typeof cs.value !== 'number' || !isFinite(cs.value)) c.band = null;
            else if (typeof c.band !== 'number' || c.unit !== cs.unit) c.band = cs.unit === 'kw' ? cs.value : 0;
            else { c.band += (cs.value - c.band) * Math.min(1, gdt / 0.30); if (Math.abs(cs.value - c.band) < 0.05) c.band = cs.value; }
            c.unit = cs.unit;
            const style = cons.styleOf(settings.get('consStyle'));
            const cf = mfont.fontOf(settings.get('consFont')), ct = (Number(settings.get('consText')) || 100) / 100;
            const uk = settings.get('units') === 'uk';
            const key = [num(c.band), num(c.fig), num(cs.avg), cs.unit, sc, style, cf, ct, uk].join('|');
            if (key !== c.last) {
                cons.draw(mfont.wrap(c.cv, cf, 1, ct), { value: c.band, fig: c.fig, avg: cs.avg, unit: cs.unit, scale: sc, style: style, uk: uk });
                if (cr.pixels(c.ref, null, buf(c.cv))) c.last = key;
            }
        }
    });

    const connect = safe('connect', () => {
        if (cr || !ClusterRender) return;
        cr = new ClusterRender('mcluster');
        cr.on('ready', safe('ready', () => {
            log.info('cluster: connected (' + cr.backend + ', targets ' + cr.targets + ')');
            L.gauge.ref = 0; L.label.ref = 0; L.range.ref = 0; L.cons.ref = 0; L.trip.ref = 0; L.song.ref = 0;
            place(); tick();
        }));
        cr.on('disconnected', safe('gone', () => log.warn('cluster: the renderer went away, reconnecting')));
        cr.on('target', safe('target', (name, state, holder, reason) => {
            if (name !== 'panel') return;
            targetState = state;
            const t = state + (holder ? ' behind ' + holder : '') + (reason ? ' (' + reason + ')' : '');
            if (t !== lastTarget) { lastTarget = t; log.info('cluster: panel ' + t); }
        }));
        cr.on('layer', safe('layer', (ref, state, reason) => {
            const who = ref === L.gauge.ref ? 'gauge' : ref === L.label.ref ? 'label' : ref === L.range.ref ? 'range' : ref === L.cons.ref ? 'consumption' : ref === L.trip.ref ? 'trip' : ref === L.song.ref ? 'song' : 'layer ' + ref;
            log.info('cluster: ' + who + ' ' + state + (reason ? ' (' + reason + ')' : ''));
        }));
        cr.on('refused', safe('refused', (op, ref, reason) => log.warn('cluster: refused ' + op + ': ' + reason)));
        cr.connect();
        log.info('cluster: connecting to cluster-render');
    });

    connect();
    if (cr) timer = setInterval(tick, 50);
    else log.warn('cluster: cluster_render_client.js is missing, nothing will be drawn');
    const fresh = () => { L.gauge.last = null; L.label.last = null; L.range.last = null; L.cons.last = null; L.trip.last = null; L.song.last = null; };
    settings.onChange(() => { place(); fresh(); tick(); });

    return {
        available: () => !!ClusterRender,
        target: () => targetState,
        connected: () => !!(cr && cr.ready),
        refresh: () => { place(); fresh(); tick(); },
        stop: safe('stop', () => {
            if (timer) clearInterval(timer);
            timer = null;
            drop(L.gauge); drop(L.label); drop(L.range); drop(L.cons); drop(L.trip); drop(L.song);
            if (cr) { cr.removeAllListeners(); cr.close(); cr = null; }
        }),
    };
}

/** The label: the mode large, the variant small beneath it (SPORT / XTRABOOST). */
function drawLabel(cv, main, sub, color, k, font, subColor) {
    cv.clear([0, 0, 0, 0]);
    cv = mfont.wrap(cv, font);
    // one word: large; two (SPORT over XTRABOOST): the mode smaller and the variant tight under it,
    // so both fit in about the room the single word takes
    // one word: the size the mode has over a variant, sitting low where the variant would end (the same in every mode)
    if (main && !sub) cv.text(main, 4 * k, 47 * k, 27 * k, color || '#f2f5f7', { font: 'bold' });
    if (main && sub) {
        cv.text(main, 4 * k, 28 * k, 27 * k, color || '#f2f5f7', { font: 'bold' });
        cv.text(sub, 5 * k, 47 * k, 16 * k, subColor || '#b9c0c6', { font: 'bold', spacing: 1.2 * k });
    }
    return cv;
}

/** The trip distance: the electric car's symbol (as the stock widget draws it), the figure large and the unit small, all in the cluster's blue. */
function drawTrip(cv, num, k, font, unit) {
    unit = unit || 'km';
    const C = [64, 190, 224, 255], SC = 0.0815, w = 2.8 * k;
    const tx = mfont.wrap(cv, font, font === 'm' ? 1 : 1.2);      // the letters 20 % wider (M is wide as it is)
    // the right side is fixed ("km" stays on its line); the figure grows to the left and the car keeps right against it
    const KMX = 209, nw = tx.textWidth(num || '--', 40 * k, { font: 'num' }) / k, numLeft = KMX - 6 - nw, dx = numLeft - 86;
    const T = (x, y) => [(4 + dx + (x - 150) * SC) * k, (8 + (y - 190) * SC) * k];
    const line = (pts) => cv.polyline(pts.map((p) => T(p[0], p[1])), w, C);
    cv.clear([0, 0, 0, 0]);
    line([[655, 268], [525, 268], [405, 355], [280, 383], [200, 405], [176, 455], [200, 505]]);      // roof, windscreen, bonnet, nose
    line([[903, 395], [935, 405], [946, 455], [926, 495], [880, 505]]);                              // the tail
    line([[375, 500], [700, 500]]);                                                                  // the sill between the wheels
    [[305, 490], [775, 490]].forEach((c) => { const p = T(c[0], c[1]); cv.arc(p[0], p[1], 36 * SC * k, 82 * SC * k, 0, 360, C); });
    // the "e" plate: a bold e with its lower bar running out to the right and rising at the end, as drawn by the stock widget
    const PX = 48 + dx, PY = 9.8, Q = (x, y) => [(PX + x) * k, (PY + y) * k];
    const box = (x, y, w, h, r) => { const p = Q(x, y); cv.roundRect(p[0], p[1], w * k, h * k, r * k, C); };
    box(0, 0, 18.3, 6.0, 1.6);                                   // above the opening
    box(0, 0, 6.6, 10.8, 1.6);                                   // the closed left side
    box(0, 7.3, 18.3, 3.5, 1.6);                                 // the lower bar
    const K = [0, 0, 0, 255];
    cv.polyline([Q(4.3, 4.6), Q(4.3, 2.9), Q(15.2, 2.9)], 1.3 * k, K);   // the closed counter of the e
    tx.text(num || '--', numLeft * k, 41 * k, 40 * k, C, { font: 'num' });
    tx.text(unit, KMX * k, 41 * k, 24 * k, C, { font: 'num' });
    return cv;
}

/** Greek letters in Latin ones (the cluster's fonts have no Greek): tonos dropped, then letter for letter. */
const GR = { 'Α': 'A', 'Β': 'V', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'TH', 'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P', 'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'CH', 'Ψ': 'PS', 'Ω': 'O',
    'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o' };
function latin(s) {
    let x = String(s || '');
    try { x = x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* no ICU: accented letters drop below */ }
    return x.replace(/[\u0370-\u03ff]/g, (c) => (GR[c] !== undefined ? GR[c] : '')).replace(/[^\x20-\x7e]/g, '');
}

/** s cut to fit w px at size (with "..." when cut). */
function fit(cv, s, size, w, font) {
    if (cv.textWidth(s, size, { font: font, literal: true }) <= w) return s;
    let n = s.length;
    while (n > 1 && cv.textWidth(s.slice(0, n) + '...', size, { font: font, literal: true }) > w) n--;
    return s.slice(0, n).replace(/\s+$/, '') + '...';
}

/* ---------- the song playing, as the stock media widget: the cover in the middle on a blurred copy of it,
 * the title and the artist under it, the time and the bar of the time played ---------- */
// the song bar's colour in each drive mode (its own, the gauge keeps its colours)
const MUSIC_BAR = { ELECTRIC: '#4fd2ff', ELECTRIC_IND: '#4fd2ff', BATTERY: '#4fd2ff', HYBRID: '#f2f5f7', SPORT: '#e0262a', SPORT_IND: '#e0262a', BOOST: '#e0262a', OTHER: '#2bb8ea' };
const MUSIC_W = 360, MUSIC_H = 330;        // the widget at 100 %
const musicSize = (pct) => { const k = (Number(pct) || 100) / 100; return { w: Math.round(MUSIC_W * k), h: Math.round(MUSIC_H * k) }; };
const GREEN = [30, 215, 96, 255], WHITE = [242, 245, 247, 255], LIGHT = [200, 206, 212, 255], GREY = [150, 160, 168, 255], DARK = [95, 104, 112, 255];
const BLUE = [64, 180, 230, 255], TRACK = [150, 156, 162, 255];

/** The Spotify mark: a green disc with three dark arcs (in place of a cover). */
function spotifyMark(cv, x, y, r) {
    cv.circle(x, y, r, GREEN);
    const c = [12, 14, 16, 255];
    [[0.78, 0.13, -38, 38, -0.28], [0.58, 0.11, -36, 36, -0.02], [0.40, 0.09, -34, 34, 0.22]].forEach((a) => {
        const rr = r * a[0] * 1.9, cy = y + a[4] * r + rr;
        cv.arc(x, cy, rr - r * a[1], rr, a[2], a[3], c, { round: true });
    });
}

const mmss = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); };

/** src (RGBA, sw x sh) to dw x dh: each pixel the average of the source pixels it covers (at least one). */
function resample(src, sw, sh, dw, dh) {
    const out = new Uint8Array(dw * dh * 4), fx = sw / dw, fy = sh / dh;
    for (let y = 0; y < dh; y++) {
        const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * fy)));
        for (let x = 0; x < dw; x++) {
            const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * fx)));
            let r = 0, g = 0, b = 0, n = 0;
            for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * sw + xx) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
            const o = (y * dw + x) * 4;
            out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
        }
    }
    return out;
}

/** src (sw x sh, small) blown up smoothly to dw x dh (bilinear). */
function enlarge(src, sw, sh, dw, dh) {
    const out = new Uint8Array(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        const fy = Math.max(0, Math.min(sh - 1, (y + 0.5) * sh / dh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < dw; x++) {
            const fx = Math.max(0, Math.min(sw - 1, (x + 0.5) * sw / dw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
            const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4, o = (y * dw + x) * 4;
            for (let k = 0; k < 3; k++) out[o + k] = (src[a + k] * (1 - tx) + src[b + k] * tx) * (1 - ty) + (src[c + k] * (1 - tx) + src[d + k] * tx) * ty;
            out[o + 3] = 255;
        }
    }
    return out;
}

/** Pixels (RGBA, w x h) put on cv at (x, y), each pixel's alpha times a (0..1), over what is there. */
function put(cv, px, w, h, x, y, a) {
    x = Math.round(x); y = Math.round(y);
    for (let j = 0; j < h; j++) {
        const yy = y + j;
        if (yy < 0 || yy >= cv.h) continue;
        for (let i = 0; i < w; i++) {
            const xx = x + i;
            if (xx < 0 || xx >= cv.w) continue;
            const s = (j * w + i) * 4, d = (yy * cv.w + xx) * 4, al = px[s + 3] / 255 * (typeof a === 'number' ? a : 1);
            if (al <= 0) continue;
            const da = cv.d[d + 3] / 255, oa = al + da * (1 - al);
            for (let k = 0; k < 3; k++) cv.d[d + k] = oa > 0 ? (px[s + k] * al + cv.d[d + k] * da * (1 - al)) / oa : 0;
            cv.d[d + 3] = oa * 255;
        }
    }
}

// the cover's pictures for the last size asked (the art changes once a song)
let artCache = { key: '' };
function artFor(art, cw, bw, bh) {
    const key = [art.id, cw, bw, bh].join('|');
    if (artCache.key === key) return artCache;
    const cover = resample(art.d, art.w, art.h, cw, cw);
    artCache = { key: key, cover: cover };
    return artCache;
}

/**
 * The song playing, on black (nothing of the map under it). song: { title, artist, duration (ms), playing } or null;
 * pos: ms or null; art: { id, w, h, d (RGBA) } or null (the Spotify mark in the cover's place);
 * o.text: the lettering in % (70..170), o.color: the bar's colour (the drive mode's).
 */
function drawMusic(cv, song, pos, art, o) {
    o = o || {};
    const k = Math.min(cv.w / MUSIC_W, cv.h / MUSIC_H), ox = (cv.w - MUSIC_W * k) / 2, oy = (cv.h - MUSIC_H * k) / 2;
    const tz = Math.max(0.7, Math.min(1.7, (Number(o.text) || 125) / 100));
    const X = (v) => ox + v * k, Y = (v) => oy + v * k;
    const T = (s, x, y, size, c, align) => {
        const f = { font: 'label', literal: true };
        const w = align === 'right' ? cv.textWidth(s, size * k, f) : 0;
        cv.text(s, X(x) - w, Y(y), size * k, c, f);
    };
    cv.clear([0, 0, 0, 255]);
    // from the bottom up: the bar, the time, the artist, the title; the cover takes what is left (150 at most)
    const by = 300, timeY = by - 12, albumY = timeY - 22 * tz - 4, artistY = albumY - 21 * tz - 6, titleY = artistY - 24 * tz - 8;
    const room = titleY - 30 * tz - 10;
    const cw = Math.round(Math.max(60, Math.min(150, room - 4)) * k), cx = X(MUSIC_W / 2) - cw / 2, cy = Y(4);
    if (art && art.d) {
        const a = artFor(art, cw, cv.w, cv.h);
        cv.fillRect(cx - 1 * k, cy - 1 * k, cw + 2 * k, cw + 2 * k, [70, 76, 82, 255]);
        put(cv, a.cover, cw, cw, cx, cy);
    } else {
        cv.fillRect(cx, cy, cw, cw, [28, 32, 36, 255]);
        spotifyMark(cv, cx + cw / 2, cy + cw / 2, cw * 0.3);
    }
    const W = MUSIC_W - 16;
    if (!song || !song.title) {
        T('No song', 8, titleY, 30 * tz, DARK);
        return cv;
    }
    if (!song.playing) {
        // paused: two bars on the cover
        const bx = cx + cw - 34 * k, bly = cy + cw - 38 * k;
        cv.roundRect(bx - 6 * k, bly - 6 * k, 34 * k, 38 * k, 5 * k, [0, 0, 0, 170]);
        cv.fillRect(bx, bly, 8 * k, 26 * k, WHITE); cv.fillRect(bx + 14 * k, bly, 8 * k, 26 * k, WHITE);
    }
    // the title in pure white and bold lettering, Greek as it is (own atlas with Greek: grfont)
    const title = gr.clean(song.title, latin), artist = gr.clean(song.artist, latin);
    gr.text(cv, gr.fit(title, 30 * tz * k, W * k, 'bold'), X(8), Y(titleY), 30 * tz * k, song.playing ? [255, 255, 255, 255] : GREY, 'bold');
    if (artist) gr.text(cv, gr.fit(artist, 24 * tz * k, W * k, 'label'), X(8), Y(artistY), 24 * tz * k, LIGHT, 'label');
    // under them: "Album:" and the album's name
    const album = gr.clean(song.album, latin);
    if (album) {
        const lw = gr.text(cv, 'Album: ', X(8), Y(albumY), 20 * tz * k, GREY, 'label');
        gr.text(cv, gr.fit(album, 20 * tz * k, W * k - lw, 'label'), X(8) + lw, Y(albumY), 20 * tz * k, LIGHT, 'label');
    }
    // the time and its bar: the played part thick in the drive mode's colour with a slanted end, the rest a thin line
    const dur = song.duration > 0 ? song.duration : null, x0 = 8, x1 = MUSIC_W - 8;
    if (pos !== null) T(mmss(pos), x1, timeY, 22 * tz, WHITE, 'right');
    else if (dur) T(mmss(dur), x1, timeY, 22 * tz, WHITE, 'right');
    cv.fillRect(X(x0), Y(by - 1.5), (x1 - x0) * k, 3 * k, TRACK);
    if (dur && pos !== null) {
        const f = Math.max(0, Math.min(1, pos / dur)), xe = x0 + (x1 - x0) * f;
        if (xe - x0 > 2) cv.convex([[X(x0), Y(by - 6)], [X(xe + 3), Y(by - 6)], [X(xe - 3), Y(by + 6)], [X(x0), Y(by + 6)]], song.playing ? (o.color || BLUE) : GREY);
    }
    return cv;
}

/**
 * The car's total km and the km of the trip chosen in the iDrive, as the stock widget (without its electric km):
 * "Συνολική 131732 km" over a line, "Τιμές από" and the trip's name or start, then "•→| 261.4 km".
 * d: { total: km or null, trip: km or null, from: text or null }.
 */
/* ---------- the gear: P, R, N, D1 ... D8, M1 ... M8 (S1 ...), in the M dials' lettering, white; the M red ---------- */
const GEAR_W = 230, GEAR_H = 110;
const gearSize = (pct) => { const k = (Number(pct) || 100) / 100; return { w: Math.round(GEAR_W * k), h: Math.round(GEAR_H * k) }; };
/** g: { text: 'D3' | 'P' | ..., manual: bool }. Drawn centred in the layer. */
function drawGear(cv, g) {
    const k = cv.w / GEAR_W, size = 120 * k, Wc = [242, 245, 247, 255], RED = [224, 38, 42, 255];
    cv.clear([0, 0, 0, 0]);
    const t = String((g && g.text) || '');
    if (!t) return cv;
    const head = t[0], rest = t.slice(1), wh = mfont.width(head, size), wr = rest ? mfont.width(rest, size) : 0, gap = rest ? 8 * k : 0;
    const x = (cv.w - wh - gap - wr) / 2, y = cv.h / 2 + 0.36 * size;
    mfont.draw(cv, head, x, y, size, head === 'M' && g.manual ? RED : Wc);
    if (rest) mfont.draw(cv, rest, x + wh + gap, y, size, Wc);
    return cv;
}

const ODO_W = 420, ODO_H = 300;
const odoSize = (pct) => { const k = (Number(pct) || 100) / 100; return { w: Math.round(ODO_W * k), h: Math.round(ODO_H * k) }; };
const KM_MI = 0.621371;   // km to miles (the UK setting)
function drawOdo(cv, d, uk, lang) {
    const el = lang === 'el';
    const f = uk ? KM_MI : 1, U = uk ? 'mi' : 'km';
    const k = Math.min(cv.w / ODO_W, cv.h / ODO_H), ox = (cv.w - ODO_W * k) / 2, oy = (cv.h - ODO_H * k) / 2;
    const X = (v) => ox + v * k, Y = (v) => oy + v * k;
    const Wc = [242, 245, 247, 255], Gc = [170, 176, 182, 255];
    cv.clear([0, 0, 0, 255]);
    const total = typeof d.total === 'number' ? String(Math.floor(d.total * f)) : '-';
    const t1 = el ? 'Συνολική' : 'Total', w1 = gr.width(t1, 34 * k, 'label'), w2 = gr.width(total, 38 * k, 'label'), w3 = gr.width(U, 30 * k, 'label'), sp = 10 * k;
    let x = (cv.w - (w1 + sp + w2 + sp + w3)) / 2;
    gr.text(cv, t1, x, Y(52), 34 * k, Wc, 'label'); x += w1 + sp;
    gr.text(cv, total, x, Y(52), 38 * k, Wc, 'label'); x += w2 + sp;
    gr.text(cv, U, x, Y(52), 30 * k, Wc, 'label');
    cv.fillRect(X(20), Y(72), 130 * k, 4 * k, Wc); cv.convex([[X(150), Y(72)], [X(158), Y(72)], [X(154), Y(76)], [X(146), Y(76)]], Wc); cv.fillRect(X(150), Y(72), 250 * k, 3 * k, Wc);
    if (d.from) {
        const a = el ? 'Τιμές από' : 'Values from', wa = gr.width(a, 30 * k, 'label');
        gr.text(cv, a, (cv.w - wa) / 2, Y(128), 30 * k, Gc, 'label');
        const from = gr.fit(gr.clean(d.from, latin), 36 * k, (ODO_W - 20) * k, 'label'), wf = gr.width(from, 36 * k, 'label');
        gr.text(cv, from, (cv.w - wf) / 2, Y(172), 36 * k, Wc, 'label');
    }
    // •→| and the trip km, the whole centred
    const trip = typeof d.trip === 'number' ? (d.trip * f).toFixed(1) : '-', wt = gr.width(trip, 40 * k, 'label'), wk = gr.width(U, 30 * k, 'label');
    const full = 52 * k + 18 * k + wt + 10 * k + wk, ix = (cv.w - full) / 2, iy = Y(d.from ? 228 : 160);   // no 'values from' line: the trip km moves up
    cv.circle(ix + 4 * k, iy, 4 * k, Wc); cv.fillRect(ix + 14 * k, iy - 2 * k, 22 * k, 4 * k, Wc);
    cv.convex([[ix + 34 * k, iy - 8 * k], [ix + 44 * k, iy], [ix + 34 * k, iy + 8 * k]], Wc); cv.fillRect(ix + 48 * k, iy - 10 * k, 4 * k, 20 * k, Wc);
    gr.text(cv, trip, ix + 70 * k, iy + 14 * k, 40 * k, Wc, 'label');
    gr.text(cv, U, ix + 70 * k + wt + 10 * k, iy + 14 * k, 30 * k, Wc, 'label');
    return cv;
}

/** The electric range: the figure and a smaller "km", in the trip's lettering and cyan. num: the km as a string. */
function drawRange(cv, num, k, font, unit) {
    unit = unit || 'km';
    cv.clear([0, 0, 0, 0]);
    if (!num) return cv;
    const C = [64, 190, 224, 255], tx = mfont.wrap(cv, font, font === 'm' ? 1 : 1.2);
    // the right side is fixed: "km" ends at the layer's right edge, the figure grows to the left
    const nw = tx.textWidth(num, 40 * k, { font: 'num' }), kw = tx.textWidth(unit, 24 * k, { font: 'num' });
    const x0 = cv.w - 3 * k - kw - 6 * k - nw;
    tx.text(num, x0, 41 * k, 40 * k, C, { font: 'num' });
    tx.text(unit, x0 + nw + 6 * k, 41 * k, 24 * k, C, { font: 'num' });
    return cv;
}

module.exports = { start, drawGear, gearSize, drawOdo, odoSize, MUSIC_BAR, drawMusic, musicSize, shrink: resample, MUSIC_W, MUSIC_H, drawLabel, drawRange, drawTrip, labelSize, rangeSize, gaugeSize, consSize, tripSize, styleOf, prefixOf, LABEL_W, LABEL_H };
