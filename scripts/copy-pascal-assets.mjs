/**
 * Đặt tài sản mà màn Pascal cần vào `public/`, để không lượt chạy nào đi xin CDN ngoài.
 *
 * Đo ngày 2026-09-28 trên một cảnh AppFront **vẽ thật** trong Chromium: viewer gửi
 * **10 yêu cầu ra ngoài**, tới hai đích khác nhau.
 *
 *   1. `https://editor.pascal.app/material/…` — bốn tệp `.ktx2` của vật liệu vữa mặc
 *      định (basecolor, normal, roughness, ao). Pascal ghép URL bằng
 *      `` `${ASSETS_CDN_URL}${path}` `` (`viewer/src/lib/asset-url.ts`), và
 *      `ASSETS_CDN_URL` mặc định là chính CDN ấy. Script này chép thư mục vật liệu
 *      vào `public/pascal/`, còn `vite.config.ts` đặt `NEXT_PUBLIC_ASSETS_CDN_URL`
 *      thành `/pascal` để đường ghép trỏ về chính mình.
 *
 *      **Chuỗi rỗng KHÔNG tắt được CDN**: dòng khai là `process.env.X || '<CDN>'`, và
 *      `''` là falsy nên nó rơi thẳng về mặc định. Phải đặt một đường dẫn thật.
 *
 *   2. `https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/` — bộ giải Basis
 *      mà `viewer/src/lib/ktx2-loader.ts` khai cứng; lúc build `scripts/pascal-self-host.mjs` đổi đường ấy thành `/basis/`.
 *      Nguồn KHÔNG phải bản `three` đóng gói: bản ấy dựng mã bằng `Function` (embind)
 *      và ném EvalError dưới CSP thật (FIX-380). Chép bản dựng lại không eval ở
 *      `vendor/basis/` — cùng tag, cách dựng ở `vendor/basis/NGUON.md`.
 *
 * Cả hai đều là vi phạm `connect-src` của CSP, và cả hai đều để lộ hoạt động người
 * dùng cho bên thứ ba. Chúng **không** nằm trong danh sách 4 vi phạm đã đóng trước
 * đây — lần đo ấy chạy trên một cảnh chưa vẽ được nên chưa đòi tệp nào.
 *
 * Cùng khuôn với `copy-draco.mjs`: thư mục đích được gitignore, nguồn là tệp đã có
 * trong repo hoặc trong `node_modules`, và lệnh chạy lại được bất cứ lúc nào bằng
 * `pnpm pascal:assets`. Chạy lại sau mỗi lần nâng `three` hoặc đổi tài sản Pascal.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

import { LIBRARY_MATERIALS, WEBP_MATERIAL_IDS, roleOf, sourceFor, webpPathOf } from './pascal-material-webp.mjs';
import { R5_MATERIALS, ROLES as R5_ROLES, mapPath as r5MapPath, sourceOf as r5SourceOf, thumbPath as r5ThumbPath } from './realism/r5-materials.mjs';

// `packages/` là upstream nguyên vẹn (không fork, không vá — xem `vendor/pascal/NGUON.md`):
// upstream nạp Draco từ gstatic (CSP chặn mọi máy ngoài), nên lúc build
// `scripts/pascal-self-host.mjs` đổi đường ấy sang `/draco/` trong bản dựng, không sửa nguồn.
// Mặc định của chính drei (`useGLTF(p, true)`) vẫn là gstatic — cổng
// `check-bundle-size.mjs` (`findOffMachineHosts`) bắt chỗ nào còn sót.
//
// Nhập để lấy TÁC DỤNG PHỤ: `copy-draco.mjs` chép bộ giải vào `public/draco/`
// để đường ấy có thật. Import được nâng lên đầu, nên lượt chép Draco chạy TRƯỚC
// thân tệp này; hai lượt độc lập, thứ tự không quan trọng.
import './copy-draco.mjs';

/** Vật liệu của Pascal: nguồn nằm trong repo, ở thư mục mã đã chép về. */
const MATERIAL_SOURCE = join('vendor', 'pascal', 'assets', 'material');
const MATERIAL_TARGET = join('public', 'pascal', 'material');

/** Bộ giải Basis dựng lại với `-sDYNAMIC_EXECUTION=0` — xem `vendor/basis/NGUON.md`. */
const BASIS_SOURCE = join('vendor', 'basis');
const BASIS_TARGET = join('public', 'basis');

