/** Guarda en el teléfono los ZIP/RAR ya descargados de MEGA para no volver a bajarlos. */
const DB_NAME = "crescendo-songs";
const STORE = "archives";

const keyOf = (name: string, size: number) => `${name}|${size}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getCached(name: string, size: number): Promise<Blob | null> {
  try {
    const blob = await run<Blob | undefined>("readonly", (store) => store.get(keyOf(name, size)));
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function putCached(name: string, size: number, data: Blob): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(data, keyOf(name, size)));
    return true;
  } catch {
    return false; // sin espacio o sin almacenamiento: la canción igual se carga
  }
}

export async function cachedKeys(): Promise<Set<string>> {
  try {
    const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    return new Set(keys.map(String));
  } catch {
    return new Set();
  }
}

export async function clearCache(): Promise<void> {
  try {
    await run("readwrite", (store) => store.clear());
  } catch {
    // nada que borrar
  }
}

export const isCachedKey = (keys: Set<string>, name: string, size?: number) =>
  typeof size === "number" && keys.has(keyOf(name, size));
