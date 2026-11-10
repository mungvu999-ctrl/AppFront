/**
 * Core types of the spatial graph.
 *
 * Unit conventions:
 * - Every coordinate and geometric size is an integer number of millimetres.
 * - Level elevations are stored in millimetres too; only the presentation
 *   layer converts them to metres.
 * - Areas are stored in square metres.
 *
 * This file only declares types. Id generation and validation live in `./ids`.
 */

import type { MillimetresPerPixel } from '../units/types';

/** A length in millimetres, always an integer. */
export type Millimetres = number;

/** An area in square metres. */
export type SquareMetres = number;

/** An angle in degrees, within [0, 360). */
export type Degrees = number;

/** A point on the floor plan, in millimetres. */
export interface Point {
  x: Millimetres;
  y: Millimetres;
}

/** A straight segment between two points, in millimetres. */
export interface Segment {
  start: Point;
  end: Point;
}

/** An axis-aligned bounding box, in millimetres. */
export interface BoundingBox {
  min: Point;
  max: Point;
}

/** The vertical band a given object occupies on one level. */
export interface LevelRange {
  levelId: LevelId;
  bottomElevationMm: Millimetres;
  topElevationMm: Millimetres;
}

/** Whether the data came from the AI model or from a person. */
export type DataSource = 'ai' | 'human';

/** A confidence score within [0, 1]. */
export type Confidence = number;

/**
 * Review metadata carried by every object in the graph.
 *
 * `reviewed` may only be set once a user has approved the object; AI output
 * must never set the flag on its own.
 */
export interface ReviewMetadata {
  confidence: Confidence;
  source: DataSource;
  reviewed: boolean;
  /** Set by the backend once a person has changed this AI entity; protects it from pipeline reruns. */
  edited?: boolean | undefined;
}

/** Level id, prefixed with `L-`. */
export type LevelId = `L-${string}`;

/** Wall id, prefixed with `W-`. */
export type WallId = `W-${string}`;

/** Opening id (door or window), prefixed with `D-`. */
export type OpeningId = `D-${string}`;

/** Furniture id, prefixed with `F-`. */
export type FurnitureId = `F-${string}`;

/** Room id, prefixed with `R-`. */
export type RoomId = `R-${string}`;

/** Axis id, prefixed with `A-`. */
export type AxisId = `A-${string}`;

/** Dimension id, prefixed with `M-`. */
export type DimensionId = `M-${string}`;

/** Id of any prefixed entity. */
/** Roof id, prefixed with `RF-` (two letters: `R-` is a room). */
export type RoofId = `RF-${string}`;

export type EntityId = LevelId | WallId | OpeningId | FurnitureId | RoomId | AxisId | DimensionId | RoofId;

/** Note id; notes are outside the prefix table, so their id is free-form. */
export type NoteId = string;

/** The building described by the graph. */
export interface Building extends ReviewMetadata {
  name: string;
  address?: string;
  /** The `+0.000` datum expressed in the project coordinate system. */
  datumElevationMm: Millimetres;
  grossFloorAreaM2?: SquareMetres;
}

/** One level of the building. */
export interface Level extends ReviewMetadata {
  id: LevelId;
  name: string;
  /** Ordering from the bottom up; the ground level is 0. */
  order: number;
  elevationMm: Millimetres;
  heightMm: Millimetres;
  areaM2?: SquareMetres;
  /**
   * Tỷ lệ bản vẽ của tầng này, mm trên mỗi pixel.
   * Không bắt buộc vì tầng chưa hiệu chỉnh thì chưa có.
   */
  scaleMillimetresPerPixel?: MillimetresPerPixel;
}

/** Structural role of a wall. */
export type WallKind = 'loadBearing' | 'partition' | 'envelope';

/** A wall run on one level. */
export interface Wall extends ReviewMetadata {
  id: WallId;
  levelId: LevelId;
  /** Centreline, measured through the middle of the wall section. */
  centreline: Segment;
  /**
   * Tường cong (cung ≤ 180°): sagitta có dấu, đỉnh cung = trung điểm tim − giá trị · n với
   * `n = (-dy, dx) / L` — đúng `curveOffset` của Pascal, |giá trị| ≤ L/2. Vắng = thẳng.
   * Đa giác 2D (`resolveWallShapes`), chỗ đặt ô mở và luật hở mặt tường theo cung (`./arc`); dò phòng
   * và các luật hình học khác còn coi tường cong là dây `centreline`.
   */
  curveOffsetMm?: Millimetres | undefined;
  thicknessMm: Millimetres;
  /** Độ dày máy đo lúc dựng, người sửa không đổi được; vắng = máy chủ cũ hoặc tường người vẽ (U48). */
  detectedThicknessMm?: Millimetres | undefined;
  heightMm: Millimetres;
  kind: WallKind;
  openingIds: readonly OpeningId[];
  /** Paint of each face; absent = the theme's wall colour. */
  paint?: WallPaint;
}

