# Magnusson organiser box generator - geometry engine
# Builds boxes from scratch with the Fusion API. All user-facing sizes are mm.
#
# Coordinate convention for a generated box:
#   X = across the channel (box width), centred on 0
#   Y = along the channel (box length), front end at y = 0, back end at y = L
#   Z = up, bottom at z = 0
# "Front" is the handle side of the case.

import adsk.core
import adsk.fusion
import math

MM = 0.1  # Fusion internal unit is cm

# ----------------------------------------------------------------------------
# Defaults (measured from the user's v7 / v9 / FrontCorners designs)
# ----------------------------------------------------------------------------
STD_CORNER = {'type': 'chamfer', 'x': 6.74, 'y': 6.74, 'r': 9.0}


def default_params():
    return {
        'name': 'Magnusson Box',
        'width': 66.5,
        'cells': [64.5],
        'height': 55.0,
        'wall': 1.5,
        'taper_inset': 3.5,      # how far the walls step in at the bottom
        'taper_height': 40.0,    # taper runs from z=0 to this height
        'corners': {k: dict(STD_CORNER) for k in ('FL', 'FR', 'BR', 'BL')},
        # rail indents at each cell join (both long sides)
        'rail_notches': True,
        'notch_depth': 3.5,
        'notch_width': 6.4,
        'notch_flare': 1.2,
        # hanging slots
        'slots': 'every',        # 'none' | 'every' | 'first'
        'slot_sides': 'both',    # 'both' | 'left' | 'right'
        # dividers
        'dividers': 0,           # walls across the box (split along length)
        'divider_ratios': '',    # optional relative compartment sizes along the box, e.g. "1, 1, 2"
        'divider_col_ratios': '',
        'divider_cols': 0,       # walls along the box (split across width)
        'divider_thickness': 1.2,
        'divider_height': 0.0,   # 0 = automatic
        # name tag
        'label': 'none',         # 'none' | 'front' | 'back' | 'both'
        'label_text': '',
        'label_depth': 12.0,
        'label_text_height': 6.0,
        'label_style': 'deboss', # 'deboss' | 'emboss'
        'label_text_depth': 0.6,
        'label_font': 'Arial',
        # half height tray insert
        'tray': False,
        'tray_depth': 27.5,
        'tray_clearance': 0.4,
        'tray_wall': 1.2,
        'tray_cover': 'full',    # 'full' | 'front' | 'back'
        'tray_window': 'grid',   # 'none' | 'window' | 'grid' | 'slots'
        'tray_dividers': 0,
        'tray_finger': True,
        # wall mount
        'wall_mount': False,
        'mount_clearance': 0.25,
        # box clearance inside the cell (0 = box is exactly the cell size)
        'side_clearance': 0.0,
        'end_clearance': 0.0,
        # split the compartments along into physically separate boxes
        'separate': False,
        'split_gap': 1.0,
        'piece_labels': [],     # name tag per separate piece, front first
    }


# Hanging slot geometry (taken from v7 Sketch3 / sections), z measured from box bottom
SLOT = {
    'housing_depth': 6.5,     # from outer face inward
    'housing_half': 9.0,
    'housing_top': 48.6,
    'pocket_inner': 5.0,      # pocket runs from outer-5 to outer-1.5
    'open_half': 7.5,
    'open_top': 32.91,
    'pocket_top_half': 5.0,
    'pocket_top': 47.09,
    'mouth_bot_half': 5.98,
    'mouth_top_half': 3.74,
    'mouth_top': 45.59,
    'min_height': 50.0,
    'window': 15.0,           # entry window height below the narrowing part: the hook goes in sideways, then the box drops
}


def slot_dims(wall):
    """Pocket and housing depths from the outer face, kept the same distance behind the inner face for any wall."""
    return {'pocket_inner': wall + 3.5, 'housing_depth': wall + 5.0,
            'cut_bottom': max(wall + 1.0, SLOT['open_top'] - SLOT['window'])}


# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
def V(mm):
    return adsk.core.ValueInput.createByReal(mm * MM)


def P(x, y, z=0.0):
    return adsk.core.Point3D.create(x * MM, y * MM, z * MM)


def _norm(v):
    l = math.hypot(v[0], v[1])
    return (v[0] / l, v[1] / l)


