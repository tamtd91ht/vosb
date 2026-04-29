package com.vosb.gateway.core.security;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class HmacSignerTest {

    private final HmacSigner signer = new HmacSigner();

    private static final byte[] SECRET = "partner-raw-secret-32bytes-XXXXX".getBytes(StandardCharsets.UTF_8);
    private static final String METHOD = "POST";
    private static final String PATH = "/api/v1/messages";
    private static final byte[] BODY = "{\"dest_addr\":\"84901234567\"}".getBytes(StandardCharsets.UTF_8);
    private static final String TIMESTAMP = "1745808000";

    @Test
    void sign_isDeterministic() {
        String s1 = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        String s2 = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        assertEquals(s1, s2);
    }

    @Test
    void sign_producesLowerHex64Chars() {
        String sig = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        assertNotNull(sig);
        assertEquals(64, sig.length(), "HMAC-SHA256 hex output must be 64 chars");
        assertTrue(sig.matches("[0-9a-f]+"), "Signature must be lowercase hex");
    }

    @Test
    void verify_returnsTrueForCorrectSignature() {
        String sig = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        assertTrue(signer.verify(SECRET, sig, METHOD, PATH, BODY, TIMESTAMP));
    }

    @Test
    void verify_returnsFalseForTamperedBody() {
        String sig = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        byte[] tampered = "{\"dest_addr\":\"84999999999\"}".getBytes(StandardCharsets.UTF_8);
        assertFalse(signer.verify(SECRET, sig, METHOD, PATH, tampered, TIMESTAMP));
    }

    @Test
    void verify_returnsFalseForWrongSecret() {
        String sig = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        byte[] wrongSecret = "wrong-secret".getBytes(StandardCharsets.UTF_8);
        assertFalse(signer.verify(wrongSecret, sig, METHOD, PATH, BODY, TIMESTAMP));
    }

    @Test
    void verify_returnsFalseForTamperedTimestamp() {
        String sig = signer.sign(SECRET, METHOD, PATH, BODY, TIMESTAMP);
        assertFalse(signer.verify(SECRET, sig, METHOD, PATH, BODY, "9999999999"));
    }

    @Test
    void sha256Hex_emptyBody_producesKnownHash() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        String hash = HmacSigner.sha256Hex(new byte[0]);
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hash);
    }
}
