'use strict';
/**
 * cons.js - the battery consumption widget: a half circle, 60 kWh/100km at the top, -30 at the bottom.
 *
 *   above zero  blue, the battery is giving power
 *   below zero  green, it is taking it (regeneration, charging); the figure is green with REGEN under it
 *   zero        a white mark across the band; the average (the diameter sign) another one, outside the arc
 *
 * Drawn in design units (a 620 x 740 box) and scaled by the setting. draw(cv, { value, avg, scale, dim }):
 * value and avg in kWh/100km (null = no reading yet: the empty track and "--").
 */
const VMIN = -30, VMAX = 60;
const CX = 250, CY = 390, R0 = 247, R1 = 341, RO = 364;     // centre, band inside / outside, outline
const OX = 180, OY = 20, BOX_W = 780, BOX_H = 740;          // the part of the design the layer holds

/**
 * UK figures: the per-100 km consumptions as mi/kWh (electric) and mpg (UK gallon), l/h as gal/h, kW as it is;
 * null where it has no meaning (nothing used, or charging). The band keeps the metric scale either way.
 */
function ukFig(v, unit) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    if (unit === 'kwh') return v > 0.05 ? Math.min(99.9, 62.1371 / v) : null;
    if (unit === 'l') return v > 0.05 ? Math.min(99.9, 282.481 / v) : null;
    if (unit === 'lh') return v * 0.219969;
    return v;
}
const UK_UNIT = { kwh: 'mi/kWh', l: 'mpg', lh: 'gal/h', kw: 'kW' };
const WHITE = [240, 242, 244, 255], BLUE = [64, 190, 224, 255], GREEN = [70, 205, 115, 255], DARK = [18, 20, 23, 255], TRACK = [38, 41, 45, 255];

const clampV = (v) => Math.max(VMIN, Math.min(VMAX, v));
const ang = (v) => (-90 + (VMAX - clampV(v)) / (VMAX - VMIN) * 180) * Math.PI / 180;
const P = (r, a) => [CX + r * Math.cos(a), CY + r * Math.sin(a)];

/** The layer's size at a scale in percent. */
function size(pct) {
    const k = (Number(pct) || 100) / 100;
    return { w: Math.round(BOX_W * k), h: Math.round(BOX_H * k) };
}