class Builder:
    def __init__(self, comp, params):
        self.c = comp
        self.p = params
        self.feats = comp.features
        self.warnings = []

    # -------------------------------------------------- plan outline
    def plan_vertices(self, W, L, corners, inset):
        """Sharp polygon (CCW) of the box plan, offset inward by `inset`,
        with fillet radius per vertex (already reduced by inset)."""
        w2 = W / 2.0
        pts = {'FL': (-w2, 0.0), 'FR': (w2, 0.0), 'BR': (w2, L), 'BL': (-w2, L)}
        # incoming / outgoing unit directions and which leg (x or y) applies
        order = ['FL', 'FR', 'BR', 'BL']
        dirs = {
            'FL': ((0, -1), 'y', (1, 0), 'x'),
            'FR': ((1, 0), 'x', (0, 1), 'y'),
            'BR': ((0, 1), 'y', (-1, 0), 'x'),
            'BL': ((-1, 0), 'x', (0, -1), 'y'),
        }
        verts = []
        for k in order:
            cn = corners.get(k, STD_CORNER)
            px, py = pts[k]
            din, legin, dout, legout = dirs[k]
            if cn['type'] == 'notch' and cn.get('x', 0) > 0.01 and cn.get('y', 0) > 0.01:
                # stepped notch: runs x along the width edge, y deep, with a 45 degree lead-in
                ix = -1.0 if px > 0 else 1.0
                iy = 1.0 if py == 0 else -1.0
                d = min(cn['y'], cn['x'])
                ex = (px + ix * cn['x'], py)
                m = (px + ix * (cn['x'] - d), py + iy * cn['y'])
                ey = (px, py + iy * cn['y'])
                seq = [ex, m, ey] if legin == 'x' else [ey, m, ex]
                for q in seq:
                    verts.append([q, 0.0])
            elif cn['type'] == 'chamfer' and cn.get('x', 0) > 0.01 and cn.get('y', 0) > 0.01:
                a = cn[legin]
                b = cn[legout]
                verts.append([(px - din[0] * a, py - din[1] * a), cn.get('r', 0.0)])
                verts.append([(px + dout[0] * b, py + dout[1] * b), cn.get('r', 0.0)])
            else:
                verts.append([(px, py), cn.get('r', 0.0)])
        # offset inward
        if inset != 0:
            n = len(verts)
            lines = []
            for i in range(n):
                a = verts[i][0]
                b = verts[(i + 1) % n][0]
                u = _norm((b[0] - a[0], b[1] - a[1]))
                nn = (-u[1], u[0])
                lines.append(((a[0] + nn[0] * inset, a[1] + nn[1] * inset), u))
            newv = []
            for i in range(n):
                (p1, u1) = lines[i - 1]
                (p2, u2) = lines[i]
                den = u1[0] * u2[1] - u1[1] * u2[0]
                if abs(den) < 1e-9:
                    q = p2
                else:
                    t = ((p2[0] - p1[0]) * u2[1] - (p2[1] - p1[1]) * u2[0]) / den
                    q = (p1[0] + u1[0] * t, p1[1] + u1[1] * t)
                newv.append([q, max(verts[i][1] - inset, 0.0)])
            verts = newv
        return verts

    def draw_plan(self, sketch, verts, z=0.0):
        """Draw filleted polygon in an XY-parallel sketch. Returns nothing."""
        n = len(verts)
        lines = sketch.sketchCurves.sketchLines
        arcs = sketch.sketchCurves.sketchArcs
        ends = []  # (entry SketchPoint, exit SketchPoint)
        geo = []
        for i in range(n):
            v, r = verts[i]
            pv = verts[i - 1][0]
            nv = verts[(i + 1) % n][0]
            d1 = _norm((v[0] - pv[0], v[1] - pv[1]))
            d2 = _norm((nv[0] - v[0], nv[1] - v[1]))
            cross = d1[0] * d2[1] - d1[1] * d2[0]
            dot = max(-1.0, min(1.0, d1[0] * d2[0] + d1[1] * d2[1]))
            phi = math.acos(dot)
            if r > 0.05 and phi > 1e-3 and cross > 0:
                t = r * math.tan(phi / 2.0)
                lp = math.hypot(v[0] - pv[0], v[1] - pv[1])
                ln = math.hypot(nv[0] - v[0], nv[1] - v[1])
                tmax = 0.49 * min(lp, ln)
                if t > tmax:
                    r = r * tmax / t
                    t = tmax
                t1 = (v[0] - d1[0] * t, v[1] - d1[1] * t)
                t2 = (v[0] + d2[0] * t, v[1] + d2[1] * t)
                nl = (-d1[1], d1[0])
                cen = (t1[0] + nl[0] * r, t1[1] + nl[1] * r)
                m = _norm((v[0] - cen[0], v[1] - cen[1]))
                mid = (cen[0] + m[0] * r, cen[1] + m[1] * r)
                geo.append(('arc', t1, mid, t2))
            else:
                geo.append(('pt', v))
        for g in geo:
            if g[0] == 'arc':
                a = arcs.addByThreePoints(P(g[1][0], g[1][1], z), P(g[2][0], g[2][1], z), P(g[3][0], g[3][1], z))
                s, e = a.startSketchPoint, a.endSketchPoint
                ds = (s.geometry.x / MM - g[1][0]) ** 2 + (s.geometry.y / MM - g[1][1]) ** 2
                de = (e.geometry.x / MM - g[1][0]) ** 2 + (e.geometry.y / MM - g[1][1]) ** 2
                ends.append((s, e) if ds < de else (e, s))
            else:
                sp = sketch.sketchPoints.add(P(g[1][0], g[1][1], z))
                ends.append((sp, sp))
        for i in range(n):
            a = ends[i][1]
            b = ends[(i + 1) % n][0]
            if a.geometry.distanceTo(b.geometry) > 1e-5:
                lines.addByTwoPoints(a, b)

    def plan_prism(self, W, L, corners, inset, z0, z1, taper=0.0):
        """Extrude the plan outline from z0 to z1 (new body)."""
        sk = self.c.sketches.add(self.c.xYConstructionPlane)
        sk.isComputeDeferred = True
        self.draw_plan(sk, self.plan_vertices(W, L, corners, inset))
        sk.isComputeDeferred = False
        sk.isVisible = False
        prof = self._biggest_profile(sk)
        ei = self.feats.extrudeFeatures.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        if abs(z0) > 1e-6:
            ei.startExtent = adsk.fusion.OffsetStartDefinition.create(V(z0))
        ext = adsk.fusion.DistanceExtentDefinition.create(V(z1 - z0))
        if abs(taper) > 1e-6:
            ei.setOneSideExtent(ext, adsk.fusion.ExtentDirections.PositiveExtentDirection,
                                adsk.core.ValueInput.createByReal(math.radians(taper)))
        else:
            ei.setOneSideExtent(ext, adsk.fusion.ExtentDirections.PositiveExtentDirection)
        return self.feats.extrudeFeatures.add(ei).bodies.item(0)

    @staticmethod
    def _biggest_profile(sk):
        best, area = None, -1
        for pr in sk.profiles:
            a = pr.areaProperties(adsk.fusion.CalculationAccuracy.LowCalculationAccuracy).area
            if a > area:
                best, area = pr, a
        if best is None:
            raise RuntimeError('No closed profile in sketch ' + sk.name)
        return best

    def envelope(self, W, L, corners, inset, z0, ztop):
        """Outer solid: tapered bottom section then straight section."""
        p = self.p
        ti, zt = p['taper_inset'], p['taper_height']
        if ti > 0.01 and zt > 0.5:
            ang = math.degrees(math.atan2(ti, zt))
            body = self.plan_prism(W, L, corners, inset + ti, z0, z0 + zt, taper=ang)
            top = self.top_face(body)
            ei = self.feats.extrudeFeatures.createInput(top, adsk.fusion.FeatureOperations.JoinFeatureOperation)
            ei.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(V(ztop - z0 - zt)),
                                adsk.fusion.ExtentDirections.PositiveExtentDirection)
            ei.participantBodies = [body]
            self.feats.extrudeFeatures.add(ei)
            return body
        return self.plan_prism(W, L, corners, inset, z0, ztop)

    @staticmethod
    def top_face(body, bottom=False):
        best, bz = None, None
        for f in body.faces:
            if f.geometry.surfaceType != adsk.core.SurfaceTypes.PlaneSurfaceType:
                continue
            ok, nrm = f.evaluator.getNormalAtPoint(f.pointOnFace)
            if abs(abs(nrm.z) - 1) > 1e-6:
                continue
            if (nrm.z < 0) != bottom:
                continue
            z = f.pointOnFace.z
            if bz is None or (z > bz if not bottom else z < bz) or \
               (abs(z - bz) < 1e-6 and f.area > best.area):
                best, bz = f, z
        return best

    # -------------------------------------------------- generic prism
    def prism(self, axis, a0, a1, pts):
        """Extrude polygon `pts` (2D, in the plane normal to `axis`) from
        axis coord a0 to a1. axis 'z': pts=(x,y); 'x': pts=(y,z); 'y': pts=(x,z)."""
        plane = {'z': self.c.xYConstructionPlane, 'x': self.c.yZConstructionPlane,
                 'y': self.c.xZConstructionPlane}[axis]
        sk = self.c.sketches.add(plane)
        sk.isComputeDeferred = True

        def m(u, v):
            if axis == 'z':
                return P(u, v, 0)
            if axis == 'x':
                return P(0, u, v)
            return P(u, 0, v)
        sps = [sk.sketchPoints.add(sk.modelToSketchSpace(m(u, v))) for (u, v) in pts]
        for i in range(len(sps)):
            sk.sketchCurves.sketchLines.addByTwoPoints(sps[i], sps[(i + 1) % len(sps)])
        sk.isComputeDeferred = False
        sk.isVisible = False
        n = sk.xDirection.crossProduct(sk.yDirection)
        ax = {'x': n.x, 'y': n.y, 'z': n.z}[axis]
        s = 1.0 if ax > 0 else -1.0
        prof = self._biggest_profile(sk)
        ei = self.feats.extrudeFeatures.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        if abs(a0) > 1e-9:
            ei.startExtent = adsk.fusion.OffsetStartDefinition.create(V(a0 * s))
        d = (a1 - a0) * s
        direc = adsk.fusion.ExtentDirections.PositiveExtentDirection if d > 0 else \
            adsk.fusion.ExtentDirections.NegativeExtentDirection
        ei.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(V(abs(d))), direc)
        return self.feats.extrudeFeatures.add(ei).bodies.item(0)

    def box(self, x0, x1, y0, y1, z0, z1):
        return self.prism('z', z0, z1, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def circle_pts(self, cu, cv, r, n=24):
        return [(cu + r * math.cos(2 * math.pi * i / n), cv + r * math.sin(2 * math.pi * i / n)) for i in range(n)]

    # -------------------------------------------------- booleans
    def combine(self, target, tools, op, keep=False):
        if not tools:
            return target
        col = adsk.core.ObjectCollection.create()
        for t in tools:
            col.add(t)
        ci = self.feats.combineFeatures.createInput(target, col)
        ci.operation = {'join': adsk.fusion.FeatureOperations.JoinFeatureOperation,
                        'cut': adsk.fusion.FeatureOperations.CutFeatureOperation,
                        'intersect': adsk.fusion.FeatureOperations.IntersectFeatureOperation}[op]
        ci.isKeepToolBodies = keep
        self.feats.combineFeatures.add(ci)
        return target

    def clip_join(self, piece, clip, target):
        """piece AND clip (clip kept), then join into target."""
        self.combine(piece, [clip], 'intersect', keep=True)
        if piece.isValid and piece.volume > 1e-9:
            self.combine(target, [piece], 'join')

    def clip_join_many(self, pieces, clip, target):
        """Clip each piece to `clip` (kept) and join them all into target."""
        keep = []
        for pc in pieces:
            if pc is None:
                continue
            self.combine(pc, [clip], 'intersect', keep=True)
            if pc.isValid and pc.volume > 1e-9:
                keep.append(pc)
        if keep:
            self.combine(target, keep, 'join')

    def shell(self, body, thickness):
        f = self.top_face(body)
        col = adsk.core.ObjectCollection.create()
        col.add(f)
        si = self.feats.shellFeatures.createInput(col, False)
        si.insideThickness = V(thickness)
        self.feats.shellFeatures.add(si)
        return body

    def remove(self, body):
        if body and body.isValid:
            self.feats.removeFeatures.add(body)

    # -------------------------------------------------- derived values
    def layout(self):
        p = self.p
        cells = [float(c) for c in p['cells']]
        L = sum(cells)
        joins, centres, y = [], [], 0.0
        for i, c in enumerate(cells):
            centres.append(y + c / 2.0)
            y += c
            if i < len(cells) - 1:
                joins.append(y)
        return L, joins, centres

    def notch_tools(self, L, joins, grow=0.0, inner=0.0):
        """Rail indent cutters at each cell join, both sides.
        grow: extra half-width, inner: extra depth inward."""
        p = self.p
        w2 = p['width'] / 2.0
        nd, nw, fl = p['notch_depth'], p['notch_width'] / 2.0, p['notch_flare']
        tools = []
        for yj in joins:
            for s in (1, -1):
                xi = s * (w2 - nd - inner)
                xo = s * (w2 + 2)
                pts = [(xi, yj - nw - grow), (s * w2, yj - nw - fl - grow), (xo, yj - nw - fl - grow),
                       (xo, yj + nw + fl + grow), (s * w2, yj + nw + fl + grow), (xi, yj + nw + grow)]
                tools.append(self.prism('z', -10, p['height'] + 10, pts))
        return tools

    def slot_positions(self, centres):
        p = self.p
        if p['slots'] == 'none' or p['height'] < SLOT['min_height']:
            if p['slots'] != 'none':
                self.warnings.append('Box is under %.0f mm tall, so hanging slots were left off.' % SLOT['min_height'])
            return []
        cs = centres if p['slots'] == 'every' else centres[:1]
        sides = {'both': (1, -1), 'right': (1,), 'left': (-1,)}[p['slot_sides']]
        return [(c, s) for c in cs for s in sides]


# ----------------------------------------------------------------------------
# main build
# ----------------------------------------------------------------------------
def divider_fractions(ratios, count):
    """Divider positions as fractions of the inner length, from relative sizes
    ("1, 1, 2") or an even count."""
    if isinstance(ratios, (list, tuple)):
        r = [float(v) for v in ratios]
    else:
        r = []
        for part in str(ratios or '').replace(';', ',').split(','):
            try:
                r.append(float(part.strip()))
            except ValueError:
                pass
    r = [v for v in r if v > 0]
    if len(r) < 2:
        n = max(0, int(round(count or 0)))
        return [(i + 1) / float(n + 1) for i in range(n)]
    tot = sum(r)
    out, acc = [], 0.0
    for v in r[:-1]:
        acc += v
        out.append(acc / tot)
    return out


def build(design, params, occ_offset=None, parent=None):
    """Create a new component containing the box (and optional tray / mount).
    Returns (occurrence, warnings)."""
    p = default_params()
    p.update(params or {})
    p['cells'] = [float(c) for c in p['cells'] if float(c) > 0]
    if p['side_clearance'] > 0:
        p['width'] = p['width'] - 2 * p['side_clearance']
    if p['end_clearance'] > 0 and p['cells']:
        p['cells'] = list(p['cells'])
        p['cells'][0] -= p['end_clearance']
        p['cells'][-1] -= p['end_clearance']
    root = parent or design.rootComponent
    mtx = adsk.core.Matrix3D.create()
    if occ_offset is not None:
        # set at creation time - moving an occurrence afterwards needs a snapshot in parametric designs
        mtx.translation = adsk.core.Vector3D.create(occ_offset[0] * MM, occ_offset[1] * MM, 0)
    occ = root.occurrences.addNewComponent(mtx)
    comp = occ.component
    comp.name = p['name'] or 'Magnusson Box'
    b = Builder(comp, p)

    W, H = p['width'], p['height']
    wall = p['wall'] = min(4.0, max(0.8, p['wall']))
    w2 = W / 2.0
    L, joins, centres = b.layout()
    if p.get('_joins') is not None:      # set when this box is one piece of a split span
        joins = list(p['_joins'])
    if p.get('_centres') is not None:
        centres = list(p['_centres'])
    corners = p['corners']
    use_notch = p['rail_notches'] and len(joins) > 0

    # ---- outer envelope + a kept copy used for clipping internal features
    env = b.envelope(W, L, corners, 0.0, 0.0, H)
    clip = b.envelope(W, L, corners, 0.0, 0.0, H)
    if use_notch:
        nt = b.notch_tools(L, joins)
        b.combine(env, nt, 'cut', keep=True)
        b.combine(clip, nt, 'cut')

    # ---- hollow it out
    boxb = b.shell(env, wall)
    boxb.name = 'Box'

    # ---- hanging slots
    slots = b.slot_positions(centres)
    hs = []
    for (c, s) in slots:
        hx0 = s * (w2 - slot_dims(wall)['housing_depth'])
        hx1 = s * (w2 + 2)
        hs.append(b.box(min(hx0, hx1), max(hx0, hx1), c - SLOT['housing_half'], c + SLOT['housing_half'], 0, SLOT['housing_top']))
    b.clip_join_many(hs, clip, boxb)
    cutters = []
    for (c, s) in slots:
        oh, ot = SLOT['open_half'], SLOT['open_top']
        zc = slot_dims(wall)['cut_bottom']     # the cut stops above the base instead of running out underneath
        pocket = [(c - oh, zc), (c + oh, zc), (c + oh, ot), (c + SLOT['pocket_top_half'], SLOT['pocket_top']),
                  (c - SLOT['pocket_top_half'], SLOT['pocket_top']), (c - oh, ot)]
        mouth = [(c - oh, zc), (c + oh, zc), (c + oh, ot), (c + SLOT['mouth_bot_half'], ot),
                 (c + SLOT['mouth_top_half'], SLOT['mouth_top']), (c - SLOT['mouth_top_half'], SLOT['mouth_top']),
                 (c - SLOT['mouth_bot_half'], ot), (c - oh, ot)]
        xa, xb_, xc = w2 - slot_dims(wall)['pocket_inner'], w2 - wall, w2 + 2
        if s > 0:
            cutters.append(b.prism('x', xa, xb_ + 0.01, pocket))
            cutters.append(b.prism('x', xb_, xc, mouth))
        else:
            cutters.append(b.prism('x', -xb_ - 0.01, -xa, pocket))
            cutters.append(b.prism('x', -xc, -xb_, mouth))
    b.combine(boxb, cutters, 'cut')

    # ---- tray geometry numbers (needed to limit divider height)
    tray_on = bool(p['tray'])
    ti, zt = p['taper_inset'], p['taper_height']
    cl = p['tray_clearance']
    drop = cl * zt / ti if ti > 0.01 else 0.0
    tray_zb = H - p['tray_depth']
    if tray_on:
        max_zb = zt - drop - 3.0
        if tray_zb > max_zb:
            b.warnings.append('Tray depth increased to %.1f mm so it can sit on the tapered walls.' % (H - max_zb))
            tray_zb = max_zb
        if tray_zb < wall + 5:
            tray_zb = wall + 5

    # ---- dividers
    t = p['divider_thickness']
    dh = p['divider_height'] if p['divider_height'] > 0.1 else H - 2.0
    if tray_on:
        dh = min(dh, tray_zb - 1.0)
    pieces = []
    for f in divider_fractions(p.get('divider_ratios', ''), p['dividers']):
        y = wall + (L - 2 * wall) * f
        pieces.append(b.box(-w2 - 2, w2 + 2, y - t / 2, y + t / 2, 0, dh))
    for f in divider_fractions(p.get('divider_col_ratios', ''), p['divider_cols']):
        x = -w2 + wall + (W - 2 * wall) * f
        pieces.append(b.box(x - t / 2, x + t / 2, -2, L + 2, 0, dh))
    b.clip_join_many(pieces, clip, boxb)

    # ---- name tag shelf(s)
    ends = {'none': [], 'front': ['front'], 'back': ['back'], 'both': ['front', 'back']}[p['label']]
    ld = p['label_depth']
    shelves = []
    for e in ends:
        d = wall + ld
        if e == 'front':
            prof = [(-2, H), (d, H), (d, H - 1.6), (-2, H - 1.6 - d - 2)]
        else:
            prof = [(L + 2, H), (L - d, H), (L - d, H - 1.6), (L + 2, H - 1.6 - d - 2)]
        shelves.append(b.prism('x', -w2 - 2, w2 + 2, prof))
    b.clip_join_many(shelves, clip, boxb)
    if ends and p['label_text'].strip():
        _label_text(b, boxb, ends, L)

    # ---- tray
    tray = None
    if tray_on:
        tray = _build_tray(b, L, joins, centres, slots, tray_zb, drop, ends)

    # ---- wall mount
    mount = None
    if p['wall_mount'] and slots:
        mount = _build_mount(b, slots)
    elif p['wall_mount']:
        b.warnings.append('Wall mount skipped because the box has no hanging slots.')

    b.remove(clip)
    return occ, b.warnings


def _label_text(b, boxb, ends, L):
    p = b.p
    wall, H, w2 = p['wall'], p['height'], p['width'] / 2.0
    pi = b.c.constructionPlanes.createInput()
    pi.setByOffset(b.c.xYConstructionPlane, V(H))
    plane = b.c.constructionPlanes.add(pi)
    plane.isLightBulbOn = False
    for e in ends:
        sk = b.c.sketches.add(plane)
        sk.isVisible = False
        if e == 'front':
            ya, yb = wall + 0.6, wall + p['label_depth'] - 0.6
        else:
            ya, yb = L - wall - p['label_depth'] + 0.6, L - wall - 0.6
        margin = 4.0
        th = min(p['label_text_height'], (yb - ya) * 0.85)
        st = None
        while th >= 2.0:
            ti = sk.sketchTexts.createInput2(p['label_text'], th * MM)
            ti.setAsMultiLine(P(-w2 + margin, ya, 0), P(w2 - margin, yb, 0),
                              adsk.core.HorizontalAlignments.CenterHorizontalAlignment,
                              adsk.core.VerticalAlignments.MiddleVerticalAlignment, 0)
            try:
                ti.fontName = p['label_font']
            except Exception:
                pass
            ti.textStyle = adsk.fusion.TextStyles.TextStyleBold
            st = sk.sketchTexts.add(ti)
            bb = st.boundingBox
            if (bb.maxPoint.y - bb.minPoint.y) / MM <= th * 1.45 and (bb.maxPoint.x - bb.minPoint.x) / MM <= 2 * (w2 - margin) + 0.01:
                break
            st.deleteMe()
            st = None
            th -= 0.5
        if st is None:
            b.warnings.append('Label text is too long to fit; shorten it.')
            continue
        if th < p['label_text_height'] - 0.01:
            b.warnings.append('Label text shrunk to %.1f mm to fit on one line.' % th)
        emb = p['label_style'] == 'emboss'
        op = adsk.fusion.FeatureOperations.JoinFeatureOperation if emb else adsk.fusion.FeatureOperations.CutFeatureOperation
        ei = b.feats.extrudeFeatures.createInput(st, op)
        ei.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(V(p['label_text_depth'])),
                            adsk.fusion.ExtentDirections.PositiveExtentDirection if emb else
                            adsk.fusion.ExtentDirections.NegativeExtentDirection)
        ei.participantBodies = [boxb]
        b.feats.extrudeFeatures.add(ei)


