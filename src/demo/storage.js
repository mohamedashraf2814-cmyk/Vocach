// حفظ قاعدة بيانات العرض في IndexedDB الخاص بمتصفح المستخدم
const DB = 'vocach-demo';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export let persistent = true;

export async function load(key) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    persistent = false;
    return null;
  }
}

export async function save(key, value) {
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    persistent = false;
  }
}

export async function clearAll() {
  try { indexedDB.deleteDatabase(DB); } catch { /* تجاهل */ }
  try { localStorage.removeItem('vocach-demo-cookie'); } catch { /* تجاهل */ }
}
