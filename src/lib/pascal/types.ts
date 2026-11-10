/**
 * Hình dạng cảnh Pascal, **khai lại bằng tay** ở phía AppFront.
 *
 * ## Vì sao không nhập kiểu từ chính gói Pascal
 *
 * Lược đồ thật của Pascal là zod (`@pascal-app/core/schema`): 48 loại node,
 * mỗi loại vài chục trường, và `AnyNode` là hợp của cả 48. Nhập kiểu suy ra
 * từ hợp đó vào đây kéo theo hai thứ AppFront không muốn: một phụ thuộc kiểu
 * lên gói ngoài ở tầng `src/lib` (cổng nhập của `.eslintrc.cjs` chỉ cho
 * `import type`, và ngay cả thế vẫn buộc gói phải cài mới biên dịch được), và
 * một bề mặt 48 loại trong khi bộ đổi dữ liệu chỉ viết **tám**.
 *
 * File này vì thế khai đúng phần AppFront **viết ra hoặc đọc vào**, theo đúng
 * tên trường của lược đồ Pascal 1.0.0. Trường nào Pascal có giá trị mặc định
 * thì ở đây để trống — `zod` điền lúc `parse`, và bỏ trống giữ tệp cảnh nhỏ.
 *
 * ## Quy ước đơn vị và trục — chỗ dễ sai nhất
 *
 * | AppFront | Pascal |
 * |---|---|
 * | mọi độ dài là **milimét** | mọi độ dài là **mét** |
 * | mặt bằng là `(x, y)` | mặt bằng là `[x, z]`, `y` hướng lên |
 * | góc là **độ**, ngược chiều kim đồng hồ từ trục `+x` | góc là **radian** quanh trục `y`, **đảo dấu** |
 *
 * Dấu âm của góc không phải tuỳ tiện: `wall-system.js:828` dựng tường bằng
 * `setFromAxisAngle(yAxis, -atan2(end.z - start.z, end.x - start.x))`, nên một
 * góc mặt bằng θ của AppFront là `-θ` trong hệ của Pascal. Đồ đạc đi theo
 * đúng quy ước ấy để hai thứ không quay ngược nhau.
 *
 * ## Toạ độ của cửa đi và cửa sổ
 *
 * Ô mở là **con của tường**, và `position` của nó đo trong hệ của chính tường:
 * `[u, v, w]` với `u` là khoảng cách từ **đầu** trục tường (mesh tường đặt gốc
 * tại `start` — `wall-system.js:827`), `v` là chiều cao **tâm** ô mở so với
 * sàn tầng (`wall-system.js:1215` đọc `position[1] - height / 2` làm mép
 * dưới), `w` là độ lệch khỏi mặt phẳng giữa tường. AppFront lưu `offsetMm` là
 * mép **trái** và `sillHeightMm` là mép **dưới**, nên hai bên lệch nhau đúng
 * một nửa kích thước — `toPascal.ts` là nơi duy nhất quy đổi.
 */

import type { DataSource } from '@/domain/spatial/types';

/** Id một node trong cảnh Pascal, ví dụ `wall_W-WALL0010`. */
export type PascalNodeId = string;

/** Toạ độ mặt bằng của Pascal: `[x, z]`, mét. */
export type PascalPoint2 = readonly [number, number];

/** Toạ độ ba chiều của Pascal: `[x, y, z]`, mét, `y` hướng lên. */
export type PascalVec3 = readonly [number, number, number];

/**
 * Siêu dữ liệu của AppFront gắn vào node Pascal.
 *
 * Lược đồ Pascal khai `metadata` là "túi phẳng các thứ thêm của từng node"
 * (`schema/base.js`), và đây là đúng thứ nó dùng để chứa: những trường
 * AppFront có mà Pascal không có chỗ lưu — dấu xác minh, diện tích khai tay,
 * công năng phòng, loại tường.
 *
 * **Không có trường `id` ở đây, và đó là cố ý.** Id AppFront đã nằm trong
 * chính id của node (`wall_W-WALL0010`); chép nó thêm một lần nữa là tạo ra
 * hai nguồn sự thật có thể cãi nhau, và lượt về sẽ phải chọn một trong hai.
 */
