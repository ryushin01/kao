import { createMemoryStore } from './memory'
import { createPostgresStore } from './postgres'
import type { Store } from './types'

let store: Store | undefined

/** DATABASE_URL이 있으면 Neon, 없으면 메모리 저장소 */
export function useStore(): Store {
  store ??= process.env.DATABASE_URL ? createPostgresStore(process.env.DATABASE_URL) : createMemoryStore()
  return store
}

export type { AckOutcome, PushSubscriptionRecord, Store, UserRecord } from './types'
