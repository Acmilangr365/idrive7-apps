'use strict';
/**
 * mfont.js - the M style lettering (digits, the point, capitals) drawn as shapes, as the M layout's dials have it:
 * square strokes, the outer corners cut off. Lower case and signs it has no shape for stay in the kit's font.
 *
 * A glyph is drawn in a 90-unit tall box (the capital height) out of rectangles and slanted strokes; the corners
 * named in `cut` are cut off every rectangle that has that corner. Text sizes are given as the kit font's size, so
 * an M string and a plain one of the same size have the same capital height (0.72 x size).
 */
const { Canvas, rgba } = require('./kit/canvas');

const H = 90, S = 19, C = 8, GAP = 11, LGAP = 16, CAP = 0.72;     // LGAP: the room between capitals     // as the M dials: wider than tall-ish, heavy strokes

function glyph(ch) {
    let w = ch >= 'A' && ch <= 'Z' ? 84 : 84, R = [], T = [], cut = [];
    const top = () => [0, 0, w, S], bot = () => [0, H - S, w, H], mid = () => [0, 36, w, 55];
    const L = (y0, y1) => [0, y0, S, y1], Rr = (y0, y1) => [w - S, y0, w, y1];
    switch (ch) {
        // digits
        case '0': {
            // as the stock M dials: taller than wide, heavy sides, the top and the bottom each an arc
            w = 74; const SV = 18, SH = 16, A = 7, n = 16, top = [], bot = [];
            for (let i = 0; i <= n; i++) { const x = w * i / n, u = (x - w / 2) / (w / 2); top.push([x, A * u * u]); bot.push([w - x, H - A * u * u]); }
            top.push([w, SH], [0, SH]);
            bot.push([0, H - SH], [w, H - SH]);
            return { w: w, R: [[0, A + 1, SV, H - A - 1], [w - SV, A + 1, w, H - A - 1]], T: [top, bot], cut: [] };   // the sides overlap the arcs: no seam
        }
        case '1': return { w: 24 + S, R: [[24, 0, 24 + S, H]], T: [[[6, 12], [24, 0], [24, S], [6, S + 8]]], cut: [] };
        case '2': R = [top(), Rr(0, 55), mid(), L(36, H), bot()]; cut = ['TL', 'TR', ['BR', w, 55], ['TL', 0, 36], 'BL', 'BR']; break;
        case '3': R = [top(), Rr(0, H), [18, 36, w, 55], bot()]; cut = ['TL', 'TR', 'BL', 'BR']; break;
        case '4': R = [[w - S, 0, w, H], [0, 54, w, 73]]; T = [[[w - S - 4, 0], [w, 0], [S + 4, 58], [0, 58], [0, 52]]]; break;
        case '5': R = [top(), L(0, 55), mid(), Rr(36, H), bot()]; cut = ['TL', 'BL', 'BR', ['TR', w, 36]]; break;
        case '6': R = [top(), L(0, H), mid(), Rr(36, H), bot()]; cut = ['TL', 'BL', 'BR', ['TR', w, 36]]; break;
        case '7': R = [top()]; T = [[[w - S, 0], [w, 0], [w, S + 4], [S + 12, H], [12, H]]]; cut = ['TL']; break;
        case '8': R = [top(), bot(), L(0, H), Rr(0, H), mid()]; cut = ['TL', 'TR', 'BL', 'BR']; break;
        case '9': R = [top(), L(0, 55), mid(), Rr(0, H), bot()]; cut = ['TL', 'TR', 'BL', 'BR', ['BL', 0, 55]]; break;
        case '.': return { w: S, R: [[0, H - S, S, H]], T: [], cut: [] };
        case '-': return { w: 40, R: [[0, 36, 40, 55]], T: [], cut: [] };
        case ' ': return { w: 26, R: [], T: [], cut: [] };
        // capitals
        case 'A': R = [L(0, H), Rr(0, H), top(), mid()]; cut = ['TL', 'TR']; break;
        case 'B': R = [L(0, H), top(), bot(), [0, 36, w - 6, 55], Rr(0, 40), Rr(51, H)]; cut = ['TR', 'BR', ['BR', w, 40], ['TR', w, 51]]; break;
        case 'C': R = [top(), L(0, H), bot()]; cut = ['TL', 'BL']; break;
        case 'D': R = [top(), bot(), L(0, H), Rr(0, H)]; cut = ['TR', 'BR']; break;
        case 'E': R = [L(0, H), top(), [0, 36, w - 8, 55], bot()]; cut = ['TL', 'BL']; break;
        case 'F': R = [L(0, H), top(), [0, 36, w - 8, 55]]; cut = ['TL']; break;
        case 'G': R = [top(), L(0, H), bot(), Rr(36, H), [w / 2, 36, w, 55]]; cut = ['TL', 'BL', 'BR']; break;
        case 'H': R = [L(0, H), Rr(0, H), mid()]; break;
        case 'I': return { w: S, R: [[0, 0, S, H]], T: [], cut: [] };
        case 'J': R = [Rr(0, H), bot(), L(55, H)]; cut = ['BL', 'BR']; break;
        case 'K': R = [L(0, H)]; T = [[[w - S - 4, 0], [w + 4, 0], [S + 13, 36], [S - 6, 36]], [[S, 36], [S + 14, 36], [w, H], [w - S - 4, H]], [[0, 36], [S + 14, 36], [S + 14, 55], [0, 55]]]; break;
        case 'L': R = [L(0, H), bot()]; cut = ['BL']; break;
        case 'M': w = 90; return { w: w, R: [[0, 0, S, H], [w - S, 0, w, H]], T: [[[0, 0], [S + 4, 0], [w / 2 + S / 2, 58], [w / 2 - S / 2, 58]], [[w - S - 4, 0], [w, 0], [w / 2 + S / 2, 58], [w / 2 - S / 2, 58]]], cut: [] };
        case 'N': R = [L(0, H), Rr(0, H)]; T = [[[0, 0], [S + 4, 0], [w, H], [w - S - 4, H]]]; break;
        case 'O': case 'Q': R = [top(), bot(), L(0, H), Rr(0, H)]; cut = ['TL', 'TR', 'BL', 'BR']; break;
        case 'P': R = [L(0, H), top(), Rr(0, 55), mid()]; cut = ['TL', 'TR', ['BR', w, 55]]; break;
        case 'R': R = [L(0, H), top(), Rr(0, 55), mid()]; T = [[[w - S - 14, 55], [w - S + 2, 55], [w, H], [w - S - 2, H]]]; cut = ['TL', 'TR', ['BR', w, 55]]; break;
        case 'S': R = [top(), L(0, 55), mid(), Rr(36, H), bot()]; cut = ['TL', 'TR', 'BL', 'BR', ['BL', 0, 55], ['TR', w, 36]]; break;
        case 'T': R = [top(), [(w - S) / 2, 0, (w + S) / 2, H]]; break;
        case 'U': R = [L(0, H), Rr(0, H), bot()]; cut = ['BL', 'BR']; break;
        case 'V': T = [[[0, 0], [S + 2, 0], [w / 2 + S / 2, H], [w / 2 - S / 2 - 2, H]], [[w - S - 2, 0], [w, 0], [w / 2 + S / 2 + 2, H], [w / 2 - S / 2, H]]]; break;
        case 'W': w = 94; return { w: w, R: [], cut: [], T: [[[0, 0], [S, 0], [S + 8, H], [8, H]], [[w - S, 0], [w, 0], [w - 8, H], [w - S - 8, H]],
            [[w / 2 - S / 2, 30], [w / 2 + S / 2, 30], [w - S - 4, H], [w - S - 14, H]], [[w / 2 - S / 2, 30], [w / 2 + S / 2, 30], [S + 14, H], [S + 4, H]]] };
        case 'X': T = [[[0, 0], [S + 4, 0], [w, H], [w - S - 4, H]], [[w - S - 4, 0], [w, 0], [S + 4, H], [0, H]]]; break;
        case 'Y': T = [[[0, 0], [S + 4, 0], [w / 2 + S / 2, 48], [w / 2 - S / 2, 48]], [[w - S - 4, 0], [w, 0], [w / 2 + S / 2, 48], [w / 2 - S / 2, 48]]]; R = [[(w - S) / 2, 44, (w + S) / 2, H]]; break;
        case 'Z': R = [top(), bot()]; T = [[[w - S - 6, S], [w, S], [S + 6, H - S], [0, H - S]]]; cut = ['TL', 'BR']; break;
        default: return null;
    }
    return { w: w, R: R, T: T, cut: cut };
}

