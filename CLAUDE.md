# Organiser Box Generator

Generator for 3D-printable boxes that fit the Magnusson Compartment Organiser Case (Screwfix 850JC, 375 × 285 × 65 mm). There are two front ends that share the same geometry rules:

- **Web app** (repo root, served by GitHub Pages at https://swldnphotos.github.io/Organiser-Box-Generator/)
  - `index.html`: UI with the case map, the three.js preview (importmap, three 0.160 from jsDelivr), the right-click/long-press menu, a phone split layout, and localStorage key `mbg-layout`.
  - `geometry.js`: pure-JS BSP CSG engine. `build`, `buildSplit` (separate boxes), `toBinarySTL`, `toSTEP`/`toBrep` (planar B-rep: welds vertices, fixes T-junctions, merges coplanar faces) and `makeZip`. Works in both the browser and Node (`module.exports`).
  - Downloads use `window.claude.use('downloads')` when running as a claude.ai artifact, and a normal Blob link anywhere else.
- **Fusion 360 add-in** (`fusion-addin/MagnussonBoxGenerator/`)
  - `mbox_engine.py`: Fusion API geometry. `build`, `build_split`, `slot_dims`, `CASE`, `position_params`.
  - `MagnussonBoxGenerator.py`: command dialog with Box / Corners / Inside / Tray / Extras tabs, plus STEP export.

## Case and box facts (mm)
- Standard cell is 66.5 wide × 64.5 long. 5 columns C1–C5; rows 1 (back) to 3 (front).
- Special cells:
  - C1/C5 row 1: 15.5 chamfer at the outer back corner.
  - C2/C4 row 3: handle notch.
  - C3 row 3: 51.5 long.
  - Front corners DL/DR: 86.8 × 63.8 with a 17.8 chamfer, no rails or slots.
- Box: 55 tall, wall 1.5 by default (0.8–4 allowed). The bottom 40 mm tapers in by 3.5. Rail indents are 3.5 deep and 6.4 wide.
- Hanging slot: keyhole style. The cut starts at `open_top - 15` (it doesn't run out through the base), the pocket sits `wall + 3.5` from the outer face, and the housing is `wall + 5` deep.
- Separate boxes:
  - The span is shared out by the compartment ratios, minus `split_gap`.
  - Internal ends get standard corners.
  - Each piece has its own `piece_labels[i]`; a blank one falls back to `label_text`.

## Working rules
- Keep the JS and Python engines in step: a geometry change in one usually needs the same change in the other.
- Run `node tests/geometry.test.js` after any geometry change.
- The add-in can only be tested inside Fusion. Install it by copying the folder into Fusion's AddIns directory.
