'use strict';
/**
 * gauge2.js - the two other gauge styles, in the same 240 x 280 layer (at 100 %) as the classic one.
 *
 *   ring  a 270-degree ring of 24 segments that light up with a glow, the charge and a battery
 *         in the middle, a red level mark across the ring and the M stripes in the gap at the bottom
 *   cell  a battery-shaped container that fills with liquid (a soft wave on top), the charge inside
 *   stripes  three slanted M stripes filling together, the charge bottom right
 *
 *   draw(style, cv, { soc, color, arrow, scale, dim })   (the km have their own label)
 *
 * Only drawing calls the kit's canvases (and the app page's recorder) both have: arc, fill, line,
 * fillRect, roundRect, strokeRoundRect, text, textWidth.
 */
const WHITE = '#f2f4f5';

function rgb(c) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [43, 184, 234];
}
const A = (c, a) => rgb(c).concat(Math.round(a * 255));

function battery(cv, x, y, K, c) {
    cv.strokeRoundRect(x, y, 34 * K, 18 * K, 3 * K, 2 * K, c);
    cv.fillRect(x + 34 * K, y + 5 * K, 3 * K, 8 * K, c);
}

function ring(cv, o) {
    const K = o.scale, known = o.known, soc = known ? o.soc : 0, col = o.color, white = o.dim ? '#8a9095' : WHITE;
    const cx = 128 * K, cy = 150 * K, R = 104 * K, r = 84 * K, a0 = 225, span = 270, N = 24, gap = 2.2;
    const lit = soc / 100 * span;
    if (known && soc > 0.5) for (let i = 0; i < 6; i++) cv.arc(cx, cy, R + 2 * K, R + (3 + i * 2.4) * K, a0, a0 + lit, A(col, 0.10 - i * 0.015));
    for (let i = 0; i < N; i++) {
        const s0 = a0 + i * span / N + gap / 2, s1 = a0 + (i + 1) * span / N - gap / 2;
        const on = known && (i + 0.5) / N * 100 <= soc, f = i / (N - 1);
        cv.arc(cx, cy, r, R, s0, s1, on ? A(col, 0.55 + 0.45 * f) : [46, 48, 53, 255]);
        if (on) cv.arc(cx, cy, R - 3 * K, R, s0, s1, [255, 255, 255, 89]);
    }
    cv.arc(cx, cy, r - 9 * K, r - 7 * K, a0, a0 + span, [90, 94, 100, 255]);
    [0, 0.25, 0.5, 0.75, 1].forEach((q) => {
        const a = (a0 + q * span - 90) * Math.PI / 180, major = q === 0 || q === 0.5 || q === 1;
        const r1 = R + 4 * K, r2 = R + (major ? 14 : 9) * K;
        cv.line(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, (major ? 3 : 1.5) * K, white);
    });
    if (known) {
        const an = (a0 + lit - 90) * Math.PI / 180;
        cv.line(cx + Math.cos(an) * (r - 12 * K), cy + Math.sin(an) * (r - 12 * K), cx + Math.cos(an) * (R + 12 * K), cy + Math.sin(an) * (R + 12 * K), 4 * K, o.arrow || '#e0262a');
    }
    // the km have their own label on the cluster, so only the charge and the battery in the middle
    {
        battery(cv, cx - 18 * K, cy - 62 * K, K, white);
        const n = known ? String(Math.round(soc)) : '--', nw = cv.textWidth(n, 64 * K, { font: 'num' });
        cv.text(n, cx - 6 * K, cy + 24 * K, 64 * K, white, { align: 'center', font: 'num' });
        cv.text('%', cx - 6 * K + nw / 2 + 4 * K, cy - 4 * K, 20 * K, '#9aa0a6', { font: 'bold' });
    }
    [['#81c4ff', -26], ['#16588e', -8], ['#e0262a', 10]].forEach(([c, dx]) => cv.fill([[cx + dx * K, cy + 96 * K], [cx + (dx + 16) * K, cy + 96 * K],
        [cx + (dx + 12) * K, cy + 101 * K], [cx + (dx - 4) * K, cy + 101 * K]], c));
    cv.text('0', cx - 86 * K, cy + 88 * K, 16 * K, '#9aa0a6', { align: 'center', font: 'bold' });
    cv.text('100', cx + 86 * K, cy + 88 * K, 16 * K, '#9aa0a6', { align: 'center', font: 'bold' });
}

