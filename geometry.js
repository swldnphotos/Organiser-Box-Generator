// Magnusson box generator - browser geometry engine (pure JS, no dependencies).
// Mirrors the Fusion add-in's mbox_engine.py. Units: mm.
// X across the box (centred), Y along the box (front at y=0), Z up.
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ CSG (BSP, after Evan Wallace's csg.js)
  const EPS = 1e-5;
  class V3 {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    plus(a) { return new V3(this.x + a.x, this.y + a.y, this.z + a.z); }
    minus(a) { return new V3(this.x - a.x, this.y - a.y, this.z - a.z); }
    times(k) { return new V3(this.x * k, this.y * k, this.z * k); }
    dot(a) { return this.x * a.x + this.y * a.y + this.z * a.z; }
    lerp(a, t) { return this.plus(a.minus(this).times(t)); }
    len() { return Math.sqrt(this.dot(this)); }
    unit() { return this.times(1 / this.len()); }
    cross(a) { return new V3(this.y * a.z - this.z * a.y, this.z * a.x - this.x * a.z, this.x * a.y - this.y * a.x); }
  }
  class Plane {
    constructor(n, w) { this.normal = n; this.w = w; }
    static fromPoints(a, b, c) {
      const n = b.minus(a).cross(c.minus(a));
      const l = n.len();
      if (!(l > 1e-12)) return null;
      const u = n.times(1 / l);
      return new Plane(u, u.dot(a));
    }
    clone() { return new Plane(this.normal, this.w); }
    flip() { this.normal = this.normal.times(-1); this.w = -this.w; }
    split(poly, cf, cb, f, b) {
      const COP = 0, FR = 1, BK = 2, SP = 3;
      let pt = 0; const types = [];
      for (const v of poly.v) {
        const t = this.normal.dot(v) - this.w;
        const ty = t < -EPS ? BK : t > EPS ? FR : COP;
        pt |= ty; types.push(ty);
      }
      switch (pt) {
        case COP: (this.normal.dot(poly.plane.normal) > 0 ? cf : cb).push(poly); break;
        case FR: f.push(poly); break;
        case BK: b.push(poly); break;
        case SP: {
          const fv = [], bv = [];
          const n = poly.v.length;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
            if (ti !== BK) fv.push(vi);
            if (ti !== FR) bv.push(vi);
            if ((ti | tj) === SP) {
              const t = (this.w - this.normal.dot(vi)) / this.normal.dot(vj.minus(vi));
              const v = vi.lerp(vj, t);
              fv.push(v); bv.push(v);
            }
          }
          if (fv.length >= 3) f.push(new Poly(fv, poly.plane.clone()));
          if (bv.length >= 3) b.push(new Poly(bv, poly.plane.clone()));
        }
      }
    }
  }
  class Poly {
    constructor(v, plane) { this.v = v; this.plane = plane || Plane.fromPoints(v[0], v[1], v[2]); }
    clone() { return new Poly(this.v.slice(), this.plane.clone()); }
    flip() { this.v.reverse(); this.plane.flip(); }
  }
  class Node {
    constructor(polys) { this.plane = null; this.front = null; this.back = null; this.polys = []; if (polys) this.build(polys); }
    invert() {
      // iterative to avoid deep recursion
      const st = [this];
      while (st.length) {
        const n = st.pop();
        for (const p of n.polys) p.flip();
        n.plane.flip();
        const t = n.front; n.front = n.back; n.back = t;
        if (n.front) st.push(n.front);
        if (n.back) st.push(n.back);
      }
    }
    clipPolygons(polys) {
      if (!this.plane) return polys.slice();
      let f = [], b = [];
      for (const p of polys) this.plane.split(p, f, b, f, b);
      if (this.front) f = this.front.clipPolygons(f);
      b = this.back ? this.back.clipPolygons(b) : [];
      return f.concat(b);
    }
    clipTo(bsp) {
      const st = [this];
      while (st.length) {
        const n = st.pop();
        n.polys = bsp.clipPolygons(n.polys);
        if (n.front) st.push(n.front);
        if (n.back) st.push(n.back);
      }
    }
    allPolygons() {
      const out = [], st = [this];
      while (st.length) {
        const n = st.pop();
        for (const p of n.polys) out.push(p);
        if (n.front) st.push(n.front);
        if (n.back) st.push(n.back);
      }
      return out;
    }
    build(polys) {
      const st = [[this, polys]];
      while (st.length) {
        const [n, ps] = st.pop();
        if (!ps.length) continue;
        if (!n.plane) n.plane = ps[0].plane.clone();
        const f = [], b = [];
        for (const p of ps) n.plane.split(p, n.polys, n.polys, f, b);
        if (f.length) { if (!n.front) n.front = new Node(); st.push([n.front, f]); }
        if (b.length) { if (!n.back) n.back = new Node(); st.push([n.back, b]); }
      }
    }
  }
  class CSG {
    constructor(polys) { this.polys = polys || []; }
    clone() { return new CSG(this.polys.map(p => p.clone())); }
    bbox() {
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const p of this.polys) for (const v of p.v) {
        mn[0] = Math.min(mn[0], v.x); mn[1] = Math.min(mn[1], v.y); mn[2] = Math.min(mn[2], v.z);
        mx[0] = Math.max(mx[0], v.x); mx[1] = Math.max(mx[1], v.y); mx[2] = Math.max(mx[2], v.z);
      }
      return [mn, mx];
    }
    static overlap(a, b) {
      const A = a.bbox(), B = b.bbox();
      for (let i = 0; i < 3; i++) if (A[1][i] < B[0][i] - 1e-6 || B[1][i] < A[0][i] - 1e-6) return false;
      return true;
    }
    union(o) {
      if (!this.polys.length) return o.clone();
      if (!o.polys.length) return this.clone();
      if (!CSG.overlap(this, o)) return new CSG(this.clone().polys.concat(o.clone().polys));
      const a = new Node(this.clone().polys), b = new Node(o.clone().polys);
      a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.allPolygons());
      return new CSG(a.allPolygons());
    }
    subtract(o) {
      if (!this.polys.length || !o.polys.length || !CSG.overlap(this, o)) return this.clone();
      const a = new Node(this.clone().polys), b = new Node(o.clone().polys);
      a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.allPolygons()); a.invert();
      return new CSG(a.allPolygons());
    }
    intersect(o) {
      if (!this.polys.length || !o.polys.length || !CSG.overlap(this, o)) return new CSG([]);
      const a = new Node(this.clone().polys), b = new Node(o.clone().polys);
      a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.allPolygons()); a.invert();
      return new CSG(a.allPolygons());
    }
    // union many (balanced, skipping disjoint pairs cheaply)
    static unionAll(list) {
      list = list.filter(c => c && c.polys.length);
      if (!list.length) return new CSG([]);
      while (list.length > 1) {
        const nx = [];
        for (let i = 0; i < list.length; i += 2) nx.push(i + 1 < list.length ? list[i].union(list[i + 1]) : list[i]);
        list = nx;
      }
      return list[0];
    }
    subtractAll(list) {
      let r = this;
      for (const c of list) r = r.subtract(c);
      return r;
    }
    triangles() {
      const out = [];
      for (const p of this.polys) {
        const v = p.v;
        for (let i = 1; i < v.length - 1; i++) out.push([v[0], v[i], v[i + 1]]);
      }
      return out;
    }
    volume() {
      let s = 0;
      for (const [a, b, c] of this.triangles()) s += a.dot(b.cross(c)) / 6;
      return s;
    }
  }

  // polygon list from triangles/faces, dropping degenerate ones
  function mkPoly(pts) {
    const v = [];
    for (const p of pts) {
      if (v.length && v[v.length - 1].minus(p).len() < 1e-7) continue;
      v.push(p);
    }
    if (v.length > 1 && v[0].minus(v[v.length - 1]).len() < 1e-7) v.pop();
    if (v.length < 3) return null;
    // find a non-degenerate plane
    let pl = null;
    for (let i = 1; i < v.length - 1 && !pl; i++) pl = Plane.fromPoints(v[0], v[i], v[i + 1]);
    if (!pl) return null;
    return new Poly(v, pl);
  }

  // ------------------------------------------------------------------ primitives
  // Prism: polygon pts (2D) extruded along axis from a0 to a1.
  // axis 'z': pts (x,y); 'x': pts (y,z); 'y': pts (x,z)
  function prism(axis, a0, a1, pts) {
    const P = (u, v, a) => axis === 'z' ? new V3(u, v, a) : axis === 'x' ? new V3(a, u, v) : new V3(u, a, v);
    // orientation: make polygon CCW in (u,v)
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) pts = pts.slice().reverse();
    // (u,v,axis) handedness: z:(x,y,z) right-handed; x:(y,z,x) right-handed; y:(x,z,y) left-handed
    const flipAxis = axis === 'y';
    const lo = flipAxis ? a1 : a0, hi = flipAxis ? a0 : a1;
    const bot = pts.map(p => P(p[0], p[1], lo));
    const top = pts.map(p => P(p[0], p[1], hi));
    const polys = [];
    const add = q => { const p = mkPoly(q); if (p) polys.push(p); };
    for (const tri of triangulate(pts)) {
      add(tri.map(i => bot[i]).reverse());
      add(tri.map(i => top[i]));
    }
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      add([bot[i], bot[j], top[j], top[i]]);
    }
    return new CSG(polys);
  }
  // ear-clipping triangulation of a CCW simple polygon -> list of index triples (or [all] if convex)
  function triangulate(pts) {
    const n = pts.length;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let convex = true;
    for (let i = 0; i < n; i++) if (cross(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]) < -1e-9) { convex = false; break; }
    if (convex) return [pts.map((_, i) => i)];
    const idx = pts.map((_, i) => i), tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        const a = pts[i0], b = pts[i1], c = pts[i2];
        if (cross(a, b, c) <= 1e-12) continue;
        let inside = false;
        for (const j of idx) {
          if (j === i0 || j === i1 || j === i2) continue;
          const q = pts[j];
          if (cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0) { inside = true; break; }
        }
        if (inside) continue;
        tris.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push(idx.slice());
    return tris;
  }
  function box(x0, x1, y0, y1, z0, z1) {
    return prism('z', z0, z1, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  }
  // loft through rings (each ring same vertex count, CCW in xy, at given z)
  function loft(rings) {
    const polys = [];
    const add = q => { const p = mkPoly(q); if (p) polys.push(p); };
    const n = rings[0].length;
    const cap = (ring, flip) => {
      const pts = [], idx = [];
      ring.forEach((v, i) => { const l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - v.x, l[1] - v.y) > 1e-7) { pts.push([v.x, v.y]); idx.push(i); } });
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-7) { pts.pop(); idx.pop(); }
      for (const tri of triangulate(pts)) { const q = tri.map(i => ring[idx[i]]); add(flip ? q.reverse() : q); }
    };
    cap(rings[0], true);
    cap(rings[rings.length - 1], false);
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], B = rings[r + 1];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        add([A[i], A[j], B[j]]);
        add([A[i], B[j], B[i]]);
      }
    }
    return new CSG(polys);
  }
  function circlePts(cu, cv, r, n) {
    n = n || 20;
    const o = [];
    for (let i = 0; i < n; i++) o.push([cu + r * Math.cos(2 * Math.PI * i / n), cv + r * Math.sin(2 * Math.PI * i / n)]);
    return o;
  }

  // ------------------------------------------------------------------ plan outline
  const STD_CORNER = { type: 'chamfer', x: 6.74, y: 6.74, r: 9 };
  const ARC_SEG = 6;
  const norm = v => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };

  function planVertices(W, L, corners, inset) {
    const w2 = W / 2;
    const pts = { FL: [-w2, 0], FR: [w2, 0], BR: [w2, L], BL: [-w2, L] };
    const dirs = { FL: [[0, -1], 'y', [1, 0], 'x'], FR: [[1, 0], 'x', [0, 1], 'y'], BR: [[0, 1], 'y', [-1, 0], 'x'], BL: [[-1, 0], 'x', [0, -1], 'y'] };
    let verts = [];
    for (const k of ['FL', 'FR', 'BR', 'BL']) {
      const cn = corners[k] || STD_CORNER;
      const [px, py] = pts[k];
      const [din, legin, dout, legout] = dirs[k];
      if (cn.type === 'notch' && cn.x > 0.01 && cn.y > 0.01) {
        // stepped notch: runs cn.x along the width edge, cn.y deep, with a 45 degree lead-in
        const ix = -Math.sign(px), iy = py === 0 ? 1 : -1, d = Math.min(cn.y, cn.x);
        const Ex = [px + ix * cn.x, py], M = [px + ix * (cn.x - d), py + iy * cn.y], Ey = [px, py + iy * cn.y];
        const seq = legin === 'x' ? [Ex, M, Ey] : [Ey, M, Ex];
        for (const q of seq) verts.push([q, 0]);
      } else if (cn.type === 'chamfer' && cn.x > 0.01 && cn.y > 0.01) {
        const a = cn[legin], b = cn[legout];
        verts.push([[px - din[0] * a, py - din[1] * a], cn.r || 0]);
        verts.push([[px + dout[0] * b, py + dout[1] * b], cn.r || 0]);
      } else verts.push([[px, py], cn.r || 0]);
    }
    if (inset) {
      const n = verts.length, lines = [];
      for (let i = 0; i < n; i++) {
        const a = verts[i][0], b = verts[(i + 1) % n][0];
        const u = norm([b[0] - a[0], b[1] - a[1]]), nn = [-u[1], u[0]];
        lines.push([[a[0] + nn[0] * inset, a[1] + nn[1] * inset], u]);
      }
      const nv = [];
      for (let i = 0; i < n; i++) {
        const [p1, u1] = lines[(i - 1 + n) % n], [p2, u2] = lines[i];
        const den = u1[0] * u2[1] - u1[1] * u2[0];
        let q;
        if (Math.abs(den) < 1e-9) q = p2;
        else { const t = ((p2[0] - p1[0]) * u2[1] - (p2[1] - p1[1]) * u2[0]) / den; q = [p1[0] + u1[0] * t, p1[1] + u1[1] * t]; }
        nv.push([q, Math.max(verts[i][1] - inset, 0)]);
      }
      verts = nv;
    }
    return verts;
  }
  // discretize with a FIXED number of points per vertex so rings correspond
  function planPoints(verts) {
    const n = verts.length, out = [];
    for (let i = 0; i < n; i++) {
      let [v, r] = verts[i];
      const pv = verts[(i - 1 + n) % n][0], nv = verts[(i + 1) % n][0];
      const d1 = norm([v[0] - pv[0], v[1] - pv[1]]), d2 = norm([nv[0] - v[0], nv[1] - v[1]]);
      const phi = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
      const lp = Math.hypot(v[0] - pv[0], v[1] - pv[1]), ln = Math.hypot(nv[0] - v[0], nv[1] - v[1]);
      const crs = d1[0] * d2[1] - d1[1] * d2[0];
      if (r < 0.02 || crs <= 1e-9) { for (let s = 0; s <= ARC_SEG; s++) out.push([v[0], v[1]]); continue; }
      let t = r * Math.tan(phi / 2);
      const tmax = 0.49 * Math.min(lp, ln);
      if (t > tmax) { r = r * tmax / t; t = tmax; }
      const t1 = [v[0] - d1[0] * t, v[1] - d1[1] * t];
      const nl = [-d1[1], d1[0]];
      const c = [t1[0] + nl[0] * r, t1[1] + nl[1] * r];
      const a0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
      for (let s = 0; s <= ARC_SEG; s++) {
        const a = a0 + phi * s / ARC_SEG;
        out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
    }
    return out;
  }
  function planPrism(W, L, corners, inset, z0, z1) {
    return prism('z', z0, z1, planPoints(planVertices(W, L, corners, inset)));
  }

  // ------------------------------------------------------------------ parameters
  function defaultParams() {
    const c = () => Object.assign({}, STD_CORNER);
    return {
      width: 66.5, cells: [64.5], height: 55, wall: 1.5, taper_inset: 3.5, taper_height: 40,
      corners: { FL: c(), FR: c(), BR: c(), BL: c() },
      rail_notches: true, notch_depth: 3.5, notch_width: 6.4, notch_flare: 1.2,
      slots: 'every', slot_sides: 'both',
      dividers: 0, divider_cols: 0, divider_ratios: '', divider_col_ratios: '', divider_thickness: 1.2, divider_height: 0,
      label: 'none', label_text: '', label_depth: 12, label_text_height: 6, label_style: 'deboss', label_text_depth: 0.6,
      tray: false, tray_depth: 27.5, tray_clearance: 0.4, tray_wall: 1.2, tray_cover: 'full', tray_window: 'grid',
      tray_dividers: 0, tray_finger: true, separate: false, split_gap: 1.0, piece_labels: [],
      wall_mount: false, mount_clearance: 0.25, side_clearance: 0, end_clearance: 0,
    };
  }
  const SLOT = {
    housing_depth: 6.5, housing_half: 9.0, housing_top: 48.6, pocket_inner: 5.0, open_half: 7.5, open_top: 32.91,
    pocket_top_half: 5.0, pocket_top: 47.09, mouth_bot_half: 5.98, mouth_top_half: 3.74, mouth_top: 45.59, min_height: 50,
    window: 15,   // height of the entry window below the narrowing part; the hook goes in sideways, then the box drops onto it
  };
  // pocket and housing depths measured from the outer wall, kept the same distance behind the inner face whatever the wall thickness
  const slotDims = wall => ({ pocket_inner: wall + 3.5, housing_depth: wall + 5, cut_bottom: Math.max(wall + 1, SLOT.open_top - SLOT.window) });

  // ------------------------------------------------------------------ builder
  function envelope(p, inset, z0, ztop) {
    const W = p.width, L = p._L, ti = p.taper_inset, zt = p.taper_height;
    const ring = (ins, z) => planPoints(planVertices(W, L, p.corners, ins)).map(q => new V3(q[0], q[1], z));
    if (ti > 0.01 && zt > 0.5) return loft([ring(inset + ti, z0), ring(inset, z0 + zt), ring(inset, ztop)]);
    return loft([ring(inset, z0), ring(inset, ztop)]);
  }
  function notchTools(p, joins, grow, inner) {
    const w2 = p.width / 2, nd = p.notch_depth, nw = p.notch_width / 2, fl = p.notch_flare;
    const tools = [];
    for (const yj of joins) for (const s of [1, -1]) {
      const xi = s * (w2 - nd - inner), xo = s * (w2 + 2);
      tools.push(prism('z', -10, p.height + 10, [[xi, yj - nw - grow], [s * w2, yj - nw - fl - grow], [xo, yj - nw - fl - grow],
        [xo, yj + nw + fl + grow], [s * w2, yj + nw + fl + grow], [xi, yj + nw + grow]]));
    }
    return tools;
  }

  // simple stroke font on a 4 x 6 grid (x 0..4, y 0..6, baseline 0)
  const FONT = {
    'A': [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]],
    'B': [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
    'C': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
    'D': [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
    'E': [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
    'F': [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
    'G': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
    'H': [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
    'I': [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
    'J': [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
    'K': [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]],
    'L': [[[0, 6], [0, 0], [4, 0]]],
    'M': [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
    'N': [[[0, 0], [0, 6], [4, 0], [4, 6]]],
    'O': [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
    'P': [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
    'Q': [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[2.5, 1.5], [4, 0]]],
    'R': [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
    'S': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    'T': [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
    'U': [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
    'V': [[[0, 6], [2, 0], [4, 6]]],
    'W': [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
    'X': [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
    'Y': [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
    'Z': [[[0, 6], [4, 6], [0, 0], [4, 0]]],
    '0': [[[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]], [[0.5, 1], [3.5, 5]]],
    '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
    '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
    '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [2, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
    '5': [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    '6': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
    '7': [[[0, 6], [4, 6], [1, 0]]],
    '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
    '9': [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]],
    '-': [[[1, 3], [3, 3]]],
    '+': [[[0.5, 3], [3.5, 3]], [[2, 1.5], [2, 4.5]]],
    '.': [[[2, 0], [2, 0.6]]],
    ',': [[[2, 0.6], [1.5, -0.8]]],
    ':': [[[2, 1], [2, 1.6]], [[2, 4], [2, 4.6]]],
    '/': [[[0, 0], [4, 6]]],
    '#': [[[1, 0], [1.5, 6]], [[2.5, 0], [3, 6]], [[0, 2], [4, 2]], [[0, 4], [4, 4]]],
    "'": [[[2, 6], [2, 4.5]]],
    '(': [[[3, 6], [2, 5], [2, 1], [3, 0]]],
    ')': [[[1, 6], [2, 5], [2, 1], [1, 0]]],
    'x': [[[0.5, 0], [3.5, 4]], [[0.5, 4], [3.5, 0]]],
    '%': [[[0, 0], [4, 6]], [[0.5, 5], [1, 5.5]], [[3, 0.5], [3.5, 1]]],
    '&': [[[4, 0], [1, 4], [1, 5], [2, 6], [3, 5], [3, 4], [0, 1.5], [1, 0], [2.5, 0], [4, 2]]],
  };
  // label text as 2D stroke quads (shared by both engines): {quads, height} for text centred at x0, baseline y0
  function textQuads(text, height, x0, y0, maxW) {
    text = text.toUpperCase().replace(/[^A-Z0-9\-+.,:/#'()X%& ]/g, '');
    let h = height;
    const advance = 5.4; // grid units per char
    const widthFor = hh => (text.length * advance - 1.4) * hh / 6;
    while (h > 2 && widthFor(h) > maxW) h -= 0.25;
    const s = h / 6, sw = Math.max(0.6, 0.85 * s);
    const tw = widthFor(h);
    const quads = [];
    let cx = x0 - tw / 2;
    for (const ch of text) {
      const g = FONT[ch];
      if (g) for (const line of g) {
        for (let i = 0; i < line.length - 1; i++) {
          const a = [cx + line[i][0] * s, y0 + line[i][1] * s], b = [cx + line[i + 1][0] * s, y0 + line[i + 1][1] * s];
          let d = [b[0] - a[0], b[1] - a[1]];
          const l = Math.hypot(d[0], d[1]);
          if (l < 1e-6) d = [1, 0]; else d = [d[0] / l, d[1] / l];
          const n = [-d[1] * sw / 2, d[0] * sw / 2], e = [d[0] * sw / 2, d[1] * sw / 2];
          quads.push([[a[0] - e[0] - n[0], a[1] - e[1] - n[1]], [b[0] + e[0] - n[0], b[1] + e[1] - n[1]],
            [b[0] + e[0] + n[0], b[1] + e[1] + n[1]], [a[0] - e[0] + n[0], a[1] - e[1] + n[1]]]);
        }
      }
      cx += advance * s;
    }
    return { quads, height: h };
  }
  function textStrokes(text, height, x0, y0, z0, z1, maxW) {
    const r = textQuads(text, height, x0, y0, maxW);
    return { tools: r.quads.map(q => prism('z', z0, z1, q)), height: r.height };
  }

  // divider positions as fractions of the inner length: from relative sizes ("1, 1, 2") or an even count
  function dividerFractions(ratios, count) {
    let r = Array.isArray(ratios) ? ratios : String(ratios || '').split(/[,;\s]+/);
    r = r.map(Number).filter(v => v > 0);
    if (r.length < 2) { const n = Math.max(0, Math.round(count || 0)); return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)); }
    const tot = r.reduce((a, b) => a + b, 0), out = [];
    let acc = 0;
    for (let i = 0; i < r.length - 1; i++) { acc += r[i]; out.push(acc / tot); }
    return out;
  }

  function build(params, progress) {
    const p = Object.assign(defaultParams(), params || {});
    p.cells = (p.cells || []).map(Number).filter(v => v > 0);
    if (p.side_clearance > 0) p.width = p.width - 2 * p.side_clearance;
    if (p.end_clearance > 0 && p.cells.length) {
      p.cells = p.cells.slice();
      p.cells[0] -= p.end_clearance;
      p.cells[p.cells.length - 1] -= p.end_clearance;
    }
    const warn = [];
    const step = m => { if (progress) progress(m); };
    const W = p.width, H = p.height, wall = Math.min(4, Math.max(0.8, p.wall)), w2 = W / 2;
    if (wall !== p.wall) warn.push('Wall thickness limited to ' + wall + ' mm.');
    p.wall = wall;
    const cells = p.cells.map(Number).filter(v => v > 0);
    const L = cells.reduce((a, b) => a + b, 0);
    p._L = L;
    let joins = [], centres = [];
    let y = 0;
    cells.forEach((c, i) => { centres.push(y + c / 2); y += c; if (i < cells.length - 1) joins.push(y); });
    if (p._joins) joins = p._joins.slice();       // set when this box is one piece of a split span
    if (p._centres) centres = p._centres.slice();
    const useNotch = p.rail_notches && joins.length > 0;

    step('Shaping the box');
    const SD = slotDims(wall);
    let env = envelope(p, 0, 0, H);
    let inner = envelope(p, wall, 0, H + 5).intersect(box(-w2 - 5, w2 + 5, -5, L + 5, wall, H + 6));
    if (useNotch) {
      env = env.subtractAll(notchTools(p, joins, 0, 0));
      inner = inner.subtractAll(notchTools(p, joins, wall, wall));
    }
    const clip = env;
    let boxb = env.subtract(inner);

    // hanging slots
    let slots = [];
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
      const hs = slots.map(([c, s]) => {
        const a = s * (w2 - SD.housing_depth), b = s * (w2 + 2);
        return box(Math.min(a, b), Math.max(a, b), c - SLOT.housing_half, c + SLOT.housing_half, -1, SLOT.housing_top).intersect(clip);
      });
      boxb = CSG.unionAll([boxb].concat(hs));
      const cut = [];
      for (const [c, s] of slots) {
        const oh = SLOT.open_half, ot = SLOT.open_top;
        const zb = SD.cut_bottom;
        const pocket = [[c - oh, zb], [c + oh, zb], [c + oh, ot], [c + SLOT.pocket_top_half, SLOT.pocket_top], [c - SLOT.pocket_top_half, SLOT.pocket_top], [c - oh, ot]];
        const mouth = [[c - oh, zb], [c + oh, zb], [c + oh, ot], [c + SLOT.mouth_bot_half, ot], [c + SLOT.mouth_top_half, SLOT.mouth_top],
          [c - SLOT.mouth_top_half, SLOT.mouth_top], [c - SLOT.mouth_bot_half, ot], [c - oh, ot]];
        const xa = w2 - SD.pocket_inner, xb = w2 - wall, xc = w2 + 2;
        if (s > 0) { cut.push(prism('x', xa, xb + 0.01, pocket)); cut.push(prism('x', xb, xc, mouth)); }
        else { cut.push(prism('x', -xb - 0.01, -xa, pocket)); cut.push(prism('x', -xc, -xb, mouth)); }
      }
      boxb = boxb.subtractAll(cut);
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
    for (const f of dividerFractions(p.divider_ratios, p.dividers)) {
      const yy = wall + (L - 2 * wall) * f;
      pieces.push(box(-w2 - 2, w2 + 2, yy - t / 2, yy + t / 2, 0.5, dh).intersect(clip));
    }
    for (const f of dividerFractions(p.divider_col_ratios, p.divider_cols)) {
      const xx = -w2 + wall + (W - 2 * wall) * f;
      pieces.push(box(xx - t / 2, xx + t / 2, -2, L + 2, 0.5, dh).intersect(clip));
    }
    if (pieces.length) { step('Adding dividers'); boxb = CSG.unionAll([boxb].concat(pieces)); }

    // name tag shelves
    const ends = { none: [], front: ['front'], back: ['back'], both: ['front', 'back'] }[p.label] || [];
    if (ends.length) {
      step('Adding name tag');
      const sh = [];
      for (const e of ends) {
        const d = wall + p.label_depth;
        const prof = e === 'front' ? [[-2, H], [d, H], [d, H - 1.6], [-2, H - 1.6 - d - 2]] : [[L + 2, H], [L - d, H], [L - d, H - 1.6], [L + 2, H - 1.6 - d - 2]];
        sh.push(prism('x', -w2 - 2, w2 + 2, prof).intersect(clip));
      }
      boxb = CSG.unionAll([boxb].concat(sh));
      if ((p.label_text || '').trim()) {
        for (const e of ends) {
          const ya = e === 'front' ? wall + 0.6 : L - wall - p.label_depth + 0.6;
          const yb = e === 'front' ? wall + p.label_depth - 0.6 : L - wall - 0.6;
          const h0 = Math.min(p.label_text_height, (yb - ya) * 0.85);
          const emb = p.label_style === 'emboss';
          const z0 = emb ? H - 0.05 : H - p.label_text_depth, z1 = emb ? H + p.label_text_depth : H + 1;
          const r = textStrokes(p.label_text, h0, 0, (ya + yb) / 2 - h0 / 2, z0, z1, W - 8);
          if (r.height < p.label_text_height - 0.01) warn.push('Label text shrunk to ' + r.height.toFixed(1) + ' mm to fit.');
          const txt = CSG.unionAll(r.tools);
          boxb = emb ? boxb.union(txt) : boxb.subtract(txt);
        }
      }
    }

    const out = { box: boxb, warnings: warn, L };

    // ---------------- tray
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
      let outer = envelope(p, inset, -drop, H + 2).intersect(box(-w2 - 2, w2 + 2, y0, y1, zb, H)).subtractAll(clearTools(0));
      const trayClip = outer;
      let hollow = envelope(p, inset + tw, -drop, H + 5)
        .intersect(box(-w2 - 2, w2 + 2, y0 > 0 ? y0 + tw : -5, y1 < L ? y1 - tw : L + 5, zb + tw, H + 5))
        .subtractAll(clearTools(tw));
      let tray = outer.subtract(hollow);

      const divYs = [];
      { const ya = Math.max(y0, inset), yb = Math.min(y1, L - inset); for (let i = 1; i <= p.tray_dividers; i++) divYs.push(ya + (yb - ya) * i / (p.tray_dividers + 1)); }

      if (p.tray_window !== 'none') {
        const frac = zt > 0 ? Math.max(0, 1 - (zb + drop) / zt) : 0;
        let xs = w2 - inset - ti * frac - tw - 2.5;
        if (slots.length) xs = Math.min(xs, w2 - SD.housing_depth - cl - tw - 2.5);
        if (p.rail_notches && joins.length) xs = Math.min(xs, w2 - p.notch_depth - inset - tw - 2.5);
        const ya = Math.max(y0, inset + ti * frac) + tw + 2.5, yb = Math.min(y1, L - inset - ti * frac) - tw - 2.5;
        if (yb - ya > 6 && xs > 3) {
          const region = planPrism(W, L, p.corners, inset + ti * frac + tw + 2.5, zb - 1, zb + tw + 0.5)
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
          let openings = region;
          if (ribs.length) openings = region.subtract(CSG.unionAll(ribs));
          tray = tray.subtract(openings);
        }
      }
      if (divYs.length) tray = CSG.unionAll([tray].concat(divYs.map(yy => box(-w2, w2, yy - 0.6, yy + 0.6, zb + 0.5, H - 1.5).intersect(trayClip))));
      if (p.tray_finger) {
        const r = 8, pts = [[-r, H + 5]];
        for (let i = 0; i <= 16; i++) pts.push([r * Math.cos(Math.PI + Math.PI * i / 16), H + r * Math.sin(Math.PI + Math.PI * i / 16)]);
        pts.push([r, H + 5]);
        tray = tray.subtract(prism('y', -5, L + 5, pts));
      }
      out.tray = tray;
    }

    // ---------------- wall mount
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
        let m = CSG.unionAll([prism('x', ...X(xf0, xf1), flange), prism('x', ...X(xf1 - 0.01, w2 + 0.01), neck),
          prism('x', ...X(w2, w2 + pt), [[c - 12, zp0], [c + 12, zp0], [c + 12, zp1], [c - 12, zp1]])]);
        const holes = [];
        for (const zh of [zp0 + 5, zp1 - 4]) {
          holes.push(prism('x', ...X(w2 - 1, w2 + pt + 1), circlePts(c, zh, 2.1)));
          holes.push(prism('x', ...X(w2 - 1, w2 + 1.6), circlePts(c, zh, 4.1)));
        }
        out.mount = m.subtractAll(holes);
      }
    }
    return out;
  }

  // Split a span into physically separate boxes along its length.
  // Returns [{res, y0, index}] where y0 is the piece's front edge in span coordinates.
  function buildSplit(params, progress) {
    const p = Object.assign(defaultParams(), params || {});
    let fr = dividerFractions(p.divider_ratios, p.dividers);
    if (!p.separate || !fr.length) return [{ res: build(params, progress), y0: 0, index: 0, label: p.label === 'none' ? '' : (p.label_text || '') }];
    const cellsIn = (p.cells || []).map(Number).filter(v => v > 0);
    const ec = p.end_clearance > 0 ? p.end_clearance : 0, gap = p.split_gap > 0 ? p.split_gap : 0;
    const Lfull = cellsIn.reduce((a, b) => a + b, 0);
    const joins = [], centres = [];
    let y = 0;
    cellsIn.forEach((c, i) => { centres.push(y + c / 2); y += c; if (i < cellsIn.length - 1) joins.push(y); });
    const inner0 = ec, inner1 = Lfull - ec;
    // piece lengths share the span after the gaps are taken out
    const n = fr.length + 1, usable = inner1 - inner0 - gap * (n - 1);
    const fracs = [0, ...fr, 1], out = [];
    const nw = p.notch_width / 2 + p.notch_flare, sm = SLOT.housing_half + p.wall + 1;
    let yAt = inner0;
    for (let i = 0; i < n; i++) {
      const L = usable * (fracs[i + 1] - fracs[i]), y0 = yAt, y1 = y0 + L;
      yAt = y1 + gap;
      const corners = JSON.parse(JSON.stringify(p.corners));
      if (i > 0) { corners.FL = Object.assign({}, STD_CORNER); corners.FR = Object.assign({}, STD_CORNER); }
      if (i < n - 1) { corners.BL = Object.assign({}, STD_CORNER); corners.BR = Object.assign({}, STD_CORNER); }
      // rail indents wherever a rail rib falls on this piece (also part-way off an end);
      // hanging slots at the cell centres inside it, or at its own centre if none fit
      let cs = centres.filter(c => c - y0 > sm && y1 - c > sm).map(c => c - y0);
      if (!cs.length && L > 2 * sm) cs = [L / 2];
      // each piece can carry its own name tag; a blank one falls back to the shared label
      const own = Array.isArray(p.piece_labels) ? String(p.piece_labels[i] || '').trim() : '';
      const lt = own || p.label_text || '';
      const q = Object.assign({}, params, {
        label_text: lt, label: own && p.label === 'none' ? 'front' : p.label,
        cells: [L], end_clearance: 0, separate: false, dividers: 0, divider_ratios: '', corners,
        _joins: joins.filter(j => j > y0 - nw && j < y1 + nw).map(j => j - y0),
        _centres: cs,
      });
      if (L < 20) throw new Error('A separate box would be under 20 mm long; use fewer or larger compartments.');
      const res = build(q, progress);
      if (p.slots !== 'none' && !cs.length && p.height >= SLOT.min_height) res.warnings.push('Piece ' + (i + 1) + ' is too short for a hanging slot.');
      out.push({ res, y0, index: i, label: q.label === 'none' ? '' : lt });
    }
    return out;
  }

  // ------------------------------------------------------------------ export
  function toBinarySTL(csg, name) {
    const tris = csg.triangles();
    const buf = new ArrayBuffer(84 + tris.length * 50);
    const dv = new DataView(buf);
    const head = ('Magnusson box generator ' + (name || '')).slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const [a, b, c] of tris) {
      let n = b.minus(a).cross(c.minus(a));
      const l = n.len(); n = l > 0 ? n.times(1 / l) : new V3(0, 0, 0);
      for (const v of [n, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Uint8Array(buf);
  }

  // ------------------------------------------------------------------ STEP export
  // Turns a CSG result into a planar B-rep: welds vertices, closes T-junctions left by the BSP booleans,
  // merges coplanar neighbours into single faces (with holes), then writes AP214 advanced faces.
  function toBrep(csg) {
    const TOL = 1e-3, pts = [], grid = new Map();
    const key = (i, j, k) => i + ',' + j + ',' + k;
    const vid = v => {
      const i = Math.round(v.x / TOL), j = Math.round(v.y / TOL), k = Math.round(v.z / TOL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const l = grid.get(key(i + a, j + b, k + c));
        if (l) for (const id of l) { const q = pts[id]; if (Math.abs(q.x - v.x) < TOL && Math.abs(q.y - v.y) < TOL && Math.abs(q.z - v.z) < TOL) return id; }
      }
      const id = pts.length; pts.push(v);
      const kk = key(i, j, k); (grid.get(kk) || grid.set(kk, []).get(kk)).push(id);
      return id;
    };
    let polys = [];
    for (const p of csg.polys) {
      const ids = [];
      for (const v of p.v) { const id = vid(v); if (ids[ids.length - 1] !== id) ids.push(id); }
      while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
      if (ids.length >= 3) polys.push({ ids, n: p.plane.normal, w: p.plane.w });
    }
    // T-junctions: put any vertex lying on an edge into that edge
    const C = 2, cg = new Map();
    pts.forEach((q, id) => { const k = key(Math.floor(q.x / C), Math.floor(q.y / C), Math.floor(q.z / C)); (cg.get(k) || cg.set(k, []).get(k)).push(id); });
    const onEdge = (a, b) => {
      const A = pts[a], B = pts[b], d = B.minus(A), L2 = d.dot(d), found = [];
      if (L2 < 1e-12) return found;
      const lo = [Math.min(A.x, B.x), Math.min(A.y, B.y), Math.min(A.z, B.z)].map(x => Math.floor((x - TOL) / C));
      const hi = [Math.max(A.x, B.x), Math.max(A.y, B.y), Math.max(A.z, B.z)].map(x => Math.floor((x + TOL) / C));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const l = cg.get(key(i, j, k)); if (!l) continue;
        for (const id of l) {
          if (id === a || id === b) continue;
          const P = pts[id], t = P.minus(A).dot(d) / L2;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          const off = P.minus(A.plus(d.times(t)));
          if (off.dot(off) < TOL * TOL) found.push([t, id]);
        }
      }
      return found.sort((x, y) => x[0] - y[0]).map(x => x[1]);
    };
    const splitCache = new Map();
    for (const p of polys) {
      const out = [];
      for (let i = 0; i < p.ids.length; i++) {
        const a = p.ids[i], b = p.ids[(i + 1) % p.ids.length];
        out.push(a);
        const ck = a < b ? a + '_' + b : b + '_' + a;
        let mid = splitCache.get(ck);
        if (!mid) { mid = onEdge(Math.min(a, b), Math.max(a, b)); splitCache.set(ck, mid); }
        if (mid.length) out.push(...(a < b ? mid : mid.slice().reverse()));
      }
      p.ids = out;
    }
    // group coplanar polygons that share an edge
    const parent = polys.map((_, i) => i);
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const edgeOwner = new Map();
    polys.forEach((p, pi) => p.ids.forEach((a, i) => edgeOwner.set(a + '>' + p.ids[(i + 1) % p.ids.length], pi)));
    polys.forEach((p, pi) => p.ids.forEach((a, i) => {
      const qi = edgeOwner.get(p.ids[(i + 1) % p.ids.length] + '>' + a);
      if (qi == null || qi === pi) return;
      const q = polys[qi];
      if (p.n.dot(q.n) > 1 - 1e-7 && Math.abs(p.w - q.w) < TOL) parent[find(pi)] = find(qi);
    }));
    const groups = new Map();
    polys.forEach((p, pi) => { const r = find(pi); (groups.get(r) || groups.set(r, []).get(r)).push(p); });
    const faces = [];
    for (const g of groups.values()) {
      const n = g[0].n, w = g[0].w;
      const loopsOf = ps => {
        const edges = new Map();
        for (const p of ps) p.ids.forEach((a, i) => {
          const b = p.ids[(i + 1) % p.ids.length];
          if (edges.has(b + '>' + a)) edges.delete(b + '>' + a); else edges.set(a + '>' + b, [a, b]);
        });
        const next = new Map();
        for (const [a, b] of edges.values()) { if (next.has(a)) return null; next.set(a, b); }
        const loops = [], seen = new Set();
        for (const s of next.keys()) {
          if (seen.has(s)) continue;
          const lp = []; let v = s;
          while (!seen.has(v)) { seen.add(v); lp.push(v); v = next.get(v); if (v == null) return null; }
          if (v !== s) return null;
          loops.push(lp);
        }
        return loops;
      };
      const area = lp => { let s = new V3(0, 0, 0); for (let i = 0; i < lp.length; i++) s = s.plus(pts[lp[i]].cross(pts[lp[(i + 1) % lp.length]])); return s.dot(n) / 2; };
      let loops = g.length > 1 ? loopsOf(g) : null;
      if (loops && loops.filter(l => area(l) > 0).length !== 1) loops = null;
      if (loops) faces.push({ n, w, loops: loops.sort((a, b) => area(b) - area(a)) });
      else for (const p of g) faces.push({ n, w, loops: [p.ids] });
    }
    // drop vertices that sit mid-way along a straight edge everywhere they appear
    const uses = new Map();
    faces.forEach(f => f.loops.forEach(lp => lp.forEach((v, i) => {
      const a = pts[lp[(i + lp.length - 1) % lp.length]], b = pts[lp[(i + 1) % lp.length]], P = pts[v];
      const d1 = P.minus(a), d2 = b.minus(P), cr = d1.cross(d2);
      const straight = cr.len() < 1e-6 * d1.len() * d2.len() + 1e-12 && d1.dot(d2) > 0;
      const u = uses.get(v) || { n: 0, straight: true }; u.n++; u.straight = u.straight && straight; uses.set(v, u);
    })));
    for (const f of faces) f.loops = f.loops.map(lp => lp.filter(v => { const u = uses.get(v); return !(u.n === 2 && u.straight); })).filter(lp => lp.length >= 3);
    // split into connected solids
    const fp = faces.map((_, i) => i), ff = i => { while (fp[i] !== i) i = fp[i] = fp[fp[i]]; return i; };
    const eface = new Map();
    faces.forEach((f, fi) => f.loops.forEach(lp => lp.forEach((a, i) => {
      const b = lp[(i + 1) % lp.length], k = a < b ? a + '_' + b : b + '_' + a;
      if (eface.has(k)) fp[ff(fi)] = ff(eface.get(k)); else eface.set(k, fi);
    })));
    const solids = new Map();
    faces.forEach((f, fi) => { const r = ff(fi); (solids.get(r) || solids.set(r, []).get(r)).push(f); });
    // closed check: every directed edge must have its reverse
    const de = new Set(); let open = 0;
    faces.forEach(f => f.loops.forEach(lp => lp.forEach((a, i) => de.add(a + '>' + lp[(i + 1) % lp.length]))));
    for (const e of de) { const [a, b] = e.split('>'); if (!de.has(b + '>' + a)) open++; }
    return { pts, solids: [...solids.values()], faceCount: faces.length, openEdges: open };
  }

  function toSTEP(parts, fileName) {
    // parts: [{name, csg}] -> one STEP file, one solid body per connected piece
    const L = [], ent = s => { L.push(s); return '#' + L.length; };
    const f = x => { const s = (Math.abs(x) < 1e-9 ? 0 : x).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.'); return s.includes('.') ? s : s + '.'; };
    const q = s => "'" + String(s).replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_') + "'";
    const appCtx = ent("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    ent(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
    const len = ent("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
    const ang = ent("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
    const sol = ent("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
    const unc = ent(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-03),${len},'distance_accuracy_value','confusion accuracy')`);
    const ctx = ent(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${len},${ang},${sol}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);
    const prodCtx = ent(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
    const pdCtx = ent(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
    const origin = ent("CARTESIAN_POINT('',(0.,0.,0.))"), dz = ent("DIRECTION('',(0.,0.,1.))"), dx = ent("DIRECTION('',(1.,0.,0.))");
    const ax0 = ent(`AXIS2_PLACEMENT_3D('',${origin},${dz},${dx})`);
    let stats = { faces: 0, solids: 0, open: 0 };
    for (const part of parts) {
      const br = toBrep(part.csg);
      stats.open += br.openEdges;
      const vp = new Map(), ec = new Map();
      const vertex = id => { if (!vp.has(id)) { const P = br.pts[id]; vp.set(id, ent(`VERTEX_POINT('',${ent(`CARTESIAN_POINT('',(${f(P.x)},${f(P.y)},${f(P.z)}))`)})`)); } return vp.get(id); };
      const edge = (a, b) => {
        const k = a < b ? a + '_' + b : b + '_' + a;
        if (!ec.has(k)) {
          const lo = Math.min(a, b), hi = Math.max(a, b), A = br.pts[lo], B = br.pts[hi], d = B.minus(A), l = d.len(), u = d.times(1 / l);
          const line = ent(`LINE('',${ent(`CARTESIAN_POINT('',(${f(A.x)},${f(A.y)},${f(A.z)}))`)},${ent(`VECTOR('',${ent(`DIRECTION('',(${f(u.x)},${f(u.y)},${f(u.z)}))`)},${f(l)})`)})`);
          ec.set(k, { id: ent(`EDGE_CURVE('',${vertex(lo)},${vertex(hi)},${line},.T.)`), lo });
        }
        const e = ec.get(k);
        return ent(`ORIENTED_EDGE('',*,*,${e.id},${e.lo === a ? '.T.' : '.F.'})`);
      };
      const bodies = [];
      br.solids.forEach((faces, si) => {
        const fids = [];
        for (const fc of faces) {
          const P = br.pts[fc.loops[0][0]], n = fc.n;
          const r = Math.abs(n.x) < 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
          const ref = r.minus(n.times(r.dot(n))).unit();
          const plane = ent(`PLANE('',${ent(`AXIS2_PLACEMENT_3D('',${ent(`CARTESIAN_POINT('',(${f(P.x)},${f(P.y)},${f(P.z)}))`)},${ent(`DIRECTION('',(${f(n.x)},${f(n.y)},${f(n.z)}))`)},${ent(`DIRECTION('',(${f(ref.x)},${f(ref.y)},${f(ref.z)}))`)})`)})`);
          const bounds = fc.loops.map((lp, li) => {
            const loop = ent(`EDGE_LOOP('',(${lp.map((a, i) => edge(a, lp[(i + 1) % lp.length])).join(',')}))`);
            return ent(`${li === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${loop},.T.)`);
          });
          fids.push(ent(`ADVANCED_FACE('',(${bounds.join(',')}),${plane},.T.)`));
        }
        stats.faces += fids.length; stats.solids++;
        bodies.push(ent(`MANIFOLD_SOLID_BREP(${q(part.name + (br.solids.length > 1 ? '_' + (si + 1) : ''))},${ent(`CLOSED_SHELL('',(${fids.join(',')}))`)})`));
      });
      const rep = ent(`ADVANCED_BREP_SHAPE_REPRESENTATION(${q(part.name)},(${[ax0].concat(bodies).join(',')}),${ctx})`);
      const prod = ent(`PRODUCT(${q(part.name)},${q(part.name)},'',(${prodCtx}))`);
      ent(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
      const pdf = ent(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
      const pd = ent(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
      const pds = ent(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
      ent(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    }
    const now = new Date().toISOString().slice(0, 19);
    const txt = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'Magnusson box generator\'),\'2;1\');\n' +
      `FILE_NAME(${q(fileName || 'box.step')},'${now}',(''),(''),'Magnusson box generator','Magnusson box generator','');\n` +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n" +
      L.map((s, i) => `#${i + 1}=${s};`).join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
    return { data: new TextEncoder().encode(txt), stats };
  }

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // store-only zip
  function makeZip(files) {
    const enc = s => new TextEncoder().encode(s);
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc(f.name), data = f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const total = all.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const a of all) { out.set(a, o); o += a.length; }
    return out;
  }

  // ---------------------------------------------------------------- case layout (Magnusson 850JC)
  // Standard cell 66.5 x 64.5. Special cuts are placed where the A-E box set puts them.
  const C_STD = () => Object.assign({}, STD_CORNER);
  const C_SMALL = () => ({ type: 'chamfer', x: 3, y: 3, r: 1.5 });
  // per column, cells listed front (row 3) to back (row 1)
  const CASE = {
    C1: [{ len: 64.5 }, { len: 64.5 }, { len: 64.5, back: { BL: { type: 'chamfer', x: 15.5, y: 15.5, r: 3 } }, tag: 'B' }],
    C2: [{ len: 64.5, front: { FR: { type: 'notch', x: 40.75, y: 11.5, r: 0 }, FL: C_SMALL() }, tag: 'E' }, { len: 64.5 }, { len: 64.5 }],
    C3: [{ len: 51.5, front: { FL: C_SMALL(), FR: C_SMALL() }, tag: 'C' }, { len: 64.5 }, { len: 64.5 }],
    C4: [{ len: 64.5, front: { FL: { type: 'notch', x: 40.75, y: 11.5, r: 0 }, FR: C_SMALL() }, tag: 'E' }, { len: 64.5 }, { len: 64.5 }],
    C5: [{ len: 64.5 }, { len: 64.5 }, { len: 64.5, back: { BR: { type: 'chamfer', x: 15.5, y: 15.5, r: 3 } }, tag: 'B' }],
  };
  const FRONT_CORNER = {
    DL: { width: 86.8, cells: [63.8], corners: { FL: { type: 'chamfer', x: 17.8, y: 17.8, r: 3 }, FR: C_STD(), BL: C_STD(), BR: C_STD() } },
    DR: { width: 86.8, cells: [63.8], corners: { FL: C_STD(), FR: { type: 'chamfer', x: 17.8, y: 17.8, r: 3 }, BL: C_STD(), BR: C_STD() } },
  };
  // column key + front row (3 = front, 1 = back) + number of cells running back from it
  function positionParams(col, frontRow, n) {
    if (FRONT_CORNER[col]) {
      const f = FRONT_CORNER[col];
      return { width: f.width, cells: f.cells.slice(), corners: JSON.parse(JSON.stringify(f.corners)), rail_notches: false, slots: 'none' };
    }
    const list = CASE[col];
    const start = 3 - frontRow;               // index into front-to-back list
    n = Math.max(1, Math.min(n, list.length - start));
    const span = list.slice(start, start + n);
    const corners = { FL: C_STD(), FR: C_STD(), BL: C_STD(), BR: C_STD() };
    Object.assign(corners, JSON.parse(JSON.stringify(span[0].front || {})));
    Object.assign(corners, JSON.parse(JSON.stringify(span[span.length - 1].back || {})));
    return { width: 66.5, cells: span.map(c => c.len), corners, rail_notches: true, slots: 'every' };
  }

  const API = { buildSplit, dividerFractions, CASE, FRONT_CORNER, positionParams, envelope, CSG, V3, build, defaultParams, STD_CORNER, toBinarySTL, toSTEP, toBrep, makeZip, prism, box, planVertices, planPoints, textQuads, SLOT, slotDims };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MBG = API;
})(typeof self !== 'undefined' ? self : this);
