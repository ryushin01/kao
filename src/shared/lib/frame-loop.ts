/**
 * requestAnimationFrame 그리기 반복(3D 무대·블랙홀 배경이 함께 씀).
 *
 * - 재생 중이고(playing) 화면 안에 있고(inView) 탭이 보일 때(pageVisible)만 매 프레임 그립니다.
 * - 그 밖에는 invalidate()로 요청할 때만 한 번 그립니다(동작 줄이기, 카메라를 끌 때 등).
 * - 화면 밖이거나 탭이 숨겨진 동안의 요청은 그리지 않고 기억했다가, 다시 보이면 한 번 그립니다. 그리는 중에 카메라 컨트롤이
 *   change를 내며 다시 요청하는 연쇄(자동 회전·따라가기)도 화면 밖에서는 여기서 멈춥니다.
 * - 반복 중에 그리는 동안 들어온 요청은 다음 반복 프레임이 그리므로 같은 프레임을 두 번 그리지 않습니다. 반복이 아닐 때
 *   그리는 동안 들어온 요청(감속 중인 컨트롤 등)은 다음 프레임에 한 번 더 그립니다.
 */
export interface FrameLoopOptions {
  /** 한 프레임 그리기 */
  draw: () => void
  /** 반복을 (다시) 시작할 때 부릅니다(경과 시간 시계를 맞추는 데 씀). */
  onStart?: () => void
  playing?: boolean
  inView?: boolean
  pageVisible?: boolean
  /** 다음 프레임 예약과 취소(시험에서 바꿈) */
  schedule?: (callback: () => void) => number
  cancel?: (id: number) => void
}

export interface FrameLoop {
  setPlaying: (playing: boolean) => void
  setInView: (inView: boolean) => void
  setPageVisible: (visible: boolean) => void
  /** 한 번 그리기를 요청합니다(반복 중이면 반복이 그림). */
  invalidate: () => void
  /** 지금 상태에 맞게 다시 그립니다: 반복할 수 있으면 반복을 시작하고, 아니면 한 번 그립니다. */
  resume: () => void
  /** 매 프레임 반복 중인지 */
  readonly running: boolean
  dispose: () => void
}

export function createFrameLoop({
  draw,
  onStart,
  playing = true,
  inView = true,
  pageVisible = true,
  schedule = (callback) => requestAnimationFrame(callback),
  cancel = (id) => cancelAnimationFrame(id),
}: FrameLoopOptions): FrameLoop {
  /** 반복 프레임 예약(0이면 없음) */
  let loopId = 0
  /** invalidate로 예약한 한 번 그리기(0이면 없음) */
  let pendingId = 0
  let drawing = false
  /** 보이지 않는 동안 받은 그리기 요청 */
  let missed = false
  let disposed = false

  const visible = () => inView && pageVisible
  const active = () => playing && visible()

  const drawOnce = () => {
    drawing = true
    try {
      draw()
    } finally {
      drawing = false
    }
  }

  const frame = () => {
    loopId = 0
    drawOnce()
    if (!disposed && active()) loopId = schedule(frame)
  }

  const start = () => {
    if (disposed || loopId !== 0 || !active()) return
    if (pendingId !== 0) {
      cancel(pendingId)
      pendingId = 0
    }
    missed = false
    onStart?.()
    loopId = schedule(frame)
  }

  const invalidate = () => {
    if (disposed) return
    if (!visible()) {
      missed = true
      return
    }
    // 이미 다음 프레임이 예약돼 있거나, 반복 중에 그리는 동안의 요청이면 다음 반복 프레임이 그립니다.
    if (loopId !== 0 || pendingId !== 0 || (drawing && active())) return
    pendingId = schedule(() => {
      pendingId = 0
      if (!visible()) {
        missed = true
        return
      }
      drawOnce()
    })
  }

  const resume = () => {
    if (active()) start()
    else if (visible()) {
      missed = false
      invalidate()
    }
  }

  /** 보이게 되면 반복을 시작하거나, 보이지 않는 동안 받은 요청을 한 번 그립니다. */
  const refresh = () => {
    if (active()) start()
    else if (visible() && missed) {
      missed = false
      invalidate()
    }
  }

  return {
    setPlaying(next) {
      playing = next
      // 멈추면 멈춘 모습을 한 번 그립니다.
      if (active()) start()
      else invalidate()
    },
    setInView(next) {
      inView = next
      refresh()
    },
    setPageVisible(next) {
      pageVisible = next
      refresh()
    },
    invalidate,
    resume,
    get running() {
      return loopId !== 0
    },
    dispose() {
      disposed = true
      if (loopId !== 0) cancel(loopId)
      if (pendingId !== 0) cancel(pendingId)
      loopId = 0
      pendingId = 0
    },
  }
}