/** Chỉ cần bộ giải; `NGUON.md` và bài so khớp đi kèm không phục vụ lượt chạy nào. */
const BASIS_WANTED = /^basis_transcoder\.(js|wasm)$/;

/**
 * Bản kê vật liệu của Pascal — nguồn duy nhất nói tệp nào SẼ được gọi lúc chạy.
 *
 * Đo ngày 2026-09-29: bản kê trỏ tới **249** tệp `.ktx2`, repo chỉ commit **62**
 * (17 trong 65 vật liệu). 187 tệp còn lại sống trên CDN của Pascal, và tự host
 * mà không đối chiếu thì chúng thành **404 trong im lặng** — đúng thứ đã xảy ra
 * với `woodplank_48`: bốn lượt gọi hỏng, mặt gỗ ra không có vân, không một dòng
 * báo nào. Lượt chép nay nói ra con số ấy.
 */
const LIBRARY_SOURCE = join('vendor', 'pascal', 'packages', 'core', 'src', 'material-library.ts');

/**
 * Chỉ chép thứ lúc chạy CÓ gọi tới.
 *
 * Đo trên một cảnh thật (`e2e/pascal-viewer.spec.ts`): 12 lượt gọi tài sản, cả
 * 12 đều là `.ktx2`. Không một lượt nào chạm `.webp` hay `.jpg` — chúng là ảnh
 * NGUỒN và ảnh xem trước của bảng chọn vật liệu, mà màn chỉ-xem không dựng bảng
 * ấy. Chép cả cụm là 17 330,7 KiB; chép đúng `.ktx2` là 6 526,4 KiB.
 *
 * Ngày nào mở phần sửa và bảng chọn vật liệu hiện ra, thêm `.webp` vào đây —
 * đừng gỡ dòng này đi mà không đo lại.
 */
const MATERIAL_WANTED = /\.ktx2$/;

/**
 * Biểu tượng ảnh của editor Pascal: mã gốc viết `<img src="/icons/x.webp">` (đường tuyệt đối
 * của app Next gốc), nên tệp phải nằm đúng ở `/icons/`. Chép TẤT CẢ (kể cả `fittings/` và
 * `scene.webp`): trang 3D riêng dùng nguyên giao diện gốc, thiếu tệp nào là nút ấy thành ảnh vỡ.
 */
const ICON_SOURCE = join('vendor', 'pascal', 'assets', 'icons');
const ICON_TARGET = join('public', 'icons');
/**
 * Cạnh dài tối đa của biểu tượng `.webp` khi chép. Nguồn upstream là 500–1 024 px (2 215 KiB), mà
 * editor vẽ chúng ở 14–28 px (`width={14|28}`). 256 px vẫn dư gấp 9 lần ở 28 px trên màn 1x
 * và hơn 4 lần trên màn 2x; đo 2026-10-27: 2 215 → 549 KiB, tài sản Pascal là cổng đang vượt.
 */
const ICON_MAX_PX = 256;

/** Âm thanh thao tác của editor gốc: `/audios/sfx/*.mp3` (từ `apps/editor/public/audios`). */
const AUDIO_SOURCE = join('vendor', 'pascal', 'assets', 'audios');
const AUDIO_TARGET = join('public', 'audios');

/**
 * Thư viện đồ đạc của editor (QA-05c B4): `catalog-items.tsx` ghi `/items/<mẫu>/{model.glb,thumbnail.webp}`,
 * `resolveCdnUrl` ghép thành `/pascal/items/…`. Bản gốc trỏ supabase.co của Pascal — CSP chặn, 111 ảnh vỡ
 * (`scripts/pascal-catalog-local.mjs` trỏ catalog về đây lúc build, không sửa `packages/`).
 * Nguồn: `apps/editor/public/items` của `F:/pascal-editor`, chỉ 100 thư mục mà 101 mẫu catalog dùng (200 tệp, 2 010 KiB).
 */
const ITEMS_SOURCE = join('vendor', 'pascal', 'assets', 'items');
const ITEMS_TARGET = join('public', 'pascal', 'items');
/** Mẫu của AppFront (không thuộc catalog Pascal): `scripts/gen-decor-models.mjs` sinh ra, giấy phép ở LICENSES.md. */
const APPFRONT_ITEMS_SOURCE = join('assets', 'appfront-items');

