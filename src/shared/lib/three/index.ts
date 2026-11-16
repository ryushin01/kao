/**
 * three.js를 쓰는 공통 코드(무대·조명 환경). 화면 조각이 three.js를 받지 않도록 `@shared/lib`와 나눴고,
 * 화면 가까이 왔을 때 지연 로딩하는 3D 장면 코드만 가져옵니다.
 */
export { applyStudioEnvironment } from './environment'
export { createStage, disposeObject, markShared, nextTask, precompile, sharedResourcesOf } from './stage'
export type { Stage } from './stage'