function draw(cv, o) {
    const k = (Number(o.scale) || 100) / 100 * 1;
    const T = (p) => [(p[0] - OX) * k, (p[1] - OY) * k];
    const line = (a, b, w, c) => { const p = T(a), q = T(b); cv.line(p[0], p[1], q[0], q[1], w * k, c); };
    const text = (s, x, y, sz, al, c) => { const p = T([x, y]); cv.text(s, p[0], p[1], sz * k, c || WHITE, { align: al || 'left', font: 'bold' }); };
    const band = (v0, v1, r0, r1, c) => {
        const a0 = ang(v0), a1 = ang(v1), n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.03)), out = [], inn = [];
        for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push(T(P(r1, a))); inn.push(T(P(r0, a))); }
        cv.fill(out.concat(inn.reverse()), c);
    };
    cv.clear([0, 0, 0, 0]);
    // fuel (l/100km, l/h): 0 to 20 on the 0 to 60 part of the arc, a white fill, no regeneration
    const fuel = o.unit === 'l' || o.unit === 'lh', F = fuel ? 3 : 1;
    const known = typeof o.value === 'number' && isFinite(o.value);
    const v = known ? clampV(fuel ? Math.max(0, o.value) * F : o.value) : 0;
    band(VMAX, VMIN, R0, R1, TRACK);
    if (known && v > 0.05) band(0, v, R0, R1, fuel ? FUEL : BLUE);
    if (known && v < -0.05) band(0, v, R0, R1, GREEN);
    [-20, 20, 40].forEach((m) => { const a = ang(m); line(P(R0 - 1, a), P(R1 + 1, a), 3, DARK); });
    // the outline and its base
    const out = [];
    for (let i = 0; i <= 60; i++) out.push(T(P(RO, ang(VMAX) + (ang(VMIN) - ang(VMAX)) * i / 60)));
    cv.polyline(out, 6 * k, WHITE);
    line(P(RO, ang(VMIN)), P(R0 - 14, ang(VMIN)), 6, WHITE);
    // zero
    line(P(R0 - 12, ang(0)), P(RO + 2, ang(0)), 6, WHITE);
    // the average
    const kwMode = o.unit === 'kw';
    const hasAvg = typeof o.avg === 'number' && isFinite(o.avg);
    if (hasAvg) {
        const aa = ang(Math.max(-25, Math.min(42, o.avg * F)));
        line(P(R0 - 12, aa), P(RO + 2, aa), 7, WHITE);
        const g = P(RO + 46, aa), gx = g[0] + 6, gy = g[1] + 4, rx = 25, ry = 36, ring = [];
        for (let i = 0; i <= 28; i++) { const t = i / 28 * Math.PI * 2; ring.push(T([gx + Math.cos(t) * rx, gy + Math.sin(t) * ry])); }
        cv.polyline(ring, 6.5 * k, WHITE);                                   // the font has no diameter sign: a ring and a slash
        line([gx + rx + 7, gy - ry - 8], [gx - rx - 7, gy + ry + 8], 6.5, WHITE);
        const av = o.uk ? ukFig(o.avg, o.unit) : o.avg;
        text(av === null ? '--' : av.toFixed(1), gx + rx + 20, gy + 32, 94);
    }
    // the scale, inside the arc
    (fuel ? [[60, '20'], [30, '10'], [0, '0']] : [[60, '60'], [40, '40'], [20, '20'], [0, '0'], [-20, '-20']]).forEach(([m, l]) => { const p = P(R0 - 34, ang(m)); text(l, p[0], p[1] + 14, 42, 'center'); });
    // the reading and its unit
    // the figure may be a slower copy of the value than the band (o.fig)
    const fig = typeof o.fig === 'number' && isFinite(o.fig) ? o.fig : o.value, figKnown = known && typeof fig === 'number';
    const neg = !fuel && figKnown && fig < 0, c = neg ? GREEN : WHITE;
    const shown = figKnown && o.uk ? ukFig(fig, o.unit) : fig;
    text(figKnown && shown !== null ? shown.toFixed(1) : '--', CX + 62, CY + 26, 124, 'center', figKnown ? c : [150, 156, 162, 255]);
    if (o.uk) text(UK_UNIT[o.unit] || '', CX - 8, CY + 98, 52, 'left', c);
    else if (kwMode) text('kW', CX - 8, CY + 98, 52, 'left', c);
    else if (o.unit === 'lh') text('l/h', CX - 8, CY + 98, 52, 'left', c);
    else if (o.unit === 'l') text('l/100km', CX - 8, CY + 98, 52, 'left', c);
    else { text('kWh/', CX - 8, CY + 98, 52, 'left', c); text('100km', CX - 8, CY + 158, 52, 'left', c); }
    if (neg) text(kwMode ? 'CHARGING' : 'REGEN', CX - 70, CY + (kwMode ? 166 : 226), 36, 'left', GREEN);
    return cv;
}

/* ---------- the OEM style: the stock widget's shape, without regeneration ----------
 * Drawn in the coordinates of a photo of the stock widget: the level line is horizontal, y = OY0 - 15.2 * value
 * (0 at the base, 60 at the top); the band is two straight arms joined by a circular corner, the same thickness
 * all the way along. Below zero it reads 0.0 and the band stays empty.
 */
