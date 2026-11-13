/**
 * M18 LSB — hộp "tủ áo" nông (sâu < 0,45 m; tủ áo thật sâu ≥ 0,5 m) ngoài phòng ngủ là kệ TV / tủ thấp: bậc T3 (đồ chứa
 * nhỏ hơn) thử thêm tủ thấp. Bằng chứng tích hợp: phát lại 23 căn (F:/runs/m18/LSB/THAY-DOI.txt).
 */
import { describe, expect, it } from 'vitest';

import { shallowClosetOf } from '../sceneVariety';

describe('shallowClosetOf — tủ áo nông ngoài phòng ngủ', () => {
  it('hộp sâu 0,26–0,41 m trong phòng khách là đồ chứa nông', () => {
    for (const d of [0.26, 0.33, 0.41, 0.44]) expect(shallowClosetOf('closet', d, 'livingRoom')).toBe(true);
    expect(shallowClosetOf('closet', 0.3, undefined)).toBe(true);
  });

  it('tủ áo sâu ≥ 0,45 m, phòng ngủ, hoặc vai khác không đổi', () => {
    expect(shallowClosetOf('closet', 0.45, 'livingRoom')).toBe(false);
    expect(shallowClosetOf('closet', 0.6, 'livingRoom')).toBe(false);
    expect(shallowClosetOf('closet', 0.3, 'bedroom')).toBe(false);
    for (const role of ['doubleBed', 'singleBed', 'dresser', 'cabinet']) expect(shallowClosetOf(role, 0.3, 'livingRoom')).toBe(false);
  });
});
