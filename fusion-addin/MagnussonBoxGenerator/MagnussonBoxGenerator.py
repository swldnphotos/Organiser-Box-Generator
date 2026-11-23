# Magnusson Box Generator - Fusion add-in
# Adds "Magnusson Box" to Solid > Create. Builds a new component with a box
# (plus optional tray insert and wall mount) that fits the Magnusson
# compartment organiser case (Screwfix 850JC).

import adsk.core
import adsk.fusion
import os
import sys
import json
import traceback
import re
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import mbox_engine as E  # noqa: E402

CMD_ID = 'MagnussonBoxGeneratorCmd'
CMD_NAME = 'Magnusson Box'
CMD_TIP = 'Build a custom box, tray insert and wall mount for the Magnusson compartment organiser.'
PANEL_ID = 'SolidCreatePanel'
SETTINGS = os.path.join(HERE, 'last_settings.json')

_app = None
_ui = None
_handlers = []
_applying = False

STD_CELL = 64.5
SHORT_CELL = 51.5

CORNER_KEYS = [('FL', 'Front left'), ('FR', 'Front right'), ('BL', 'Back left'), ('BR', 'Back right')]

COLS = [('C1', 'C1 (left column)'), ('C2', 'C2'), ('C3', 'C3 (centre)'), ('C4', 'C4'), ('C5', 'C5 (right column)'),
        ('DL', 'Front corner, left (D)'), ('DR', 'Front corner, right (D)'), ('', 'Custom')]
ROWS = ['Row 3 (front)', 'Row 2', 'Row 1 (back)']
CORNER_TYPES = ['Standard', 'Chamfer', 'Handle notch', 'Round']
EXPORT_FORMATS = ['None', 'STEP', 'STL', 'STEP + STL']

LAYOUT_ID = 'MagnussonLayoutCmd'
LAYOUT_NAME = 'Organiser Layout'
LAYOUT_TIP = ('Build every box of a layout planned in the web app (Download > "Export layout for Fusion"), '
              'placed where it sits in the case.')


def _std():
    return {'type': 'Standard', 'x': 6.74, 'y': 6.74, 'r': 9.0}


DEFAULT_UI = {
    'col': 'C2',
    'row': 'Row 2',
    'name': 'Magnusson Box',
    'cells': 1,
    'cell_lengths': '64.5',
    'width': 66.5,
    'height': 55.0,
    'rail': True,
    'slots': 'Every cell',
    'slot_sides': 'Both sides',
    'corners': {'FL': _std(), 'FR': _std(), 'BL': _std(), 'BR': _std()},
    'comp_along': 1,
    'comp_ratios': '',
    'comp_across': 1,
    'comp_across_ratios': '',
    'separate': False,
    'split_gap': 1.0,
    'piece_labels': '',
    'divider_thickness': 1.2,
    'divider_height': 0.0,
    'label': 'None',
    'label_text': '',
    'label_text_height': 6.0,
    'label_style': 'Debossed (cut in)',
    'label_font': 'Arial',
    'tray': False,
    'tray_depth': 27.5,
    'tray_cover': 'Full length',
    'tray_window': 'Grid',
    'tray_dividers': 0,
    'tray_finger': True,
    'tray_clearance': 0.4,
    'wall_mount': False,
    'export_format': 'None',
    'export_folder': '',
    'mount_clearance': 0.25,
    'side_clearance': 0.0,
    'end_clearance': 0.0,
    'wall': 1.5,
    'taper_inset': 3.5,
    'taper_height': 40.0,
    'notch_depth': 3.5,
    'notch_width': 6.4,
    'place': 'Beside existing geometry',
}


def load_settings():
    d = json.loads(json.dumps(DEFAULT_UI))
    try:
        with open(SETTINGS) as f:
            saved = json.load(f)
        d.update({k: v for k, v in saved.items() if k in d})
    except Exception:
        pass
    return d


def save_settings(d):
    try:
        with open(SETTINGS, 'w') as f:
            json.dump(d, f, indent=1)
    except Exception:
        pass


