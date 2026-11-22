'use strict';
/**
 * grfont.js - lettering with Greek for the song (the kit's fonts are Latin only): the Ubuntu font's Regular and
 * Bold, Latin + Greek, baked into atlases of the kit's format (grfont_data.js) and drawn with the kit canvas's
 * own glyph blit, the same way canvas.text() draws.
 *   text(cv, str, x, y, size, colour, 'label' | 'bold')   x, y: the left end of the baseline; returns the width
 *   width(str, size, 'label' | 'bold')
 *   fit(str, size, w, family)                             str cut with "..." to fit w px
 * Letters the atlas lacks go through fallback (e.g. accented Latin to plain) or are left out.
 */
const zlib = require('zlib');
const { rgba } = require('./kit/canvas');
const DATA = require('./grfont_data');

const fams = {};
function get(name, size) {
    const key = name === 'bold' ? 'bold' : 'label';
    if (!fams[key]) fams[key] = DATA[key].sizes.map((s) => ({ size: s.size, atlasW: s.atlasW, atlasH: s.atlasH, glyphs: s.glyphs, _a: s.alpha, alpha: null }));
    const fam = fams[key];
    let best = null;
    for (const f of fam) if (f.size >= size && (!best || f.size < best.size)) best = f;
    if (!best) best = fam[fam.length - 1];
    if (!best.alpha) best.alpha = zlib.inflateSync(Buffer.from(best._a, 'base64'));
    return best;
}

/** The string in letters the atlas has: composed (NFC), the rest through fallback(ch) or left out. */
function clean(s, fallback) {
    let x = String(s || '');
    try { x = x.normalize('NFC'); } catch (e) { /* no ICU */ }
    const f = get('label', 24);
    let out = '';
    for (const ch of x) {
        if (f.glyphs[ch.codePointAt(0)]) { out += ch; continue; }
        const alt = fallback ? fallback(ch) : '';
        for (const c2 of alt) if (f.glyphs[c2.codePointAt(0)]) out += c2;
    }
    return out;
}

function measure(f, s) {
    let w = 0;
    for (const ch of s) { const g = f.glyphs[ch.codePointAt(0)] || f.glyphs[63]; if (g) w += g[6]; }
    return w;
}

function width(s, size, name) { const f = get(name, size); return measure(f, String(s)) * size / f.size; }

function text(cv, s, x, y, size, c, name) {
    const f = get(name, size), scale = size / f.size;
    c = rgba(c);
    let pen = x;
    for (const ch of String(s)) {
        const g = f.glyphs[ch.codePointAt(0)] || f.glyphs[63];
        if (!g) continue;
        const gx = g[0], gy = g[1], gw = g[2], gh = g[3], ox = g[4], oy = g[5], adv = g[6];
        if (gw && gh) cv._blit(f, gx, gy, gw, gh, pen + ox * scale, y + oy * scale, scale, c);
        pen += adv * scale;
    }
    return pen - x;
}

function fit(s, size, w, name) {
    s = String(s);
    if (width(s, size, name) <= w) return s;
    const a = Array.from(s);
    let n = a.length;
    while (n > 1 && width(a.slice(0, n).join('') + '...', size, name) > w) n--;
    return a.slice(0, n).join('').replace(/\s+$/, '') + '...';
}

module.exports = { text, width, fit, clean };
