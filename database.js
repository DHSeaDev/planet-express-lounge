/**
 * database.js  —  Planet Express Lounge
 * IndexedDB storage replacing the Python SQLite backend.
 * Provides async methods mirroring the Python DB class interface.
 */

const DB_NAME    = "PlanetExpressLounge";
const DB_VERSION = 2;  // v2: adds inventions store

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

      // cfg — key/value config store
      if (!db.objectStoreNames.contains("cfg")) {
        db.createObjectStore("cfg", { keyPath: "key" });
      }

      // inventions — Patent Office ledger (added v2)
      // Schema: { id:autoIncrement, name:string, text:string, critique:string,
      //           critiqueAgent:string, rating:'success'|'failure'|'unknown',
      //           isMega:boolean, isScrap:boolean, ts:ISOString }
      if (!db.objectStoreNames.contains("inventions")) {
        const iv = db.createObjectStore("inventions", {
          keyPath: "id",
          autoIncrement: true,
        });
        iv.createIndex("ts",     "ts",     { unique: false });
        iv.createIndex("rating", "rating", { unique: false });
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

    // Transaction 1: delete the session record
    const t1 = this._db.transaction("sessions", "readwrite");
    t1.objectStore("sessions").delete(sid);
    await new Promise((resolve, reject) => {
      t1.oncomplete = resolve;
      t1.onerror    = () => reject(t1.error);
    });

    // Transaction 2: delete turns by sid (separate tx — IDB auto-commits on await yield)
    const t2 = this._db.transaction("turns", "readwrite");
    await new Promise((resolve, reject) => {
      const req = t2.objectStore("turns").index("sid").openCursor(IDBKeyRange.only(sid));
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
      text:  (text  || "").slice(0, 6000), // ~1000 tokens, enough for episode summaries
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

  // ── Inventions (Patent Office) ────────────────────────────────────────────

  async saveInvention(name, text, critique, critiqueAgent, rating, isMega = false, isRecycled = false) {
    await this._ready;
    const record = {
      name:         (name         || "").slice(0, 200),
      text:         (text         || "").slice(0, 1000),
      critique:     (critique     || "").slice(0, 500),
      critiqueAgent:(critiqueAgent|| ""),
      rating,          // 'success' | 'failure' | 'unknown'
      isMega:        !!isMega,
      isRecycled:    !!isRecycled,
      isScrap:       false,  // set explicitly via scrapInvention() — never auto-set
      ts:            new Date().toISOString(),
    };
    const t   = this._db.transaction("inventions", "readwrite");
    const req = t.objectStore("inventions").add(record);
    return reqPromise(req);
  }

  /** Move an invention to the Scrap Heap (user-initiated). Does not delete it. */
  async scrapInvention(id) {
    await this._ready;
    const t    = this._db.transaction("inventions", "readwrite");
    const store= t.objectStore("inventions");
    const get  = store.get(id);
    return new Promise((resolve, reject) => {
      get.onsuccess = () => {
        const rec = get.result;
        if (!rec) return resolve(false);
        rec.isScrap = true;
        rec.scrappedAt = new Date().toISOString();
        const put = store.put(rec);
        put.onsuccess = () => resolve(true);
        put.onerror   = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  }

  async getInventions() {
    await this._ready;
    const t   = this._db.transaction("inventions", "readonly");
    const all = await cursorAll(t.objectStore("inventions"));
    return all.sort((a, b) => b.ts.localeCompare(a.ts));
  }

  async deleteInvention(id) {
    await this._ready;
    const t   = this._db.transaction("inventions", "readwrite");
    const req = t.objectStore("inventions").delete(id);
    return reqPromise(req);
  }

  async clearInventions() {
    await this._ready;
    const t   = this._db.transaction("inventions", "readwrite");
    const req = t.objectStore("inventions").clear();
    return reqPromise(req);
  }

  async clearAllData() {
    await this._ready;
    const stores = ["sessions", "turns", "pins", "cfg", "inventions"];
    const t = this._db.transaction(stores, "readwrite");
    for (const s of stores) t.objectStore(s).clear();
  }
}

// Singleton instance
export const db = new PEDatabase();