const gapOf = (ch) => (ch >= 'A' && ch <= 'Z' ? LGAP : GAP);
const CACHE = {};
/** The glyph as polygons in its 90-unit box: every rectangle with the named corners cut off, and the slanted strokes. */
function shapes(ch) {
    if (CACHE[ch] !== undefined) return CACHE[ch];
    const g = glyph(ch);
    if (!g) return (CACHE[ch] = null);
    const corners = g.cut.map((c) => {
        if (Array.isArray(c)) return { k: c[0], x: c[1], y: c[2] };
        return { k: c, x: c[0] === 'T' || c[0] === 'B' ? (c[1] === 'L' ? 0 : g.w) : 0, y: c[0] === 'T' ? 0 : H };
    });
    const polys = g.R.map((r) => {
        const [x0, y0, x1, y1] = r;
        const has = (k, x, y) => corners.some((c) => c.k === k && Math.abs(c.x - x) < 0.01 && Math.abs(c.y - y) < 0.01);
        const p = [];
        if (has('TL', x0, y0)) p.push([x0, y0 + C], [x0 + C, y0]); else p.push([x0, y0]);
        if (has('TR', x1, y0)) p.push([x1 - C, y0], [x1, y0 + C]); else p.push([x1, y0]);
        if (has('BR', x1, y1)) p.push([x1, y1 - C], [x1 - C, y1]); else p.push([x1, y1]);
        if (has('BL', x0, y1)) p.push([x0 + C, y1], [x0, y1 - C]); else p.push([x0, y1]);
        return p;
    }).concat(g.T);
    return (CACHE[ch] = { w: g.w, polys: polys });
}

