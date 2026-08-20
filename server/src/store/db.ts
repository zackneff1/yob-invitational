import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import { DB } from '../types';
import { seed } from './seed';

const DB_FILE = path.join(config.DATA_DIR, 'db.json');

let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as DB;
    logger.info({ file: DB_FILE }, 'loaded data store');
  } else {
    db = seed();
    persist();
    logger.info({ file: DB_FILE }, 'seeded new data store');
  }
  return db;
}

/** Write the store to disk atomically (tmp file + rename). */
export function saveDb(): void {
  if (!db) return;
  persist();
}

function persist(): void {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
