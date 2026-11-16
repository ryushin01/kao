/**
 * 로그인 시도 제한: 15분 동안 같은 아이디·같은 주소로 10번, 같은 주소로 50번 실패하면 막습니다(429).
 * 아이디만으로 막으면 남이 일부러 틀려 데모 계정(여러 사람이 함께 씀)을 잠글 수 있어, 아이디는 주소와 묶어 셉니다.
 * 실패 기록은 저장소(login_failures)에 남겨 서버리스 인스턴스끼리 함께 봅니다. 성공하면 그 아이디·주소의 기록을 지웁니다.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000
export const LOGIN_LIMIT_PER_ACCOUNT = 10
export const LOGIN_LIMIT_PER_ADDRESS = 50

export const loginFailureKeys = (login: string, address: string) => ({
  account: `login:${login.toLowerCase()}|${address}`,
  address: `ip:${address}`,
})

/** 막아야 하면 true */
export const isLoginBlocked = (failures: Record<string, number>, keys: ReturnType<typeof loginFailureKeys>) =>
  (failures[keys.account] ?? 0) >= LOGIN_LIMIT_PER_ACCOUNT || (failures[keys.address] ?? 0) >= LOGIN_LIMIT_PER_ADDRESS
