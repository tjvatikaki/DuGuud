const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'data', 'duguud.db');

let db = null;
let SQL = null;

// ─── Initialization ───
async function getDb() {
  if (db) return db;

  SQL = await initSqlJs();

  try {
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      db = new SQL.Database();
    }
  } catch (e) {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  initSchema();
  persist();
  return db;
}

function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── Schema ───
function initSchema() {
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT DEFAULT '', password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', reset_token TEXT DEFAULT '', reset_token_expires TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, cat TEXT NOT NULL DEFAULT 'men', icon TEXT NOT NULL DEFAULT 'tee', tag TEXT NOT NULL DEFAULT 'Tops', subtag TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0, desc TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS product_sizes (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, size TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0, UNIQUE(product_id, size))");
  db.run("CREATE TABLE IF NOT EXISTS product_images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)");
  db.run("CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, customer_phone TEXT DEFAULT '', customer_address TEXT DEFAULT '', customer_city TEXT DEFAULT '', customer_postal TEXT DEFAULT '', notes TEXT DEFAULT '', total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', tracking_number TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL, product_name TEXT NOT NULL, product_icon TEXT DEFAULT '', product_image TEXT DEFAULT '', size TEXT NOT NULL, qty INTEGER NOT NULL, price INTEGER NOT NULL)");
}

// ─── Query helpers ───
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  persist();
}

function dbLastInsertId() {
  const row = dbGet('SELECT last_insert_rowid() AS id');
  return row ? row.id : null;
}

// ─── Simple helper for atomic multi-insert (doesn't use SQL transactions) ───
// sql.js on different platforms handles BEGIN/COMMIT inconsistently,
// so we just run inserts and persist at the end.
function dbBatch(fn) {
  fn();
  persist();
}

module.exports = { getDb, dbAll, dbGet, dbRun, dbBatch, dbLastInsertId };
