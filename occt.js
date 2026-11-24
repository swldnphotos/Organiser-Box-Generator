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
function envelope(G, p, L, inset, z0, ztop) {
  const sk = (ins, z) => planDrawing(G.planVertices(p.width, L, p.corners, ins)).sketchOnPlane('XY', z);
  if (p.taper_inset > 0.01 && p.taper_height > 0.5) {
    const lower = sk(inset + p.taper_inset, z0).loftWith(sk(inset, z0 + p.taper_height), { ruled: true });
    const upper = sk(inset, z0 + p.taper_height).extrude(ztop - z0 - p.taper_height);
    return lower.fuse(upper);
  }
  return sk(inset, z0).extrude(ztop - z0);
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

// Stage 1 box body. G is geometry.js (for defaults and the plan outline), params as for G.build().
export function buildBody(G, params) {
  if (!R) throw new Error('Call initOCCT() first.');
  const p = Object.assign(G.defaultParams(), params || {});
  let cells = p.cells.map(Number).filter(c => c > 0);
  if (p.side_clearance > 0) p.width -= 2 * p.side_clearance;
  if (p.end_clearance > 0) { cells = cells.slice(); cells[0] -= p.end_clearance; cells[cells.length - 1] -= p.end_clearance; }
  const L = cells.reduce((a, b) => a + b, 0), H = p.height, wall = Math.min(4, Math.max(0.8, p.wall)), w2 = p.width / 2;
  const joins = []; let y = 0;
  for (let i = 0; i < cells.length - 1; i++) { y += cells[i]; joins.push(y); }
  const t0 = performance.now();
  let env = envelope(G, p, L, 0, 0, H);
  let inner = envelope(G, p, L, wall, 0, H + 5)
    .intersect(R.makeBaseBox(p.width + 10, L + 10, H + 6 - wall).translate([0, L / 2, wall]));
  if (p.rail_notches && joins.length) {
    for (const t of notchTools(p, joins, 0, 0)) env = env.cut(t);
    for (const t of notchTools(p, joins, wall, wall)) inner = inner.cut(t);
  }
  const body = env.cut(inner);
  return { body, seconds: (performance.now() - t0) / 1000, L, w2 };
}

export const volume = shape => R.measureVolume(shape);
export const stepBlob = shape => shape.blobSTEP();
export const stlBlob = (shape, tol = 0.02) => shape.blobSTL({ tolerance: tol, angularTolerance: 2, binary: true });
export const mesh = (shape, tol = 0.05) => shape.mesh({ tolerance: tol, angularTolerance: 5 });
