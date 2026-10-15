// XMAS-32b "The globe", slice 2: the turning shapes inside the globe.
// The house, the eight presents and the lamp post are small boxes and
// cylinders standing on the globe's floor disc, turned about the globe's
// vertical axis by the turn; each visible face carries a drawing from the
// House or Props sheet (XMAS-21 7.2-7.4). The floor is seen from a little
// above, so a present's top shows above its walls while a wall keeps its
// drawn height, and the whole shape's footprint stays inside the disc.
import { drawings, type Drawing } from '../shared/art.generated.ts';

export type ShapeKind = 'house' | 'present' | 'lamp-post' | 'pine' | 'snowman';
export type PresentDesign = 1 | 2 | 3 | 4;
export type PineDrawing = 'pine-1' | 'pine-2' | 'pine-3';

/**
 * One turning shape, placed on the floor disc at turn 0. Local axes: x across
 * to the visitor's right, z towards the visitor; sizes in art pixels. The
 * footprint is the axis-aligned box x ± width / 2, z ± depth / 2.
 */
export interface GlobeShape {
  kind: ShapeKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Presents only: which of the four present drawings its faces carry. */
  design?: PresentDesign;
  /** Pines only: the name of the drawing the pine is, one of pine-1 to pine-3. */
  drawing?: PineDrawing;
}

/** The floor disc the shapes stand on: its centre's offset below the globe's centre on screen, and its radius, in art pixels. */
export interface FloorDisc {
  y: number;
  radius: number;
}

/**
 * One visible face of a shape: the drawing it carries and its screen corners,
 * relative to the globe's centre (x right, y down), in art pixels. Four
 * corners are the drawing's own corners; three are a gable's left foot, apex
 * and right foot, which show the part of the drawing under the apex's level.
 */
export interface ProjectedFace {
  drawing: string;
  corners: readonly (readonly [number, number])[];
}

/** One point of the shapes' space: across (to the visitor's right), towards the visitor and up off the floor. */
type Point = readonly [number, number, number];

/** One full turn in radians: whole turns and negative turns show the same faces as turn 0. */
const FULL_TURN = 2 * Math.PI;
/**
 * The floor is seen from a little above: a step of the floor towards the
 * visitor drops it this far down the picture. A wall keeps its whole drawn
 * height at every turn, because the tilt moves its top and its foot together,
 * while a present's near top edge sits below its far one, so its top shows.
 */
const TILT = 0.3;
/** A face this near edge-on is passed over: its hairline would be no face at all. */
const EDGE_ON = 1e-9;
/** Far enough behind any face's nearness to put a face last within its shape. */
const UNDER = 1e6;

/** The floor disc's middle sits 20 art pixels below the globe's centre and reaches 44 art pixels out: at every turn its whole rim stays inside the glass (radius 56 less its 2.5-wide rim) and its front edge rests above the base of the shortest picture. */
export const floorDisc: FloorDisc = { y: 20, radius: 44 };

/**
 * The house, the globe's hero: its walls are 28 art pixels across, 18 deep and
 * 15 tall (art/objects.ts), stood in the middle of the disc and a little back,
 * under a thick snow roof that overhangs its gables. Every shape stands so
 * that its front wall's columns and rows land on the picture's grid at turn 0,
 * as the lettering does: x - width / 2 and floorDisc.y + TILT * (z + depth / 2)
 * are whole art pixels.
 */
