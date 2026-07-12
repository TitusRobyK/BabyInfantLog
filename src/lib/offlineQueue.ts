import { openDB } from 'idb'
import type { PendingOperation } from './types'

const dbPromise = openDB('baby-infant-log', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('operations')) {
      const store = db.createObjectStore('operations', { keyPath: 'id' })
      store.createIndex('by-user', 'userId')
      store.createIndex('by-created', 'createdAt')
    }
  },
})

export async function enqueue(operation: PendingOperation): Promise<void> {
  const db = await dbPromise
  await db.put('operations', operation)
}

export async function pendingForUser(userId: string): Promise<PendingOperation[]> {
  const db = await dbPromise
  return (await db.getAllFromIndex('operations', 'by-user', userId)).sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  ) as PendingOperation[]
}

export async function removePending(id: string): Promise<void> {
  const db = await dbPromise
  await db.delete('operations', id)
}

export async function clearPendingForUser(userId: string): Promise<void> {
  const db = await dbPromise
  const items = await pendingForUser(userId)
  await Promise.all(items.map((item) => db.delete('operations', item.id)))
}