# --------------------------------------------------------------------------------------
# dialog helpers
# --------------------------------------------------------------------------------------
def _mm(v):
    return adsk.core.ValueInput.createByString('%g mm' % v)


def _dropdown(inputs, cid, name, options, current):
    dd = inputs.addDropDownCommandInput(cid, name, adsk.core.DropDownStyles.TextListDropDownStyle)
    for o in options:
        dd.listItems.add(o, o == current, '')
    if dd.selectedItem is None and dd.listItems.count:
        dd.listItems.item(0).isSelected = True
    return dd


def _sel(inputs, cid):
    dd = adsk.core.DropDownCommandInput.cast(inputs.itemById(cid))
    return dd.selectedItem.name if dd and dd.selectedItem else ''


def _val_mm(inputs, cid):
    return adsk.core.ValueCommandInput.cast(inputs.itemById(cid)).value * 10.0


def _set_mm(inputs, cid, v):
    adsk.core.ValueCommandInput.cast(inputs.itemById(cid)).value = v / 10.0


def _int(inputs, cid):
    return adsk.core.IntegerSpinnerCommandInput.cast(inputs.itemById(cid)).value


def _bool(inputs, cid):
    return adsk.core.BoolValueCommandInput.cast(inputs.itemById(cid)).value


def _str(inputs, cid):
    return adsk.core.StringValueCommandInput.cast(inputs.itemById(cid)).value


def _set_dd(inputs, cid, name):
    dd = adsk.core.DropDownCommandInput.cast(inputs.itemById(cid))
    for i in range(dd.listItems.count):
        it = dd.listItems.item(i)
        if it.name == name:
            it.isSelected = True


