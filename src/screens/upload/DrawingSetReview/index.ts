/**
 * Đường nhập ổn định của màn "Tải cả bộ hồ sơ" (K-32b). `src/routes/lazyScreens.ts` nạp lười
 * `DrawingSetRoute`; bài kiểm và story nhập `DrawingSetContainer` cùng cổng giả.
 *
 * KHÔNG tái xuất phần con của view (`DrawingSetViewCard`…): chúng là mảnh của một view, không phải API
 * của màn — cùng lý lẽ `FloorManager/index.ts`.
 */

export { DrawingSetContainer, DrawingSetRoute, DRAWING_SET_SCREEN_ID, type DrawingSetContainerProps } from './DrawingSetReview.container';
export { createAppDrawingSetGateway, createDrawingSetGateway, type DrawingSetGateway } from './drawingSetGateway';
export { DRAWING_SET_FILE_INPUT_TEST_ID } from './DrawingSetPickView';
