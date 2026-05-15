import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectionManager } from '../../src/storage/connection.js';
import { createUserStore } from '../../src/storage/user-store.js';
import { createAuthTokenStore } from '../../src/storage/auth-token-store.js';
import { hashPassword, hashToken, generateSessionToken } from '../../src/storage/auth-crypto.js';
import type { ConnectionManager } from '../../src/storage/connection.js';
import type { UserStore } from '../../src/storage/user-store.js';
import type { AuthTokenStore } from '../../src/storage/auth-token-store.js';

describe('auth-stores', () => {
  let connection: ConnectionManager;
  let userStore: UserStore;
  let authTokenStore: AuthTokenStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    connection.exec(`
      CREATE TABLE users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    connection.exec(`
      CREATE TABLE auth_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      )
    `);

    userStore = createUserStore(connection);
    authTokenStore = createAuthTokenStore(connection);
  });

  describe('UserStore', () => {
    describe('create', () => {
      it('should create a user successfully', async () => {
        const passwordHash = await hashPassword('test-password');
        const user = userStore.create({
          userId: 'user-001',
          username: 'testuser',
          passwordHash
        });

        expect(user.userId).toBe('user-001');
        expect(user.username).toBe('testuser');
        expect(user.passwordHash).toBe(passwordHash);
        expect(user.createdAt).toBeDefined();
        expect(user.updatedAt).toBeDefined();
      });

      it('should throw on duplicate userId', async () => {
        const passwordHash = await hashPassword('test-password');
        userStore.create({
          userId: 'user-001',
          username: 'testuser1',
          passwordHash
        });

        expect(() => {
          userStore.create({
            userId: 'user-001',
            username: 'testuser2',
            passwordHash
          });
        }).toThrow();
      });

      it('should throw on duplicate username', async () => {
        const passwordHash = await hashPassword('test-password');
        userStore.create({
          userId: 'user-001',
          username: 'testuser',
          passwordHash
        });

        expect(() => {
          userStore.create({
            userId: 'user-002',
            username: 'testuser',
            passwordHash
          });
        }).toThrow();
      });
    });

    describe('getById', () => {
      it('should return user by id', async () => {
        const passwordHash = await hashPassword('test-password');
        userStore.create({
          userId: 'user-001',
          username: 'testuser',
          passwordHash
        });

        const retrieved = userStore.getById('user-001');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.userId).toBe('user-001');
        expect(retrieved?.username).toBe('testuser');
      });

      it('should return null for non-existent user', () => {
        const retrieved = userStore.getById('non-existent');
        expect(retrieved).toBeNull();
      });
    });

    describe('getByUsername', () => {
      it('should return user by username', async () => {
        const passwordHash = await hashPassword('test-password');
        userStore.create({
          userId: 'user-001',
          username: 'testuser',
          passwordHash
        });

        const retrieved = userStore.getByUsername('testuser');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.userId).toBe('user-001');
        expect(retrieved?.username).toBe('testuser');
      });

      it('should return null for non-existent username', () => {
        const retrieved = userStore.getByUsername('non-existent');
        expect(retrieved).toBeNull();
      });
    });

    describe('list', () => {
      it('should return empty array when no users', () => {
        const users = userStore.list();
        expect(users).toEqual([]);
      });

      it('should return all users in descending created_at order', async () => {
        const passwordHash = await hashPassword('test-password');
        userStore.create({
          userId: 'user-001',
          username: 'user1',
          passwordHash
        });
        await new Promise(resolve => setTimeout(resolve, 10));
        userStore.create({
          userId: 'user-002',
          username: 'user2',
          passwordHash
        });

        const users = userStore.list();
        expect(users.length).toBe(2);
        expect(users[0].userId).toBe('user-002');
        expect(users[1].userId).toBe('user-001');
      });
    });

    describe('updatePassword', () => {
      it('should update password successfully', async () => {
        const oldHash = await hashPassword('old-password');
        userStore.create({
          userId: 'user-001',
          username: 'testuser',
          passwordHash: oldHash
        });

        const newHash = await hashPassword('new-password');
        const result = userStore.updatePassword('user-001', newHash);
        expect(result).toBe(true);

        const retrieved = userStore.getById('user-001');
        expect(retrieved?.passwordHash).toBe(newHash);
        expect(retrieved?.updatedAt).not.toBe(retrieved?.createdAt);
      });

      it('should return false for non-existent user', async () => {
        const newHash = await hashPassword('new-password');
        const result = userStore.updatePassword('non-existent', newHash);
        expect(result).toBe(true);
      });
    });
  });

  describe('AuthTokenStore', () => {
    beforeEach(async () => {
      const passwordHash = await hashPassword('test-password');
      userStore.create({
        userId: 'user-001',
        username: 'testuser',
        passwordHash
      });
    });

    describe('create', () => {
      it('should create an auth token successfully', () => {
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const authToken = authTokenStore.create({
          tokenHash,
          userId: 'user-001',
          expiresAt
        });

        expect(authToken.tokenHash).toBe(tokenHash);
        expect(authToken.userId).toBe('user-001');
        expect(authToken.expiresAt).toBe(expiresAt);
        expect(authToken.revokedAt).toBeNull();
        expect(authToken.createdAt).toBeDefined();
      });

      it('should throw on duplicate token hash', () => {
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        authTokenStore.create({
          tokenHash,
          userId: 'user-001',
          expiresAt
        });

        expect(() => {
          authTokenStore.create({
            tokenHash,
            userId: 'user-001',
            expiresAt
          });
        }).toThrow();
      });

      it('should throw for non-existent user', () => {
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        expect(() => {
          authTokenStore.create({
            tokenHash,
            userId: 'non-existent',
            expiresAt
          });
        }).toThrow();
      });
    });

    describe('findByHash', () => {
      it('should return token by hash', () => {
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        authTokenStore.create({
          tokenHash,
          userId: 'user-001',
          expiresAt
        });

        const retrieved = authTokenStore.findByHash(tokenHash);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.tokenHash).toBe(tokenHash);
        expect(retrieved?.userId).toBe('user-001');
      });

      it('should return null for non-existent token', () => {
        const retrieved = authTokenStore.findByHash('non-existent-hash');
        expect(retrieved).toBeNull();
      });
    });

    describe('revoke', () => {
      it('should revoke a token successfully', () => {
        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        authTokenStore.create({
          tokenHash,
          userId: 'user-001',
          expiresAt
        });

        const result = authTokenStore.revoke(tokenHash);
        expect(result).toBe(true);

        const retrieved = authTokenStore.findByHash(tokenHash);
        expect(retrieved?.revokedAt).not.toBeNull();
      });

      it('should return false for non-existent token', () => {
        const result = authTokenStore.revoke('non-existent-hash');
        expect(result).toBe(true);
      });
    });

    describe('purgeExpired', () => {
      it('should remove expired tokens', () => {
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const token1 = generateSessionToken();
        const tokenHash1 = hashToken(token1);
        authTokenStore.create({
          tokenHash: tokenHash1,
          userId: 'user-001',
          expiresAt: pastDate
        });

        const token2 = generateSessionToken();
        const tokenHash2 = hashToken(token2);
        authTokenStore.create({
          tokenHash: tokenHash2,
          userId: 'user-001',
          expiresAt: futureDate
        });

        const now = new Date().toISOString();
        const deletedCount = authTokenStore.purgeExpired(now);

        expect(deletedCount).toBe(1);
        expect(authTokenStore.findByHash(tokenHash1)).toBeNull();
        expect(authTokenStore.findByHash(tokenHash2)).not.toBeNull();
      });

      it('should return 0 when no expired tokens', () => {
        const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        authTokenStore.create({
          tokenHash,
          userId: 'user-001',
          expiresAt: futureDate
        });

        const now = new Date().toISOString();
        const deletedCount = authTokenStore.purgeExpired(now);

        expect(deletedCount).toBe(0);
        expect(authTokenStore.findByHash(tokenHash)).not.toBeNull();
      });
    });
  });

  describe('integration: user and token workflow', () => {
    it('should support full user auth workflow', async () => {
      const password = 'my-secret-password';
      const passwordHash = await hashPassword(password);

      const user = userStore.create({
        userId: 'user-001',
        username: 'testuser',
        passwordHash
      });

      const token = generateSessionToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const authToken = authTokenStore.create({
        tokenHash,
        userId: user.userId,
        expiresAt
      });

      expect(authToken.userId).toBe(user.userId);

      const retrievedUser = userStore.getById(user.userId);
      expect(retrievedUser).not.toBeNull();

      const retrievedToken = authTokenStore.findByHash(tokenHash);
      expect(retrievedToken).not.toBeNull();
      expect(retrievedToken?.userId).toBe(user.userId);
    });

    it('should cascade delete tokens when user is deleted', async () => {
      const passwordHash = await hashPassword('test-password');
      userStore.create({
        userId: 'user-001',
        username: 'testuser',
        passwordHash
      });

      const token = generateSessionToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      authTokenStore.create({
        tokenHash,
        userId: 'user-001',
        expiresAt
      });

      expect(authTokenStore.findByHash(tokenHash)).not.toBeNull();

      connection.exec('DELETE FROM users WHERE user_id = ?', ['user-001']);

      expect(authTokenStore.findByHash(tokenHash)).toBeNull();
    });
  });
});
