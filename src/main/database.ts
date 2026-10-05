import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "fs";
import { app } from "electron";
import { join } from "path";

import { initializeBaseSchema, runMigrations } from "./database-migrations";
import { migrateLegacyDebriefsToArtifacts } from "./legacy-debrief-migration";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath("userData");
  const dbDir = join(userDataPath, "data");

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = join(dbDir, "nexy.db");

  // An isolated runtime profile must start empty. Never migrate the user's database into it:
  // that could copy or rename the user's production profile into the child instance.
  if (!existsSync(dbPath) && !process.env.NEXY_ISOLATED_USER_DATA) {
    // 1. Same directory, old filename (rename only, no userData change)
    const sameDirLegacy = join(dbDir, "copilot-hub.db");
    // 2. Old userData directory (app was renamed — Electron switches %AppData% folder)
    const oldUserDataDb = join(app.getPath("appData"), "copilot-desktop-hub", "data", "copilot-hub.db");

    if (existsSync(sameDirLegacy)) {
      renameSync(sameDirLegacy, dbPath);
    } else if (existsSync(oldUserDataDb)) {
      renameSync(oldUserDataDb, dbPath);
    }
  }

  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);

  return db;
}

function initializeSchema(db: Database.Database): void {
  initializeBaseSchema(db);
  runMigrations(db);
  migrateLegacyDebriefsToArtifacts(db);

  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  insertSetting.run("theme", "dark");
  insertSetting.run("globalHotkey", "Ctrl+Shift+H");
  insertSetting.run("autoStart", "false");
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
