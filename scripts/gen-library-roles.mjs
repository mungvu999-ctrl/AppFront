/**
 * Bước "vai" của quy trình nhập thư viện chung (vòng 13): thêm mẫu MỚI vào `src/lib/pascal/libraryRoles.json` theo LUẬT
 * chung từ hồ sơ mẫu, rồi tính lại các trường dẫn xuất cho mọi mẫu (thay `F:/runs/m6/lC/gen-roles.mjs` ngoài repo).
 *
 *   node scripts/gen-library-roles.mjs --add <tệp id mới, mỗi dòng một id> [--profiles <profiles.jsonl>] [--files <files.json>] [--dry]
 *
 * - Mẫu ĐÃ có vai giữ nguyên vai (không phân loại lại — tránh đổi ngầm lựa chọn cũ).
 * - Chỉ xét id trong `--add` (gói vừa nhập). 50 mẫu cũ chưa có vai đã bị loại ở các vòng trước vì lạc cỡ/lạc vai (bbcf6f29),
 *   không tự thêm lại. Mẫu trong `--add` được thêm khi: id có trong `files.json` backend (đã nhập qua CLI), giấy phép CC0/CC-BY, `qc.ok`,
 *   `frontCheck === 'ok'`, không nằm trong `libraryQc.json` loại, và loại hồ sơ ánh xạ được (`ROLE_OF`). Giường: cạnh
 *   ngắn < SINGLE_BED_MAX_MM là giường đơn.
 * - Tính lại: `models[id]` = { s: phong cách, c: độ rực, t: tông gỗ l/d (theo vật liệu hồ sơ), h: họ màu của màu chiếm nhiều
 *   nhất } và `profiles` (p10/p50/p90 cỡ theo vai). Ghi lại nguồn/ngày vào `profilesSource`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const OUT = 'src/lib/pascal/libraryRoles.json';
const PROFILES = arg('profiles', 'F:/runs/library-profiles/profiles.jsonl');
const FILES = arg('files', 'F:/App/AppBack/packages/domain/library/files.json');
const DRY = process.argv.includes('--dry');
const ADD = arg('add');

/** Loại hồ sơ (type hoặc type/typeDetail) → vai. Chỉ vai đồ đứng sàn chọn theo bộ + phụ trợ đã có trong tệp. */
export const ROLE_OF = {
  sofa: 'sofa',
  armchair: 'armchair',
  diningTable: 'diningTable',
  diningChair: 'diningChair',
  wardrobe: 'closet',
  nightstand: 'nightstand',
  coffeeTable: 'coffeeTable',
  desk: 'desk',
  bookshelf: 'bookshelf',
  bed: 'bed',
  'other/dresser': 'dresser',
  'other/chestOfDrawers': 'dresser',
  'other/sideboard': 'dresser',
  'other/bench': 'bench',
  'other/ottoman': 'bench',
};
export const SINGLE_BED_MAX_MM = 1300;
export const SIZE_LO = 0.7;
export const SIZE_HI = 1.3;
/** Hồ sơ cỡ vai ít mẫu hơn chừng này (tủ áo: 5) quá hẹp để làm chuẩn lạc cỡ — bỏ kiểm. */
export const SIZE_MIN_N = 10;
/**
 * Hồ sơ RIÊNG của sofa góc/chữ L (hồ sơ `typeDetail === 'sectionalSofa'`, LSA vòng 18): không so với hồ sơ sofa thẳng (cạnh
 * ngắn p90 1069 mm → 22/23 mẫu L "lạc vai"). Cạnh ngắn ≥ 1,3 m = chân L thật (mẫu 3 chỗ gắn nhầm nhãn sectional sâu 1,06 m bị
 * loại), trần theo hộp góc AI lớn nhất đã gặp (2,38 m) và cạnh dài sofa góc phòng khách. Sofa góc KHÔNG vào hồ sơ cỡ vai
 * `profiles.sofa` (sceneRepair kẹp hộp sofa thẳng theo hồ sơ ấy).
 */
export const SECTIONAL_MM = { short: [1300, 2500], long: [1800, 3300] };
export const isSectional = (p) => p.typeDetail === 'sectionalSofa';
const LICENCES = /^(CC0|CC-BY)/;

export const familyOf = ([L, a, b]) => {
  const c = Math.hypot(a, b);
  if (c < 8) return L > 70 ? 'cream' : L < 35 ? 'black' : 'grey';
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return h < 30 ? 'red' : h < 75 ? 'brown' : h < 110 ? 'yellow' : h < 190 ? 'green' : h < 280 ? 'blue' : 'purple';
};
export const roleOfProfile = (p) => {
  const r = ROLE_OF[`${p.type}/${p.typeDetail}`] ?? ROLE_OF[p.type];
  if (r !== 'bed') return r;
  return Math.min(p.sizeMm.w, p.sizeMm.d) < SINGLE_BED_MAX_MM ? 'singleBed' : 'doubleBed';
};
export const admits = (p, inFiles, excluded) =>
  inFiles.has(p.id) && !excluded.has(p.id) && LICENCES.test(p.license ?? '') && p.qc?.ok === true && p.frontCheck === 'ok';