/** True when every character of s has an M shape. */
const supports = (s) => typeof s === 'string' && s.length > 0 && s.split('').every((ch) => shapes(ch) !== null);

/** The width of s in M at a kit font size, stretched sideways by `stretch`. */
function width(s, size, stretch) {
    const u = size * CAP / H * (stretch || 1);
    let w = 0;
    s.split('').forEach((ch, i) => { w += shapes(ch).w + (i ? gapOf(ch) : 0); });
    return w * u;
}

/** Draws s in M with its baseline at y; opts.align left / center / right. */
function draw(cv, s, x, y, size, color, opts) {
    const st = (opts && opts.stretch) || 1, u = size * CAP / H, ux = u * st, al = opts && opts.align;
    const total = width(s, size, st);
    let px = al === 'center' ? x - total / 2 : al === 'right' ? x - total : x;
    const top = y - H * u;
    s.split('').forEach((ch) => {
        const g = shapes(ch);
        g.polys.forEach((p) => cv.fill(p.map((q) => [px + q[0] * ux, top + q[1] * u]), color));
        px += (g.w + gapOf(ch)) * ux;
    });
    return cv;
}

/** Kit text stretched sideways: drawn on a scratch canvas and laid on cv column by column. */
function stretched(cv, s, x, y, size, color, opts, st) {
    const o = Object.assign({}, opts || {}), al = o.align;
    delete o.align;
    const w0 = cv.textWidth(s, size, o);
    if (!cv.d || typeof cv._blend !== 'function' || st === 1) return cv.text(s, x, y, size, color, opts);
    const pad = Math.ceil(size * 0.2), tw = Math.ceil(w0) + 2 * pad, th = Math.ceil(size * 1.5), base = Math.ceil(size * 1.15);
    const t = new Canvas(tw, th);
    t.clear([0, 0, 0, 0]);
    t.text(s, pad, base, size, [255, 255, 255, 255], o);
    const c = rgba(color), W2 = Math.ceil(tw * st);
    const left = (al === 'center' ? x - w0 * st / 2 : al === 'right' ? x - w0 * st : x) - pad * st, topY = Math.round(y - base);
    const X0 = Math.round(left);
    for (let yy = 0; yy < th; yy++) {
        const Y = topY + yy;
        if (Y < 0 || Y >= cv.h) continue;
        for (let xx = 0; xx < W2; xx++) {
            const X = X0 + xx;
            if (X < 0 || X >= cv.w) continue;
            const sx = (xx + 0.5) / st - 0.5, i0 = Math.max(0, Math.floor(sx)), f = Math.max(0, sx - i0), i1 = Math.min(tw - 1, i0 + 1);
            if (i0 >= tw) continue;
            const a = t.d[(yy * tw + i0) * 4 + 3] * (1 - f) + t.d[(yy * tw + i1) * 4 + 3] * f;
            if (a > 0.5) cv._blend(X, Y, c, a / 255);
        }
    }
    return cv;
}

