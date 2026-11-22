'use strict';
/**
 * gauge.js - the 330e's battery gauge, redrawn for the M cluster layout.
 *
 * Everything is worked out in the pixels of the photo the outline was traced from
 * and scaled to the layer at the end, so the size setting scales the whole gauge
 * (outline, glow, numbers, icon) together.
 *
 *   the shell      the traced white outline, with the short arm at the 0 end
 *   the channel    a band just inside the shell: grey where empty, the red reserve at 0-8 %
 *   the glow       the charged part: bright at the shell and fading inwards, its ends
 *                  running along the 100 line and the 0 arm (no dark wedges), cut level
 *                  with the ground at the charge
 *   the level bar  along the level line (it follows the stock gauge's slope), from where the blue ends at the channel's
 *                  inner line to where the fade begins; it sits on the blue's upper edge and fades out to the left
 *   the readout    the charge in white, the 100 / 0 numbers, % and the battery icon
 *
 * Nothing here touches the car: it only draws on a kit Canvas.
 *
 *   const g = require('./gauge');
 *   const size = g.size(1.0);                  // { w, h } of the layer at 100 %
 *   g.draw(cv, { soc: 72, color: '#2bb8ea', arrow: '#ffffff', scale: 1.0, depth: 0.66, bar: 12 });
 */

/* ---------- geometry (photo pixels) ---------- */
const TRACE = [[560, 77], [628, 79], [660, 100], [700, 165], [724, 230], [730, 300], [726, 400],
    [712, 480], [688, 545], [655, 600], [605, 670], [550, 740], [490, 800], [420, 845], [340, 870], [270, 878]];
const TAIL = [[270, 878], [66, 808]];
const MARKS = [[100, [628, 79]], [75, [705, 300]], [50, [640, 578]], [25, [495, 770]], [0, [270, 878]]];
// where the glow fades to: a curve whose ends run along the 100 line and along the 0 arm
const FADE = [[360, 80], [0, 440], [66, 808]];
const OX = 55, OY = 50, BASE_K = 0.32;                 // photo pixels -> layer pixels at 100 %
const BASE_W = 240, BASE_H = 280;
const SHELL = 13, SH = 10, POCKET_IN = 3.2;            // shell stroke, channel start, glow start
const LAYERS = 26;

function smooth(pts, n) {
    const Q = [pts[0]].concat(pts, [pts[pts.length - 1]]), out = [];
    for (let i = 1; i < Q.length - 2; i++) {
        const a = Q[i - 1], b = Q[i], c = Q[i + 1], d = Q[i + 2];
        for (let k = 0; k < n; k++) {
            const t = k / n, t2 = t * t, t3 = t2 * t;
            out.push([0, 1].map((j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t
                + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3)));
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}
const CURVE = smooth(TRACE, 14);
const LEN = [0];
for (let i = 1; i < CURVE.length; i++) LEN.push(LEN[i - 1] + Math.hypot(CURVE[i][0] - CURVE[i - 1][0], CURVE[i][1] - CURVE[i - 1][1]));
const TOTAL = LEN[LEN.length - 1];

/** The point and the inward normal at distance s along the shell. */
function at(s) {
    s = Math.max(0, Math.min(TOTAL, s));
    for (let i = 1; i < LEN.length; i++) {
        if (LEN[i] >= s) {
            const a = CURVE[i - 1], b = CURVE[i];
            const t = (s - LEN[i - 1]) / Math.max(1e-9, LEN[i] - LEN[i - 1]);
            const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
            return { p: [a[0] + dx * t, a[1] + dy * t], n: [-dy / d, dx / d] };
        }
    }
    return { p: CURVE[CURVE.length - 1], n: [0, -1] };
}
const off = (s, d) => { const o = at(s); return [o.p[0] + o.n[0] * d, o.p[1] + o.n[1] * d]; };
const curve = (s0, s1, d, n) => { const o = []; n = n || 80; for (let i = 0; i <= n; i++) o.push(off(s0 + (s1 - s0) * i / n, d)); return o; };

const nearest = (q) => {
    let best = 0, bd = Infinity;
    CURVE.forEach((c, i) => { const d = Math.hypot(c[0] - q[0], c[1] - q[1]); if (d < bd) { bd = d; best = i; } });
    return LEN[best];
};
const ALONG = MARKS.map((m) => [m[0], nearest(m[1])]);
function alongFor(pct) {
    const v = Math.max(0, Math.min(100, pct));
    for (let i = 0; i < ALONG.length - 1; i++) {
        const a = ALONG[i], b = ALONG[i + 1];
        if (v <= a[0] && v >= b[0]) return a[1] + (b[1] - a[1]) * (a[0] - v) / (a[0] - b[0]);
    }
    return ALONG[ALONG.length - 1][1];
}
const S100 = alongFor(100), S0 = alongFor(0);
const fadeAt = (f) => [0, 1].map((j) => (1 - f) * (1 - f) * FADE[0][j] + 2 * f * (1 - f) * FADE[1][j] + f * f * FADE[2][j]);

/** Keep the part of a polygon at or below y (Sutherland-Hodgman against one horizontal edge). */
function below(poly, y) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ain = a[1] >= y, bin = b[1] >= y;
        if (ain) out.push(a);
        if (ain !== bin) { const t = (y - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, y]); }
    }
    return out;
}