const HOUSE: GlobeShape = { kind: 'house', x: 0, z: 1, width: 28, depth: 18, height: 15 };
/** The eight presents, two of each design, each a cube the size of its design's drawings, heaped round the house, the path to its door kept clear. */
const PRESENTS: readonly GlobeShape[] = [
  { kind: 'present', x: -29.5, z: -23.5, width: 7, depth: 7, height: 7, design: 1 },
  { kind: 'present', x: 33.5, z: 6.5, width: 7, depth: 7, height: 7, design: 1 },
  { kind: 'present', x: 14, z: 27, width: 6, depth: 6, height: 6, design: 2 },
  { kind: 'present', x: -28, z: 17, width: 6, depth: 6, height: 6, design: 2 },
  { kind: 'present', x: 2.5, z: 27.5, width: 5, depth: 5, height: 5, design: 3 },
  { kind: 'present', x: -19.5, z: -22.5, width: 5, depth: 5, height: 5, design: 3 },
  { kind: 'present', x: -14.5, z: 26.5, width: 7, depth: 7, height: 7, design: 4 },
  { kind: 'present', x: 16.5, z: -23.5, width: 7, depth: 7, height: 7, design: 4 },
];
/** The lamp post: a thin cylinder, so its one drawing shows the same 5 x 24 face from every side. */
const LAMP_POST: GlobeShape = { kind: 'lamp-post', x: -19.5, z: 10, width: 5, depth: 5, height: 24 };

/** The three pines, of three heights: flat drawings facing the visitor, each on a thin footprint, framing the house at turn 0. */
const PINES: readonly GlobeShape[] = [
  { kind: 'pine', x: -32.5, z: 0, width: 17, depth: 2, height: 30, drawing: 'pine-1' },
  { kind: 'pine', x: 30.5, z: -10, width: 15, depth: 2, height: 25, drawing: 'pine-2' },
  { kind: 'pine', x: -8.5, z: -30, width: 13, depth: 2, height: 21, drawing: 'pine-3' },
];
/** The snowman: his body is a flat drawing facing the visitor, round on a 10 x 10 footprint; his face, arms and scarf turn with the globe. */
const SNOWMAN: GlobeShape = { kind: 'snowman', x: 25, z: 20, width: 10, depth: 10, height: 18 };

export const globeShapes: readonly GlobeShape[] = [HOUSE, ...PRESENTS, LAMP_POST, ...PINES, SNOWMAN];

