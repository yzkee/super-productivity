import {
  decrypt,
  encrypt,
  decryptWithMigration,
  encryptBatch,
  decryptBatch,
  deriveKeyFromPassword,
  encryptWithDerivedKey,
  decryptWithDerivedKey,
} from './encryption';

describe('Encryption', () => {
  const PASSWORD = 'super_secret_password';
  const DATA = 'some very secret data';

  it('should encrypt and decrypt data correctly', async () => {
    const encrypted = await encrypt(DATA, PASSWORD);
    expect(encrypted).not.toBe(DATA);
    const decrypted = await decrypt(encrypted, PASSWORD);
    expect(decrypted).toBe(DATA);
  });

  it('should fail to decrypt with wrong password', async () => {
    const encrypted = await encrypt(DATA, PASSWORD);
    try {
      await decrypt(encrypted, 'wrong_password');
      fail('Should have thrown error');
    } catch (e) {
      // Success
    }
  }, 10000); // 10s timeout for expensive Argon2id operations

  describe('Legacy Compatibility', () => {
    // Helper to simulate legacy encryption (PBKDF2)
    const encryptLegacy = async (data: string, password: string): Promise<string> => {
      const ALGORITHM = 'AES-GCM';
      const IV_LENGTH = 12;

      const enc = new TextEncoder();
      const passwordBuffer = enc.encode(password);
      const ops = {
        name: 'PBKDF2',
        salt: enc.encode(password), // Legacy used password as salt
        iterations: 1000,
        hash: 'SHA-256',
      };
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey'],
      );
      const key = await window.crypto.subtle.deriveKey(
        ops,
        keyMaterial,
        { name: ALGORITHM, length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );

      const dataBuffer = enc.encode(data);
      const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const encryptedContent = await window.crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        dataBuffer,
      );

      const buffer = new Uint8Array(IV_LENGTH + encryptedContent.byteLength);
      buffer.set(iv, 0);
      buffer.set(new Uint8Array(encryptedContent), IV_LENGTH);

      const binary = Array.prototype.map
        .call(buffer, (byte: number) => String.fromCharCode(byte))
        .join('');
      return window.btoa(binary);
    };

    it('should decrypt data encrypted with legacy PBKDF2', async () => {
      const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
      const decrypted = await decrypt(legacyEncrypted, PASSWORD);
      expect(decrypted).toBe(DATA);
    });

    describe('decryptWithMigration', () => {
      it('should return wasLegacy: false for Argon2id encrypted data', async () => {
        const encrypted = await encrypt(DATA, PASSWORD);
        const result = await decryptWithMigration(encrypted, PASSWORD);

        expect(result.plaintext).toBe(DATA);
        expect(result.wasLegacy).toBe(false);
        expect(result.migratedCiphertext).toBeUndefined();
      });

      it('should return wasLegacy: true and migratedCiphertext for legacy data', async () => {
        const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
        const result = await decryptWithMigration(legacyEncrypted, PASSWORD);

        expect(result.plaintext).toBe(DATA);
        expect(result.wasLegacy).toBe(true);
        expect(result.migratedCiphertext).toBeDefined();

        // Verify migrated ciphertext is valid Argon2id
        const decryptedMigrated = await decrypt(result.migratedCiphertext!, PASSWORD);
        expect(decryptedMigrated).toBe(DATA);
      });

      it('should produce migrated ciphertext that decrypts without legacy fallback', async () => {
        const legacyEncrypted = await encryptLegacy(DATA, PASSWORD);
        const result = await decryptWithMigration(legacyEncrypted, PASSWORD);

        // Migrated data should NOT need legacy fallback
        const decryptResult = await decryptWithMigration(
          result.migratedCiphertext!,
          PASSWORD,
        );
        expect(decryptResult.wasLegacy).toBe(false);
      });
    });
  });

  describe('Batch Encryption (Performance Optimization)', () => {
    const ITEMS = ['item1', 'item2', 'item3', 'item with special chars: 日本語 🎉'];

    describe('deriveKeyFromPassword', () => {
      it('should derive a key that can be reused for encryption', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        expect(keyInfo.key).toBeDefined();
        expect(keyInfo.salt).toBeDefined();
        expect(keyInfo.salt.length).toBe(16);
      });

      it('should use provided salt when given', async () => {
        const customSalt = new Uint8Array(16);
        window.crypto.getRandomValues(customSalt);

        const keyInfo = await deriveKeyFromPassword(PASSWORD, customSalt);
        expect(keyInfo.salt).toEqual(customSalt);
      });
    });

    describe('encryptWithDerivedKey', () => {
      it('should encrypt data using pre-derived key', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        const encrypted = await encryptWithDerivedKey(DATA, keyInfo);

        expect(encrypted).not.toBe(DATA);
        // Should be decryptable with normal decrypt (which extracts salt from ciphertext)
        const decrypted = await decrypt(encrypted, PASSWORD);
        expect(decrypted).toBe(DATA);
      });

      it('should produce different ciphertext due to random IV', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        const encrypted1 = await encryptWithDerivedKey(DATA, keyInfo);
        const encrypted2 = await encryptWithDerivedKey(DATA, keyInfo);

        expect(encrypted1).not.toBe(encrypted2);
      });
    });

    describe('decryptWithDerivedKey', () => {
      it('should decrypt data using pre-derived key', async () => {
        const keyInfo = await deriveKeyFromPassword(PASSWORD);
        const encrypted = await encryptWithDerivedKey(DATA, keyInfo);
        const decrypted = await decryptWithDerivedKey(encrypted, keyInfo);

        expect(decrypted).toBe(DATA);
      });
    });

    describe('encryptBatch', () => {
      it('should encrypt multiple items', async () => {
        const encrypted = await encryptBatch(ITEMS, PASSWORD);

        expect(encrypted.length).toBe(ITEMS.length);
        // Each should be decryptable
        for (let i = 0; i < ITEMS.length; i++) {
          const decrypted = await decrypt(encrypted[i], PASSWORD);
          expect(decrypted).toBe(ITEMS[i]);
        }
      });

      it('should return empty array for empty input', async () => {
        const encrypted = await encryptBatch([], PASSWORD);
        expect(encrypted).toEqual([]);
      });

      it('should produce ciphertext compatible with regular decrypt', async () => {
        const encrypted = await encryptBatch([DATA], PASSWORD);
        const decrypted = await decrypt(encrypted[0], PASSWORD);
        expect(decrypted).toBe(DATA);
      });
    });

    describe('decryptBatch', () => {
      it('should decrypt multiple items encrypted with encryptBatch', async () => {
        const encrypted = await encryptBatch(ITEMS, PASSWORD);
        const decrypted = await decryptBatch(encrypted, PASSWORD);

        expect(decrypted).toEqual(ITEMS);
      });

      it('should decrypt items encrypted individually', async () => {
        // Encrypt each item separately (different salts)
        const encrypted = await Promise.all(ITEMS.map((item) => encrypt(item, PASSWORD)));
        const decrypted = await decryptBatch(encrypted, PASSWORD);

        expect(decrypted).toEqual(ITEMS);
      });

      it('should return empty array for empty input', async () => {
        const decrypted = await decryptBatch([], PASSWORD);
        expect(decrypted).toEqual([]);
      });

      it('should handle mixed batch with same and different salts', async () => {
        // First batch: all items share the same salt
        const batch1 = await encryptBatch(['a', 'b'], PASSWORD);
        // Second batch: different salt
        const batch2 = await encryptBatch(['c'], PASSWORD);
        // Individual: yet another salt
        const individual = await encrypt('d', PASSWORD);

        const allEncrypted = [...batch1, ...batch2, individual];
        const decrypted = await decryptBatch(allEncrypted, PASSWORD);

        expect(decrypted).toEqual(['a', 'b', 'c', 'd']);
      });

      it('should fail with wrong password', async () => {
        const encrypted = await encryptBatch(ITEMS, PASSWORD);

        try {
          await decryptBatch(encrypted, 'wrong_password');
          fail('Should have thrown error');
        } catch (e) {
          // Success
        }
      }, 10000); // 10s timeout for expensive Argon2id operations
    });
  });
});