/** Keep the part of a polygon on the far side (toward 0) of the line through p, along the shell's normal. */
function beyond(poly, p, t) {
    const f = (q) => (q[0] - p[0]) * t[0] + (q[1] - p[1]) * t[1];
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
        if (fa >= 0) out.push(a);
        if ((fa >= 0) !== (fb >= 0)) { const u = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
    }
    return out;
}

// the slope of the level line (degrees, falling to the right) read off the stock gauge, by charge
const SLOPE = [[100, 0], [87, 8], [75, 5], [62, 8], [50, 15], [37, 23], [25, 14], [12, 10], [0, 8]];
function slopeFor(pct) {
    const v = Math.max(0, Math.min(100, pct));
    for (let i = 0; i < SLOPE.length - 1; i++) {
        const a = SLOPE[i], b = SLOPE[i + 1];
        if (v <= a[0] && v >= b[0]) return (a[1] + (b[1] - a[1]) * (a[0] - v) / (a[0] - b[0])) * Math.PI / 180;
    }
    return 0;
}

function toRgb(c) {
    if (Array.isArray(c)) return c.slice(0, 3);
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [43, 184, 234];
}

/** The layer's size for a scale (1 = 100 %). */
function size(scale) {
    const k = Number(scale) > 0 ? Number(scale) : 1;
    return { w: Math.round(BASE_W * k), h: Math.round(BASE_H * k) };
}

/**
 * Draw the gauge.
 *   o.soc    charge 0-100, or null: no reading (empty, numbers dimmed, '--')
 *   o.color  the glow's colour
 *   o.arrow  the level bar's colour (white; red in Sport)
 *   o.scale  1 = 100 %
 *   o.depth  how far the glow reaches in from the shell before it has faded out (0.2 ... 1)
 *   o.bar    the level bar's thickness in photo pixels (12 = as before)
 *   o.pctOn / o.pctSize / o.pctDX / o.pctDY   the charge in figures: on, size in % (100 = as the stock 50),
 *            and moved by dx / dy layer pixels at 100 % (it still steps above the level bar where they meet)
 *   o.dim    everything a little dimmer (no car data yet)
 */
