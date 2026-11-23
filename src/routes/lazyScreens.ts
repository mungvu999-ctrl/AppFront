/**
 * Các màn nạp lười (`React.lazy`) của router — tách khỏi `router.tsx` để file ấy dưới trần 400 dòng.
 */

import { lazy } from 'react';

export const RouteAuth = lazy(() => import('../screens/auth/AuthScreen').then(m => ({ default: m.AuthRoute })));
export const RouteInvitationAccept = lazy(() => import('../screens/auth/InvitationAccept').then(m => ({ default: m.InvitationAcceptRoute })));
export const RoutePasswordReset = lazy(() => import('../screens/auth/PasswordReset').then(m => ({ default: m.PasswordResetRoute })));
export const RouteDashboard = lazy(() => import('../screens/dashboard/ProjectDashboard').then(m => ({ default: m.ProjectDashboardRoute })));
export const RouteProjectSettings = lazy(() => import('../screens/project/ProjectSettings').then(m => ({ default: m.ProjectSettingsRoute })));
export const RouteAccountSettings = lazy(() => import('../screens/account/AccountSettings').then(m => ({ default: m.AccountSettingsRoute })));
export const RouteNotificationCenter = lazy(() => import('../screens/system/NotificationCenter').then(m => ({ default: m.NotificationCenterRoute })));
export const RouteAccessDenied = lazy(() => import('../screens/system/AccessDenied').then(m => ({ default: m.AccessDeniedRoute })));
export const RouteMobileViewer = lazy(() => import('../screens/system/MobileViewer').then(m => ({ default: m.MobileViewerRoute })));
export const RouteNotFound = lazy(() => import('../screens/system/NotFound').then(m => ({ default: m.NotFoundRoute })));
export const RouteOnboarding = lazy(() => import('../screens/onboarding/WelcomeScreen').then(m => ({ default: m.WelcomeRoute })));
export const RouteFloorUpload = lazy(() => import('../screens/upload/FloorUploadScreen').then(m => ({ default: m.FloorUploadRoute })));
export const RouteDrawingSet = lazy(() => import('../screens/upload/DrawingSetReview').then(m => ({ default: m.DrawingSetRoute })));
export const RouteInputQualityGate = lazy(() => import('../screens/upload/InputQualityGate').then(m => ({ default: m.InputQualityGateRoute })));
export const RouteProcessing = lazy(() => import('../screens/pipeline/ProcessingScreen').then(m => ({ default: m.ProcessingScreenRoute })));
export const RouteScaleCalibration = lazy(() => import('../screens/pipeline/ScaleCalibration').then(m => ({ default: m.ScaleCalibrationRoute })));
export const RouteOverlayComparison = lazy(() => import('../screens/viewer/OverlayComparison').then(m => ({ default: m.OverlayComparisonRoute })));
export const RouteRules = lazy(() => import('../screens/rules/RuleReport').then(m => ({ default: m.RulesRoute })));
export const RouteRuleSettings = lazy(() => import('../screens/rules/RuleSettings').then(m => ({ default: m.RuleSettingsRoute })));
export const RouteExportPanel = lazy(() => import('../screens/export/ExportPanel').then(m => ({ default: m.ExportPanelRoute })));
export const RoutePipelineGraph = lazy(() => import('../screens/pipeline/PipelineGraph').then(m => ({ default: m.PipelineGraphRoute })));
export const RouteWallLayerReview = lazy(() => import('../screens/qc/WallLayerReview').then(m => ({ default: m.WallLayerReviewRoute })));
export const RouteObjectLayerReview = lazy(() => import('../screens/qc/ObjectLayerReview').then(m => ({ default: m.ObjectLayerReviewRoute })));
export const RouteDimensionOcrReview = lazy(() => import('../screens/qc/DimensionOcrReview').then(m => ({ default: m.DimensionOcrReviewRoute })));
export const RouteAxisGridManager = lazy(() => import('../screens/qc/AxisGridManager').then(m => ({ default: m.AxisGridManagerRoute })));
export const RouteRoomLabelReview = lazy(() => import('../screens/qc/RoomLabelReview').then(m => ({ default: m.RoomLabelReviewRoute })));
export const RouteFloorManager = lazy(() => import('../screens/qc/FloorManager').then(m => ({ default: m.FloorManagerRoute })));
export const RouteThicknessStandardization = lazy(() => import('../screens/qc/ThicknessStandardization').then(m => ({ default: m.ThicknessStandardizationRoute })));
export const RouteSpatialJsonViewer = lazy(() => import('../screens/export/SpatialJsonViewer').then(m => ({ default: m.SpatialJsonViewerRoute })));
export const RouteVersionHistory = lazy(() => import('../screens/export/VersionHistory').then(m => ({ default: m.VersionHistoryRoute })));
export const RouteModelLibrary = lazy(() => import('../screens/admin/ModelLibrary').then(m => ({ default: m.ModelLibraryRoute })));
export const RouteModelRegistry = lazy(() => import('../screens/admin/ModelRegistry').then(m => ({ default: m.ModelRegistryRoute })));
export const RouteTrainingJobs = lazy(() => import('../screens/admin/TrainingJobs').then(m => ({ default: m.TrainingJobsRoute })));
export const RouteUserManagement = lazy(() => import('../screens/admin/UserManagement').then(m => ({ default: m.UserManagementRoute })));
// `/welcome` = bản kết hợp v6 (`landing-lab/combo`), chủ dự án chốt 24-10; trang cuộn cũ `screens/landing` thôi dùng.
export const RouteLanding = lazy(() => import('../screens/landing-lab/combo/index'));
export const RouteSharedModel = lazy(() => import('../screens/share/SharedModelPage').then(m => ({ default: m.SharedModelPage })));
