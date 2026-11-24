// OpenCascade version of the box geometry, built through replicad (OpenCascade compiled to WebAssembly).
// Unlike geometry.js, which works only in flat faces, this keeps true arcs and fillets, so the STEP files
// it writes have exact curved surfaces. Loaded on demand, because the WebAssembly kernel is a large download.
//
// Stage 1: the box body - tapered outer envelope with exact corner arcs, hollowed inside, rail indents.

const CDN = 'https://cdn.jsdelivr.net/npm/';
export const VERSIONS = { replicad: '1.2.1', oc: '1.2.1' };   // pinned; the kernel WebAssembly is about 23 MB before compression

let R = null, ready = null;

// Load the kernel once; later calls reuse it.
export function initOCCT(onStatus) {
  if (ready) return ready;
  ready = (async () => {
    const t0 = performance.now();
    onStatus && onStatus('Downloading the CAD kernel…');
    const v = s => (s ? '@' + s : '');
    const [{ default: opencascade }, replicad] = await Promise.all([
      import(CDN + 'replicad-opencascadejs' + v(VERSIONS.oc) + '/dist/replicad_single.js'),
      import(CDN + 'replicad' + v(VERSIONS.replicad) + '/+esm'),
    ]);
    onStatus && onStatus('Starting the CAD kernel…');
    const OC = await opencascade({ locateFile: () => CDN + 'replicad-opencascadejs' + v(VERSIONS.oc) + '/dist/replicad_single.wasm' });
    replicad.setOC(OC);
    R = replicad;
    return { seconds: (performance.now() - t0) / 1000 };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

const norm = v => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };

// Plan outline from geometry.js's planVertices ([point, radius] pairs) as an exact drawing:
// straight edges plus true tangent arcs, using the same arc maths as planPoints().
function planDrawing(verts) {
  const n = verts.length, segs = [];
  for (let i = 0; i < n; i++) {
    let [v, r] = verts[i];
    const pv = verts[(i - 1 + n) % n][0], nv = verts[(i + 1) % n][0];
    const d1 = norm([v[0] - pv[0], v[1] - pv[1]]), d2 = norm([nv[0] - v[0], nv[1] - v[1]]);
    const phi = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    const lp = Math.hypot(v[0] - pv[0], v[1] - pv[1]), ln = Math.hypot(nv[0] - v[0], nv[1] - v[1]);
    const crs = d1[0] * d2[1] - d1[1] * d2[0];
    if (r < 0.02 || crs <= 1e-9) { segs.push({ p: v }); continue; }
    let t = r * Math.tan(phi / 2);
    const tmax = 0.49 * Math.min(lp, ln);
    if (t > tmax) { r = r * tmax / t; t = tmax; }
    const t1 = [v[0] - d1[0] * t, v[1] - d1[1] * t], t2 = [v[0] + d2[0] * t, v[1] + d2[1] * t];
    const nl = [-d1[1], d1[0]], c = [t1[0] + nl[0] * r, t1[1] + nl[1] * r];
    const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]), am = a0 + phi / 2;
    segs.push({ p: t1, arc: { end: t2, mid: [c[0] + r * Math.cos(am), c[1] + r * Math.sin(am)] } });
  }
  let pen = R.draw(segs[0].p);
  if (segs[0].arc) pen = pen.threePointsArcTo(segs[0].arc.end, segs[0].arc.mid);
  for (let i = 1; i < segs.length; i++) {
    pen = pen.lineTo(segs[i].p);
    if (segs[i].arc) pen = pen.threePointsArcTo(segs[i].arc.end, segs[i].arc.mid);
  }
  return pen.close();
}

// Same envelope as geometry.js: tapered from the base up to taper_height, straight above.
// A corner rounding that shrinks to nothing at the bottom of the taper would leave the two outlines with different
// edge counts, which the loft can't pair up reliably, so the lower outline keeps a tiny 0.05 mm arc there instead.
function envelope(G, p, L, inset, z0, ztop) {
  const verts = ins => G.planVertices(p.width, L, p.corners, ins);
  const sk = (vs, z) => planDrawing(vs).sketchOnPlane('XY', z);
  if (p.taper_inset > 0.01 && p.taper_height > 0.5) {
    const top = verts(inset), bot = verts(inset + p.taper_inset).map((v, i) => [v[0], top[i][1] > 0.02 ? Math.max(v[1], 0.05) : v[1]]);
    const lower = sk(bot, z0).loftWith(sk(verts(inset), z0 + p.taper_height), { ruled: true });
    const upper = sk(verts(inset), z0 + p.taper_height).extrude(ztop - z0 - p.taper_height);
    return lower.fuse(upper);
  }
  return sk(verts(inset), z0).extrude(ztop - z0);
}

