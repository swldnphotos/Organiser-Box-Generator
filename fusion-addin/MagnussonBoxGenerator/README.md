# Magnusson Box Generator (Fusion add-in)

This add-in builds custom inserts for the Magnusson compartment organiser case (Screwfix 850JC).

## Install
1. Unzip so you have a folder called `MagnussonBoxGenerator` containing `MagnussonBoxGenerator.py`, `mbox_engine.py`, the `.manifest` file and `resources/`.
2. In Fusion, open **Utilities > Add-Ins > Scripts and Add-Ins** and go to the **Add-Ins** tab.
3. Click **+**, then choose the `MagnussonBoxGenerator` folder.
4. Select the add-in and click **Run**. To load it every time Fusion starts, tick **Run on Startup**.
5. **Magnusson Box** now appears under **Solid > Create**. It is also promoted to the toolbar.

## Use
Open any design and click **Magnusson Box**. Pick a preset, adjust the options, then click **Build**.
Each build creates a new component with these bodies:
- **Box**
- **Tray insert** (optional), shown at the height where it rests in the box
- **Wall mount** (optional), shown engaged in the first right-hand hanging slot

To print, right-click a body and choose **Save as Mesh** / 3MF.

The add-in remembers your last settings in `last_settings.json`, which is saved next to the add-in.

## Picking a cell
On the **Box** tab, choose the **Case column** (C1–C5, or a front corner box) and the **Front cell** (row 3 is next to the handle, row 1 is at the back). Then use **Cells long** to run the box back towards row 1. Each cell's shape is filled in automatically:

| Position | Size (cell) | Cuts |
|---|---|---|
| Standard (A) | 66.5 × 64.5 | your v7 corners (6.74 chamfer, R9) |
| C1 / C5, row 1 (B) | 66.5 × 64.5 | 15.5 mm chamfer at the outer back corner |
| C2 / C4, row 3 (E) | 66.5 × 64.5 | handle notch on the handle side, 11.5 deep, 40.75 across, 45° lead-in |
| C3, row 3 (C) | 66.5 × 51.5 | small front chamfers |
| Front corners (D) | 86.8 × 63.8 | 17.8 mm chamfer at the outer front corner; no rails or slots |

These cut sizes put each cut in the same place as the matching box in the A–E set, scaled up to full cell size. Boxes are built at full cell size by default. Under **Extras > Advanced**, **Side clearance** and **End clearance** shrink them. The A–E set uses 1.25 at each side and 2.75 at each end.

## Tabs
- **Box:** case position, cell lengths (front first, editable), width, height, rail indents, and hanging slots (every cell or the first only, on both sides or one).
- **Corners:** set each corner to Standard, Chamfer, Handle notch or Round. Front is the handle side.
- **Inside:**
  - Compartments along and across the box. They don't have to follow the case cells, so a 2-cell box can be split into 3. You can also give relative sizes, e.g. `1, 1, 2`.
  - **Name tag shelf** at the front, back or both, with the text cut in or raised.
- **Tray:** a half-height insert that sits on the tapered walls. It has a see-through floor (window, grid or slots), can cover the full length, front half or back half, and has dividers and finger notches.
- **Extras:** wall mount for the hanging slot. **Advanced** holds the clearances, wall thickness, taper and rail indent size.

## Notes
- Box geometry is measured from your v7 box: 1.5 mm walls, 55 mm tall, a 15 mm straight top band, and walls tapering in 3.5 mm over the bottom 40 mm. The hanging-slot pocket and mouth match your Sketch3 profile.
- Hanging slots are left off boxes under 50 mm tall.


## Separate boxes

On the Inside tab, tick **Make the compartments along separate boxes** to print each compartment along a span as its own box instead of fitting dividers. The span length (minus end clearance) is shared out by the compartment ratios, less the **gap between separate boxes** (default 1 mm).

- Internal ends get standard corners. The front and back pieces keep the span's end cuts (handle notch, chamfers).
- Rail indents are kept wherever an orange-divider rail falls on a piece.
- Each piece gets hanging slots at the cell centres it covers, or at its own centre if it is short.
- Each piece is a separate component, placed where it sits in the span.
- Any piece shorter than 20 mm is refused.


## Wall thickness, hook slots and STEP export

- **Wall thickness** is on the Box tab (0.8 to 4 mm). The hanging-slot pocket and housing move inward with the wall, so they stay the same size behind the inner face, and the wall mount still fits.
- **Hook slot cut-out:** the slot no longer runs out through the base. It now starts about 18 mm up, leaving a 15 mm tall entry window under the narrowing part. To hang a box, push it onto the mount's flange through the window, then let it drop.
- **STEP export:** on the Extras tab, tick *Save a STEP file of each box after building*. After the build you choose a folder (it remembers the last one), and each box component, including each separate piece, is saved as its own `.step` file.

## Name tags on separate boxes

When *Make the compartments along separate boxes* is ticked, **Name tag per box** gives each piece its own label, front piece first, separated by `|`. For example, `M3 | | WASHERS` labels pieces 1 and 3, and piece 2 keeps the shared label from the Inside tab (or has none). A piece given its own tag gets a front label shelf even if the shared label is off. Its component name ends with the tag, so the STEP file names match.

## Building a whole layout (Organiser Layout)

1. Plan the organiser in the web app (https://swldnphotos.github.io/Organiser-Box-Generator/).
2. Tap **Export for Fusion** under the case map, or right-click the background of the 3D view and choose *Export layout for Fusion*. This saves `organiser-layout.json`.
3. In Fusion, go to **Solid → Create → Organiser Layout**, choose the file and click **Build layout**.

Every box is built where it sits in the case, with the origin at the front centre. You can group the boxes in one "Organiser layout" component, or place them beside whatever is already in the design. The layout keeps all the web app settings: separate boxes and their name tags, trays, wall mounts, compartments, wall thickness and clearances.

## Saving files

Both commands can save files after building: **None**, **STEP**, **STL** (binary, high refinement) or **STEP + STL**. You choose a folder, which the add-in remembers, and it saves one file per box or piece.