/**
 * cv with its text and textWidth in the chosen lettering: mode 'm' draws what has M shapes in M, the rest in the
 * kit font; stretch widens the letters sideways (1 = as they are). Everything else goes straight to cv.
 */
function wrap(cv, mode, stretch, textScale) {
    const st = Number(stretch) || 1, m = mode === 'm', ts = Number(textScale) || 1;
    if (!m && st === 1 && ts === 1) return cv;
    // a string in runs: a word (between spaces) wholly of M shapes goes in M, a figure with a % after it
    // in M with the % in the kit font, any other word (km, kWh/, 100km) in the kit font
    const runs = (s) => {
        const out = [], push = (isM, t) => { const last = out[out.length - 1]; if (last && last.m === isM) last.s += t; else if (t) out.push({ m: isM, s: t }); };
        s.split(/( )/).forEach((tok) => {
            if (!tok) return;
            if (!m) return push(false, tok);
            if (tok === ' ') return push(out.length ? out[out.length - 1].m : false, tok);
            if (supports(tok)) return push(true, tok);
            const pc = /^([0-9.\-]+)(%)$/.exec(tok);
            if (pc) { push(true, pc[1]); return push(false, pc[2]); }
            push(false, tok);
        });
        return out;
    };
    const kitW = (s, size, opts) => cv.textWidth(s, size, opts) * st;
    const runW = (r, size, opts) => (r.m ? width(r.s, size, st) : kitW(r.s, size, opts));
    const w = Object.create(cv);
    w.textWidth = (s, size, opts) => runs(String(s)).reduce((a, r) => a + runW(r, size * ts, opts), 0);
    w.text = (s, x, y, size, color, opts) => {
        s = String(s);
        size *= ts;
        const rs = runs(s), al = opts && opts.align, total = rs.reduce((a, r) => a + runW(r, size, opts), 0);
        let px = al === 'center' ? x - total / 2 : al === 'right' ? x - total : x;
        const o = Object.assign({}, opts || {});
        delete o.align;
        rs.forEach((r) => {
            if (r.m) draw(cv, r.s, px, y, size, color, { stretch: st });
            else if (st === 1) cv.text(r.s, px, y, size, color, o);
            else stretched(cv, r.s, px, y, size, color, o, st);
            px += runW(r, size, o);
        });
        return cv;
    };
    return w;
}

const fontOf = (v) => (v === 'm' ? 'm' : 'simple');

module.exports = { wrap, draw, width, supports, fontOf };