def _build_tray(b, L, joins, centres, slots, zb, drop, ends):
    p = b.p
    W, H, wall = p['width'], p['height'], p['wall']
    w2 = W / 2.0
    cl, tw = p['tray_clearance'], p['tray_wall']
    ti, zt = p['taper_inset'], p['taper_height']
    corners = p['corners']
    inset = wall + cl

    # tapered outer shell of the tray, shown at its resting height (drops by `drop`)
    tray = b.envelope(W, L, corners, inset, -drop, H + 2)
    trayclip = b.envelope(W, L, corners, inset, -drop, H + 2)
    tray.name = 'Tray insert'

    # how much of the length it covers
    y0, y1 = -2.0, L + 2.0
    if p['tray_cover'] == 'front':
        y1 = L / 2.0
    elif p['tray_cover'] == 'back':
        y0 = L / 2.0
    if 'front' in ends:
        y0 = max(y0, wall + p['label_depth'] + cl)
    if 'back' in ends:
        y1 = min(y1, L - wall - p['label_depth'] - cl)
    slab = b.box(-w2 - 2, w2 + 2, y0, y1, zb, H)
    b.combine(tray, [slab], 'intersect', keep=True)
    b.combine(trayclip, [slab], 'intersect')

    # clear the box's internal features (hanging slot housings, rail indents)
    def clear_tools(g):
        cut = []
        for (c, s) in slots:
            xi = s * (w2 - slot_dims(wall)['housing_depth'] - cl - g)
            cut.append(b.box(min(xi, s * (w2 + 2)), max(xi, s * (w2 + 2)),
                             c - SLOT['housing_half'] - cl - g, c + SLOT['housing_half'] + cl + g, zb - 5, H + 5))
        if p['rail_notches'] and joins:
            cut += b.notch_tools(L, joins, grow=wall + cl + g, inner=wall + cl + g)
        return cut
    ct = clear_tools(0.0)
    b.combine(tray, ct, 'cut', keep=True)
    b.combine(trayclip, ct, 'cut')

    # hollow it out by subtraction (more robust than a shell on thin slivers)
    inner = b.envelope(W, L, corners, inset + tw, -drop, H + 5)
    iy0 = y0 + tw if y0 > 0 else -5.0
    iy1 = y1 - tw if y1 < L else L + 5.0
    b.combine(inner, [b.box(-w2 - 2, w2 + 2, iy0, iy1, zb + tw, H + 5)], 'intersect')
    b.combine(inner, clear_tools(tw), 'cut')
    b.combine(tray, [inner], 'cut')

    pat = p['tray_window']
    if pat != 'none':
        # usable floor half width / y range at floor level
        ztl = zb + drop
        frac = max(0.0, 1.0 - ztl / zt) if zt > 0 else 0.0
        xin = w2 - inset - ti * frac - tw
        xs = xin - 2.5
        if slots:
            xs = min(xs, w2 - slot_dims(wall)['housing_depth'] - cl - tw - 2.5)
        if p['rail_notches'] and joins:
            xs = min(xs, w2 - p['notch_depth'] - inset - tw - 2.5)
        ya = max(y0, inset + ti * frac) + tw + 2.5
        yb = min(y1, L - inset - ti * frac) - tw - 2.5
        # region = plan outline inset to floor edge, limited to |x|<=xs, y in [ya,yb]
        region = b.plan_prism(W, L, corners, inset + ti * frac + tw + 2.5, zb - 1, zb + tw + 0.5)
        lim = b.box(-xs, xs, ya, yb, zb - 1, zb + tw + 0.5)
        b.combine(region, [lim], 'intersect')
        # open the whole window area, then add the ribs back inside it
        fz0, fz1 = zb, zb + tw
        ribs = []
        rib = 2.4
        if pat in ('grid', 'slots'):
            pitch = 12.0 if pat == 'grid' else 8.0
            nx = max(1, int(round((2 * xs) / pitch)))
            for i in range(1, nx):
                x = -xs + 2 * xs * i / nx
                ribs.append(b.box(x - rib / 2, x + rib / 2, ya - 1, yb + 1, fz0, fz1))
            if pat == 'grid':
                ny = max(1, int(round((yb - ya) / pitch)))
                for i in range(1, ny):
                    y = ya + (yb - ya) * i / ny
                    ribs.append(b.box(-xs - 1, xs + 1, y - rib / 2, y + rib / 2, fz0, fz1))
        elif pat == 'window':
            if yb - ya > 70:
                y = (ya + yb) / 2.0
                ribs.append(b.box(-xs - 1, xs + 1, y - rib / 2, y + rib / 2, fz0, fz1))
        # tray dividers need a solid strip of floor under them
        for y in _tray_div_ys(p, y0, y1, L, inset):
            ribs.append(b.box(-xs - 1, xs + 1, y - rib / 2 - 0.6, y + rib / 2 + 0.6, fz0, fz1))
        if region.isValid and region.volume > 1e-9:
            b.combine(tray, [region], 'cut', keep=True)
            b.clip_join_many(ribs, region, tray)
        b.remove(region)

    # tray dividers
    b.clip_join_many([b.box(-w2, w2, y - 0.6, y + 0.6, zb, H - 1.5)
                      for y in _tray_div_ys(p, y0, y1, L, inset)], trayclip, tray)

    # finger notches in the end walls so it can be lifted out
    if p['tray_finger']:
        r = 8.0
        pts = [(-r, H + 5)] + [(r * math.cos(math.pi + math.pi * i / 16), H + r * math.sin(math.pi + math.pi * i / 16)) for i in range(17)] + [(r, H + 5)]
        fn = b.prism('y', -5, L + 5, pts)
        b.combine(tray, [fn], 'cut')

    b.remove(trayclip)
    return tray