function prismZ(pts, z0, z1) {
  let pen = R.draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close().sketchOnPlane('XY', z0).extrude(z1 - z0);
}

function notchTools(p, joins, grow, inner) {
  const w2 = p.width / 2, nd = p.notch_depth, nw = p.notch_width / 2, fl = p.notch_flare, out = [];
  for (const yj of joins) for (const s of [1, -1]) {
    const xi = s * (w2 - nd - inner), xo = s * (w2 + 2);
    const pts = [[xi, yj - nw - grow], [s * w2, yj - nw - fl - grow], [xo, yj - nw - fl - grow],
      [xo, yj + nw + fl + grow], [s * w2, yj + nw + fl + grow], [xi, yj + nw + grow]];
    out.push(prismZ(s > 0 ? pts : pts.slice().reverse(), -10, p.height + 10));
  }
  return out;
}

// ------------------------------------------------------------------ primitives
const P3 = (axis, u, v, a) => axis === 'z' ? [u, v, a] : axis === 'x' ? [a, u, v] : [u, a, v];
// polygon pts (u, v) in the plane across `axis`, extruded from a0 to a1 (same convention as geometry.js prism)
function prism(axis, a0, a1, pts) {
  const face = R.makePolygon(pts.map(q => P3(axis, q[0], q[1], a0)));
  return R.basicFaceExtrusion(face, new R.Vector(P3(axis, 0, 0, a1 - a0)));
}
const box = (x0, x1, y0, y1, z0, z1) => R.makeBox([x0, y0, z0], [x1, y1, z1]);
// true cylinder along an axis through (u, v), from a0 to a1
const cylinder = (axis, u, v, r, a0, a1) => R.makeCylinder(r, a1 - a0, P3(axis, u, v, a0), P3(axis, 0, 0, 1));
const fuseAll = (base, list) => { for (const t of list) base = base.fuse(t); return base; };
const cutAll = (base, list) => { for (const t of list) base = base.cut(t); return base; };
function planPrism(G, p, L, inset, z0, z1) {
  return planDrawing(G.planVertices(p.width, L, p.corners, inset)).sketchOnPlane('XY', z0).extrude(z1 - z0);
}

