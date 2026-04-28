package com.smpp.core.security;

import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * HMAC-SHA-256 signer for partner HTTP API authentication (see ADR-006).
 *
 * Canonical string format:
 *   METHOD\nPATH\nSHA256_HEX(body)\nTIMESTAMP
 *
 * Signature = lowercase hex of HMAC-SHA256(rawSecretBytes, canonicalString).
 */
@Component
public class HmacSigner {

    private static final String HMAC_ALGO = "HmacSHA256";

    /**
     * Compute signature for the given request components.
     *
     * @param rawSecret partner's raw secret bytes (decrypted from DB)
     * @param method    HTTP method (e.g. "POST")
     * @param path      request path (e.g. "/api/v1/messages")
     * @param body      raw request body bytes (empty byte array if no body)
     * @param timestamp ISO-8601 or epoch-seconds timestamp string from X-Timestamp header
     * @return lowercase hex signature
     */
    public String sign(byte[] rawSecret, String method, String path, byte[] body, String timestamp) {
        String canonical = buildCanonical(method, path, body, timestamp);
        return hmacHex(rawSecret, canonical);
    }

    /**
     * Constant-time verify — compare expected signature against provided signature.
     */
    public boolean verify(byte[] rawSecret, String providedSignature,
                          String method, String path, byte[] body, String timestamp) {
        String expected = sign(rawSecret, method, path, body, timestamp);
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                providedSignature.getBytes(StandardCharsets.UTF_8));
    }

    private String buildCanonical(String method, String path, byte[] body, String timestamp) {
        String bodyHash = sha256Hex(body);
        return method.toUpperCase() + "\n" + path + "\n" + bodyHash + "\n" + timestamp;
    }

    private String hmacHex(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGO);
            mac.init(new SecretKeySpec(key, HMAC_ALGO));
            return toHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 failed", e);
        }
    }

    static String sha256Hex(byte[] data) {
        try {
            return toHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
