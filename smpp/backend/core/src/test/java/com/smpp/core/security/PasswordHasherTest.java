package com.smpp.core.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PasswordHasherTest {

    private final PasswordHasher hasher = new PasswordHasher();

    @Test
    void hash_producesNonNullBcryptString() {
        String hash = hasher.hash("Admin@123456");
        assertNotNull(hash);
        assertTrue(hash.startsWith("$2a$"), "Expected BCrypt prefix");
    }

    @Test
    void matches_returnsTrueForCorrectPassword() {
        String hash = hasher.hash("secret123");
        assertTrue(hasher.matches("secret123", hash));
    }

    @Test
    void matches_returnsFalseForWrongPassword() {
        String hash = hasher.hash("secret123");
        assertFalse(hasher.matches("wrong", hash));
    }

    @Test
    void hash_eachCallProducesDifferentSalt() {
        String h1 = hasher.hash("same");
        String h2 = hasher.hash("same");
        assertNotEquals(h1, h2, "BCrypt should use different salt each time");
    }
}
