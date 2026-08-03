import { openDB } from 'idb'
import type { PendingOperation } from './types'

let dbPromise: ReturnType<typeof openDB> | undefined

function database() {
  dbPromise ??= openDB('baby-infant-log', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('operations')) {
        const store = db.createObjectStore('operations', { keyPath: 'id' })
        store.createIndex('by-user', 'userId')
        store.createIndex('by-created', 'createdAt')
      }
    },
  })
  return dbPromise
}

export async function enqueue(operation: PendingOperation): Promise<void> {
  const db = await database()
  await db.put('operations', operation)
}

export async function pendingForUser(userId: string): Promise<PendingOperation[]> {
  const db = await database()
  return (await db.getAllFromIndex('operations', 'by-user', userId)).sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  ) as PendingOperation[]
}

export async function removePending(id: string): Promise<void> {
  const db = await database()
  await db.delete('operations', id)
}

export async function clearPendingForUser(userId: string): Promise<void> {
  const db = await database()
  const items = await pendingForUser(userId)
  await Promise.all(items.map((item) => db.delete('operations', item.id)))
}