/** A material from the library or the scene, e.g. `library:oak` (wire `^(library|scene):[a-z0-9_-]{1,64}$`). */
export type MaterialRef = `library:${string}` | `scene:${string}`;

/** Paint of the two faces of a wall. */
export interface WallPaint {
  interior?: MaterialRef;
  exterior?: MaterialRef;
}

/** Kind of opening cut into a wall. */
export type OpeningKind = 'door' | 'window';

/** How the leaf opens, seen from inside the room. */
export type SwingDirection = 'left' | 'right' | 'double' | 'sliding' | 'fixed';

/** An opening in a wall: a door or a window. */
export interface Opening extends ReviewMetadata {
  id: OpeningId;
  wallId: WallId;
  kind: OpeningKind;
  /** Distance from the centreline start point to the left edge of the opening. */
  offsetMm: Millimetres;
  widthMm: Millimetres;
  heightMm: Millimetres;
  /** Sill height above the level floor; doors use 0. */
  sillHeightMm: Millimetres;
  swing: SwingDirection;
  /** Door with `swing: 'sliding'` only: pocket (slides into the wall) or folding leaves; absent = plain sliding. */
  doorStyle?: DoorStyle;
  /** Doors: leaf opens the other way than the default (hinged: other wall face; sliding: slides right). */
  reversed?: boolean;
}

/** Track-door variants refining `swing: 'sliding'`. */
export type DoorStyle = 'pocket' | 'folding';

/** Furniture grouped by purpose. */
export type FurnitureKind =
  | 'table'
  | 'chair'
  | 'bed'
  | 'wardrobe'
  | 'kitchenCabinet'
  | 'sanitaryFixture'
  | 'washingMachine'
  | 'shower'
  | 'stair'
  | 'other';

/** A furniture item placed on the plan. */
export interface Furniture extends ReviewMetadata {
  id: FurnitureId;
  levelId: LevelId;
  roomId?: RoomId;
  kind: FurnitureKind;
  centre: Point;
  /** The piece's own, unrotated footprint centred on `centre`; `rotationDeg` turns it about `centre`. */
  boundingBox: BoundingBox;
  rotationDeg: Degrees;
  /** Catalogue model chosen for this item (e.g. after a Pascal "replace all"); absent = the stock model of `kind`. */
  model?: { id: string; src: string };
  /** Material per named slot of the model (at most 8); absent slot = the model's own material. */
  slots?: Readonly<Record<string, MaterialRef>>;
  /**
   * Finer-grained piece than `kind` (the login-house vocabulary); absent = pick from `kind`.
   * On `kind: 'stair'` it may instead be a `StairVariant` (AppBack M1-01): carried through read → write untouched so a
   * save never drops it, even though this branch always builds a straight stair.
   */
  variant?: FurnitureVariant | StairVariant;
  /** Height of the piece; absent = the model's own height. */
  heightMm?: Millimetres;
  /** Height of the piece's base above the floor (mirror, wall cabinet); absent = on the floor. */
  liftMm?: Millimetres;
  /** A machine suggestion the reviewer has not accepted yet: kept out of the 3D build; absent = a normal piece. */
  suggested?: boolean;
}

/** The 35 furniture variants of the login-page house model. */
export const FURNITURE_VARIANTS = [
  'bed',
  'nightstand',
  'tableLamp',
  'wardrobe',
  'rug',
  'plant',
  'shower',
  'wc',
  'basin',
  'mirror',
  'artwork',
  'shelves',
  'table',
  'chair',
  'baseRun',
  'upperRun',
  'hood',
  'hob',
  'sink',
  'fridge',
  'stool',
  'cabinet',
  'sofa',
  'sconce',
  'tv',
  'armchair',
  'sideTable',
  'floorLamp',
  'bench',
  'pendant',
  'vase',
  'lounger',
  'planter',
  'bamboo',
  'shrub',
] as const;

