// The castle plan: every piece of a castle as plain data, so the game, the physics checks and the
// computer kids all work from the same list. Units are toy units (the blocks are a 4-unit set);
// x points from a castle towards its enemy, y up from the table top, z towards the camera.
// The castles are one block deep, like a castle drawn on paper and built in wood.

export const DEPTH = 10;              // every block is 10 deep (z)
export const CASTLE_X = 100;          // castle origins at -100 (Red) and +100 (Blue)
export const TABLE = { x: 180, z: 65 };   // half extents of the table top
export const GRAVITY = 200;           // toy gravity: flights you can follow with your eyes

// block kinds: [width (x), height (y)]
export const BLOCKS = {
  cube: [4, 4],
  brick: [8, 4],
  board: [24, 2],
  tower: [4, 16],
};

// where the pieces that are not plain blocks stand (local x, bottom y)
export const SLOTS = {
  catapults: [
    { x: 10, y: 0, launch: [13, 14], name: 'Courtyard catapult' },
    { x: -40, y: 0, launch: [-37, 14], name: 'Back catapult' },
  ],
  piggies: [
    { x: -13, y: 32, name: 'Keep roof' },
    { x: 21, y: 0, name: 'Courtyard' },
    { x: -54, y: 0, name: 'Back yard' },
  ],
  throne: { x: -14, y: 14 },
  flag: { x: -23, y: 40 },
};
export const TEDDY = { w: 8, h: 11, d: 7 };
export const THRONE = { seat: [10, 4, 8], back: [10, 10, 2] };
export const PIGGY = { w: 9, h: 7, d: 6 };
export const CATAPULT = { w: 12, h: 6, d: 8 };

// The blocks of one castle in local coordinates: {kind, x (centre), y (bottom), w, h, part}.
export function castlePlan() {
  const P = [];
  const add = (kind, x, y, part) => { const [w, h] = BLOCKS[kind]; P.push({ kind, x, y, w, h, part }); };
  // the front wall: 16 wide, four courses in running bond, two merlons on top
  const W = 26;
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    if (row % 2 === 0) { add('brick', W + 4, y, 'wall'); add('brick', W + 12, y, 'wall'); }
    else { add('cube', W + 2, y, 'wall'); add('brick', W + 8, y, 'wall'); add('cube', W + 14, y, 'wall'); }
  }
  add('cube', W + 2, 16, 'wall'); add('cube', W + 14, 16, 'wall');
  // the keep: a solid ground floor, a floor board, two towers round the throne room, the roof board
  for (let row = 0; row < 3; row++) {
    const y = row * 4;
    if (row % 2 === 0) { add('brick', -22, y, 'keep'); add('brick', -14, y, 'keep'); add('brick', -6, y, 'keep'); }
    else { add('cube', -24, y, 'keep'); add('brick', -18, y, 'keep'); add('brick', -10, y, 'keep'); add('cube', -4, y, 'keep'); }
  }
  add('board', -14, 12, 'keep');
  add('tower', -24, 14, 'keep'); add('tower', -4, 14, 'keep');
  add('board', -14, 30, 'keep');
  // on the roof: the flag tower at the back, a merlon at the front
  add('cube', -23, 32, 'roof'); add('cube', -23, 36, 'roof');
  add('cube', -4, 32, 'roof');
  return P;
}

// local x → world x for a castle (side 0 = Red on the left, 1 = Blue on the right)
export const sideDir = (side) => (side === 0 ? 1 : -1);
export const worldX = (side, x) => (side === 0 ? -CASTLE_X : CASTLE_X) + sideDir(side) * x;
