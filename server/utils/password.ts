import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 32

/** scrypt 해시: scrypt$<salt>$<hash> */
export function hashPassword(password: string, salt = randomBytes(16).toString('base64url')) {
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('base64url')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