const OEM = (() => {
    const Y0 = 1728, YK = 15.2, THK = 112, RAD = 250, TOP = 815;
    const a = [745, 1728], b = [915, 1425], c = [932, 1150], d = [652, 815];
    const dir = (p, q) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
    const u = dir(a, b), w = dir(c, d);
    const t = ((c[0] - a[0]) * w[1] - (c[1] - a[1]) * w[0]) / (u[0] * w[1] - u[1] * w[0]);
    const V = [a[0] + u[0] * t, a[1] + u[1] * t];
    const phi = Math.acos(u[0] * w[0] + u[1] * w[1]), tl = RAD * Math.tan(phi / 2);
    const T1 = [V[0] - u[0] * tl, V[1] - u[1] * tl], C = [T1[0] + u[1] * RAD, T1[1] - u[0] * RAD];
    const a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    const pts = [];          // the outer edge from below the base to above the top: [x, y, tangent x, tangent y]
    for (let y = Y0 + 240; y > T1[1]; y -= 3) pts.push([a[0] + u[0] * (y - a[1]) / u[1], y, u[0], u[1]]);
    for (let k = 0; k <= 60; k++) { const g = a0 - phi * k / 60; pts.push([C[0] + RAD * Math.cos(g), C[1] + RAD * Math.sin(g), Math.sin(g), -Math.cos(g)]); }
    const T2 = [V[0] + w[0] * tl, V[1] + w[1] * tl];
    for (let y = T2[1] - 3; y > TOP - 240; y -= 3) pts.push([c[0] + w[0] * (y - c[1]) / w[1], y, w[0], w[1]]);
    const out = pts.map((p) => [p[0], p[1]]), inn = pts.map((p) => [p[0] + THK * p[3], p[1] - THK * p[2]]);
    const tab = (e) => e.map((p) => [p[1], p[0]]);        // x as a function of y, y falling
    return { Y0, YK, TOP, out, inn, OUT: tab(out), INN: tab(inn), full: out.concat(inn.slice().reverse()) };
})();
const FUEL = [140, 146, 152, 255];   // the fuel fill: grey
const OEM_OX = 90, OEM_OY = 720, OEM_W = 1420, OEM_H = 1060, OEM_K = 0.62;   // the part of the photo the layer holds; its size at 100 %
const xAt = (tabl, y) => {
    const n = tabl.length;
    if (y >= tabl[0][0]) return tabl[0][1];
    if (y <= tabl[n - 1][0]) return tabl[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tabl[m][0] >= y) lo = m; else hi = m; }
    const A = tabl[lo], B = tabl[hi], f = (A[0] - y) / (A[0] - B[0]);
    return A[1] + (B[1] - A[1]) * f;
};
const clipY = (poly, ymin, ymax) => {      // the part of a polygon with ymin <= y <= ymax
    const cut = (pts, inside, xy) => {
        const res = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length], ip = inside(p), iq = inside(q);
            if (ip) res.push(p);
            if (ip !== iq) res.push(xy(p, q));
        }
        return res;
    };
    const r = cut(poly, (p) => p[1] >= ymin, (p, q) => { const f = (ymin - p[1]) / (q[1] - p[1]); return [p[0] + (q[0] - p[0]) * f, ymin]; });
    return cut(r, (p) => p[1] <= ymax, (p, q) => { const f = (ymax - p[1]) / (q[1] - p[1]); return [p[0] + (q[0] - p[0]) * f, ymax]; });
};