/** A battery-shaped container that fills with liquid, a soft wave on top, the charge inside. */
function cell(cv, o) {
    const K = o.scale, known = o.known, soc = known ? o.soc : 0, col = o.color, white = o.dim ? '#8a9095' : WHITE;
    const x = 70 * K, y = 40 * K, w = 110 * K, h = 200 * K, r = 18 * K, bot = y + h - 8 * K;
    cv.roundRect(x + w * 0.32, y - 10 * K, w * 0.36, 14 * K, 5 * K, [70, 73, 79, 255]);
    cv.roundRect(x, y, w, h, r, [22, 23, 26, 255]);
    if (known && soc > 0.5) {
        const lvl = bot - (h - 16 * K) * soc / 100, steps = 24;
        for (let i = 0; i < steps; i++) {
            const y0 = lvl + (bot - lvl) * i / steps, y1 = lvl + (bot - lvl) * (i + 1) / steps;
            const pts = [];
            if (i === 0) for (let k = 0; k <= 24; k++) pts.push([x + 8 * K + (w - 16 * K) * k / 24, y0 + Math.sin(k / 24 * Math.PI * 2) * 3 * K]);
            else pts.push([x + 8 * K, y0], [x + w - 8 * K, y0]);
            pts.push([x + w - 8 * K, y1 + 1], [x + 8 * K, y1 + 1]);
            cv.fill(pts, A(col, 0.95 - 0.5 * i / steps));
        }
    }
    cv.fillRect(x + 14 * K, y + 16 * K, 6 * K, h - 40 * K, [255, 255, 255, 26]);
    cv.strokeRoundRect(x, y, w, h, r, 4 * K, white);
    [0.25, 0.5, 0.75].forEach((q) => {
        const yy = bot - (h - 16 * K) * q;
        cv.line(x + w - 2 * K, yy, x + w + 10 * K, yy, 2 * K, q === 0.5 ? white : [200, 204, 208, 170]);
    });
    if (known) { const lvl = bot - (h - 16 * K) * soc / 100; cv.line(x + w + 4 * K, lvl, x + w + 24 * K, lvl, 4 * K, o.arrow || '#e0262a'); }
    {
        cv.text(known ? String(Math.round(soc)) : '--', x + w / 2, y + h / 2 + 20 * K, 54 * K, white, { align: 'center', font: 'num' });
        cv.text('%', x + w / 2, y + h / 2 + 44 * K, 18 * K, '#dfe3e6', { align: 'center', font: 'bold' });
    }
}

/**
 * The M stripes: three slanted stripes in M light blue, M dark blue and M red, at the rev
 * counter's angle, filling together from the bottom; the level is a red line edged in white.
 */
function stripes(cv, o) {
    const K = o.scale, known = o.known, soc = known ? o.soc : 0;
    // M light blue, M dark blue, M red; parallel to the rev counter's edge beside them (about 34 degrees off upright)
    const cs = ['#81c4ff', '#1c69d4', '#e0262a'], bx = 4 * K, by = 266 * K, tx = 162 * K, ty = 22 * K, w = 20 * K, g = 7 * K;
    cs.forEach((c, j) => {
        const off = j * (w + g), P = (f, d) => [bx + (tx - bx) * f + off + d, by + (ty - by) * f];
        cv.fill([P(0, 0), P(0, w), P(1, w), P(1, 0)], [32, 34, 38, 255]);
        if (known && soc > 0.5) {
            const n = 30;
            for (let i = 0; i < n; i++) {
                const f0 = i / n * soc / 100, f1 = (i + 1) / n * soc / 100;
                cv.fill([P(f0, 0), P(f0, w), P(f1 + 0.003, w), P(f1 + 0.003, 0)], A(c, 0.4 + 0.6 * i / n));
            }
        }
    });
    if (known) {
        const f = soc / 100, P = (d) => [bx + (tx - bx) * f + d, by + (ty - by) * f];
        const a = P(-10 * K), b = P(3 * (w + g) - g + 4 * K);
        cv.line(a[0], a[1], b[0], b[1], 8 * K, '#ffffff');
        cv.line(a[0], a[1], b[0], b[1], 4 * K, o.arrow || '#e0262a');
    }
    // the charge, bottom right, clear of the stripes
    const n = known ? String(Math.round(soc)) : '--', pw = cv.textWidth('%', 22 * K, { font: 'bold' });
    cv.text('%', 236 * K, 262 * K, 22 * K, '#9aa0a6', { align: 'right', font: 'bold' });
    cv.text(n, 236 * K - pw - 3 * K, 262 * K, 44 * K, o.dim ? '#8a9095' : WHITE, { align: 'right', font: 'num' });
}

function draw(style, cv, o) {
    o = Object.assign({}, o);
    o.scale = Number(o.scale) > 0 ? Number(o.scale) : 1;
    o.known = typeof o.soc === 'number' && isFinite(o.soc);
    if (o.known) o.soc = Math.max(0, Math.min(100, o.soc));
    (style === 'cell' ? cell : style === 'stripes' ? stripes : ring)(cv, o);
    return cv;
}

module.exports = { draw, STYLES: ['classic', 'ring', 'cell', 'stripes'] };
