/**
 * Dữ liệu tự tạo cho `pascal-stability.spec.ts`: thư viện máy chủ nhiều mẫu + concept AI đã xong.
 * Hình dạng đúng như API thật (`LibraryItemSchema`, `DesignConceptStateSchema` ở `src/api/schemas`); GLB trỏ về
 * các mẫu đóng gói sẵn trong `public/pascal/items` nên không cần tệp mới.
 */

type Group = 'table' | 'chair' | 'bed' | 'sofa' | 'storage' | 'sanitary' | 'kitchen' | 'technical' | 'decor';

/** [thư mục GLB đóng gói, nhóm]: 24 mẫu, đủ 9 nhóm. */
const MODELS: readonly (readonly [string, Group])[] = [
  ['coffee-table', 'table'], ['bedside-table', 'table'], ['bedside-table-ph', 'table'],
  ['armchair-ph', 'chair'], ['coat-rack', 'chair'],
  ['bed-sf', 'bed'], ['bunkbed', 'bed'],
  ['sofa', 'sofa'], ['armchair-ph', 'sofa'],
  ['closet-gen', 'storage'], ['bookshelf', 'storage'], ['bookshelf-ph', 'storage'],
  ['bathroom-sink', 'sanitary'], ['bathtub', 'sanitary'],
  ['coffee-machine', 'kitchen'], ['ball', 'kitchen'],
  ['ac-block', 'technical'], ['air-conditioning', 'technical'], ['ceiling-fan', 'technical'], ['alarm-keypad', 'technical'],
  ['cactus', 'decor'], ['bush', 'decor'], ['ceramic-vase', 'decor'], ['books', 'decor'],
];

/** GLB của mục thư viện mà concept chọn cho vai tủ áo (`closet`); không vai nào khác dựng ra nó. */
export const CONCEPT_FOLDER = 'closet-gen';
/**
 * Mục thư viện concept chọn cho vai tủ áo. Từ vòng 16 concept không còn là ghim: chỉ áp khi qua ràng buộc chất lượng /
 * an toàn của món. Mục tự tạo `e2e-lib-NN` không có dữ liệu chất lượng (`libraryQuality.json`) và cỡ 0,75 × 0,70 × 0,80 m
 * méo trong hộp tủ áo 1,7 × 0,6 m của F1 → bị loại đúng luật. Concept HỢP LỆ = id mục thật có dữ liệu chất lượng
 * (`wardrobe-pro`) với cỡ thật của nó; GLB vẫn là `closet-gen` đóng gói.
 */
const CONCEPT_CLOSET = { id: 'wardrobe-pro', widthMm: 1166, heightMm: 2098, depthMm: 511 } as const;

export const richLibraryBody = (requestUrl: string): unknown[] =>
  MODELS.map(([folder, group], index) => ({
    depthMm: 400 + (index % 5) * 100,
    fileSizeBytes: 10_000 + index,
    group,
    heightMm: 500 + (index % 7) * 100,
    id: `e2e-lib-${String(index).padStart(2, '0')}`,
    modelUrl: new URL(`/pascal/items/${folder}/model.glb`, requestUrl).href,
    name: `Mẫu thử ${index + 1}`,
    source: 'catalogue',
    triangleCount: 1_000 + index,
    widthMm: 600 + (index % 4) * 150,
    ...(folder === CONCEPT_FOLDER ? CONCEPT_CLOSET : {}),
  }));
/**
 * Tệp mặc định của vai `closet` (hai tủ áo variant `wardrobe` của F1): thư mục `closet` qua swap realism
 * (`REALISM_MODEL_SWAP`) thành `wardrobe-sf`. Concept áp → không còn trong cảnh; không áp → luôn có.
 */
export const DEFAULT_CLOSET_FILE = 'wardrobe-sf';
const conceptClosetId = CONCEPT_CLOSET.id;

/**
 * Mẫu concept chọn theo vai. Như máy chủ thật (Design Director chỉ chọn mục thư viện đã công bố), vai tủ áo dùng
 * id mục thư viện; `modelFolderOf` bỏ id đóng gói ngoài danh mục của vai (vd. `closet-gen` cho `closet`) — các vai
 * khác giữ id đóng gói chỉ để đủ khoá của schema.
 */
const ROLE_MODELS = {
  doubleBed: 'bed-sf', singleBed: 'bed-sf', closet: conceptClosetId, dresser: 'dresser', bookshelf: 'bookshelf', diningChair: 'armchair-ph',
  armchair: 'armchair-ph', sofa: 'sofa', nightstand: 'bedside-table', coffeeTable: 'coffee-table', desk: 'coffee-table',
  diningTable: 'coffee-table', fridge: 'fridge', counter: 'kitchen-cabinet', toilet: 'bathroom-sink', bathtub: 'bathtub', shower: 'bathtub',
  basin: 'bathroom-sink', washer: 'washing-machine', plant: 'bush', smallPlant: 'cactus', rug: 'books', roundRug: 'books',
};

const STAMP = '2026-11-01T00:00:00.000Z';

/** Thân `GET /api/projects/:id/design-concept` với concept đã xong. */
export const conceptState = (): unknown => ({
  enabled: true,
  suggestedStyleId: 'japandi',
  active: {
    id: 'dcn_e2e0001',
    styleId: 'japandi',
    suggested: false,
    status: 'done',
    createdAt: STAMP,
    startedAt: STAMP,
    endedAt: STAMP,
    result: {
      nameVi: 'Japandi thử',
      summaryVi: 'Phong cách thử cho e2e ổn định.',
      baseStyle: 'toi-gian',
      wall: { interior: 'library:paint-cream' },
      floor: { wood: 'library:wood-oak' },
      models: ROLE_MODELS,
      additions: [],
    },
  },
});
