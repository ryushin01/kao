import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 32

/** scrypt 해시: scrypt$<salt>$<hash>. 계정을 만들 때(스크립트·메모리 저장소) 씁니다. */
export function hashPassword(password: string, salt = randomBytes(16).toString('base64url')) {
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('base64url')
  return `scrypt$${salt}$${hash}`
}

function parse(stored: string) {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return null
  return { salt, expected: Buffer.from(hash, 'base64url') }
}

/** 스크립트(마이그레이션)용 동기 확인 */
export function verifyPasswordSync(password: string, stored: string) {
  const parsed = parse(stored)
  if (!parsed) return false
  const actual = scryptSync(password, parsed.salt, parsed.expected.length)
  return parsed.expected.length === actual.length && timingSafeEqual(parsed.expected, actual)
}

/**
 * 요청을 처리할 때 쓰는 확인. scrypt는 수십~수백 ms가 걸려, 동기로 하면 같은 인스턴스가 함께 처리하는
 * 다른 요청(관제 스트림 등)까지 멈춥니다. 비동기 scrypt는 libuv 스레드에서 돌아 이벤트 루프를 막지 않습니다.
 */
export async function verifyPassword(password: string, stored: string) {
  const parsed = parse(stored)
  if (!parsed) return false
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, parsed.salt, parsed.expected.length, (error, key) => (error ? reject(error) : resolve(key))),
  )
  return parsed.expected.length === actual.length && timingSafeEqual(parsed.expected, actual)
}

/**
 * 없는 아이디로 로그인할 때 대신 확인하는 해시(어떤 비밀번호와도 맞지 않음). 없는 아이디도 같은 시간이 걸려
 * 응답 시간으로 계정이 있는지 알 수 없게 합니다.
 */
export const DUMMY_PASSWORD_HASH = 'scrypt$TXITZwZvl4RsFnZEk8bwiQ$AbpX_GMoB7no7TYbE3SYpJgQjuvGjjr9Ul7i-UiwZIA'
