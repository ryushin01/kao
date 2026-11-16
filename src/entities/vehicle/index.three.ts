/**
 * three.js가 필요한 미니어처(3D 모델) 공개 API. 화면 조각이 three.js를 받지 않도록 `index.ts`와 나눴고,
 * 화면 가까이 왔을 때 지연 로딩하는 3D 장면 코드(관제 지도·턴테이블)만 가져옵니다.
 */
export { createMiniature, loadModelMiniature, preloadModel, rollWheels } from './lib/miniatures'
export type { Miniature } from './lib/miniatures'