def _tray_div_ys(p, y0, y1, L, inset):
    n = int(p['tray_dividers'])
    ya, yb = max(y0, inset), min(y1, L - inset)
    return [ya + (yb - ya) * i / (n + 1) for i in range(1, n + 1)]


def _build_mount(b, slots):
    p = b.p
    w2 = p['width'] / 2.0
    H = p['height']
    wall = p['wall']
    mc = p['mount_clearance']
    c, s = slots[0]
    for cc, ss in slots:
        if ss > 0:
            c, s = cc, ss
            break

    def hw(z):  # pocket half width at z
        return SLOT['open_half'] - (z - SLOT['open_top']) * (SLOT['open_half'] - SLOT['pocket_top_half']) / \
            (SLOT['pocket_top'] - SLOT['open_top']) - mc

    def hn(z):  # mouth half width at z
        return SLOT['mouth_bot_half'] - (z - SLOT['open_top']) * (SLOT['mouth_bot_half'] - SLOT['mouth_top_half']) / \
            (SLOT['mouth_top'] - SLOT['open_top']) - mc

    za, zf, zn = SLOT['open_top'] + 0.5, SLOT['pocket_top'] - 0.5, SLOT['mouth_top'] - 0.5
    flange = [(c - hw(za), za), (c + hw(za), za), (c + hw(zf), zf), (c - hw(zf), zf)]
    neck = [(c - hn(za), za), (c + hn(za), za), (c + hn(zn), zn), (c - hn(zn), zn)]
    xf0, xf1 = w2 - slot_dims(wall)['pocket_inner'] + mc, w2 - wall - mc
    plate_t = 3.0
    zp0, zp1 = 18.0, H - 1.0

    def X(a, bb):
        return (a, bb) if s > 0 else (-bb, -a)
    m = b.prism('x', *X(xf0, xf1), flange)
    m.name = 'Wall mount'
    parts = [b.prism('x', *X(xf1 - 0.01, w2 + 0.01), neck),
             b.prism('x', *X(w2, w2 + plate_t), [(c - 12, zp0), (c + 12, zp0), (c + 12, zp1), (c - 12, zp1)])]
    b.combine(m, parts, 'join')
    # screw holes with counterbores on the box side of the plate
    holes = []
    for zh in (zp0 + 5.0, zp1 - 4.0):
        holes.append(b.prism('x', *X(w2 - 1, w2 + plate_t + 1), b.circle_pts(c, zh, 2.1)))
        holes.append(b.prism('x', *X(w2 - 1, w2 + 1.6), b.circle_pts(c, zh, 4.1)))
    b.combine(m, holes, 'cut')
    return m


