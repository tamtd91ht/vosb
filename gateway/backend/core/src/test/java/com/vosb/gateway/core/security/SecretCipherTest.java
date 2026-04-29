package com.vosb.gateway.core.security;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class SecretCipherTest {

    private final SecretCipher cipher = new SecretCipher("test-key-for-unit-tests-only");

    @Test
    void encryptDecrypt_roundTrip() {
        byte[] plaintext = "ak_secret_value_123456".getBytes(StandardCharsets.UTF_8);
        SecretCipher.Encrypted enc = cipher.encrypt(plaintext);

        assertNotNull(enc.ciphertext());
        assertNotNull(enc.nonce());
        assertEquals(12, enc.nonce().length);

        byte[] decrypted = cipher.decrypt(enc.ciphertext(), enc.nonce());
        assertArrayEquals(plaintext, decrypted);
    }

    @Test
    void encrypt_producesDifferentNonceEachCall() {
        byte[] data = "same-data".getBytes(StandardCharsets.UTF_8);
        SecretCipher.Encrypted e1 = cipher.encrypt(data);
        SecretCipher.Encrypted e2 = cipher.encrypt(data);
        assertFalse(java.util.Arrays.equals(e1.nonce(), e2.nonce()), "Nonce must be random each call");
    }

    @Test
    void decrypt_failsWithWrongNonce() {
        byte[] data = "secret".getBytes(StandardCharsets.UTF_8);
        SecretCipher.Encrypted enc = cipher.encrypt(data);
        byte[] badNonce = new byte[12]; // all zeros
        assertThrows(IllegalStateException.class, () -> cipher.decrypt(enc.ciphertext(), badNonce));
    }

    @Test
    void differentKeys_cannotDecryptEachOther() {
        SecretCipher other = new SecretCipher("completely-different-key");
        byte[] data = "crosskey".getBytes(StandardCharsets.UTF_8);
        SecretCipher.Encrypted enc = cipher.encrypt(data);
        assertThrows(IllegalStateException.class, () -> other.decrypt(enc.ciphertext(), enc.nonce()));
    }
}
