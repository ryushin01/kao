/**
 * 속도·출력 제한 구간 때문에 덜 간 유효 시간(초)의 적분. engine.ts의 effectiveTime이 씁니다.
 *
 * 제한 아래에서 유효 시간은 min(m, 제한 / 표의 속도)로 흐르므로, 제한이 걸린 구간(조치마다 같은 길이)만 STEP 칸으로
 * 수치 적분해 m과의 차이(deficit)를 모읍니다. 칸은 첫 구간 시작에서 시작하고, 앞 구간과 떨어진 구간은 그 시작에서 다시 맞춥니다.
 *
 * 지난 구간의 결과(구간 끝의 칸 위치와 deficit)는 구간 목록이 같으면 늘 같으므로 한 번만 계산해 둡니다(checkpoint).
 * 시각 time의 값은 time 전에 끝난 구간까지는 기억한 값을, 지금 걸린 구간만 이어서 적분합니다.
 * 같은 칸을 같은 순서로 더하므로 처음부터 다시 적분한 값과 비트 단위로 같습니다(서버리스 인스턴스끼리 같은 결과).
 */

export interface CapWindow {
  /** 제한 시작(ms) */
  start: number
  /** 제한 끝(ms). 모든 구간의 길이(end - start)가 같아야 합니다. */
  end: number
  /** 최고 속도(m/s) */
  cap: number
}

export interface CapIntegrand {
  /** 교통 흐름 배수 m(at), at은 ms */
  pace: (at: number) => number
  /** 제한이 없을 때의 유효 시간(초) */
  base: (at: number) => number
  /** 유효 시간 e(초)의 주행 속도 표 값(m/s). 한 바퀴로 감싸는 일은 이 함수가 합니다. */
  speedAt: (effective: number) => number
}

/** 수치 적분 칸(ms) */
export const CAP_STEP = 500

interface State {
  /** 다음 칸의 시작(ms). 구간을 다 적분하면 구간 끝 이상입니다. */
  at: number
  deficit: number
}

/**
 * windows(시작 순, 같은 길이)로 시각 → deficit 함수를 만듭니다. 시작이 time 이후인 구간은 쓰지 않으므로,
 * 나중에 보낸 조치가 섞인 목록으로 만들어도 그 전 시각의 값은 같습니다.
 */
export function createCapDeficit(windows: readonly CapWindow[], { pace, base, speedAt }: CapIntegrand) {
  const duration = windows[0] ? windows[0].end - windows[0].start : 0
  /** checkpoints[k]: 앞 k개 구간을 끝까지 적분한 상태 */
  const checkpoints: State[] = [{ at: windows[0]?.start ?? 0, deficit: 0 }]

  /** 시각 at에 걸린 제한 가운데 가장 낮은 값. 구간 길이가 같아 시작이 (at - 길이, at]인 구간만 봅니다. */
  function capAt(at: number, last: number) {
    let cap = Number.POSITIVE_INFINITY
    for (let i = last; i >= 0 && windows[i]!.start > at - duration; i -= 1) {
      const window = windows[i]!
      if (window.start <= at && at < window.end && window.cap < cap) cap = window.cap
    }
    return cap
  }

  /** k번째 구간을 until(구간 끝이나 지금 시각)까지 이어서 적분합니다. */
  function advance(k: number, until: number, from: State): State {
    const window = windows[k]!
    let at = Math.max(from.at, window.start)
    let deficit = from.deficit
    // capAt이 볼 마지막 구간: 시작이 at 이하인 구간(at이 커지면 앞으로 옮김)
    let last = k
    for (; at < until; at += CAP_STEP) {
      while (last + 1 < windows.length && windows[last + 1]!.start <= at) last += 1
      const dt = Math.min(CAP_STEP, until - at) / 1000
      const cap = capAt(at, last)
      const m = pace(at)
      const speed = speedAt(base(at) - deficit)
      const rate = speed * m > cap ? cap / speed : m
      deficit += (m - rate) * dt
    }
    return { at, deficit }
  }

  return (time: number) => {
    if (!windows.length || windows[0]!.start >= time) return 0
    // time 전에 끝난 구간 수(끝도 시작 순으로 정렬돼 있음)
    let low = 0
    let high = windows.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (windows[mid]!.end <= time) low = mid + 1
      else high = mid
    }
    const done = low
    for (let k = checkpoints.length - 1; k < done; k += 1) checkpoints.push(advance(k, windows[k]!.end, checkpoints[k]!))
    const state = checkpoints[done]!
    // 지금 걸린 구간이 있으면 time까지만 이어서 적분합니다(그 뒤 구간은 time 전에 시작했어도 남은 칸이 없음).
    return done < windows.length && windows[done]!.start < time ? advance(done, time, state).deficit : state.deficit
  }
}