function draw(cv, o) {
    o = o || {};
    const k = BASE_K * (Number(o.scale) > 0 ? Number(o.scale) : 1);
    const T = (p) => [(p[0] - OX) * k, (p[1] - OY) * k];
    const TP = (pts) => pts.map(T);
    const W = 48;                                       // the channel's width (photo pixels), fixed
    const reach = Math.max(0.15, Math.min(1, Number(o.depth) || 0.66));
    const known = typeof o.soc === 'number' && isFinite(o.soc);
    const soc = known ? Math.max(0, Math.min(100, o.soc)) : 0;
    const rgb = toRgb(o.color || '#2bb8ea');
    const white = o.dim ? '#8a9095' : '#f2f4f5';

    // the shell and the 0 arm
    cv.polyline(TP(CURVE), SHELL * k, white);
    cv.polyline(TP(TAIL), 12 * k, white);
    // the empty channel: almost black
    cv.fill(TP(curve(S100, S0, SH).concat(curve(S100, S0, SH + W).reverse())), [14, 15, 17, 235]);

    if (known && soc > 0.4) {
        const sl = alongFor(soc), N = 60;
        // the colour lives on the face only, from the channel's inner line inwards
        // the glow is always built for the full face (right up to the 100 line) and then cut along the level line,
        // so its top edge lies exactly on the line, whatever the slope
        const M = N * 2, edge = curve(S100, S0, SH + W, M);
        const tgt = edge.map((q, i) => fadeAt(i / M));
        const edgeC = curve(sl, S0, SH + W, N);                // the charged part of the inner line only
        const lv = { p: off(sl, SH + W) }, an = slopeFor(soc), dir = [Math.cos(an), Math.sin(an)], tg = [-Math.sin(an), Math.cos(an)];
        const cutP = [lv.p[0] - tg[0] * 3, lv.p[1] - tg[1] * 3];
        const depth = (j) => Math.pow(j / LAYERS, 1.35);
        const level = (t) => 0.9 * Math.pow(Math.max(0, 1 - t / reach), 2.3);
        for (let j = LAYERS; j >= 1; j--) {
            const t = depth(j), inner = level(depth(j - 1)), outer = level(t);
            if (inner <= 0.002) continue;
            const a = 1 - (1 - inner) / (1 - outer);
            if (a <= 0.002) continue;
            const ring = edge.map((q, i) => [q[0] + (tgt[i][0] - q[0]) * t, q[1] + (tgt[i][1] - q[1]) * t]);
            const full = edge.concat(ring.reverse()), poly = beyond(full, cutP, tg);
            if (poly.length >= 3) cv.fill(TP(poly), [rgb[0], rgb[1], rgb[2], Math.round(a * 255)]);
        }
        cv.polyline(TP(edgeC), 5 * k, [rgb[0], rgb[1], rgb[2], 110]);
        if (true) {
            const E = 14, L0 = 0, L1 = 230;
            for (let i = 0; i < E; i++) {
                const d0 = L0 + (L1 - L0) * i / E, d1 = L0 + (L1 - L0) * (i + 1) / E;
                const A = Math.round(235 * Math.pow(1 - i / E, 1.6));
                const a = T([lv.p[0] - dir[0] * d0, lv.p[1] - dir[1] * d0]), b = T([lv.p[0] - dir[0] * (d1 + 1), lv.p[1] - dir[1] * (d1 + 1)]);
                cv.line(a[0], a[1], b[0], b[1], 3.2 * k, [Math.min(255, rgb[0] + 60), Math.min(255, rgb[1] + 60), Math.min(255, rgb[2] + 60), A]);
            }
        }
        // the charged part of the channel: almost black, a touch lighter at the shell
        const G = 7;
        for (let j = 0; j < G; j++) {
            const d0 = SH + W * j / G, d1 = SH + W * (j + 1) / G, f = j / (G - 1);
            const c = [Math.round(52 - 30 * f), Math.round(54 - 30 * f), Math.round(58 - 30 * f), 245];   // almost black
            cv.fill(TP(curve(sl, S0, d0, N).concat(curve(sl, S0, d1 + 0.6, N).reverse())), c);
        }
    }
    // the channel's inner line
    cv.polyline(TP(curve(S100, S0, SH + W)), 4 * k, [201, 205, 209, 255]);
    // the level bar: level with the ground, out of the shell to the left
    const barY = known && soc >= 1 ? at(alongFor(soc)).p[1] : null;
    if (barY !== null) {
        const sb = alongFor(soc), thP = Number(o.bar) || 12, th = thP * k, N = 22;
        const lvb = { p: off(sb, SH + W) }, anb = slopeFor(soc), dxb = Math.cos(anb), dyb = Math.sin(anb);
        // from the channel's inner line (where the blue ends) to where the fade begins; it sits on the blue's upper edge
        const L0 = 0, L1 = 230;
        const lift = thP / 2 + 3;
        const col = toRgb(o.arrow || '#ffffff');
        for (let i = 0; i < N; i++) {
            const d0 = L0 + (L1 - L0) * i / N, d1 = L0 + (L1 - L0) * (i + 1) / N;
            const A = Math.round(255 * (i < N * 0.35 ? 1 : Math.pow(1 - (i - N * 0.35) / (N * 0.65), 1.3)));
            const pb = [lvb.p[0] + dyb * lift, lvb.p[1] - dxb * lift], dx = dxb, dy = dyb;   // lifted off the blue, perpendicular to the line
            const a = T([pb[0] - dx * d0, pb[1] - dy * d0]), b = T([pb[0] - dx * (d1 + 1.5), pb[1] - dy * (d1 + 1.5)]);
            cv.line(a[0], a[1], b[0], b[1], th, [col[0], col[1], col[2], A]);
        }
    }
    // the marks: 50 across the channel, 75 and 25 short and thin, as the stock fuel gauge's quarters
    ALONG.slice(1, -1).forEach((m) => {
        if (m[0] === 50) {
            // 50: an arrow pointing in from the shell, across the channel
            const o = at(m[1]), tx = [-o.n[1], o.n[0]];              // the shell's direction there
            const P0 = (d, w) => [o.p[0] + o.n[0] * d + tx[0] * w, o.p[1] + o.n[1] * d + tx[1] * w];
            cv.fill([P0(-2, -15), P0(-2, 15), P0(SH + W + 16, 3.5), P0(SH + W + 16, -3.5)].map(T), white);
            return;
        }
        const a = T(off(m[1], -4)), b = T(off(m[1], SH + W * 0.45));
        cv.line(a[0], a[1], b[0], b[1], 4 * k, [230, 233, 236, 170]);
    });

    // the numbers, the charge, % and the battery icon
    const num = o.dim ? '#9aa0a6' : '#f6f8f9';
    const txt = (s, p, sz, opt) => { const q = T(p); cv.text(s, q[0], q[1], sz * k, num, Object.assign({ align: 'center', font: 'bold' }, opt)); };
    txt('100', [470, 140], 90);
    txt('0', [170, 780], 90);
    // the charge sits where the stock 50 was (or where it was moved); when the level bar crosses it,
    // it steps above the bar
    if (o.pctOn !== false) {
        const fs = 105 * (Number(o.pctSize) || 100) / 100;
        const px = 430 + (Number(o.pctDX) || 0) / BASE_K, py = 705 + (Number(o.pctDY) || 0) / BASE_K;
        const ry = barY !== null && barY > py - fs * 0.75 - 10 && barY < py + 30 ? barY - 30 : py;
        txt(known ? Math.round(soc) + '%' : '--', [px, ry], fs);
    }
    txt('%', [720, 690], 80);
    battery(cv, T, k, num);
    return cv;
}