# ----------------------------------------------------------------------------
# case layout (Magnusson 850JC). Standard cell 66.5 x 64.5; special cuts are
# placed where the A-E box set puts them.
# ----------------------------------------------------------------------------
def _c_small():
    return {'type': 'chamfer', 'x': 3.0, 'y': 3.0, 'r': 1.5}


def _notch():
    return {'type': 'notch', 'x': 40.75, 'y': 11.5, 'r': 0.0}


def _case_corner():
    return {'type': 'chamfer', 'x': 15.5, 'y': 15.5, 'r': 3.0}


def _front_corner():
    return {'type': 'chamfer', 'x': 17.8, 'y': 17.8, 'r': 3.0}


# per column, cells front (row 3) to back (row 1)
CASE = {
    'C1': [{'len': 64.5}, {'len': 64.5}, {'len': 64.5, 'back': {'BL': _case_corner()}, 'tag': 'B'}],
    'C2': [{'len': 64.5, 'front': {'FR': _notch(), 'FL': _c_small()}, 'tag': 'E'}, {'len': 64.5}, {'len': 64.5}],
    'C3': [{'len': 51.5, 'front': {'FL': _c_small(), 'FR': _c_small()}, 'tag': 'C'}, {'len': 64.5}, {'len': 64.5}],
    'C4': [{'len': 64.5, 'front': {'FL': _notch(), 'FR': _c_small()}, 'tag': 'E'}, {'len': 64.5}, {'len': 64.5}],
    'C5': [{'len': 64.5}, {'len': 64.5}, {'len': 64.5, 'back': {'BR': _case_corner()}, 'tag': 'B'}],
}
FRONT_CORNER = {
    'DL': {'width': 86.8, 'cells': [63.8], 'corners': {'FL': _front_corner()}},
    'DR': {'width': 86.8, 'cells': [63.8], 'corners': {'FR': _front_corner()}},
}


