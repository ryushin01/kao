/**
 * 로그인 시도 제한: 15분 창 안에서 같은 아이디·같은 주소로 10번, 같은 주소로 50번을 넘게 시도하면 막습니다(429).
 * 아이디만으로 막으면 남이 일부러 틀려 데모 계정(여러 사람이 함께 씀)을 잠글 수 있어, 아이디는 주소와 묶어 셉니다.
 *
 * 비밀번호를 확인하기 전에 시도를 먼저 셉니다(저장소의 키별 카운터를 원자적으로 하나 올림, login_throttle). 세고 나서
 * 확인하는 순서가 아니면, 틀린 요청이 한꺼번에 몰릴 때 모두 0번으로 읽혀 제한을 통과합니다. 성공하면 그 아이디·주소의
 * 카운터를 비우고 주소 카운터는 이번 시도만큼 되돌려, 성공한 로그인은 주소 제한에 쌓이지 않습니다.
 * 막아서 비밀번호를 확인하지 않은 시도는 제한을 넘지 않은 쪽 카운터에서 되돌립니다. 한 사람이 막힌 아이디를 계속 두드려도
 * 같은 주소(공유기·회사망)의 다른 사람이 주소 제한에 걸리지 않게 하기 위해서입니다.
 * 카운터는 저장소에 두어 서버리스 인스턴스끼리 함께 봅니다. 창은 첫 시도부터 15분이고, 지나면 다시 1부터 셉니다.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000
export const LOGIN_LIMIT_PER_ACCOUNT = 10
export const LOGIN_LIMIT_PER_ADDRESS = 50

export const loginAttemptKeys = (login: string, address: string) => ({
  account: `login:${login.toLowerCase()}|${address}`,
  address: `ip:${address}`,
})

/** 이번 시도까지 센 수(reserveLoginAttempt의 결과)로 아이디·주소가 각각 제한을 넘었는지 */
export const loginLimits = (attempts: Record<string, { count: number }>, keys: ReturnType<typeof loginAttemptKeys>) => ({
  account: (attempts[keys.account]?.count ?? 0) > LOGIN_LIMIT_PER_ACCOUNT,
  address: (attempts[keys.address]?.count ?? 0) > LOGIN_LIMIT_PER_ADDRESS,
})
