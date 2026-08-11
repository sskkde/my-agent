/**
 * Rotate APP_SECRET_KEY and re-encrypt every provider secret stored in
 * provider_configs.encrypted_api_key (AES-256-GCM under the old key).
 *
 * Usage:
 *   npm run rotate:app-secret                  # auto-generate a new key
 *   npm run rotate:app-secret -- --new-key <key>  # use a specific key (>=32 chars)
 *
 * After rotation:
 *   - secrets/app_secret_key.txt holds the NEW key (chmod 600)
 *   - re-encrypt the sops source: sops -e secrets/app_secret_key.txt > secrets/app_secret_key.txt.age
 *   - redeploy: ./scripts/deploy.sh
 *
 * SAFETY: the script requires the OLD key to decrypt every provider secret;
 * it fails loudly (no partial writes) if any secret cannot be decrypted.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import {
  decryptSecret,
  encryptSecret,
  deserializeEncryptedSecret,
  serializeEncryptedSecret,
} from '../src/storage/provider-crypto.js'

const SECRETS_FILE = new URL('../secrets/app_secret_key.txt', import.meta.url)
const DB_PATH = process.env.DATABASE_PATH ?? './data/app.db'

function parseArgs(argv: string[]): { newKey: string | null } {
  let newKey: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--new-key' && argv[i + 1]) {
      newKey = argv[i + 1]
    }
  }
  return { newKey }
}

function main(): void {
  const { newKey: requestedKey } = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(SECRETS_FILE)) {
    throw new Error(`Secret file not found: ${SECRETS_FILE.pathname}. Run scripts/decrypt-secrets.sh first.`)
  }
  const oldKey = fs.readFileSync(SECRETS_FILE, 'utf8').trim()
  if (!oldKey) throw new Error('Current APP_SECRET_KEY is empty.')

  const newKey = requestedKey ?? crypto.randomBytes(32).toString('hex')
  if (newKey.length < 32) {
    throw new Error(`New APP_SECRET_KEY must be at least 32 chars, got ${newKey.length}.`)
  }

  const db = new Database(DB_PATH)
  const rows = db.prepare('SELECT provider_id, encrypted_api_key FROM provider_configs WHERE encrypted_api_key IS NOT NULL').all() as Array<{
    provider_id: string
    encrypted_api_key: string
  }>

  // Phase 1: decrypt everything under the OLD key before writing anything.
  const reencrypted: Array<{ provider_id: string; encrypted_api_key: string }> = []
  process.env.APP_SECRET_KEY = oldKey
  for (const row of rows) {
    const secret = deserializeEncryptedSecret(row.encrypted_api_key)
    let plaintext: string
    try {
      plaintext = decryptSecret(secret.encrypted, secret.iv, secret.authTag)
    } catch (error) {
      throw new Error(
        `Cannot decrypt provider ${row.provider_id} with the current APP_SECRET_KEY. ` +
          `Rotation aborted with no writes (key mismatch?). Cause: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    reencrypted.push({ provider_id: row.provider_id, encrypted_api_key: plaintext })
  }

  // Phase 2: write everything under the NEW key (single transaction).
  process.env.APP_SECRET_KEY = newKey
  const update = db.transaction(() => {
    for (const { provider_id, encrypted_api_key: plaintext } of reencrypted) {
      const encrypted = serializeEncryptedSecret(encryptSecret(plaintext))
      db.prepare('UPDATE provider_configs SET encrypted_api_key = ? WHERE provider_id = ?').run(encrypted, provider_id)
    }
  })
  update()

  fs.writeFileSync(SECRETS_FILE, newKey, { mode: 0o600 })
  console.log(`Rotated APP_SECRET_KEY for ${reencrypted.length} provider secret(s).`)
  console.log(`New key written to ${SECRETS_FILE.pathname} (chmod 600).`)
  console.log('Next steps:')
  console.log('  sops -e secrets/app_secret_key.txt > secrets/app_secret_key.txt.age')
  console.log('  ./scripts/deploy.sh')
}

main()