/** Đếm đệ quy, để dòng tổng kết nói được số thật chứ không nói "xong". */
const countFiles = (dir) => {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    total += statSync(path).isDirectory() ? countFiles(path) : 1;
  }
  return total;
};

/** Mọi tệp dưới `dir`, đường dẫn tương đối so với chính nó. */
const walk = (dir, prefix = '') => {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(path).isDirectory()) found.push(...walk(path, rel));
    else found.push(rel);
  }
  return found;
};

/*
 * Dọn đích TRƯỚC khi chép. Lượt chép chỉ ghi đè, không xoá, nên một tệp bị gỡ
 * khỏi `vendor/` vẫn nằm lại ở đích mãi mãi — và cổng vách ngăn quét đệ quy nên
 * nó SẼ đếm phần rác ấy. `01-ho-so-cong-T4.1.md` đã ghi đúng cái bẫy này: một
 * lượt dựng xếp chồng làm số đo lệch 29 % trong im lặng.
 */
const library = readFileSync(LIBRARY_SOURCE, 'utf8');

/*
 * Vật liệu trong `WEBP_MATERIAL_IDS` (rút từ bản kê: thiếu `.ktx2` mà có ảnh nguồn) dùng `.webp` 512
 * sinh từ ảnh nguồn trong `vendor/pascal/assets/material/**`; `pascal-material-local.mjs` đổi đường
 * dẫn map của đúng các id ấy sang `.webp` lúc build (viewer nạp đuôi khác `.ktx2` bằng TextureLoader).
 */
const WEBP_IDS = new Set(WEBP_MATERIAL_IDS);
const webpMaps = LIBRARY_MATERIALS.filter(({ id }) => WEBP_IDS.has(id)).flatMap(({ maps }) => maps);

/*
 * Ảnh xem trước của bảng chọn vật liệu (L8): bản kê trỏ 63 `…_thumb.webp`, repo chỉ có một phần.
 * Có sẵn thì chép; thiếu thì dựng 128 px từ ảnh basecolor nguồn (hoặc `.ktx2`-vắng → ảnh nguồn webp).
 */
const thumbJobs = LIBRARY_MATERIALS.filter(({ thumb }) => thumb !== undefined).map(({ id, thumb, maps }) => {
  const own = join('vendor', 'pascal', 'assets', thumb);
  const albedo = maps.find((map) => roleOf(map) === 'basecolor');
  let source = own;
  if (!existsSync(own)) {
    if (albedo === undefined) throw new Error(`copy-pascal-assets: ${id} thiếu ảnh xem trước và không có map basecolor`);
    source = sourceFor(albedo);
  }
  return { rel: thumb.replace('/material/', ''), source, copy: source === own };
});

/** Đường `.webp` tương đối so với MATERIAL_TARGET — lượt dọn dưới đây giữ lại chúng. */
/*
 * Vật liệu mới của R5 (editor-realism GĐ5): ảnh nguồn CC0 ở `vendor-extra/materials/<id>/`, luật
 * `scripts/realism/r5-materials.mjs` chèn mục vào thư viện lúc dựng. Dựng webp 512 + ảnh xem trước 128.
 */
const r5Jobs = R5_MATERIALS.flatMap(({ id }) => [
  ...Object.keys(R5_ROLES).map((role) => ({ rel: r5MapPath(id, role).replace('/material/', ''), source: r5SourceOf(id, role), size: 512, cover: false, normal: role === 'normal' })),
  { rel: r5ThumbPath(id).replace('/pascal/material/', ''), source: r5SourceOf(id, 'basecolor'), size: 128, cover: true, normal: false },
]);

const webpTargets = new Set([
  ...r5Jobs.map((job) => job.rel),
  ...webpMaps.map((map) => webpPathOf(map).replace('/material/', '')),
  ...thumbJobs.filter((job) => !job.copy).map((job) => job.rel),
]);

// Dọn mọi thứ trừ `.webp` đã sinh (map + ảnh xem trước): giữ để lượt sau bỏ qua tệp còn mới hơn ảnh nguồn.
if (existsSync(MATERIAL_TARGET)) {
  for (const rel of walk(MATERIAL_TARGET)) {
    if (!webpTargets.has(rel)) rmSync(join(MATERIAL_TARGET, rel), { force: true });
  }
}
mkdirSync(MATERIAL_TARGET, { recursive: true });

