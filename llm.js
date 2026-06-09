/**
 * database.js  —  Planet Express Lounge v4.0
 * IndexedDB storage replacing the Python SQLite backend.
 * Provides async methods mirroring the Python DB class interface.
 */

const DB_NAME    = "PlanetExpressLounge";
const DB_VERSION = 1;

// ── Open / upgrade ──────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // sessions — top-level conversation containers
      if (!db.objectStoreNames.contains("sessions")) {
        const ss = db.createObjectStore("sessions", { keyPath: "id" });
        ss.createIndex("ts", "ts", { unique: false });
      }

      // turns — individual agent utterances, indexed by sessionId
      if (!db.objectStoreNames.contains("turns")) {
        const ts = db.createObjectStore("turns", {
          keyPath: "id",
          autoIncrement: true,
        });
        ts.createIndex("sid", "sid", { unique: false });
        ts.createIndex("ts",  "ts",  { unique: false });
      }

      // pins — cold storage saved exchanges
      if (!db.objectStoreNames.contains("pins")) {
        const ps = db.createObjectStore("pins", {
          keyPath: "id",
          autoIncrement: true,
        });
        ps.createIndex("ts", "ts", { unique: false });
      }

      // journal — mission log entries
      if (!db.objectStoreNames.contains("journal")) {
        const js = db.createObjectStore("journal", {
          keyPath: "id",
          autoIncrement: true,
        });
        js.createIndex("sid", "sid", { unique: false });
        js.createIndex("ts",  "ts",  { unique: false });
      }

      // cfg — key/value config store
      if (!db.objectStoreNames.contains("cfg")) {
        db.createObjectStore("cfg", { keyPath: "key" });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.onerror   = () => reject(t.error);
    t.oncomplete = () => {};
    resolve(fn(t));
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function cursorAll(store) {
  return new Promise((resolve, reject) => {
    const results = [];
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { results.push(cursor.value); cursor.continue(); }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

function indexAll(index) {
  return new Promise((resolve, reject) => {
    const results = [];
    const req = index.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { results.push(cursor.value); cursor.continue(); }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── PEDatabase class ────────────────────────────────────────────────────────
export class PEDatabase {
  constructor() {
    this._db = null;
    this._ready = this._init();
  }

  async _init() {
    this._db = await openDB();
  }

  async ready() {
    await this._ready;
    return this;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async newSession(sid, query) {
    await this._ready;
    const session = {
      id:    sid,
      query: (query || "").slice(0, 500),
      ts:    new Date().toISOString(),
      label: "",
      notes: "",
    };
    const t = this._db.transaction("sessions", "readwrite");
    const req = t.objectStore("sessions").put(session);
    return reqPromise(req);
  }

  async getSessions() {
    await this._ready;
    const t     = this._db.transaction("sessions", "readonly");
    const all   = await cursorAll(t.objectStore("sessions"));
    return all.sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async deleteSession(sid) {
    await this._ready;
    const stores = ["sessions", "turns", "journal"];
    const t = this._db.transaction(stores, "readwrite");
    t.objectStore("sessions").delete(sid);

    // Delete turns by sid
    const turnsIdx = t.objectStore("turns").index("sid");
    await new Promise((resolve, reject) => {
      const req = turnsIdx.openCursor(IDBKeyRange.only(sid));
      req.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); } else resolve();
      };
      req.onerror = reject;
    });

    // Delete journal by sid
    const jIdx = t.objectStore("journal").index("sid");
    await new Promise((resolve, reject) => {
      const req = jIdx.openCursor(IDBKeyRange.only(sid));
      req.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); } else resolve();
      };
      req.onerror = reject;
    });
  }

  async updateNotes(sid, notes) {
    await this._ready;
    const t   = this._db.transaction("sessions", "readwrite");
    const req = t.objectStore("sessions").get(sid);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const sess = req.result;
        if (sess) {
          sess.notes = (notes || "").slice(0, 2000);
          t.objectStore("sessions").put(sess);
        }
        resolve();
      };
      req.onerror = reject;
    });
  }

  // ── Turns ─────────────────────────────────────────────────────────────────

  async logTurn(sid, agent, content) {
    await this._ready;
    const turn = {
      sid,
      agent,
      content: (content || "").slice(0, 4000),
      ts:      new Date().toISOString(),
    };
    const t   = this._db.transaction("turns", "readwrite");
    const req = t.objectStore("turns").add(turn);
    await reqPromise(req);
    await this._trimTurns(sid);
  }

  async _trimTurns(sid, max = 120) {
    const all  = await this.getHistory(sid);
    if (all.length <= max) return;
    const toDelete = all.slice(0, all.length - max);
    const t = this._db.transaction("turns", "readwrite");
    for (const turn of toDelete) {
      t.objectStore("turns").delete(turn.id);
    }
  }

  async getHistory(sid) {
    await this._ready;
    const t   = this._db.transaction("turns", "readonly");
    const idx = t.objectStore("turns").index("sid");
    const all = await indexAll(idx);
    return all
      .filter(r => r.sid === sid)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  // ── Pins (Cold Storage) ───────────────────────────────────────────────────

  async savePin(agent, text, label) {
    await this._ready;
    const pin = {
      agent,
      text:  (text  || "").slice(0, 2000),
      label: (label || agent),
      ts:    new Date().toISOString(),
    };
    const t   = this._db.transaction("pins", "readwrite");
    const req = t.objectStore("pins").add(pin);
    return reqPromise(req);
  }

  async getPins() {
    await this._ready;
    const t   = this._db.transaction("pins", "readonly");
    const all = await cursorAll(t.objectStore("pins"));
    return all.sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async deletePin(id) {
    await this._ready;
    const t   = this._db.transaction("pins", "readwrite");
    const req = t.objectStore("pins").delete(id);
    return reqPromise(req);
  }

  async deleteAllPins() {
    await this._ready;
    const t   = this._db.transaction("pins", "readwrite");
    const req = t.objectStore("pins").clear();
    return reqPromise(req);
  }

  // ── Journal ───────────────────────────────────────────────────────────────

  async saveJournal(sid, content) {
    await this._ready;
    const entry = {
      sid,
      content: (content || "").slice(0, 2000),
      ts:      new Date().toISOString(),
    };
    const t   = this._db.transaction("journal", "readwrite");
    const req = t.objectStore("journal").add(entry);
    return reqPromise(req);
  }

  async getJournal(sid) {
    await this._ready;
    const t   = this._db.transaction("journal", "readonly");
    const idx = t.objectStore("journal").index("sid");
    const all = await indexAll(idx);
    return all
      .filter(r => r.sid === sid)
      .sort((a, b) => b.ts.localeCompare(a.ts));
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  async cfgSet(key, value) {
    await this._ready;
    const t   = this._db.transaction("cfg", "readwrite");
    const req = t.objectStore("cfg").put({ key, value: String(value) });
    return reqPromise(req);
  }

  async cfgGet(key, defaultValue = "") {
    await this._ready;
    const t   = this._db.transaction("cfg", "readonly");
    const req = t.objectStore("cfg").get(key);
    const r   = await reqPromise(req);
    return r ? r.value : defaultValue;
  }

  // ── Wipe everything ───────────────────────────────────────────────────────

  async clearAllData() {
    await this._ready;
    const stores = ["sessions", "turns", "pins", "journal", "cfg"];
    const t = this._db.transaction(stores, "readwrite");
    for (const s of stores) t.objectStore(s).clear();
  }
}

// Singleton instance
export const db = new PEDatabase();