def build_dialog(cmd, s):
    inputs = cmd.commandInputs

    # ---------------- Box tab
    tab = inputs.addTabCommandInput('tabBox', 'Box')
    t = tab.children
    _dropdown(t, 'col', 'Case column', [lbl for _, lbl in COLS], s['col'])
    _dropdown(t, 'row', 'Front cell', ROWS, s['row'])
    t.addIntegerSpinnerCommandInput('cells', 'Cells long (towards back)', 1, 3, 1, int(s['cells']))
    t.addTextBoxCommandInput('pos_help', '', 'Row 3 is next to the handle, row 1 is at the back. C1 and C5 row 1 get the '
                             'case corner cut, C2/C4 row 3 the handle notch, C3 row 3 is 51.5 long.', 3, True)
    t.addStringValueInput('name', 'Name', s['name'])
    t.addStringValueInput('cell_lengths', 'Cell lengths (mm)', s['cell_lengths'])
    t.addTextBoxCommandInput('cell_help', '', 'Front cell first, comma separated. Standard cell is '
                             '66.5 x 64.5; the cell in front of the handle is 51.5 long.', 2, True)
    t.addValueInput('width', 'Width', 'mm', _mm(s['width']))
    t.addValueInput('height', 'Height', 'mm', _mm(s['height']))
    t.addValueInput('wall', 'Wall thickness (0.8-4)', 'mm', _mm(s['wall']))
    t.addBoolValueInput('rail', 'Rail indents at cell joins', True, '', s['rail'])
    _dropdown(t, 'slots', 'Hanging slots', ['None', 'Every cell', 'First cell only'], s['slots'])
    _dropdown(t, 'slot_sides', 'Slot sides', ['Both sides', 'Left side', 'Right side'], s['slot_sides'])
    _dropdown(t, 'place', 'Place new box', ['Beside existing geometry', 'At origin'], s['place'])

    # ---------------- Corners tab
    tab = inputs.addTabCommandInput('tabCorners', 'Corners')
    t = tab.children
    t.addTextBoxCommandInput('corner_help', '', 'Front = handle side of the case. Standard = the 6.74 mm '
                             'chamfer with R9 blends from your v7 box. Handle notch = step cut, '
                             '"across" from the corner, "along" deep, with a 45 degree lead-in.', 3, True)
    for key, label in CORNER_KEYS:
        c = s['corners'].get(key, _std())
        g = t.addGroupCommandInput('grp' + key, label)
        g.isExpanded = True
        gc = g.children
        _dropdown(gc, 'ctype' + key, 'Type', CORNER_TYPES, c['type'])
        gc.addValueInput('cx' + key, 'Cut across', 'mm', _mm(c['x']))
        gc.addValueInput('cy' + key, 'Cut along', 'mm', _mm(c['y']))
        gc.addValueInput('cr' + key, 'Radius', 'mm', _mm(c['r']))

    # ---------------- Inside tab
    tab = inputs.addTabCommandInput('tabInside', 'Inside')
    t = tab.children
    t.addIntegerSpinnerCommandInput('comp_along', 'Compartments along', 1, 16, 1, int(s['comp_along']))
    t.addStringValueInput('comp_ratios', 'Sizes along (optional)', s['comp_ratios'])
    t.addIntegerSpinnerCommandInput('comp_across', 'Compartments across', 1, 6, 1, int(s['comp_across']))
    t.addStringValueInput('comp_across_ratios', 'Sizes across (optional)', s['comp_across_ratios'])
    t.addBoolValueInput('separate', 'Make the compartments along separate boxes', True, '', s['separate'])
    t.addValueInput('split_gap', 'Gap between separate boxes', 'mm', _mm(s['split_gap']))
    t.addStringValueInput('piece_labels', 'Name tag per box (front first, | between)', s['piece_labels'])
    t.addTextBoxCommandInput('comp_help', '', 'Compartments need not follow the case cells (a 2-cell box can be split '
                             'into 3). Sizes are relative, front to back and left to right, e.g. 1, 1, 2, and override the count.', 3, True)
    t.addValueInput('divider_thickness', 'Divider thickness', 'mm', _mm(s['divider_thickness']))
    t.addValueInput('divider_height', 'Divider height (0 = auto)', 'mm', _mm(s['divider_height']))
    g = t.addGroupCommandInput('grpLabel', 'Name tag')
    g.isExpanded = True
    gc = g.children
    _dropdown(gc, 'label', 'Name tag shelf', ['None', 'Front', 'Back', 'Both'], s['label'])
    gc.addStringValueInput('label_text', 'Text', s['label_text'])
    gc.addValueInput('label_text_height', 'Text height', 'mm', _mm(s['label_text_height']))
    _dropdown(gc, 'label_style', 'Text style', ['Debossed (cut in)', 'Embossed (raised)'], s['label_style'])
    gc.addStringValueInput('label_font', 'Font', s['label_font'])

    # ---------------- Tray tab
    tab = inputs.addTabCommandInput('tabTray', 'Tray')
    t = tab.children
    t.addBoolValueInput('tray', 'Add a half height tray insert', True, '', s['tray'])
    t.addTextBoxCommandInput('tray_help', '', 'The tray sits on the tapered lower walls. A see-through floor '
                             '(print it in clear/translucent filament for best effect) lets you see the '
                             'box below without lifting it out.', 3, True)
    t.addValueInput('tray_depth', 'Tray depth', 'mm', _mm(s['tray_depth']))
    _dropdown(t, 'tray_cover', 'Covers', ['Full length', 'Front half', 'Back half'], s['tray_cover'])
    _dropdown(t, 'tray_window', 'See-through floor', ['None', 'Window', 'Grid', 'Slots'], s['tray_window'])
    t.addIntegerSpinnerCommandInput('tray_dividers', 'Tray dividers', 0, 10, 1, int(s['tray_dividers']))
    t.addBoolValueInput('tray_finger', 'Finger notches for lifting', True, '', s['tray_finger'])
    t.addValueInput('tray_clearance', 'Clearance', 'mm', _mm(s['tray_clearance']))

    # ---------------- Extras tab
    tab = inputs.addTabCommandInput('tabExtra', 'Extras')
    t = tab.children
    t.addBoolValueInput('wall_mount', 'Wall mount piece for the hanging slot', True, '', s['wall_mount'])
    t.addValueInput('mount_clearance', 'Mount clearance', 'mm', _mm(s['mount_clearance']))
    _dropdown(t, 'export_format', 'Save files after building', EXPORT_FORMATS, s.get('export_format', 'None'))
    g = t.addGroupCommandInput('grpAdv', 'Advanced')
    g.isExpanded = False
    gc = g.children
    gc.addValueInput('side_clearance', 'Side clearance (each)', 'mm', _mm(s['side_clearance']))
    gc.addValueInput('end_clearance', 'End clearance (each)', 'mm', _mm(s['end_clearance']))
    gc.addValueInput('taper_inset', 'Taper inset at base', 'mm', _mm(s['taper_inset']))
    gc.addValueInput('taper_height', 'Taper height', 'mm', _mm(s['taper_height']))
    gc.addValueInput('notch_depth', 'Rail indent depth', 'mm', _mm(s['notch_depth']))
    gc.addValueInput('notch_width', 'Rail indent width', 'mm', _mm(s['notch_width']))

    apply_position(inputs)
    update_visibility(inputs)