let materialCount = 0;
for (const rel of walk(MATERIAL_SOURCE)) {
  if (!MATERIAL_WANTED.test(rel)) continue;
  const target = join(MATERIAL_TARGET, rel);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(MATERIAL_SOURCE, rel), target);
  materialCount += 1;
}

let webpMade = 0;
let webpBytes = 0;
for (const map of webpMaps) {
  const source = sourceFor(map);
  const target = join('public', 'pascal', webpPathOf(map));
  if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs) {
    mkdirSync(dirname(target), { recursive: true });
    await sharp(source)
      .resize(512, 512, { fit: 'fill' })
      .webp({ quality: roleOf(map) === 'normal' ? 90 : 80 })
      .toFile(target);
    webpMade += 1;
  }
  webpBytes += statSync(target).size;
}

let thumbCopied = 0;
let thumbMade = 0;
for (const { rel, source, copy } of thumbJobs) {
  const target = join(MATERIAL_TARGET, rel);
  mkdirSync(dirname(target), { recursive: true });
  if (copy) {
    copyFileSync(source, target);
    thumbCopied += 1;
  } else if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs) {
    await sharp(source).resize(128, 128, { fit: 'cover' }).webp({ quality: 80 }).toFile(target);
    thumbMade += 1;
  }
}
let r5Made = 0;
for (const { rel, source, size, cover, normal } of r5Jobs) {
  const target = join(MATERIAL_TARGET, rel);
  if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) continue;
  mkdirSync(dirname(target), { recursive: true });
  await sharp(source).resize(size, size, { fit: cover ? 'cover' : 'fill' }).webp({ quality: normal ? 90 : 80 }).toFile(target);
  r5Made += 1;
}

const thumbPresent = thumbJobs.filter(({ rel }) => existsSync(join(MATERIAL_TARGET, rel))).length;

/*
 * Đối chiếu bản kê với thứ vừa chép. Không ném lỗi: 187 tệp thiếu là trạng thái
 * THẬT của repo Pascal, không phải hỏng cài đặt, và ném ở đây sẽ chặn cả `pnpm
 * dev`. Nhưng nó phải được NÓI RA — một con số in ra mỗi lượt dựng là thứ duy
 * nhất ngăn nó lại thành 404 không ai thấy.
 */
const referenced = [
  ...new Set(
    [...library.matchAll(/'(\/material\/[^']+\.ktx2)'/g)].map(
      (match) => match[1].replace('/material/', ''),
    ),
  ),
];
const missing = referenced.filter(
  (rel) => !existsSync(join(MATERIAL_TARGET, rel)) && !webpTargets.has(rel.replace(/\.ktx2$/, '.webp')),
);

rmSync(ITEMS_TARGET, { force: true, recursive: true });
cpSync(ITEMS_SOURCE, ITEMS_TARGET, { recursive: true });
// Đồ trang trí riêng của AppFront (FE3D-FIX-004 D): mẫu sinh/CC0 ở assets/appfront-items, chép cạnh đồ của Pascal.
cpSync(APPFRONT_ITEMS_SOURCE, ITEMS_TARGET, { recursive: true, filter: (src) => !src.endsWith('.md') });

