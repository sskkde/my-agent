import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';

const dbPath = resolve(process.cwd(), process.env.E2E_DATABASE_PATH ?? './data/e2e.db');
const authStatePath = resolve(process.cwd(), './web/playwright/.auth/user.json');

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(dirname(authStatePath), { recursive: true });

for (const path of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`, authStatePath]) {
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}
