/**
 * Phần dùng chung của `mainLandmark.*.test.tsx` (FIX-381): bảng route lá đã
 * phẳng hoá cùng cha của nó, và đường cụ thể hoá tham số. Tách ra đây để mỗi
 * tệp test chỉ còn phần dựng/kiểm của nhóm mình — xem PERF-01 FE-6.
 */
import { isValidElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ScreenMain } from '@/components/shell/ScreenMain';

import { ROUTE_PATTERNS } from './paths';
import { routes } from './router';

export const DEMO_PATHS: readonly string[] = [
  ROUTE_PATTERNS.demoGallery,
  ROUTE_PATTERNS.designSystem,
  ROUTE_PATTERNS.designSystemStates,
  ROUTE_PATTERNS.dataEntryDemo,
  ROUTE_PATTERNS.listReviewDemo,
  ROUTE_PATTERNS.shellDemo,
  ROUTE_PATTERNS.canvasOverlaysDemo,
  ROUTE_PATTERNS.feedbackDemo,
  ROUTE_PATTERNS.welcomeLab,
];

export interface ProductRoute {
  readonly path: string;
  readonly leaf: RouteObject;
  readonly parent: RouteObject | undefined;
}

/**
 * Route chỉ chuyển hướng, không dựng màn nào.
 *
 * `/3d/exploded` chuyển hướng tới `/3d?view=exploded` (W2-C2), `/3d/measure` tới `/3d?tool=measure`.
 * `/3d/pascal` là địa chỉ cũ của `/3d` sau F-15: phần tử của nó là `<Navigate>`,
 * nên nó KHÔNG có `<main>` và không thuộc phép kiểm landmark. Nó cũng không
 * được nằm trong bốn nhóm, nếu không phép kiểm "hợp bốn nhóm đúng bằng tập
 * route sản phẩm" sẽ đòi một landmark không bao giờ có.
 */
export const REDIRECT_PATHS: readonly string[] = [
  /* `/3d` điều hướng cả trang sang `public/editor3d.html` (trang Pascal riêng), không dựng màn. */
  ROUTE_PATTERNS.projectViewer,
  ROUTE_PATTERNS.projectViewerPascal,
  ROUTE_PATTERNS.projectExploded,
  ROUTE_PATTERNS.projectMeasure,
  /* `/projects` → `/` (danh sách dự án). */
  '/projects',
];

/* Phẳng hoá cây route để lấy lại từng route lá cùng với nhóm `<ScreenMain>` bọc nó (nếu có).
   Nhóm không path khác (khung header `AppLayout`) trong suốt: nó không mang `<main>`. */
const isMainGroup = (route: RouteObject): boolean =>
  isValidElement(route.element) && route.element.type === ScreenMain;

/** Mọi route lá có path của một cây, kể cả nằm sâu trong nhóm không path. */
export function leafRoutes(list: readonly RouteObject[]): RouteObject[] {
  return list.flatMap((route) => (route.path === undefined ? leafRoutes(route.children ?? []) : [route]));
}

export const productRoutes: ProductRoute[] = [];
function collect(list: readonly RouteObject[], group: RouteObject | undefined): void {
  for (const route of list) {
    if (route.path === undefined) {
      collect(route.children ?? [], isMainGroup(route) ? route : group);
    } else if (!DEMO_PATHS.includes(route.path) && !REDIRECT_PATHS.includes(route.path)) {
      productRoutes.push({ path: route.path, leaf: route, parent: group });
    }
  }
}
collect(routes[0]?.children ?? [], undefined);

export const outsideRoutes: ProductRoute[] = productRoutes.filter(
  ({ parent }) => parent === undefined,
);

export const concretePath = (pattern: string): string =>
  pattern === '*'
    ? '/khong-co-trang-nay'
    : pattern.replace(':projectId', 'p1').replace(':floorId', 'f1');

/**
 * Bốn nhóm route, mỗi nhóm một tệp `mainLandmark.<nhóm>.test.tsx`. Hợp bốn nhóm phải
 * bằng đúng tập `productRoutes` — `mainLandmark.shell.test.tsx` khoá điều đó, nên route
 * mới chưa xếp nhóm làm đỏ thay vì lặng lẽ không được kiểm.
 */
export const SHELL_PATHS: readonly string[] = [
  '/login',
  '/login/forgot',
  '/login/invitation',
  '/login/reset-password',
  '/welcome',
  '/',
  '/khong-co-quyen',
  '/onboarding',
  '/tai-khoan',
  '/thong-bao',
  '/share/:token',
  '*',
];

export const PROJECT_PATHS: readonly string[] = [
  '/projects/:projectId/settings',
  '/projects/:projectId/upload',
  '/projects/:projectId/drawing-sets/:setId?',
  '/projects/:projectId/quality',
  '/projects/:projectId/pipeline',
  '/projects/:projectId/pipeline/graph',
  '/projects/:projectId/rules',
  '/projects/:projectId/rules/settings',
  '/projects/:projectId/export',
  '/projects/:projectId/data',
  '/projects/:projectId/versions',
];

export const FLOORS_ADMIN_PATHS: readonly string[] = [
  '/projects/:projectId/floors/:floorId/scale',
  '/projects/:projectId/floors/:floorId/overlay',
  '/projects/:projectId/floors/:floorId/layers/walls',
  '/projects/:projectId/floors/:floorId/layers/objects',
  '/projects/:projectId/floors/:floorId/layers/dimensions',
  '/projects/:projectId/floors/:floorId/layers/grids',
  '/projects/:projectId/floors/:floorId/layers/rooms',
  '/projects/:projectId/floors',
  '/projects/:projectId/floors/:floorId/layers/thickness',
  '/admin/models',
  '/admin/training/jobs',
  '/admin/training/models',
  '/admin/users',
];

export const VIEWER_PATHS: readonly string[] = [
  '/m/du-an/:projectId',
];

export const ALL_GROUP_PATHS: readonly string[] = [
  ...SHELL_PATHS,
  ...PROJECT_PATHS,
  ...FLOORS_ADMIN_PATHS,
  ...VIEWER_PATHS,
];