export interface AppFrontOrigin {
  /** Độ tin cậy `[0, 1]` của bản ghi gốc. */
  readonly confidence: number;
  /** Dữ liệu đến từ mô hình AI hay từ người. */
  readonly source: DataSource;
  /**
   * Dấu "đã xác minh" của bản ghi gốc.
   *
   * **A5 sống hay chết ở đây.** Cờ này chỉ được tin khi id của node dịch ngược
   * được thành một id AppFront hợp lệ — tức node đó do chính AppFront viết ra.
   * Node Pascal tự đẻ mang id nanoid, không qua được phép kiểm, và luôn quay
   * về `reviewed: false`. Xem `toSpatial.ts`.
   */
  readonly reviewed: boolean;
  /** Trường riêng của từng loại mà lược đồ Pascal không có chỗ chứa. */
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** Túi siêu dữ liệu của một node; `appfront` là phần AppFront sở hữu. */
export interface PascalMetadata {
  readonly appfront?: AppFrontOrigin;
  readonly [key: string]: unknown;
}

/** Phần mọi node Pascal đều có (`schema/base.js`). */
interface PascalNodeCommon {
  readonly object: 'node';
  readonly id: PascalNodeId;
  readonly parentId: PascalNodeId | null;
  readonly name?: string;
  /** `false` = Pascal không vẽ node (mặc định hiện). */
  readonly visible?: boolean;
  readonly metadata?: PascalMetadata;
}

/**
 * Khu đất — gốc của cây cảnh.
 *
 * `polygon` **bắt buộc**, dù lược đồ khai nó `.optional().default(...)`. Lý do:
 * đường chạy thật nạp cảnh bằng `setScene`, mà `setScene` **không** parse qua
 * zod — nên mặc định của lược đồ không bao giờ được áp. Thiếu nó thì bộ vẽ khu
 * đất trả `null` và **cả cây con biến mất, im lặng**
 * (`nodes/dist/site/renderer.js:293`). Mặc định của lược đồ cũng không dùng
 * được: nó là ô vuông 30×30 quanh gốc, nhỏ hơn nhiều công trình thật.
 */
export interface PascalSiteNode extends PascalNodeCommon {
  readonly type: 'site';
  readonly children: readonly PascalNodeId[];
  readonly polygon: {
    readonly type: 'polygon';
    readonly points: readonly PascalPoint2[];
  };
}

/**
 * Công trình; con của khu đất, cha của các tầng.
 *
 * `position` và `rotation` **bắt buộc**, cùng một lý do như `polygon` ở trên:
 * bộ vẽ đọc thẳng `node.rotation[0]` (`nodes/dist/building/renderer.js`), nên
 * thiếu chúng là **ném lỗi** và ranh giới lỗi của viewer nuốt mất.
 */
export interface PascalBuildingNode extends PascalNodeCommon {
  readonly type: 'building';
  readonly children: readonly PascalNodeId[];
  readonly position: PascalVec3;
  readonly rotation: PascalVec3;
}

/**
 * Tầng.
 *
 * `level` là số thứ tự để xếp chồng, `height` là chiều cao tầng (m), và
 * `baseElevation` là **phần cộng thêm** vào vị trí xếp chồng tính được chứ
 * không phải cao độ tuyệt đối (`services/storey.js:41-73`). `toPascal.ts`
 * tính phần cộng thêm ấy sao cho cao độ ra đúng bằng cao độ AppFront lưu.
 */
export interface PascalLevelNode extends PascalNodeCommon {
  readonly type: 'level';
  readonly children: readonly PascalNodeId[];
  readonly level: number;
  readonly baseElevation: number;
  readonly height: number;
}

/** Tường; con của tầng, cha của các ô mở. */
export interface PascalWallNode extends PascalNodeCommon {
  readonly type: 'wall';
  readonly children: readonly PascalNodeId[];
  readonly start: PascalPoint2;
  readonly end: PascalPoint2;
  /** Sagitta có dấu (m) của tường cong (`wall-curve.ts`); vắng = thẳng. */
  readonly curveOffset?: number;
  readonly thickness: number;
  readonly height: number;
  /**
   * Mặt trước (phía pháp tuyến `perp(end - start)`) / mặt sau quay vào nhà hay ra ngoài
   * (`wall.ts:301`, mặc định `unknown`). Quyết định mặt nào nhận khe `exterior`
   * (`wall-system.tsx` `getWallFaceMaterialIndex`) và bức nào `cutaway` được ẩn.
   */
  readonly frontSide?: 'interior' | 'exterior';
  readonly backSide?: 'interior' | 'exterior';
  /** Vật liệu từng mặt (`interior`/`exterior`), tham chiếu `scene:`/`library:` — `sceneDressing.ts`. */
  readonly slots?: Readonly<Record<string, string>>;
  readonly skirting?: PascalWallTrim;
  readonly crown?: PascalWallTrim;
}

export type PascalWallTrimProfile = 'flat' | 'bevel' | 'triangle' | 'cove' | 'bullnose' | 'base-modern' | 'crown-cove';

/** `WallTrimConfig` của Pascal (`core/src/schema/nodes/wall.ts`), mọi trường khai đủ. */
export interface PascalWallTrim {
  readonly enabled: boolean;
  readonly sides: 'interior' | 'exterior' | 'both';
  readonly height: number;
  readonly proud: number;
  /** `WallTrimProfile` của Pascal; mặc định trong nhà: len `base-modern`, phào trần `crown-cove` (vòng 4). */
  readonly profile: PascalWallTrimProfile;
  /** Cỡ riêng mặt ngoài (thêm bởi scripts/realism/r9u-skirt-sides.mjs); thiếu = như mặt trong. */
  readonly exterior?: { readonly height: number; readonly proud: number; readonly profile: PascalWallTrimProfile };
}

/**
 * Cửa đi; con của tường, `position` trong hệ toạ độ của tường.
 *
 * `rotation` khai tường minh vì lược đồ để nó `.default([0,0,0])` mà đường
 * chạy thật (`setScene`) không parse — xem chú thích của `PascalSiteNode`.
 */
export interface PascalDoorNode extends PascalNodeCommon {
  readonly type: 'door';
  readonly wallId: PascalNodeId;
  readonly position: PascalVec3;
  readonly rotation: PascalVec3;
  readonly width: number;
  readonly height: number;
  readonly leafCount?: 1 | 2 | 3 | 4;
  readonly hingesSide?: 'left' | 'right';
  /** Tập con `DoorType` AppFront ghi/đọc; Pascal còn french/barn/garage-* (lượt về đọc lỏng). */
  readonly doorType?: 'hinged' | 'double' | 'sliding' | 'pocket' | 'folding';
  /** Cửa lùa/âm tường: lùa về bên nào (`door.ts`, mặc định `left`). */
  readonly slideDirection?: 'left' | 'right';
  /** `'opening'` = ô trống không cánh (vòm, lối thông). */
  readonly openingKind?: 'door' | 'opening';
  /** Góc mở cánh bản lề, radian 0..π/2. Cửa trượt không đọc. */
  readonly swingAngle?: number;
  readonly swingDirection?: 'inward' | 'outward';
  /** 0..1; chỉ cửa trượt/xếp/cuốn đọc, cửa bản lề đọc `swingAngle`. */
  readonly operationState?: number;
}

/** Cửa sổ; con của tường. Xem `PascalDoorNode` về `rotation`. */
export interface PascalWindowNode extends PascalNodeCommon {
  readonly type: 'window';
  readonly wallId: PascalNodeId;
  readonly position: PascalVec3;
  readonly rotation: PascalVec3;
  readonly width: number;
  readonly height: number;
  readonly openingKind?: 'window' | 'opening';
  readonly windowType?: 'fixed' | 'sliding' | 'casement';
  readonly casementStyle?: 'single' | 'french';
  readonly hingesSide?: 'left' | 'right';
  /** Vật liệu khung/kính (`frame`/`glass`), tham chiếu `library:`/`scene:` — `window.ts:34-37`. */
  readonly slots?: Readonly<Record<string, string>>;
}

/**
 * Tấm sàn của một phòng. Pascal tính diện tích sàn và đặt đồ từ node này.
 *
 * `zone` KHÔNG dựng ra mặt sàn — nó là khối không gian, không phải vật thể. Nên
 * một cảnh chỉ có `zone` thì nhìn xuống là thấy nền trời, và đó là điều đã xảy
 * ra ở bản đầu.
 *
 * **Mọi trường dưới đây khai đích danh, kể cả những trường lược đồ Pascal có
 * `.default()`.** `setScene` không parse qua zod nên mặc định không bao giờ được
 * áp — cùng cái bẫy đã ăn `site.polygon` và `building.rotation`. Xem
 * `__tests__/renderContract.test.ts`.
 */
export interface PascalSlabNode extends PascalNodeCommon {
  readonly type: 'slab';
  readonly polygon: readonly PascalPoint2[];
  readonly holes: readonly (readonly PascalPoint2[])[];
  readonly holeMetadata: readonly never[];
  /**
   * Mặt đi lại, mét trên mặt phẳng tầng. AppFront đặt **0** chứ không lấy 0,05
   * của lược đồ: tường và đồ đạc đều mọc từ 0, nên sàn dày xuống dưới 0 là thứ
   * duy nhất không chèn vào chân tường.
   */
  readonly elevation: number;
  /** Bề dày, mọc XUỐNG từ `elevation`; khối chiếm `[elevation − thickness, elevation]`. */
  readonly thickness: number;
  readonly recessed: boolean;
  readonly autoFromWalls: boolean;
  /**
   * Vật liệu của từng mặt sàn, theo mô hình khe của Pascal (`surface`, `side`).
   *
   * **Phải khai, và lý do đo được.** Mặc định của Pascal là
   * `SLAB_TOP_SLOT_DEFAULT = 'library:wood-woodplank48'`
   * (`nodes/src/slab/slots.ts`) — một mặt sàn gỗ mà repo Pascal **không commit**
   * bốn tệp `.ktx2` của nó. Tự host thì bốn lượt gọi ấy hỏng, mặt sàn ra không
   * vân, và **không gì đổ**: máy chủ dev trả `index.html` kèm mã 200, Pascal
   * nuốt lỗi phân tích trong bộ nạp texture của nó.
   *
   * Bản kê vật liệu trỏ tới 249 tệp `.ktx2` mà repo chỉ có 62 (17/65 vật liệu),
   * nên chọn bừa một cái tên là 74 % khả năng rơi vào lỗ. `concrete-polished`
   * nằm trong 17 cái có thật.
   */
  readonly slots: Readonly<Record<string, string>>;
}

/** Phòng. Pascal gọi là `zone`; `spaceRole: 'room'` mới là phòng kiến trúc. */
export interface PascalZoneNode extends PascalNodeCommon {
  readonly type: 'zone';
  readonly name: string;
  readonly polygon: readonly PascalPoint2[];
  readonly spaceRole: 'room';
  readonly boundaryWallIds: readonly PascalNodeId[];
  /** Công năng hiển thị (bảng "Diện tích phòng" nhóm theo nó); vắng thì Pascal để `''`. */
  readonly occupancy?: string;
  /** Chiều cao trần, mét; vắng thì Pascal mặc định 2,7. */
  readonly ceilingHeight?: number;
}

/**
 * Đồ đạc. Pascal gọi là `item`, và `asset` là trường **bắt buộc**.
 *
 * `asset.src` phải qua được `AssetUrl` (`schema/asset-url.js`), và
 * `asset://…` là dạng nội bộ mà lược đồ nhận — AppFront không có mô hình GLB
 * cho đồ đạc nên nó dùng đúng dạng ấy làm chỗ giữ chỗ.
 */
export interface PascalItemNode extends PascalNodeCommon {
  readonly type: 'item';
  readonly position: PascalVec3;
  readonly rotation: PascalVec3;
  /**
   * Tỉ lệ sửa của mô hình. **Bắt buộc phải có**, không để lược đồ tự điền:
   * `getScaledDimensions` (`core/schema/nodes/item.ts:210`) bung mảng này bằng
   * `const [sx, sy, sz] = item.scale` — thiếu nó là `TypeError` giữa lượt render,
   * và ranh giới lỗi của Pascal nuốt trọn cả món đồ.
   */
  readonly scale: PascalVec3;
  /** Đè vật liệu khe `slot_*` của mô hình (khoá = tên khe) — `itemSlotsOf` ở `sceneDressing.ts`. */
  readonly slots?: Readonly<Record<string, string>>;
  readonly asset: {
    readonly id: string;
    readonly category: string;
    readonly name: string;
    readonly thumbnail: string;
    readonly src: string;
    readonly dimensions: PascalVec3;
    /** Dời/xoay/tỉ lệ của riêng mô hình GLB trong nhóm của món đồ (`nodes/item/renderer.tsx:718-725`). */
    readonly offset?: PascalVec3;
    readonly rotation?: PascalVec3;
    readonly scale?: PascalVec3;
    /** Chỗ gắn của mô hình; đèn trần sinh ra mang `'ceiling'` (`sceneDressing.ts`). */
    readonly attachTo?: 'wall' | 'wall-side' | 'ceiling';
    /** Đèn âm trần: lún vào mặt trần thay vì treo dưới nó. */
    readonly recessed?: boolean;
    /** Khối điều khiển + hiệu ứng (đèn) của Pascal, chép nguyên từ bảng mô hình. */
    readonly interactive?: unknown;
  };
}

/**
 * Trần của một phòng; con của tầng. `height` vắng = theo đỉnh tầng
 * (`core/schema/nodes/ceiling.ts`). `children` là id các đèn gắn trần.
 */
export interface PascalCeilingNode extends PascalNodeCommon {
  readonly type: 'ceiling';
  readonly children: readonly PascalNodeId[];
  readonly polygon: readonly PascalPoint2[];
  readonly holes: readonly (readonly PascalPoint2[])[];
  readonly holeMetadata: readonly never[];
  readonly autoFromWalls: boolean;
  readonly slots: Readonly<Record<string, string>>;
}

/**
 * Trục định vị; con của tầng. `start`/`end` là toạ độ mặt bằng (m) cùng hệ với tường.
 * `label` của lược đồ Pascal dài 1–12 ký tự; nhãn gốc đầy đủ nằm ở `metadata.appfront.fields`.
 */
export interface PascalStructuralGridNode extends PascalNodeCommon {
  readonly type: 'structural-grid';
  readonly start: PascalPoint2;
  readonly end: PascalPoint2;
  readonly label: string;
  readonly showStartBubble: boolean;
  readonly showEndBubble: boolean;
}

/**
 * Thang (`core/schema/nodes/stair.ts`); con của tầng. Ghi ĐỦ mọi trường lược đồ vì
 * `setScene` không áp mặc định zod. `position` = chân thang (đầu bậc thấp nhất), thân
 * thang chạy theo +z cục bộ sau khi xoay `rotation` quanh `y` (`stair-system.tsx:209-210`).
 */
export interface PascalStairNode extends PascalNodeCommon {
  readonly type: 'stair';
  readonly children: readonly PascalNodeId[];
  readonly position: PascalVec3;
  readonly rotation: number;
  readonly stairType: 'straight';
  readonly fromLevelId: PascalNodeId | null;
  readonly toLevelId: PascalNodeId | null;
  readonly slabOpeningMode: 'none';
  readonly openingOffset: number;
  readonly width: number;
  readonly totalRise: number;
  readonly stepCount: number;
  readonly thickness: number;
  readonly fillToFloor: boolean;
  readonly innerRadius: number;
  readonly sweepAngle: number;
  readonly topLandingMode: 'none';
  readonly topLandingDepth: number;
  readonly showCenterColumn: boolean;
  readonly showStepSupports: boolean;
  readonly railingMode: 'none' | 'left' | 'right' | 'both';
  readonly railingHeight: number;
  readonly treadMaterialPreset: string;
  readonly sideMaterialPreset: string;
}

/** Một đoạn thang (`core/schema/nodes/stair-segment.ts`); con của thang, id `sseg_…`. */
export interface PascalStairSegmentNode extends PascalNodeCommon {
  readonly type: 'stair-segment';
  readonly position: PascalVec3;
  readonly rotation: number;
  readonly segmentType: 'stair';
  readonly width: number;
  readonly length: number;
  readonly height: number;
  readonly stepCount: number;
  readonly attachmentSide: 'front';
  readonly fillToFloor: boolean;
  readonly thickness: number;
}

/** Một node bất kỳ trong số các loại AppFront viết ra. */
/**
 * Mái (`core/schema/nodes/roof.ts`), id `roof_…`. AppFront không đọc hình học mái: node đi
 * nguyên dạng qua `Roof.nodes` (`roofs.ts`), nên ở đây chỉ khai phần cây; các trường
 * khác vẫn có mặt lúc chạy (đọc qua `Record<string, unknown>`).
 */
export interface PascalRoofNode extends PascalNodeCommon {
  readonly type: 'roof';
  readonly children: readonly PascalNodeId[];
}

/** Một mặt mái (`core/schema/nodes/roof-segment.ts`), id `rseg_…`; con của `roof`. */
export interface PascalRoofSegmentNode extends PascalNodeCommon {
  readonly type: 'roof-segment';
  readonly children: readonly PascalNodeId[];
}

export type PascalNode =
  | PascalSiteNode
  | PascalBuildingNode
  | PascalLevelNode
  | PascalWallNode
  | PascalDoorNode
  | PascalWindowNode
  | PascalZoneNode
  | PascalSlabNode
  | PascalItemNode
  | PascalCeilingNode
  | PascalStructuralGridNode
  | PascalStairNode
  | PascalStairSegmentNode
  | PascalRoofNode
  | PascalRoofSegmentNode;

/** Loại node AppFront viết ra, đọc từ chính hợp trên. */
export type PascalNodeType = PascalNode['type'];

/**
 * Cảnh Pascal như tệp JSON của nó: bảng node phẳng cộng danh sách gốc.
 *
 * Đây đúng là hình dạng `{ nodes, rootNodeIds }` mà `validateBuildJson` và
 * `setScene` của Pascal nhận (`core/dist/validation/validate-build-json.d.ts`).
 */
export interface PascalScene {
  readonly nodes: Readonly<Record<PascalNodeId, PascalNode>>;
  readonly rootNodeIds: readonly PascalNodeId[];
  /** Vật liệu riêng của cảnh, khoá theo `id` — đúng hình `extra.materials` của `setScene`. */
  readonly materials?: Readonly<Record<string, PascalSceneMaterial>>;
}

/** `SceneMaterial` của Pascal (`core/src/schema/scene-material.ts`): màu phẳng, không texture. */
export interface PascalSceneMaterial {
  readonly id: `mat_${string}`;
  readonly name: string;
  readonly material: {
    readonly preset: 'custom';
    readonly properties: {
      readonly color: string;
      readonly roughness: number;
      readonly metalness: number;
      readonly opacity: number;
      readonly transparent: boolean;
      readonly side: 'front' | 'back' | 'double';
    };
  };
}

/** Một đối tượng AppFront không chuyển được, kèm lý do đọc được bằng tiếng Việt. */
export interface SkippedEntity {
  /** Id phía AppFront. */
  readonly id: string;
  /** Loại đối tượng, bằng tiếng Việt. */
  readonly kind: string;
  /** Vì sao nó không sang Pascal được. Một câu, chữ thường, kiểu câu (A6). */
  readonly reason: string;
}

/** Kết quả một lượt đổi AppFront → Pascal. */
export interface PascalSceneResult {
  readonly scene: PascalScene;
  /** Mọi đối tượng bị bỏ qua, theo thứ tự của đồ thị. Không bao giờ là `null`. */
  readonly skipped: readonly SkippedEntity[];
}