/** The turn folded into [0, 2π): negative turns and whole turns show turn 0. */
export function wrapTurn(turn: number): number {
  return ((turn % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** A drawing from the packed sheets, or a clear failure: the build packs every object's drawing. */
export function sheet(name: string): Drawing {
  const drawing = drawings[name];
  if (drawing === undefined) throw new Error(`the sheets have no ${name} drawing`);
  return drawing;
}

/** One point of the floor turned by t: screen x = x cos t − z sin t, its height lifting it up the picture. */
function project(x: number, z: number, height: number, cos: number, sin: number): [number, number] {
  return [x * cos - z * sin, floorDisc.y + TILT * (x * sin + z * cos) - height];
}

/** Whether a face whose outside points along (ax, az, ah) turns to the visitor: the tilt looks down on it a little. */
function shows(ax: number, az: number, ah: number, cos: number, sin: number): boolean {
  return (ax * sin + az * cos + ah * TILT) / Math.hypot(ax, az, ah) > EDGE_ON;
}

/** A face and how near it is to the visitor (larger is nearer), so a shape's faces can be put near to far. */
interface Placed {
  face: ProjectedFace;
  near: number;
}

/** How near points are to the visitor on average: the way the floor turns to him, plus the tilt's lift. */
function nearness(points: readonly Point[], cos: number, sin: number): number {
  let sum = 0;
  for (const [x, z, height] of points) sum += x * sin + z * cos + TILT * height;
  return sum / points.length;
}

/**
 * A face from four corners, a ring in drawing order: the drawing's top left,
 * top right, bottom right and bottom left pixel corners; or from three, a
 * gable's left foot, apex and right foot.
 */
function face(drawing: string, corners: readonly Point[], cos: number, sin: number): Placed {
  return {
    face: { drawing, corners: corners.map(([x, z, height]) => project(x, z, height, cos, sin)) },
    near: nearness(corners, cos, sin),
  };
}

/** One wall of a box: the drawing it carries, its outward direction and its floor line, left column first. */
interface Wall {
  drawing: string;
  out: Point;
  left: readonly [number, number];
  right: readonly [number, number];
}

/**
 * The visible walls of a box standing on the floor, in the fixed order
 * front, back, right, left. Each wall's drawing is drawn as drawn when that
 * wall faces the visitor: at turn 0 the front wall's left column is on the
 * screen's left, and the other walls follow the same way round.
 */
function boxWalls(
  names: readonly [string, string, string, string],
  x: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
  top: number,
  cos: number,
  sin: number,
): Placed[] {
  const [front, back, right, left] = names;
  const walls: readonly Wall[] = [
    { drawing: front, out: [0, 1, 0], left: [x - halfWidth, z + halfDepth], right: [x + halfWidth, z + halfDepth] },
    { drawing: back, out: [0, -1, 0], left: [x + halfWidth, z - halfDepth], right: [x - halfWidth, z - halfDepth] },
    { drawing: right, out: [1, 0, 0], left: [x + halfWidth, z + halfDepth], right: [x + halfWidth, z - halfDepth] },
    { drawing: left, out: [-1, 0, 0], left: [x - halfWidth, z - halfDepth], right: [x - halfWidth, z + halfDepth] },
  ];
  return walls
    .filter((wall) => shows(wall.out[0], wall.out[1], wall.out[2], cos, sin))
    .map((wall) =>
      face(
        wall.drawing,
        [
          [wall.left[0], wall.left[1], top],
          [wall.right[0], wall.right[1], top],
          [wall.right[0], wall.right[1], 0],
          [wall.left[0], wall.left[1], 0],
        ],
        cos,
        sin,
      ),
    );
}

/** A face that always looks the visitor in the eye, like a thin cylinder: its drawing keeps its size at every turn. */
function roundFace(drawing: Drawing, name: string, x: number, z: number, bottom: number, cos: number, sin: number): Placed {
  const [cx, cy] = project(x, z, bottom, cos, sin);
  const half = drawing.width / 2;
  return {
    face: {
      drawing: name,
      corners: [
        [cx - half, cy - drawing.height],
        [cx + half, cy - drawing.height],
        [cx + half, cy],
        [cx - half, cy],
      ],
    },
    near: nearness([[x, z, bottom + drawing.height / 2]], cos, sin),
  };
}

/** A face laid before the faces at its own depth, so it covers them where they overlap. */
function over(placed: Placed): Placed {
  return { face: placed.face, near: placed.near + 0.5 };
}

/** A face laid after every other face of its shape, so any of them covers it where they overlap. */
function under(placed: Placed): Placed {
  return { face: placed.face, near: placed.near - UNDER };
}

/** The house's faces: its walls, the gable ends over the side walls, the two roof slopes and the chimney on the ridge. */
function houseFaces(shape: GlobeShape, cos: number, sin: number): Placed[] {
  const { x, z, width, depth, height } = shape;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const roof = sheet('house-roof-front');
  // The roof drawing is wider than the walls: its slopes overhang both gables by the difference.
  const eave = halfWidth + (roof.width - width) / 2;
  // The slope runs from the eave at the wall's top up to the ridge over the
  // house's middle; its rise is chosen so the drawing's rows fill exactly the
  // rows the slope's back-to-front run and its height cover on the screen.
  const rise = roof.height - TILT * halfDepth;
  const ridge = height + rise;
  const chimney = sheet('house-chimney');
  return [
    // The walls stand under the roof too: its eaves cover their tops where they overhang them.
    ...boxWalls(['house-wall-front', 'house-wall-back', 'house-wall-right', 'house-wall-left'], x, z, halfWidth, halfDepth, height, cos, sin).map((wall) => ({ face: wall.face, near: wall.near - UNDER / 2 })),
    // The gable ends close the triangle between a side wall's top and the
    // slopes. They sit under the roof, whose eaves overhang them, so they are
    // laid last: the slopes always cover them where the two meet on screen,
    // whatever the turn, instead of swapping over as their middles pass.
    ...(shows(1, 0, 0, cos, sin)
      ? [under(face('house-wall-right', [[x + halfWidth, z + halfDepth, height], [x + halfWidth, z, ridge], [x + halfWidth, z - halfDepth, height]], cos, sin))]
      : []),
    ...(shows(-1, 0, 0, cos, sin)
      ? [under(face('house-wall-left', [[x - halfWidth, z - halfDepth, height], [x - halfWidth, z, ridge], [x - halfWidth, z + halfDepth, height]], cos, sin))]
      : []),
    ...(shows(0, rise, halfDepth, cos, sin)
      ? [
          face(
            'house-roof-front',
            [
              [x - eave, z, ridge],
              [x + eave, z, ridge],
              [x + eave, z + halfDepth, height],
              [x - eave, z + halfDepth, height],
            ],
            cos,
            sin,
          ),
        ]
      : []),
    ...(shows(0, -rise, halfDepth, cos, sin)
      ? [
          face(
            'house-roof-back',
            [
              [x + eave, z, ridge],
              [x - eave, z, ridge],
              [x - eave, z - halfDepth, height],
              [x + eave, z - halfDepth, height],
            ],
            cos,
            sin,
          ),
        ]
      : []),
    roundFace(chimney, 'house-chimney', x + 8, z, ridge, cos, sin),
  ];
}

/** A present's faces: its four sides and its top, all carrying its own design's drawings. */
function presentFaces(shape: GlobeShape, cos: number, sin: number): Placed[] {
  if (shape.design === undefined) throw new Error('a present carries no design');
  const side = `present-${shape.design}-side`;
  const { x, z, width, depth, height } = shape;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    ...boxWalls([side, side, side, side], x, z, halfWidth, halfDepth, height, cos, sin),
    // The top is always seen from a little above, so it shows at every turn.
    face(
      `present-${shape.design}-top`,
      [
        [x - halfWidth, z - halfDepth, height],
        [x + halfWidth, z - halfDepth, height],
        [x + halfWidth, z + halfDepth, height],
        [x - halfWidth, z + halfDepth, height],
      ],
      cos,
      sin,
    ),
  ];
}

/**
 * The snowman's faces: his body, always facing the visitor, behind the three
 * parts that turn with the globe. The face sits on the front of his head
 * (rows 6-8 of the body drawing, one column left of its middle so that its
 * columns land on the grid) and shows while it looks towards the visitor; the
 * scarf (rows 9-11, his neck) and the arms (rows 8-12) stand in his middle
 * plane and show from both sides, mirrored once seen from behind.
 */
/** The rows of the body drawing (from the top) where his turning parts sit: face rows 6-8, scarf rows 9-11, arms rows 8-12, coal buttons rows 14-16 (below the arms, so they never cross as he turns). */
const FACE_ROW = 6;
const SCARF_ROW = 9;
const ARMS_ROW = 8;
const BUTTONS_ROW = 14;
/** How far his face and buttons stand out of his middle plane: his head's radius, so the face stays on the head as he turns. */
const SNOWMAN_FRONT = 3;

function snowmanFaces(shape: GlobeShape, cos: number, sin: number): Placed[] {
  const { x, z, height } = shape;
  // The turning parts always cover the body, whichever side they are seen from.
  const body = under(roundFace(sheet('snowman-body'), 'snowman-body', x, z, 0, cos, sin));
  const faceHalf = sheet('snowman-face').width / 2;
  const armsHalf = sheet('snowman-arms').width / 2;
  const scarfHalf = sheet('snowman-scarf').width / 2;
  const front = SNOWMAN_FRONT;
  const armsTall = sheet('snowman-arms').height;
  const scarfTall = sheet('snowman-scarf').height;
  // The face stands out of the middle plane by `front`; lifting it by the tilt's share keeps its rows on the body's at turn 0.
  const faceTop = height - FACE_ROW + TILT * front;
  const faceX = x - 0.5;
  const buttons = sheet('snowman-buttons');
  const buttonsTop = height - BUTTONS_ROW + TILT * front;
  return [
    body,
    ...(shows(0, 1, 0, cos, sin)
      ? [face('snowman-face', [[faceX - faceHalf, z + front, faceTop], [faceX + faceHalf, z + front, faceTop], [faceX + faceHalf, z + front, faceTop - 3], [faceX - faceHalf, z + front, faceTop - 3]], cos, sin)]
      : []),
    // The coal buttons sit on his front only, one column wide, in the middle of the face's columns.
    ...(shows(0, 1, 0, cos, sin)
      ? [face('snowman-buttons', [[faceX - 0.5, z + front, buttonsTop], [faceX + 0.5, z + front, buttonsTop], [faceX + 0.5, z + front, buttonsTop - buttons.height], [faceX - 0.5, z + front, buttonsTop - buttons.height]], cos, sin)]
      : []),
    face('snowman-arms', [[x - armsHalf, z, height - ARMS_ROW], [x + armsHalf, z, height - ARMS_ROW], [x + armsHalf, z, height - ARMS_ROW - armsTall], [x - armsHalf, z, height - ARMS_ROW - armsTall]], cos, sin),
    // The scarf wraps his neck over the arms' roots: it always covers them.
    over(face('snowman-scarf', [[x - scarfHalf, z, height - SCARF_ROW], [x + scarfHalf, z, height - SCARF_ROW], [x + scarfHalf, z, height - SCARF_ROW - scarfTall], [x - scarfHalf, z, height - SCARF_ROW - scarfTall]], cos, sin)),
  ];
}

/**
 * The faces of `shape` the visitor sees at `turn` (radians, period 2π), the
 * nearest first. A point (x, z) turns to screen x = x cos t - z sin t, its
 * nearness to the visitor being x sin t + z cos t. Throws a RangeError for a
 * non-finite turn.
 */
export function projectShape(shape: GlobeShape, turn: number): ProjectedFace[] {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  const t = wrapTurn(turn);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const placed = ((): Placed[] => {
    switch (shape.kind) {
      case 'house':
        return houseFaces(shape, cos, sin);
      case 'present':
        return presentFaces(shape, cos, sin);
      case 'lamp-post':
        return [roundFace(sheet('lamp-post'), 'lamp-post', shape.x, shape.z, 0, cos, sin)];
      case 'pine':
        // A pine is a flat drawing that always faces the visitor, like the lamp post but wider.
        if (shape.drawing === undefined) throw new Error('a pine carries no drawing');
        return [roundFace(sheet(shape.drawing), shape.drawing, shape.x, shape.z, 0, cos, sin)];
      case 'snowman':
        return snowmanFaces(shape, cos, sin);
    }
  })();
  return placed.sort((a, b) => b.near - a.near).map((one) => one.face);
}

/**
 * One point of the floor at `turn`, `height` art pixels up, relative to the
 * globe's centre. Throws a RangeError for a non-finite turn.
 */
export function projectPoint(x: number, z: number, height: number, turn: number): [number, number] {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  const t = wrapTurn(turn);
  return project(x, z, height, Math.cos(t), Math.sin(t));
}

/** Whether a screen point (relative to the globe's centre) lies on the floor disc. */
export function onFloor(x: number, y: number): boolean {
  const deep = (y - floorDisc.y) / TILT;
  return x * x + deep * deep <= floorDisc.radius * floorDisc.radius;
}

/** XMAS-82: the floor disc's rim as `points` points in art units, relative to the globe's centre: the ellipse onFloor tests. */
export function floorDiscRing(points: number): [number, number][] {
  return Array.from({ length: points }, (_, n) => {
    const angle = (n * 2 * Math.PI) / points;
    return [floorDisc.radius * Math.cos(angle), floorDisc.y + TILT * floorDisc.radius * Math.sin(angle)];
  });
}