// ------------------------------------------------------------------ full build, same steps and numbers as geometry.js build()
// Returns { box, tray?, mount?, warnings, L } with OpenCascade shapes.
export function build(G, params, progress) {
  if (!R) throw new Error('Call initOCCT() first.');
  let stage = 'Starting';
  try { return buildInner(G, params, m => { stage = m; if (progress) progress(m); }); }
  catch (e) {
    let msg = e && e.message;
    if (!msg && R.OC && typeof e === 'object' && 'excPtr' in e) msg = 'OpenCascade error';
    throw new Error(stage + ' failed: ' + (msg || String(e)));
  }
}
function buildInner(G, params, progress) {
  const SLOT = G.SLOT;
  const p = Object.assign(G.defaultParams(), params || {});
  p.cells = (p.cells || []).map(Number).filter(v => v > 0);
  if (p.side_clearance > 0) p.width = p.width - 2 * p.side_clearance;
  if (p.end_clearance > 0 && p.cells.length) { p.cells = p.cells.slice(); p.cells[0] -= p.end_clearance; p.cells[p.cells.length - 1] -= p.end_clearance; }
  const warn = [], step = m => { if (progress) progress(m); };
  const W = p.width, H = p.height, wall = Math.min(4, Math.max(0.8, p.wall)), w2 = W / 2;
  if (wall !== p.wall) warn.push('Wall thickness limited to ' + wall + ' mm.');
  p.wall = wall;
  const cells = p.cells, L = cells.reduce((a, b) => a + b, 0);
  let joins = [], centres = [], y = 0;
  cells.forEach((c, i) => { centres.push(y + c / 2); y += c; if (i < cells.length - 1) joins.push(y); });
  if (p._joins) joins = p._joins.slice();
  if (p._centres) centres = p._centres.slice();
  const useNotch = p.rail_notches && joins.length > 0;

  step('Shaping the box');
  const SD = G.slotDims(wall);
  let env = envelope(G, p, L, 0, 0, H);
  let inner = envelope(G, p, L, wall, 0, H + 5).intersect(box(-w2 - 5, w2 + 5, -5, L + 5, wall, H + 6));
  if (useNotch) {
    env = cutAll(env, notchTools(p, joins, 0, 0));
    inner = cutAll(inner, notchTools(p, joins, wall, wall));
  }
  const clip = env;
  let boxb = env.cut(inner);

  // hanging slots
  const slots = [];
  if (p.slots !== 'none') {
    if (H < SLOT.min_height) warn.push('Box is under 50 mm tall, so hanging slots were left off.');
    else {
      const cs = p.slots === 'every' ? centres : centres.slice(0, 1);
      const sides = { both: [1, -1], right: [1], left: [-1] }[p.slot_sides];
      for (const c of cs) for (const s of sides) slots.push([c, s]);
    }
  }
  if (slots.length) {
    step('Adding hanging slots');
    boxb = fuseAll(boxb, slots.map(([c, s]) => {
      const a = s * (w2 - SD.housing_depth), b = s * (w2 + 2);
      return box(Math.min(a, b), Math.max(a, b), c - SLOT.housing_half, c + SLOT.housing_half, 0, SLOT.housing_top).intersect(clip);
    }));
    const cut = [];
    for (const [c, s] of slots) {
      const oh = SLOT.open_half, ot = SLOT.open_top, zb = SD.cut_bottom;
      const pocket = [[c - oh, zb], [c + oh, zb], [c + oh, ot], [c + SLOT.pocket_top_half, SLOT.pocket_top], [c - SLOT.pocket_top_half, SLOT.pocket_top], [c - oh, ot]];
      const mouth = [[c - oh, zb], [c + oh, zb], [c + oh, ot], [c + SLOT.mouth_bot_half, ot], [c + SLOT.mouth_top_half, SLOT.mouth_top],
        [c - SLOT.mouth_top_half, SLOT.mouth_top], [c - SLOT.mouth_bot_half, ot], [c - oh, ot]];
      const xa = w2 - SD.pocket_inner, xb = w2 - wall, xc = w2 + 2;
      if (s > 0) { cut.push(prism('x', xa, xb + 0.01, pocket)); cut.push(prism('x', xb, xc, mouth)); }
      else { cut.push(prism('x', -xb - 0.01, -xa, pocket)); cut.push(prism('x', -xc, -xb, mouth)); }
    }
    boxb = cutAll(boxb, cut);
  }

  // tray numbers
  const ti = p.taper_inset, zt = p.taper_height, cl = p.tray_clearance;
  const drop = ti > 0.01 ? cl * zt / ti : 0;
  let trayZb = H - p.tray_depth;
  if (p.tray) {
    const maxZb = zt - drop - 3;
    if (trayZb > maxZb) { warn.push('Tray depth increased to ' + (H - maxZb).toFixed(1) + ' mm so it can sit on the tapered walls.'); trayZb = maxZb; }
    if (trayZb < wall + 5) trayZb = wall + 5;
  }

  // dividers
  const t = p.divider_thickness;
  let dh = p.divider_height > 0.1 ? p.divider_height : H - 2;
  if (p.tray) dh = Math.min(dh, trayZb - 1);
  const pieces = [];
  for (const f of G.dividerFractions(p.divider_ratios, p.dividers)) {
    const yy = wall + (L - 2 * wall) * f;
    pieces.push(box(-w2 - 2, w2 + 2, yy - t / 2, yy + t / 2, 0.5, dh).intersect(clip));
  }
  for (const f of G.dividerFractions(p.divider_col_ratios, p.divider_cols)) {
    const xx = -w2 + wall + (W - 2 * wall) * f;
    pieces.push(box(xx - t / 2, xx + t / 2, -2, L + 2, 0.5, dh).intersect(clip));
  }
  if (pieces.length) { step('Adding dividers'); boxb = fuseAll(boxb, pieces); }

  // name tag shelves and text
  const ends = { none: [], front: ['front'], back: ['back'], both: ['front', 'back'] }[p.label] || [];
  if (ends.length) {
    step('Adding name tag');
    boxb = fuseAll(boxb, ends.map(e => {
      const d = wall + p.label_depth;
      const prof = e === 'front' ? [[-2, H], [d, H], [d, H - 1.6], [-2, H - 1.6 - d - 2]] : [[L + 2, H], [L - d, H], [L - d, H - 1.6], [L + 2, H - 1.6 - d - 2]];
      return prism('x', -w2 - 2, w2 + 2, prof).intersect(clip);
    }));
    if ((p.label_text || '').trim()) {
      for (const e of ends) {
        const ya = e === 'front' ? wall + 0.6 : L - wall - p.label_depth + 0.6;
        const yb = e === 'front' ? wall + p.label_depth - 0.6 : L - wall - 0.6;
        const h0 = Math.min(p.label_text_height, (yb - ya) * 0.85);
        const emb = p.label_style === 'emboss';
        const z0 = emb ? H - 0.05 : H - p.label_text_depth, z1 = emb ? H + p.label_text_depth : H + 1;
        const r = G.textQuads(p.label_text, h0, 0, (ya + yb) / 2 - h0 / 2, W - 8);
        if (r.height < p.label_text_height - 0.01) warn.push('Label text shrunk to ' + r.height.toFixed(1) + ' mm to fit.');
        if (!r.quads.length) continue;
        const strokes = r.quads.map(q => prism('z', z0, z1, q));
        const txt = fuseAll(strokes[0], strokes.slice(1));
        boxb = emb ? boxb.fuse(txt) : boxb.cut(txt);
      }
    }
  }
  const out = { box: boxb, warnings: warn, L };

  // tray
  if (p.tray) {
    step('Building tray');
    const tw = p.tray_wall, inset = wall + cl;
    let y0 = -2, y1 = L + 2;
    if (p.tray_cover === 'front') y1 = L / 2;
    else if (p.tray_cover === 'back') y0 = L / 2;
    if (ends.includes('front')) y0 = Math.max(y0, wall + p.label_depth + cl);
    if (ends.includes('back')) y1 = Math.min(y1, L - wall - p.label_depth - cl);
    const zb = trayZb;
    const clearTools = g => {
      const c2 = [];
      for (const [c, s] of slots) {
        const xi = s * (w2 - SD.housing_depth - cl - g);
        c2.push(box(Math.min(xi, s * (w2 + 2)), Math.max(xi, s * (w2 + 2)), c - SLOT.housing_half - cl - g, c + SLOT.housing_half + cl + g, zb - 5, H + 5));
      }
      if (p.rail_notches && joins.length) for (const n of notchTools(p, joins, wall + cl + g, wall + cl + g)) c2.push(n);
      return c2;
    };
    const outer = cutAll(envelope(G, p, L, inset, -drop, H + 2).intersect(box(-w2 - 2, w2 + 2, y0, y1, zb, H)), clearTools(0));
    const trayClip = outer;
    const hollow = cutAll(envelope(G, p, L, inset + tw, -drop, H + 5)
      .intersect(box(-w2 - 2, w2 + 2, y0 > 0 ? y0 + tw : -5, y1 < L ? y1 - tw : L + 5, zb + tw, H + 5)), clearTools(tw));
    let tray = outer.cut(hollow);
    const divYs = [];
    { const ya = Math.max(y0, inset), yb = Math.min(y1, L - inset); for (let i = 1; i <= p.tray_dividers; i++) divYs.push(ya + (yb - ya) * i / (p.tray_dividers + 1)); }
    if (p.tray_window !== 'none') {
      const frac = zt > 0 ? Math.max(0, 1 - (zb + drop) / zt) : 0;
      let xs = w2 - inset - ti * frac - tw - 2.5;
      if (slots.length) xs = Math.min(xs, w2 - SD.housing_depth - cl - tw - 2.5);
      if (p.rail_notches && joins.length) xs = Math.min(xs, w2 - p.notch_depth - inset - tw - 2.5);
      const ya = Math.max(y0, inset + ti * frac) + tw + 2.5, yb = Math.min(y1, L - inset - ti * frac) - tw - 2.5;
      if (yb - ya > 6 && xs > 3) {
        const region = planPrism(G, p, L, inset + ti * frac + tw + 2.5, zb - 1, zb + tw + 0.5)
          .intersect(box(-xs, xs, ya, yb, zb - 1, zb + tw + 0.5));
        const ribs = [], rib = 2.4, fz0 = zb - 0.01, fz1 = zb + tw + 0.01;
        if (p.tray_window === 'grid' || p.tray_window === 'slots') {
          const pitch = p.tray_window === 'grid' ? 12 : 8;
          const nx = Math.max(1, Math.round(2 * xs / pitch));
          for (let i = 1; i < nx; i++) { const x = -xs + 2 * xs * i / nx; ribs.push(box(x - rib / 2, x + rib / 2, ya - 1, yb + 1, fz0, fz1)); }
          if (p.tray_window === 'grid') {
            const ny = Math.max(1, Math.round((yb - ya) / pitch));
            for (let i = 1; i < ny; i++) { const yy = ya + (yb - ya) * i / ny; ribs.push(box(-xs - 1, xs + 1, yy - rib / 2, yy + rib / 2, fz0, fz1)); }
          }
        } else if (p.tray_window === 'window' && yb - ya > 70) {
          const yy = (ya + yb) / 2; ribs.push(box(-xs - 1, xs + 1, yy - rib / 2, yy + rib / 2, fz0, fz1));
        }
        for (const yy of divYs) ribs.push(box(-xs - 1, xs + 1, yy - 1.8, yy + 1.8, fz0, fz1));
        const openings = ribs.length ? region.cut(fuseAll(ribs[0], ribs.slice(1))) : region;
        tray = tray.cut(openings);
      }
    }
    if (divYs.length) tray = fuseAll(tray, divYs.map(yy => box(-w2, w2, yy - 0.6, yy + 0.6, zb + 0.5, H - 1.5).intersect(trayClip)));
    if (p.tray_finger) tray = tray.cut(cylinder('y', 0, H, 8, -5, L + 5));   // true round finger scoop
    out.tray = tray;
  }

  // wall mount
  if (p.wall_mount) {
    if (!slots.length) warn.push('Wall mount skipped because the box has no hanging slots.');
    else {
      step('Building wall mount');
      let [c, s] = slots[0];
      for (const sl of slots) if (sl[1] > 0) { [c, s] = sl; break; }
      const mc = p.mount_clearance;
      const hw = z => SLOT.open_half - (z - SLOT.open_top) * (SLOT.open_half - SLOT.pocket_top_half) / (SLOT.pocket_top - SLOT.open_top) - mc;
      const hn = z => SLOT.mouth_bot_half - (z - SLOT.open_top) * (SLOT.mouth_bot_half - SLOT.mouth_top_half) / (SLOT.mouth_top - SLOT.open_top) - mc;
      const za = SLOT.open_top + 0.5, zf = SLOT.pocket_top - 0.5, zn = SLOT.mouth_top - 0.5;
      const flange = [[c - hw(za), za], [c + hw(za), za], [c + hw(zf), zf], [c - hw(zf), zf]];
      const neck = [[c - hn(za), za], [c + hn(za), za], [c + hn(zn), zn], [c - hn(zn), zn]];
      const xf0 = w2 - SD.pocket_inner + mc, xf1 = w2 - wall - mc, pt = 3, zp0 = 18, zp1 = H - 1;
      const X = (a, b) => s > 0 ? [a, b] : [-b, -a];
      let m = prism('x', ...X(xf0, xf1), flange).fuse(prism('x', ...X(xf1 - 0.01, w2 + 0.01), neck))
        .fuse(prism('x', ...X(w2, w2 + pt), [[c - 12, zp0], [c + 12, zp0], [c + 12, zp1], [c - 12, zp1]]));
      for (const zh of [zp0 + 5, zp1 - 4]) {               // true round screw holes and counterbores
        m = m.cut(cylinder('x', c, zh, 2.1, ...X(w2 - 1, w2 + pt + 1)));
        m = m.cut(cylinder('x', c, zh, 4.1, ...X(w2 - 1, w2 + 1.6)));
      }
      out.mount = m;
    }
  }
  return out;
}

// Stage 1 entry point kept for the test page: just the box body.
export function buildBody(G, params) {
  const t0 = performance.now();
  const r = build(G, Object.assign({}, params, { slots: 'none', label: 'none', tray: false, wall_mount: false, dividers: 0, divider_cols: 0 }));
  return { body: r.box, seconds: (performance.now() - t0) / 1000, L: r.L };
}

// One STEP file with several named bodies (box, tray, mount), positioned by the caller if needed.
export function stepFile(parts) {
  return R.exportSTEP(parts.map(q => ({ shape: q.shape, name: q.name })));
}

export const volume = shape => R.measureVolume(shape);
export const stepBlob = shape => shape.blobSTEP();
export const stlBlob = (shape, tol = 0.02) => shape.blobSTL({ tolerance: tol, angularTolerance: 2, binary: true });
export const mesh = (shape, tol = 0.05) => shape.mesh({ tolerance: tol, angularTolerance: 5 });