/** The stacked-cells battery icon with the arrow (photo pixels through T). */
function battery(cv, T, k, c) {
    const w = 7 * k;
    const rect = (x, y, rw, rh) => {
        const p = [[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh], [x, y]].map(T);
        cv.polyline(p, w, c);
    };
    rect(648, 748, 120, 72);
    const f = [[626, 728], [748, 728], [748, 800], [626, 800]].map(T);
    cv.fill(f, '#000000');
    rect(626, 728, 122, 72);
    const ln = (a, b) => { const p = T(a), q = T(b); cv.line(p[0], p[1], q[0], q[1], w, c); };
    ln([646, 764], [670, 764]);
    ln([700, 764], [726, 764]);
    ln([713, 752], [713, 776]);
    cv.fill([[602, 778], [602, 808], [572, 793]].map(T), c);
}

/** The drawing options the settings hold (shared by the cluster layer and the app's preview). */
function optsFrom(get) {
    return {
        depth: (Number(get('gaugeDepth')) || 66) / 100, bar: Number(get('gaugeBar')) || 12,
        pctOn: get('pctOn') !== false, pctSize: Number(get('pctSize')) || 100,
        pctDX: Number(get('pctDX')) || 0, pctDY: Number(get('pctDY')) || 0,
    };
}

module.exports = { draw, size, optsFrom, alongFor, BASE_W, BASE_H };