export type FurnitureVariant = (typeof FURNITURE_VARIANTS)[number];

/** Stair kinds on the wire (`kind: 'stair'` only; AppBack M1-01 `packages/domain/spatial/model.py`). */
export const STAIR_VARIANTS = ['straight', 'curved', 'spiral'] as const;

export type StairVariant = (typeof STAIR_VARIANTS)[number];

export const isFurnitureVariant = (value: string): value is FurnitureVariant =>
  (FURNITURE_VARIANTS as readonly string[]).includes(value);

/** Floor finish of a room. */
export type RoomFinish = 'wood' | 'tile' | 'mosaic' | 'decking' | 'concrete';

/** What a room is used for. */
export type RoomUsage =
  | 'livingRoom'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'corridor'
  | 'stairwell'
  | 'utility'
  | 'loggia'
  | 'other';

/** A closed room on the plan. */
export interface Room extends ReviewMetadata {
  id: RoomId;
  levelId: LevelId;
  name: string;
  usage: RoomUsage;
  /** Closed outline; the first point is not repeated at the end. */
  outline: readonly Point[];
  areaM2: SquareMetres;
  /** Clear (net) area inside half the bounding walls' thickness; server-derived, read-only; absent = unknown. */
  clearAreaM2?: SquareMetres;
  wallIds: readonly WallId[];
  /** Floor finish; absent = derived from `usage`. */
  finish?: RoomFinish;
  /** Floor material; absent = from `finish`. */
  floorMaterial?: MaterialRef;
  /** Ids (`DRESS-…`) of auto-placed pieces the user deleted in 3D: never placed again; absent = none. */
  dressingOff?: readonly string[];
  /** Ceiling material; absent = the plaster default. */
  ceilingMaterial?: MaterialRef;
}

/** Orientation of a setting-out axis. */
export type AxisDirection = 'horizontal' | 'vertical';

/** A structural setting-out axis. */
export interface Axis extends ReviewMetadata {
  id: AxisId;
  levelId: LevelId;
  /** Label drawn on the sheet, for example `A` or `12`. */
  label: string;
  direction: AxisDirection;
  line: Segment;
}

/** Kind of dimension being annotated. */
export type DimensionKind = 'linear' | 'chain' | 'radial' | 'angular' | 'elevation';

/** A dimension string annotated on the drawing. */
export interface Dimension extends ReviewMetadata {
  id: DimensionId;
  levelId: LevelId;
  kind: DimensionKind;
  /** The entities this dimension measures. */
  referenceIds: readonly EntityId[];
  /** The dimension line, from start point to end point. */
  line: Segment;
  valueMm: Millimetres;
  /** Value the user typed over the automatically measured one. */
  overrideValueMm?: Millimetres;
}

/** A note attached to any entity in the graph. */
export interface Note extends ReviewMetadata {
  id: NoteId;
  entityId: EntityId;
  body: string;
  /** Creation time as an ISO 8601 string with offset. */
  createdAt: string;
  authorId: string;
}

/**
 * The spatial graph describing a whole multi-level building.
 *
 * The lists only reference each other through prefixed ids and never nest
 * entities, so every edit stays a flat patch.
 */
export interface SpatialGraph {
  building: Building;
  levels: readonly Level[];
  walls: readonly Wall[];
  openings: readonly Opening[];
  furniture: readonly Furniture[];
  rooms: readonly Room[];
  axes: readonly Axis[];
  dimensions: readonly Dimension[];
  notes: readonly Note[];
  /** Mái (Pascal `roof` + `roof-segment`); vắng = không có mái (roof-contract.md). */
  roofs?: readonly Roof[];
}

/**
 * Một mái vẽ trong editor 3D. Máy chủ không hiểu hình học mái: `nodes` là node Pascal
 * nguyên dạng (mét, toạ độ cục bộ của Pascal) bỏ `parentId`/`children` — phần tử 0 là
 * node `roof`, các phần tử sau là `roof-segment` con của nó. Chỉ `lib/pascal/roofs.ts` đọc/ghi.
 */
export interface Roof extends ReviewMetadata {
  id: RoofId;
  levelId: LevelId;
  nodes: readonly Readonly<Record<string, unknown>>[];
}