def update_visibility(inputs):
    for key, _ in CORNER_KEYS:
        ty = _sel(inputs, 'ctype' + key)
        inputs.itemById('cx' + key).isVisible = ty in ('Chamfer', 'Handle notch')
        inputs.itemById('cy' + key).isVisible = ty in ('Chamfer', 'Handle notch')
        inputs.itemById('cr' + key).isVisible = ty in ('Chamfer', 'Round')
    tray = _bool(inputs, 'tray')
    for cid in ('tray_depth', 'tray_cover', 'tray_window', 'tray_dividers', 'tray_finger', 'tray_clearance'):
        inputs.itemById(cid).isEnabled = tray
    lab = _sel(inputs, 'label') != 'None'
    for cid in ('label_text', 'label_text_height', 'label_style', 'label_font'):
        inputs.itemById(cid).isEnabled = lab
    inputs.itemById('slot_sides').isEnabled = _sel(inputs, 'slots') != 'None'
    inputs.itemById('mount_clearance').isEnabled = _bool(inputs, 'wall_mount')
    inputs.itemById('split_gap').isEnabled = _bool(inputs, 'separate')
    inputs.itemById('piece_labels').isEnabled = _bool(inputs, 'separate')
    col = _col_key(inputs)
    inputs.itemById('row').isEnabled = col.startswith('C')


def _col_key(inputs):
    lbl = _sel(inputs, 'col')
    for k, l in COLS:
        if l == lbl:
            return k
    return ''


def apply_position(inputs):
    """Fill width, cell lengths and corners from the chosen case position."""
    global _applying
    col = _col_key(inputs)
    if not col:
        return
    row = 3 - ROWS.index(_sel(inputs, 'row')) if _sel(inputs, 'row') in ROWS else 3
    maxn = 1 if col.startswith('D') else row
    n = max(1, min(_int(inputs, 'cells'), maxn))
    pp = E.position_params(col, row, n)
    _applying = True
    try:
        adsk.core.IntegerSpinnerCommandInput.cast(inputs.itemById('cells')).value = n
        adsk.core.StringValueCommandInput.cast(inputs.itemById('cell_lengths')).value = ', '.join('%g' % v for v in pp['cells'])
        _set_mm(inputs, 'width', pp['width'])
        adsk.core.BoolValueCommandInput.cast(inputs.itemById('rail')).value = pp['rail_notches']
        _set_dd(inputs, 'slots', 'None' if pp['slots'] == 'none' else 'Every cell')
        for key, _ in CORNER_KEYS:
            c = pp['corners'][key]
            std = c['type'] == 'chamfer' and abs(c.get('x', 0) - 6.74) < 1e-6 and abs(c.get('r', 0) - 9) < 1e-6
            ty = 'Standard' if std else {'chamfer': 'Chamfer', 'notch': 'Handle notch', 'round': 'Round'}[c['type']]
            _set_dd(inputs, 'ctype' + key, ty)
            _set_mm(inputs, 'cx' + key, c.get('x', 6.74))
            _set_mm(inputs, 'cy' + key, c.get('y', 6.74))
            _set_mm(inputs, 'cr' + key, c.get('r', 0.0))
    finally:
        _applying = False