function drawOem(cv, o) {
    const k = (Number(o.scale) || 100) / 100 * OEM_K;
    const T = (x, y) => [(x - OEM_OX) * k, (y - OEM_OY) * k];
    const poly = (pts, c) => { if (pts.length > 2) cv.fill(pts.map((p) => T(p[0], p[1])), c); };
    const line = (p, q, wd, c) => { const A = T(p[0], p[1]), B = T(q[0], q[1]); cv.line(A[0], A[1], B[0], B[1], wd * k, c); };
    const text = (s, x, y, sz, al, c) => { const p = T(x, y); cv.text(s, p[0], p[1], sz * k, c || WHITE, { align: al || 'left', font: 'label' }); };   // a regular weight, as the stock widget
    // fuel (l/100km, standing l/h): the stock fuel scale, 0 to 20 with ticks every 5, a white fill; electric: 0 to 60
    const fuel = o.unit === 'l' || o.unit === 'lh', MAX = fuel ? 20 : 60;
    const yOf = (v) => OEM.Y0 - (OEM.Y0 - OEM.TOP) * v / MAX;
    cv.clear([0, 0, 0, 0]);
    const known = typeof o.value === 'number' && isFinite(o.value);
    const v = known ? Math.max(0, o.value) : 0;
    poly(clipY(OEM.full, OEM.TOP, OEM.Y0), TRACK);
    const lvl = Math.min(MAX, v);
    if (lvl > 0.05) poly(clipY(OEM.full, yOf(lvl), OEM.Y0), fuel ? FUEL : BLUE);
    if (v > MAX) poly([[462, 782], [480, 736], [520, 743], [600, 776], [614, 800], [500, 800]], fuel ? FUEL : BLUE);    // the piece above the 60 mark
    if (fuel) [5, 10, 15].forEach((m) => { const y = yOf(m); line([xAt(OEM.OUT, y) - 70, y], [xAt(OEM.OUT, y), y], 7, WHITE); });   // ticks on the edge
    else [20, 40].forEach((m) => { const y = yOf(m); line([xAt(OEM.INN, y) - 2, y], [xAt(OEM.OUT, y) + 2, y], 4, DARK); });
    const edge = [];
    for (let y = OEM.Y0; y >= OEM.TOP; y -= 3) edge.push(T(xAt(OEM.OUT, y), y));
    edge.push(T(xAt(OEM.OUT, OEM.TOP), OEM.TOP));
    cv.polyline(edge, 9 * k, WHITE);
    line([xAt(OEM.INN, OEM.Y0) - 18, OEM.Y0], [xAt(OEM.OUT, OEM.Y0), OEM.Y0], 9, WHITE);
    line([xAt(OEM.INN, OEM.TOP) - 14, OEM.TOP], [xAt(OEM.OUT, OEM.TOP), OEM.TOP], 9, WHITE);
    // the average
    if (typeof o.avg === 'number' && isFinite(o.avg)) {
        const y = yOf(Math.max(MAX / 120, Math.min(MAX, o.avg)));
        line([xAt(OEM.INN, y) - 40, y], [xAt(OEM.OUT, y) + 8, y], 15, WHITE);
        const gx = 1020, gy = y + 5, rx = 24, ry = 36, ring = [];
        for (let i = 0; i <= 28; i++) { const f = i / 28 * Math.PI * 2; ring.push(T(gx + Math.cos(f) * rx, gy + Math.sin(f) * ry - 8)); }
        cv.polyline(ring, 5 * k, WHITE);                                     // the font has no diameter sign: a ring and a slash
        line([gx + rx + 6, gy - ry - 14], [gx - rx - 6, gy + ry - 2], 5, WHITE);
        const av = o.uk ? ukFig(o.avg, o.unit) : o.avg;
        text(av === null ? '--' : av.toFixed(1), gx + rx + 14, gy + 34, 134);
    }
    if (fuel) [[20, 355, 815], [10, 640, 1290], [0, 500, 1690]].forEach((m) => text(String(m[0]), m[1], m[2], 88, 'center'));
    else [[60, 355, 815], [40, 590, 1100], [20, 695, 1395], [0, 500, 1690]].forEach((m) => text(String(m[0]), m[1], m[2], 88, 'center'));
    // the reading: the figure may be a slower copy of the value (o.fig)
    const fig = typeof o.fig === 'number' && isFinite(o.fig) ? o.fig : o.value, figKnown = known && typeof fig === 'number';
    const fx = o.unit === 'kw' || o.unit === 'lh' ? 420 : 300;      // standing (kW, l/h): the figure further right, the unit centred under it
    const shown = figKnown && o.uk ? ukFig(Math.max(0, fig), o.unit) : Math.max(0, fig);
    text(figKnown && shown !== null ? shown.toFixed(1) : '--', fx, 1285, 196, 'center', figKnown ? WHITE : [150, 156, 162, 255]);
    if (o.uk) text(UK_UNIT[o.unit] || '', o.unit === 'kw' || o.unit === 'lh' ? fx : 140, 1410, 104, o.unit === 'kw' || o.unit === 'lh' ? 'center' : 'left');
    else if (o.unit === 'kw') text('kW', fx, 1410, 104, 'center');
    else if (o.unit === 'lh') text('l/h', fx, 1410, 104, 'center');
    else if (o.unit === 'l') text('l/100km', 140, 1410, 104, 'left');
    else { text('kWh/', 140, 1410, 104, 'left'); text('100km', 145, 1525, 104, 'left'); }
    return cv;
}

const STYLES = ['classic', 'oem'];
const styleOf = (s) => (s === 'oem' ? 'oem' : 'classic');

/** The layer's size at a scale in percent, for a style ('classic' or 'oem'). */
function sizeOf(pct, style) {
    if (styleOf(style) !== 'oem') return size(pct);
    const k = (Number(pct) || 100) / 100 * OEM_K;
    return { w: Math.round(OEM_W * k), h: Math.round(OEM_H * k) };
}
const drawStyled = (cv, o) => (styleOf(o.style) === 'oem' ? drawOem(cv, o) : draw(cv, o));

module.exports = { draw: drawStyled, size: sizeOf, styleOf, STYLES, BOX_W, BOX_H };