def position_params(col, front_row, n):
    """col: C1..C5, DL, DR. front_row: 3 = front row, 1 = back row. n: cells running back."""
    corners = {k: dict(STD_CORNER) for k in ('FL', 'FR', 'BL', 'BR')}
    if col in FRONT_CORNER:
        f = FRONT_CORNER[col]
        corners.update({k: dict(v) for k, v in f['corners'].items()})
        return {'width': f['width'], 'cells': list(f['cells']), 'corners': corners,
                'rail_notches': False, 'slots': 'none'}
    lst = CASE[col]
    start = 3 - front_row
    n = max(1, min(n, len(lst) - start))
    span = lst[start:start + n]
    corners.update({k: dict(v) for k, v in span[0].get('front', {}).items()})
    corners.update({k: dict(v) for k, v in span[-1].get('back', {}).items()})
    return {'width': 66.5, 'cells': [c['len'] for c in span], 'corners': corners,
            'rail_notches': True, 'slots': 'every'}


def build_split(design, params, occ_offset=None, parent=None):
    """Build a span either as one box or, with params['separate'], as separate boxes
    (one component each) laid out along Y. Returns (occurrences, warnings)."""
    p = default_params()
    p.update(params or {})
    fr = divider_fractions(p.get('divider_ratios', ''), p['dividers'])
    off = occ_offset or (0.0, 0.0)
    if not p.get('separate') or not fr:
        occ, w = build(design, params, off, parent)
        return [occ], w
    cells = [float(c) for c in p['cells'] if float(c) > 0]
    ec = max(0.0, p['end_clearance'])
    gap = max(0.0, p['split_gap'])
    joins, centres, y = [], [], 0.0
    for i, c in enumerate(cells):
        centres.append(y + c / 2.0)
        y += c
        if i < len(cells) - 1:
            joins.append(y)
    lfull = y
    n = len(fr) + 1
    usable = lfull - 2 * ec - gap * (n - 1)
    fracs = [0.0] + fr + [1.0]
    nw = p['notch_width'] / 2.0 + p['notch_flare']
    sm = SLOT['housing_half'] + p['wall'] + 1
    occs, warns, y_at = [], [], ec
    for i in range(n):
        length = usable * (fracs[i + 1] - fracs[i])
        if length < 20:
            raise RuntimeError('A separate box would be under 20 mm long; use fewer or larger compartments.')
        y0, y1 = y_at, y_at + length
        y_at = y1 + gap
        corners = {k: dict(v) for k, v in p['corners'].items()}
        if i > 0:
            corners['FL'] = dict(STD_CORNER)
            corners['FR'] = dict(STD_CORNER)
        if i < n - 1:
            corners['BL'] = dict(STD_CORNER)
            corners['BR'] = dict(STD_CORNER)
        cs = [c - y0 for c in centres if c - y0 > sm and y1 - c > sm]
        if not cs and length > 2 * sm:
            cs = [length / 2.0]
        # each piece can have its own name tag; a blank one falls back to the shared label
        pl = p.get('piece_labels') or []
        own = str(pl[i]).strip() if i < len(pl) and pl[i] else ''
        lt = own or p.get('label_text', '')
        q = dict(params)
        q.update({'cells': [length], 'end_clearance': 0.0, 'separate': False, 'dividers': 0, 'divider_ratios': '',
                  'label_text': lt, 'label': 'front' if own and p['label'] == 'none' else p['label'],
                  'corners': corners,
                  'name': '%s piece %d%s' % (p['name'] or 'Magnusson Box', i + 1, (' ' + own) if own else ''),
                  '_joins': [j - y0 for j in joins if y0 - nw < j < y1 + nw], '_centres': cs})
        occ, w = build(design, q, (off[0], off[1] + y0 - ec), parent)
        occs.append(occ)
        warns += ['Piece %d: %s' % (i + 1, x) for x in w]
    return occs, warns