const main = () => {
  const R = JSON.parse(readFileSync(OUT, 'utf8'));
  const P = new Map(
    readFileSync(PROFILES, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((p) => [p.id, p]),
  );
  const files = JSON.parse(readFileSync(FILES, 'utf8'));
  const inFiles = new Set((Array.isArray(files) ? files : files.items).map((f) => f.id));
  const excluded = new Set(Object.keys(JSON.parse(readFileSync('src/lib/pascal/libraryQc.json', 'utf8')).excluded ?? {}));
  const known = new Set(Object.values(R.roles).flat());
  const added = {};
  const wanted = new Set(ADD === undefined ? [] : readFileSync(ADD, 'utf8').split(/\s+/).filter(Boolean));
  const rejected = [];
  for (const p of P.values()) {
    if (!wanted.has(p.id) || known.has(p.id)) continue;
    if (!admits(p, inFiles, excluded)) {
      rejected.push(`${p.id}: ${!inFiles.has(p.id) ? 'chưa có trong files.json' : p.qc?.ok !== true ? 'qc' : p.frontCheck !== 'ok' ? 'mặt trước' : 'giấy phép/loại QC'}`);
      continue;
    }
    const role = roleOfProfile(p);
    if (role === undefined) continue;
    // Cỡ hợp vai (bài học bbcf6f29: 35 mẫu lạc vai theo cỡ): cạnh dài/ngắn trong [SIZE_LO × p10; SIZE_HI × p90] của vai.
    const prof = R.profiles?.[role];
    const [lo, hi] = [Math.min(p.sizeMm.w, p.sizeMm.d), Math.max(p.sizeMm.w, p.sizeMm.d)];
    if (isSectional(p)) {
      if (role !== 'sofa' || lo < SECTIONAL_MM.short[0] || lo > SECTIONAL_MM.short[1] || hi < SECTIONAL_MM.long[0] || hi > SECTIONAL_MM.long[1]) {
        rejected.push(`${p.id}: cỡ ${lo}×${hi} mm lạc vai sofa góc`);
        continue;
      }
    } else if (prof !== undefined && prof.n >= SIZE_MIN_N && (hi < SIZE_LO * prof.long[0] || hi > SIZE_HI * prof.long[2] || lo < SIZE_LO * prof.short[0] || lo > SIZE_HI * prof.short[2])) {
      rejected.push(`${p.id}: cỡ ${lo}×${hi} mm lạc vai ${role}`);
      continue;
    }
    (R.roles[role] ??= []).push(p.id);
    (added[role] ??= []).push(p.id);
  }
  for (const ids of Object.values(R.roles)) ids.sort();
  // Trường dẫn xuất cho MỌI mẫu có vai.
  const models = { ...R.models };
  for (const id of [...new Set(Object.values(R.roles).flat())].sort()) {
    const p = P.get(id);
    if (p === undefined) continue;
    const wood = (p.materials ?? []).find((x) => x === 'wood_dark' || x === 'wood_light');
    models[id] = {
      s: p.styles ?? [],
      c: Math.round(p.chroma ?? 0),
      ...(wood === undefined ? {} : { t: wood === 'wood_dark' ? 'd' : 'l' }),
      ...(p.colors?.[0]?.lab ? { h: familyOf(p.colors[0].lab) } : {}),
    };
  }
  R.models = models;
  const q = (a, f) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))];
  };
  const FIT_ROLES = ['doubleBed', 'closet', 'dresser', 'bookshelf', 'diningChair', 'armchair', 'sofa', 'nightstand', 'coffeeTable', 'desk', 'diningTable', 'basin'];
  const profiles = {};
  for (const role of FIT_ROLES) {
    const ps = (R.roles[role] ?? []).map((id) => P.get(id)).filter((p) => p !== undefined && !isSectional(p));
    if (ps.length < 5) continue;
    const L = ps.map((p) => Math.max(p.sizeMm.w, p.sizeMm.d));
    const S = ps.map((p) => Math.min(p.sizeMm.w, p.sizeMm.d));
    const A = ps.map((p) => p.sizeMm.w / p.sizeMm.d);
    profiles[role] = { n: ps.length, long: [q(L, 0.1), q(L, 0.5), q(L, 0.9)].map(Math.round), short: [q(S, 0.1), q(S, 0.5), q(S, 0.9)].map(Math.round), aspect: Math.round(q(A, 0.5) * 100) / 100 };
  }
  R.profiles = profiles;
  R.profilesSource =
    'profiles.jsonl sizeMm (đo từ GLB) của các mẫu trong roles[vai], p10/p50/p90 hạng gần nhất (mm), aspect = trung vị rộng/sâu; vai < 5 mẫu bỏ. Sinh bằng scripts/gen-library-roles.mjs';
  if (rejected.length > 0) console.log('không nhận:', rejected);
  console.log('thêm:', Object.fromEntries(Object.entries(added).map(([k, v]) => [k, v.length])));
  console.log('cỡ vai:', Object.fromEntries(Object.entries(R.roles).map(([k, v]) => [k, v.length])));
  if (!DRY) writeFileSync(OUT, JSON.stringify(R));
};

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) main();
