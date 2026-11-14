let webglAvailable: boolean | undefined

/**
 * WebGL을 쓸 수 있는지. 위젯이 뜰 때마다 부르므로 한 번만 확인하고 결과를 기억합니다.
 * 확인에 쓴 컨텍스트는 바로 놓아 줍니다. 브라우저가 한 번에 열어 두는 WebGL 컨텍스트 수에는 한도가 있습니다.
 */
export function isWebGLAvailable(): boolean {
  if (webglAvailable !== undefined) return webglAvailable
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    webglAvailable = gl !== null
  } catch {
    webglAvailable = false
  }
  return webglAvailable
}