rmSync(ICON_TARGET, { force: true, recursive: true });
cpSync(ICON_SOURCE, ICON_TARGET, { recursive: true, filter: (src) => !src.endsWith('.webp') });
let iconsResized = 0;
for (const rel of walk(ICON_SOURCE).filter((name) => name.endsWith('.webp'))) {
  const target = join(ICON_TARGET, rel);
  mkdirSync(dirname(target), { recursive: true });
  const { width = 0, height = 0 } = await sharp(join(ICON_SOURCE, rel)).metadata();
  if (Math.max(width, height) <= ICON_MAX_PX) {
    copyFileSync(join(ICON_SOURCE, rel), target);
    continue;
  }
  await sharp(join(ICON_SOURCE, rel)).resize(ICON_MAX_PX, ICON_MAX_PX, { fit: 'inside' }).webp({ quality: 85 }).toFile(target);
  iconsResized += 1;
}
rmSync(AUDIO_TARGET, { force: true, recursive: true });
cpSync(AUDIO_SOURCE, AUDIO_TARGET, { recursive: true });
// Phông nhúng của xuất PDF (luật `pdf-fonts` trong `pascal-self-host.mjs`), kèm giấy phép OFL.
cpSync(join('vendor', 'pascal', 'packages', 'editor', 'src', 'lib', 'floorplan', 'pdf-fonts'), join('public', 'pascal', 'pdf-fonts'), {
  recursive: true,
});
// Con trỏ của khung vẽ mặt bằng: `url('/cursor.svg')` trong `floorplan-panel.tsx`.
copyFileSync(join('vendor', 'pascal', 'assets', 'cursor.svg'), join('public', 'cursor.svg'));
// R4 (editor-realism): HDRI tự host cho chủ đề sáng (`src/pascal-page/realism/lighting.ts` HDRI_URL).
mkdirSync(join('public', 'pascal', 'hdri'), { recursive: true });
copyFileSync(join('vendor', 'pascal', 'assets', 'hdri', 'venice_sunset_1k.hdr'), join('public', 'pascal', 'hdri', 'venice-sunset-v1-1k.hdr'));
// Gói 2B: HDRI trời sáng có mây cho Ban ngày (Poly Haven CC0, `assets/hdri/LICENSE.md`; lighting.ts DAY_HDRI_URL).
copyFileSync(join('assets', 'hdri', 'kloofendal_48d_partly_cloudy_puresky_1k.hdr'), join('public', 'pascal', 'hdri', 'kloofendal-puresky-v1-1k.hdr'));
// M5-L3b `?lightx=env`: HDRI phòng trong nhà (Poly Haven `lebombo`, CC0; `lightx.ts` LIGHTX_ENV_URL).
copyFileSync(join('assets', 'hdri', 'lebombo_1k.hdr'), join('public', 'pascal', 'hdri', 'lebombo-v1-1k.hdr'));

mkdirSync(BASIS_TARGET, { recursive: true });
const basisCopied = readdirSync(BASIS_SOURCE).filter((name) => BASIS_WANTED.test(name));
for (const name of basisCopied) {
  copyFileSync(join(BASIS_SOURCE, name), join(BASIS_TARGET, name));
}

console.log(`Đã chép ${String(materialCount)} tệp vật liệu Pascal vào ${MATERIAL_TARGET}/`);
console.log(
  `Đã có ${String(webpMaps.length)} tệp .webp cho ${String(WEBP_MATERIAL_IDS.length)} vật liệu thiếu .ktx2 ` +
    `(sinh mới ${String(webpMade)}, ${(webpBytes / 1024).toFixed(1)} KiB)`,
);
console.log(
  `Ảnh xem trước vật liệu: ${String(thumbPresent)}/${String(thumbJobs.length)} ` +
    `(chép ${String(thumbCopied)}, sinh mới ${String(thumbMade)})`,
);
console.log(`Vật liệu R5: ${String(R5_MATERIALS.length)} mục, ${String(r5Jobs.length)} tệp .webp (sinh mới ${String(r5Made)})`);
console.log(`Đã chép ${String(countFiles(ITEMS_TARGET))} tệp thư viện đồ đạc vào ${ITEMS_TARGET}/`);

if (missing.length > 0) {
  const materials = [...new Set(missing.map((rel) => rel.split('/')[1]))];
  console.warn(
    `CẢNH BÁO: bản kê vật liệu trỏ tới ${String(referenced.length)} tệp .ktx2, ` +
      `THIẾU ${String(missing.length)} (${String(materials.length)} vật liệu). ` +
      'Repo Pascal chỉ commit một phần; phần còn lại sống trên CDN của họ. ' +
      'Cảnh nào dùng tới chúng sẽ nhận 404 và mất vân bề mặt. ' +
      `Vật liệu thiếu: ${materials.slice(0, 6).join(', ')}` +
      (materials.length > 6 ? ` … và ${String(materials.length - 6)} nữa.` : '.'),
  );
}
console.log(`Đã chép ${String(countFiles(ICON_TARGET))} biểu tượng vào ${ICON_TARGET}/ (thu về ${String(ICON_MAX_PX)} px: ${String(iconsResized)})`);
console.log(`Đã chép ${String(countFiles(AUDIO_TARGET))} tệp âm thanh vào ${AUDIO_TARGET}/`);
console.log(`Đã chép ${String(basisCopied.length)} tệp bộ giải Basis vào ${BASIS_TARGET}/: ${basisCopied.join(', ')}`);