def read_dialog(inputs):
    s = {}
    s['col'] = _sel(inputs, 'col')
    s['row'] = _sel(inputs, 'row')
    s['name'] = _str(inputs, 'name')
    s['cells'] = _int(inputs, 'cells')
    s['cell_lengths'] = _str(inputs, 'cell_lengths')
    for k in ('width', 'height', 'divider_thickness', 'divider_height', 'label_text_height', 'tray_depth',
              'tray_clearance', 'mount_clearance', 'split_gap', 'side_clearance', 'end_clearance', 'wall', 'taper_inset', 'taper_height', 'notch_depth',
              'notch_width'):
        s[k] = round(_val_mm(inputs, k), 4)
    for k in ('rail', 'tray', 'tray_finger', 'wall_mount', 'separate'):
        s[k] = _bool(inputs, k)
    for k in ('slots', 'slot_sides', 'label', 'label_style', 'tray_cover', 'tray_window', 'place', 'export_format'):
        s[k] = _sel(inputs, k)
    for k in ('comp_along', 'comp_across', 'tray_dividers'):
        s[k] = _int(inputs, k)
    s['comp_ratios'] = _str(inputs, 'comp_ratios')
    s['comp_across_ratios'] = _str(inputs, 'comp_across_ratios')
    s['label_text'] = _str(inputs, 'label_text')
    s['piece_labels'] = _str(inputs, 'piece_labels')
    s['label_font'] = _str(inputs, 'label_font')
    s['corners'] = {}
    for key, _ in CORNER_KEYS:
        s['corners'][key] = {'type': _sel(inputs, 'ctype' + key), 'x': round(_val_mm(inputs, 'cx' + key), 4),
                             'y': round(_val_mm(inputs, 'cy' + key), 4), 'r': round(_val_mm(inputs, 'cr' + key), 4)}
    return s


def parse_cells(text, n):
    vals = []
    for part in text.replace(';', ',').split(','):
        part = part.strip()
        if part:
            vals.append(float(part))
    if not vals:
        vals = [STD_CELL]
    while len(vals) < n:
        vals.append(vals[-1])
    return vals[:n]


def to_engine_params(s):
    corners = {}
    for key, c in s['corners'].items():
        if c['type'] == 'Standard':
            corners[key] = dict(E.STD_CORNER)
        elif c['type'] == 'Chamfer':
            corners[key] = {'type': 'chamfer', 'x': c['x'], 'y': c['y'], 'r': c['r']}
        elif c['type'] == 'Handle notch':
            corners[key] = {'type': 'notch', 'x': c['x'], 'y': c['y'], 'r': 0.0}
        else:
            corners[key] = {'type': 'round', 'r': c['r']}
    return {
        'name': s['name'] or 'Magnusson Box',
        'width': s['width'],
        'cells': parse_cells(s['cell_lengths'], s['cells']),
        'height': s['height'],
        'wall': s['wall'],
        'taper_inset': s['taper_inset'],
        'taper_height': s['taper_height'],
        'corners': corners,
        'rail_notches': s['rail'],
        'notch_depth': s['notch_depth'],
        'notch_width': s['notch_width'],
        'slots': {'None': 'none', 'Every cell': 'every', 'First cell only': 'first'}[s['slots']],
        'slot_sides': {'Both sides': 'both', 'Left side': 'left', 'Right side': 'right'}[s['slot_sides']],
        'dividers': max(0, s['comp_along'] - 1),
        'divider_cols': max(0, s['comp_across'] - 1),
        'divider_ratios': s['comp_ratios'],
        'divider_col_ratios': s['comp_across_ratios'],
        'separate': s['separate'],
        'piece_labels': [x.strip() for x in s['piece_labels'].split('|')] if s['piece_labels'].strip() else [],
        'split_gap': s['split_gap'],
        'divider_thickness': s['divider_thickness'],
        'divider_height': s['divider_height'],
        'label': s['label'].lower(),
        'label_text': s['label_text'],
        'label_text_height': s['label_text_height'],
        'label_style': 'emboss' if s['label_style'].startswith('Emb') else 'deboss',
        'label_font': s['label_font'] or 'Arial',
        'tray': s['tray'],
        'tray_depth': s['tray_depth'],
        'tray_clearance': s['tray_clearance'],
        'tray_cover': {'Full length': 'full', 'Front half': 'front', 'Back half': 'back'}[s['tray_cover']],
        'tray_window': s['tray_window'].lower(),
        'tray_dividers': s['tray_dividers'],
        'tray_finger': s['tray_finger'],
        'wall_mount': s['wall_mount'],
        'mount_clearance': s['mount_clearance'],
        'side_clearance': s['side_clearance'],
        'end_clearance': s['end_clearance'],
    }


