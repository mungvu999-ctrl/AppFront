// Sinh src/lib/pascal/libraryRoles2.json (vòng 11 làn b2, `?enable=libroles2`): pool mẫu thư viện cho vai đèn sinh
// (đèn đứng / đèn bàn) theo NGƯỠNG CHUNG đo từ số liệu, không phải danh sách tay.
//   node scripts/gen-library-roles2.mjs --profiles F:/runs/library-profiles/profiles.jsonl \
//     --glb F:/runs/m11/b0/glb-local.json --glb F:/runs/m11/b2/glb-pack4.json [--out src/lib/pascal/libraryRoles2.json]
// profiles.jsonl: hồ sơ mẫu (loại, cỡ mm, qc, frontCheck, sha khớp files.json). glb-*.json: đọc tĩnh GLB (glbstat.mjs của b0:
// tam giác, KB, ảnh texture, vật liệu). Mẫu Pascal gói sẵn (public/pascal/items) 0 ảnh → `flatPascal` (đầu dò "món phẳng").
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

/** Ngưỡng chung. Lý do: đèn chiếm ít điểm ảnh → ≤ 60 k tam giác, ≤ 1 MB (b0: đèn tốt 100–800 KB); phải có ảnh texture màu;
 *  mặt bằng gần tròn/vuông (dài/ngắn ≤ 1,3: đèn cần/đèn kẹp lệch tâm không vừa ô tủ đầu giường / ô đèn 0,5 × 0,5 m);
 *  chiều cao trong khoảng hợp lý của vai. */
export const THRESHOLDS = {
  maxTris: 60000,
  maxKb: 1024,
  minTexturedMaterials: 1,
  maxFootprintAspect: 1.3,
  heightMm: { floorLamp: [1300, 2000], tableLamp: [300, 700] },
};
/** Vai (variant của món sinh) → loại chi tiết trong hồ sơ. */
const ROLE_TYPE = { floorLamp: 'floorLamp', tableLamp: 'tableLamp' };

const arg = (name) => process.argv.flatMap((a, i, all) => (a === `--${name}` ? [all[i + 1]] : []));
const [profilesPath] = arg('profiles');
const glbPaths = arg('glb');
const out = arg('out')[0] ?? 'src/lib/pascal/libraryRoles2.json';
if (!profilesPath || glbPaths.length === 0) throw new Error('cần --profiles và ít nhất một --glb');

const qc = JSON.parse(readFileSync('src/lib/pascal/libraryQc.json', 'utf8'));
const excluded = new Set(Object.keys(qc.excluded ?? {}));
const stats = new Map();
const flatPascal = new Set();
for (const path of glbPaths) {
  for (const [file, s] of Object.entries(JSON.parse(readFileSync(path, 'utf8')))) {
    if (s.err) continue;
    const pascal = /\/public\/pascal\/items\/([^/]+)\/model\.glb$/.exec(file);
    if (pascal) {
      if (s.nImg === 0) flatPascal.add(pascal[1]);
      continue;
    }
    stats.set(file.split('/').pop().replace(/\.glb$/, ''), s);
  }
}

const texturedOf = (s) => (s.mats ?? []).filter((m) => m.base !== null && m.base !== undefined).length;
const reasonsOf = (p, role) => {
  const s = stats.get(p.id);
  const r = [];
  if (!s) return ['khongCoGlb'];
  if (!p.qc?.ok) r.push('qc');
  if (p.glbShaOk !== true) r.push('sha');
  if (p.frontCheck !== 'ok') r.push('front');
  if (excluded.has(p.id)) r.push('libraryQc');
  if (s.tris > THRESHOLDS.maxTris) r.push('tris');
  if (s.kb > THRESHOLDS.maxKb) r.push('kb');
  if (texturedOf(s) < THRESHOLDS.minTexturedMaterials) r.push('khongTexture');
  const { w, d, h } = p.sizeMm;
  if (Math.max(w, d) / Math.min(w, d) > THRESHOLDS.maxFootprintAspect) r.push('matBang');
  const [lo, hi] = THRESHOLDS.heightMm[role];
  if (h < lo || h > hi) r.push('cao');
  return r;
};

const profiles = readFileSync(profilesPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const roles = {};
const models = {};
const rejected = {};
for (const [role, typeDetail] of Object.entries(ROLE_TYPE)) {
  roles[role] = [];
  for (const p of profiles.filter((q) => q.type === 'lamp' && q.typeDetail === typeDetail).sort((a, b) => a.id.localeCompare(b.id))) {
    const reasons = reasonsOf(p, role);
    if (reasons.length > 0) {
      rejected[p.id] = reasons;
      continue;
    }
    const s = stats.get(p.id);
    roles[role].push(p.id);
    models[p.id] = { s: p.styles ?? [], kb: s.kb, tris: s.tris, mm: [p.sizeMm.w, p.sizeMm.h, p.sizeMm.d] };
  }
}

const json = {
  source: 'scripts/gen-library-roles2.mjs — profiles.jsonl + glbstat (b0 glb-local.json, b2 glb-pack4.json)',
  thresholds: THRESHOLDS,
  roles,
  models,
  rejected,
  flatPascal: [...flatPascal].sort(),
};
writeFileSync(out, `${JSON.stringify(json, null, 1)}\n`);
console.log(Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.length])), 'loại', Object.keys(rejected).length, 'phẳng', flatPascal.size);
