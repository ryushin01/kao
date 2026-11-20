/** 턴테이블 3D 장면 조각을 미리 받아 둡니다. 탈것 화면을 열 때 바로 쓰고, 오프라인 저장(서비스 워커)에도 들어갑니다. */
export function preloadShowcaseScene() {
  return import('./showcase-scene').then(() => undefined)
}
