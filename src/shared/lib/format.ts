const numberFormats = new Map<number, Intl.NumberFormat>()

export function formatNumber(value: number, precision = 0): string {
  let format = numberFormats.get(precision)
  if (!format) {
    format = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: precision, maximumFractionDigits: precision })
    numberFormats.set(precision, format)
  }
  return format.format(value)
}

const clock = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul',
})

/** 한국 시간 기준 HH:MM:SS */
export function formatClock(timestamp: number): string {
  return clock.format(timestamp)
}

/** ISO 8601 문자열(time 요소의 datetime 값) */
export function toIsoString(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

export function formatPercent(ratio: number): string {
  return `${formatNumber(ratio * 100, 0)}%`
}
