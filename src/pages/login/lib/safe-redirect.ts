/**
 * 로그인 뒤 돌아갈 주소. 같은 사이트 안의 경로만 씁니다(열린 리디렉트 방지).
 * 브라우저는 '\'를 '/'로 읽고 탭·줄바꿈을 지우므로 '/\evil.com'·'/\t/evil.com'도 다른 사이트(//evil.com)가 됩니다.
 * 그래서 맨 앞 '/' 뒤에 '/'나 '\'가 오거나, 탭·줄바꿈이 들어 있으면 버립니다.
 */
export function safeRedirect(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/[\t\n\r]/.test(value) ? value : null
}
