// Quick checks for the geometry engine: node tests/geometry.test.js
const G = require('../geometry.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const one = G.build({});
assert(one.box.volume() > 15000, 'single cell box builds');
const split = G.buildSplit({ cells: [64.5, 64.5], dividers: 2, separate: true, piece_labels: ['M3', '', 'WASHERS'] });
assert(split.length === 3 && split[0].label === 'M3' && split[2].label === 'WASHERS', 'separate pieces carry their own labels');
const br = G.toBrep(one.box);
assert(br.openEdges === 0 && br.solids.length === 1, 'STEP B-rep is one closed solid');
assert(G.toSTEP([{ name: 'box', csg: one.box }], 'b.step').data.length > 1000, 'STEP file written');
const w = G.build({ wall: 2.5 });
assert(w.box.volume() > one.box.volume(), 'thicker wall adds material');
