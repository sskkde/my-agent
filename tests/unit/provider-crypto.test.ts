import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  serializeEncryptedSecret,
  deserializeEncryptedSecret,
  getEncryptionKey,
  MissingEncryptionKeyError,
  DecryptionError
} from '../../src/storage/provider-crypto.js';

describe('provider-crypto', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, APP_SECRET_KEY: 'test-secret-key-for-encryption' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getEncryptionKey', () => {
    it('should return a 32-byte buffer when APP_SECRET_KEY is set', () => {
      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should throw MissingEncryptionKeyError when APP_SECRET_KEY is missing', () => {
      delete process.env.APP_SECRET_KEY;
      expect(() => getEncryptionKey()).toThrow(MissingEncryptionKeyError);
    });

    it('should throw with descriptive message when key is missing', () => {
      delete process.env.APP_SECRET_KEY;
      expect(() => getEncryptionKey()).toThrow('APP_SECRET_KEY environment variable is required for encrypting provider API keys');
    });
  });

  describe('encryptSecret', () => {
    it('should return encrypted data with iv and authTag', () => {
      const plaintext = 'my-secret-api-key';
      const result = encryptSecret(plaintext);

      expect(result).toHaveProperty('encrypted');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('authTag');
      expect(result.encrypted).toBeTruthy();
      expect(result.iv).toBeTruthy();
      expect(result.authTag).toBeTruthy();
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'same-secret';
      const result1 = encryptSecret(plaintext);
      const result2 = encryptSecret(plaintext);

      expect(result1.encrypted).not.toBe(result2.encrypted);
      expect(result1.iv).not.toBe(result2.iv);
      expect(result1.authTag).not.toBe(result2.authTag);
    });

    it('should throw when APP_SECRET_KEY is missing', () => {
      delete process.env.APP_SECRET_KEY;
      expect(() => encryptSecret('secret')).toThrow(MissingEncryptionKeyError);
    });
  });

  describe('decryptSecret', () => {
    it('should decrypt encrypted data correctly', () => {
      const plaintext = 'sk-test-12345';
      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', () => {
      const plaintext = '';
      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long API keys', () => {
      const plaintext = 'sk-' + 'a'.repeat(100);
      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toBe(plaintext);
    });

    it('should handle API keys with special characters', () => {
      const plaintext = 'sk-test_123+abc==/==';
      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag
      );

      expect(decrypted).toBe(plaintext);
    });

    it('should throw DecryptionError when authTag is wrong', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);
      const wrongAuthTag = 'a'.repeat(32);

      expect(() => decryptSecret(
        encrypted.encrypted,
        encrypted.iv,
        wrongAuthTag
      )).toThrow(DecryptionError);
    });

    it('should throw DecryptionError when IV is wrong', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);
      const wrongIv = 'b'.repeat(32);

      expect(() => decryptSecret(
        encrypted.encrypted,
        wrongIv,
        encrypted.authTag
      )).toThrow(DecryptionError);
    });

    it('should throw DecryptionError when ciphertext is wrong', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);
      const wrongCipher = 'c'.repeat(32);

      expect(() => decryptSecret(
        wrongCipher,
        encrypted.iv,
        encrypted.authTag
      )).toThrow(DecryptionError);
    });

    it('should throw when APP_SECRET_KEY is missing', () => {
      const plaintext = 'secret';
      const encrypted = encryptSecret(plaintext);
      delete process.env.APP_SECRET_KEY;

      expect(() => decryptSecret(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag
      )).toThrow(MissingEncryptionKeyError);
    });
  });

  describe('serializeEncryptedSecret', () => {
    it('should serialize to correct format', () => {
      const encrypted = {
        encrypted: 'deadbeef',
        iv: 'cafebabe',
        authTag: 'baadf00d'
      };
      const serialized = serializeEncryptedSecret(encrypted);

      expect(serialized).toBe('aes-256-gcm:cafebabe:baadf00d:deadbeef');
    });
  });

  describe('deserializeEncryptedSecret', () => {
    it('should deserialize from correct format', () => {
      const serialized = 'aes-256-gcm:cafebabe:baadf00d:deadbeef';
      const result = deserializeEncryptedSecret(serialized);

      expect(result.iv).toBe('cafebabe');
      expect(result.authTag).toBe('baadf00d');
      expect(result.encrypted).toBe('deadbeef');
    });

    it('should throw DecryptionError for invalid format (wrong parts count)', () => {
      expect(() => deserializeEncryptedSecret('aes-256-gcm:iv:auth')).toThrow(DecryptionError);
    });

    it('should throw DecryptionError for wrong algorithm prefix', () => {
      expect(() => deserializeEncryptedSecret('aes-128:iv:auth:secret')).toThrow(DecryptionError);
    });
  });

  describe('integration: encrypt/decrypt round-trip', () => {
    it('should successfully round-trip various secrets', () => {
      const secrets = [
        'sk-test-123',
        'sk-live-' + 'x'.repeat(48),
        '',
        'key-with-special-chars-!@#$%',
        'key-with-unicode-ñáéíóú'
      ];

      for (const secret of secrets) {
        const encrypted = encryptSecret(secret);
        const serialized = serializeEncryptedSecret(encrypted);
        const deserialized = deserializeEncryptedSecret(serialized);
        const decrypted = decryptSecret(
          deserialized.encrypted,
          deserialized.iv,
          deserialized.authTag
        );

        expect(decrypted).toBe(secret);
      }
    });

    it('should produce same decrypted value with different serializations', () => {
      const secret = 'my-api-key-123';
      const encrypted1 = encryptSecret(secret);
      const encrypted2 = encryptSecret(secret);

      const decrypted1 = decryptSecret(
        encrypted1.encrypted,
        encrypted1.iv,
        encrypted1.authTag
      );
      const decrypted2 = decryptSecret(
        encrypted2.encrypted,
        encrypted2.iv,
        encrypted2.authTag
      );

      expect(decrypted1).toBe(secret);
      expect(decrypted2).toBe(secret);
      expect(decrypted1).toBe(decrypted2);
    });
  });
});
