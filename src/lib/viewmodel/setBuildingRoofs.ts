/**
 * Thông số mái người duyệt nhập trên thẻ mái của khối "Ngôi nhà" (NHA-08c): nhãn từng trường, chữ gõ → số gửi
 * được, và câu báo khi số không gửi được. Thuần, không React.
 *
 * Độ dốc nhận ba cách ghi trên bản vẽ (độ, phần trăm, tỉ lệ `x:12`) và luôn quy về độ, vì dây chỉ mang độ.
 */

import { HOUSE_ELEVATION_RANGE_MM } from '@/api/schemas/houseProposal';
import { BUILDING_LIMITS } from '@/api/schemas/setBuilding';
import { formatNumber } from '@/lib/format/number';

import { readMmValue, type NumberRead, type RoofField } from './setBuildingDecisions';

export const ROOF_FIELD_LABELS: Readonly<Record<RoofField, string>> = {
  form: 'Dạng mái',
  pitchDeg: 'Độ dốc',
  quarterTurns: 'Hướng mái',
  eaveElevationMm: 'Cốt diềm',
  ridgeElevationMm: 'Cốt đỉnh',
  overhangMm: 'Độ đua',
  material: 'Vật liệu',
  parapetMm: 'Chiều cao tường chắn mái',
};

/** Trường nhập bằng ô số; ba trường còn lại là ô chọn (dạng, vật liệu) và nút xoay (hướng). */
export type RoofNumberField = Exclude<RoofField, 'form' | 'material' | 'quarterTurns'>;

const ROOF_LENGTH_RANGE_MM = { min: 0, max: BUILDING_LIMITS.maxRoofMm } as const;
const MM_RANGES: Readonly<
  Record<Exclude<RoofNumberField, 'pitchDeg'>, { readonly min: number; readonly max: number }>
> = {
  eaveElevationMm: HOUSE_ELEVATION_RANGE_MM,
  ridgeElevationMm: HOUSE_ELEVATION_RANGE_MM,
  overhangMm: ROOF_LENGTH_RANGE_MM,
  parapetMm: ROOF_LENGTH_RANGE_MM,
};

const PITCH_FORMAT = 'Nhập độ dốc theo độ, phần trăm hoặc tỉ lệ, ví dụ 30°, 58% hoặc 7:12.';
const PITCH_RANGE = `Độ dốc phải từ 0° đến dưới ${formatNumber(BUILDING_LIMITS.maxPitchDeg, { fractionDigits: 0 })}°.`;

const DECIMAL = String.raw`\d+(?:[.,]\d{1,2})?`;
const PITCH = new RegExp(String.raw`^(${DECIMAL})\s*([°%])?$`, 'u');
const RATIO = new RegExp(String.raw`^(${DECIMAL})\s*:\s*(${DECIMAL})$`, 'u');

/**
 * Số thập phân người duyệt gõ; dấu phẩy là dấu thập phân (A15), dấu chấm cũng nhận vì độ dốc không tới nghìn.
 * Tối đa hai chữ số lẻ: "1.000" là cách viết nghìn ở các ô mm cùng thẻ, nên ở đây bị từ chối chứ không thành 1°.
 */
const decimalOf = (text: string | undefined): number => Number((text ?? '').replace(',', '.'));
/** Góc của một độ dốc "cao trên dài", làm tròn một chữ số như cách hiện. */
const degreesOf = (rise: number, run: number): number =>
  Math.round((Math.atan2(rise, run) * 1800) / Math.PI) / 10;

/** Chữ người duyệt gõ → độ dốc theo độ. Chữ lạ là không có số, không đoán. */
export function pitchFromText(text: string): number | undefined {
  const trimmed = text.trim();
  const plain = PITCH.exec(trimmed);

  if (plain !== null) {
    const value = decimalOf(plain[1]);

    return plain[2] === '%' ? degreesOf(value, 100) : Math.round(value * 10) / 10;
  }
  const ratio = RATIO.exec(trimmed);
  const run = decimalOf(ratio?.[2]);

  return ratio === null || run === 0 ? undefined : degreesOf(decimalOf(ratio[1]), run);
}

/** Chữ gõ trong ô sửa → số gửi được, hoặc câu báo ngay dưới ô (BE từ chối 422 ngoài khoảng). */
export function readRoofNumber(field: RoofNumberField, text: string): NumberRead {
  if (field !== 'pitchDeg') return readMmValue(ROOF_FIELD_LABELS[field], MM_RANGES[field], text);
  const degrees = pitchFromText(text);

  if (degrees === undefined) return { problem: PITCH_FORMAT };

  return degrees < BUILDING_LIMITS.maxPitchDeg ? { value: degrees } : { problem: PITCH_RANGE };
}

export const isRoofNumberField = (field: RoofField): field is RoofNumberField =>
  field === 'pitchDeg' || field in MM_RANGES;

/** Chữ đặt sẵn vào ô sửa cho số đã nhập; `readRoofNumber` đọc lại ra đúng số đó. */
export const roofTypedText = (field: RoofField, value: number): string =>
  field === 'pitchDeg'
    ? formatNumber(value, { maxFractionDigits: 1, grouping: false })
    : String(value);