def free_spot(design):
    """X offset (mm) to the right of everything visible in the design."""
    root = design.rootComponent
    try:
        bb = root.boundingBox
        if bb is None or not bb.isValid:
            return (0.0, 0.0)
        mx = bb.maxPoint.x * 10.0
        mn = bb.minPoint.y * 10.0
        if mx < -1e8:
            return (0.0, 0.0)
        return (mx + 60.0, max(mn, 0.0))
    except Exception:
        return (0.0, 0.0)


# --------------------------------------------------------------------------------------
# event handlers
# --------------------------------------------------------------------------------------
class CreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = args.command
            cmd.setDialogMinimumSize(380, 520)
            cmd.okButtonText = 'Build'
            build_dialog(cmd, load_settings())
            for ev, h in ((cmd.inputChanged, InputChangedHandler()), (cmd.execute, ExecuteHandler()),
                          (cmd.destroy, DestroyHandler())):
                ev.add(h)
                _handlers.append(h)
        except Exception:
            _ui.messageBox('Magnusson Box dialog failed:\n' + traceback.format_exc())


class InputChangedHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        global _applying
        try:
            inputs = args.inputs
            cid = args.input.id
            if _applying:
                return
            if cid in ('col', 'row', 'cells'):
                apply_position(inputs)
            elif cid in ('width', 'cell_lengths', 'rail') or cid.startswith(('ctype', 'cx', 'cy', 'cr')):
                _set_dd(inputs, 'col', 'Custom')
            update_visibility(inputs)
        except Exception:
            pass


def export_files(design, occs, s, fmt):
    """Ask for a folder (remembering the last one) and save each built component as STEP and/or STL."""
    if not fmt or fmt == 'None' or not occs:
        return []
    dlg = _ui.createFolderDialog()
    dlg.title = 'Folder for the %s files' % fmt
    prev = s.get('export_folder') or load_settings().get('export_folder') or ''
    if prev and os.path.isdir(prev):
        dlg.initialDirectory = prev
    if dlg.showDialog() != adsk.core.DialogResults.DialogOK:
        return ['File export skipped (no folder chosen).']
    folder = dlg.folder
    st = load_settings()
    st['export_folder'] = folder
    save_settings(st)
    em, saved, notes = design.exportManager, [], []
    exts = [x for x in ('step', 'stl') if x.upper() in fmt]

    def free(base, ext):
        path, n = os.path.join(folder, base + '.' + ext), 2
        while os.path.exists(path):
            path, n = os.path.join(folder, '%s_%d.%s' % (base, n, ext)), n + 1
        return path

    for occ in occs:
        comp = occ.component
        base = re.sub(r'[^A-Za-z0-9_.-]+', '_', comp.name).strip('_') or 'box'
        for ext in exts:
            path = free(base, ext)
            if ext == 'step':
                opts = em.createSTEPExportOptions(path, comp)
            else:
                opts = em.createSTLExportOptions(comp, path)
                opts.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
                opts.isBinaryFormat = True
                opts.sendToPrintUtility = False
            if em.execute(opts):
                saved.append(os.path.basename(path))
            else:
                notes.append('Could not save ' + path)
    if saved:
        notes.append('Saved %d file(s) in %s' % (len(saved), folder))
    return notes


class ExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            s = read_dialog(inputs)
            s['export_folder'] = load_settings().get('export_folder', '')
            s['layout_file'] = load_settings().get('layout_file', '')
            save_settings(s)
            params = to_engine_params(s)
            design = adsk.fusion.Design.cast(_app.activeProduct)
            if design is None:
                _ui.messageBox('Open or create a Fusion design first.')
                return
            off = free_spot(design) if s['place'].startswith('Beside') else (0.0, 0.0)
            occs, warnings = E.build_split(design, params, off)
            warnings += export_files(design, occs, s, s.get('export_format'))
            if warnings:
                _ui.messageBox('Built %d box(es) with notes:\n\n- ' % len(occs) + '\n- '.join(warnings), CMD_NAME)
        except Exception:
            _ui.messageBox('Magnusson Box build failed:\n' + traceback.format_exc())


class DestroyHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        pass


# --------------------------------------------------------------------------------------
# Organiser Layout: build a whole layout exported from the web app
# --------------------------------------------------------------------------------------
def read_layout(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    boxes = data.get('boxes') if isinstance(data, dict) else None
    if not boxes:
        raise ValueError('This file has no boxes in it. Export it from the web app with "Export layout for Fusion".')
    return data, boxes


class LayoutCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = args.command
            cmd.okButtonText = 'Build layout'
            cmd.setDialogMinimumSize(360, 220)
            s = load_settings()
            inputs = cmd.commandInputs
            inputs.addTextBoxCommandInput('lay_help', '', 'Plan the organiser in the web app, then use '
                                          '<b>Export layout for Fusion</b> (right-click the background of the 3D view, '
                                          'or the button under the case map) and choose that file here.', 4, True)
            inputs.addStringValueInput('lay_file', 'Layout file', s.get('layout_file', ''))
            inputs.addBoolValueInput('lay_browse', 'Choose file…', False, '', False)
            inputs.addBoolValueInput('lay_group', 'Put all boxes in one "Organiser layout" component', True, '', True)
            _dropdown(inputs, 'lay_place', 'Place', ['As in the case (origin = front centre)', 'Beside existing geometry'],
                      'As in the case (origin = front centre)')
            _dropdown(inputs, 'lay_export', 'Save files after building', EXPORT_FORMATS, s.get('export_format', 'None'))
            inputs.addTextBoxCommandInput('lay_info', '', '', 2, True)
            _layout_info(inputs)
            for ev, h in ((cmd.inputChanged, LayoutInputHandler()), (cmd.execute, LayoutExecuteHandler()),
                          (cmd.destroy, DestroyHandler())):
                ev.add(h)
                _handlers.append(h)
        except Exception:
            _ui.messageBox('Organiser Layout dialog failed:\n' + traceback.format_exc())


def _layout_info(inputs):
    path = _str(inputs, 'lay_file')
    info = inputs.itemById('lay_info')
    if not path:
        info.formattedText = 'No file chosen yet.'
        return
    try:
        _, boxes = read_layout(path)
        pieces = sum(max(1, len(E.divider_fractions(b['params'].get('divider_ratios', ''), b['params'].get('dividers', 0))) + 1)
                     if b['params'].get('separate') else 1 for b in boxes)
        info.formattedText = '%d boxes in the layout, %d printable pieces.' % (len(boxes), pieces)
    except Exception as ex:
        info.formattedText = '<span style="color:#c33">%s</span>' % ex


class LayoutInputHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            inputs = args.inputs
            if args.input.id == 'lay_browse':
                dlg = _ui.createFileDialog()
                dlg.title = 'Layout exported from the web app'
                dlg.filter = 'Layout (*.json)'
                cur = _str(inputs, 'lay_file')
                if cur and os.path.isdir(os.path.dirname(cur)):
                    dlg.initialDirectory = os.path.dirname(cur)
                if dlg.showOpen() == adsk.core.DialogResults.DialogOK:
                    inputs.itemById('lay_file').value = dlg.filename
            if args.input.id in ('lay_browse', 'lay_file'):
                _layout_info(inputs)
        except Exception:
            pass


class LayoutExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            path = _str(inputs, 'lay_file')
            st = load_settings()
            st['layout_file'] = path
            st['export_format'] = _sel(inputs, 'lay_export')
            save_settings(st)
            data, boxes = read_layout(path)
            design = adsk.fusion.Design.cast(_app.activeProduct)
            if design is None:
                _ui.messageBox('Open or create a Fusion design first.')
                return
            base = free_spot(design) if _sel(inputs, 'lay_place').startswith('Beside') else (0.0, 0.0)
            if base != (0.0, 0.0):
                base = (base[0] + 166.25, base[1] + 63.8)     # the layout spans x -166 to 166, y -64 upwards
            parent = None
            if _bool(inputs, 'lay_group'):
                grp = design.rootComponent.occurrences.addNewComponent(adsk.core.Matrix3D.create())
                grp.component.name = data.get('name') or 'Organiser layout'
                parent = grp.component
            prog = _ui.createProgressDialog()
            prog.cancelButtonText = 'Stop'
            prog.isBackgroundTranslucent = False
            prog.show('Organiser Layout', 'Building box %v of %m', 0, len(boxes), 0)
            occs, notes = [], []
            for i, bx in enumerate(boxes):
                if prog.wasCancelled:
                    notes.append('Stopped after %d of %d boxes.' % (i, len(boxes)))
                    break
                prog.progressValue = i
                p = dict(bx['params'])
                p['name'] = bx.get('name') or 'Box %d' % (i + 1)
                ox, oy = bx.get('offset', [0, 0])
                try:
                    o, w = E.build_split(design, p, (base[0] + ox, base[1] + oy), parent)
                    occs += o
                    notes += ['%s: %s' % (p['name'], x) for x in w]
                except Exception as ex:
                    notes.append('%s failed: %s' % (p['name'], ex))
                adsk.doEvents()
            prog.hide()
            notes += export_files(design, occs, st, _sel(inputs, 'lay_export'))
            msg = 'Built %d printable pieces from %d boxes.' % (len(occs), len(boxes))
            _ui.messageBox(msg + ('\n\n- ' + '\n- '.join(notes) if notes else ''), LAYOUT_NAME)
        except Exception:
            _ui.messageBox('Organiser Layout build failed:\n' + traceback.format_exc())


# --------------------------------------------------------------------------------------
# add-in entry points
# --------------------------------------------------------------------------------------
def _add_command(cid, name, tip, handler_cls):
    old = _ui.commandDefinitions.itemById(cid)
    if old:
        old.deleteMe()
    res = os.path.join(HERE, 'resources')
    cmd_def = _ui.commandDefinitions.addButtonDefinition(cid, name, tip, res if os.path.isdir(res) else '')
    h = handler_cls()
    cmd_def.commandCreated.add(h)
    _handlers.append(h)
    panel = _ui.allToolbarPanels.itemById(PANEL_ID)
    if panel:
        old = panel.controls.itemById(cid)
        if old:
            old.deleteMe()
        ctl = panel.controls.addCommand(cmd_def)
        ctl.isPromotedByDefault = True
        ctl.isPromoted = True


def run(context):
    global _app, _ui
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface
        importlib.reload(E)
        _add_command(CMD_ID, CMD_NAME, CMD_TIP, CreatedHandler)
        _add_command(LAYOUT_ID, LAYOUT_NAME, LAYOUT_TIP, LayoutCreatedHandler)
    except Exception:
        if _ui:
            _ui.messageBox('Magnusson Box add-in failed to start:\n' + traceback.format_exc())


def stop(context):
    try:
        panel = _ui.allToolbarPanels.itemById(PANEL_ID)
        for cid in (CMD_ID, LAYOUT_ID):
            if panel:
                ctl = panel.controls.itemById(cid)
                if ctl:
                    ctl.deleteMe()
            cmd_def = _ui.commandDefinitions.itemById(cid)
            if cmd_def:
                cmd_def.deleteMe()
        _handlers.clear()
    except Exception:
        pass
