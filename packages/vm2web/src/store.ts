/** IndexedDB store for the user's game files (never leaves the browser). */
const DB = 'vm2web', STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
export async function putFile(name: string, data: Uint8Array) {
  const db = await open();
  await new Promise<void>((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(data, name); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function getAll(): Promise<Record<string, Uint8Array>> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly'); const st = tx.objectStore(STORE); const out: Record<string, Uint8Array> = {};
    const req = st.openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out[String(c.key)] = c.value as Uint8Array; c.continue(); } else res(out); };
    req.onerror = () => rej(req.error);
  });
}
export async function clearAll() {
  const db = await open();
  await new Promise<void>((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = () => res(); });
}
export function download(name: string, data: Uint8Array | string) {
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
