package com.smpp.server.auth;

import com.smpp.core.domain.enums.AdminRole;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Component
public class JwtService {

    private static final String CLAIM_USERNAME = "username";
    private static final String CLAIM_ROLE = "role";
    private static final String CLAIM_PARTNER_ID = "partner_id";
    private static final String CLAIM_TYPE = "type";
    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";
    private static final String REDIS_BLACKLIST_PREFIX = "jwt:bl:";

    private final SecretKey secretKey;
    private final Duration accessTtl;
    private final Duration refreshTtl;
    private final StringRedisTemplate redis;

    public JwtService(
            @Value("${app.jwt.secret}") String rawSecret,
            @Value("${app.jwt.access-ttl:1h}") String accessTtlStr,
            @Value("${app.jwt.refresh-ttl:30d}") String refreshTtlStr,
            StringRedisTemplate redis) {
        this.secretKey = deriveKey(rawSecret);
        this.accessTtl = parseDuration(accessTtlStr);
        this.refreshTtl = parseDuration(refreshTtlStr);
        this.redis = redis;
    }

    public record TokenPair(String accessToken, String refreshToken, long expiresInSeconds) {}

    public long accessTtlSeconds() {
        return accessTtl.toSeconds();
    }

    /** Issue a new access + refresh token pair for a successfully authenticated user. */
    public TokenPair issue(Long userId, String username, AdminRole role, Long partnerId) {
        String jti = UUID.randomUUID().toString();
        String access = buildToken(jti, userId, username, role, partnerId, TYPE_ACCESS, accessTtl);
        String refresh = buildToken(jti, userId, username, role, partnerId, TYPE_REFRESH, refreshTtl);
        return new TokenPair(access, refresh, accessTtl.toSeconds());
    }

    /** Verify an access token and return its AuthContext. Throws on invalid/expired token. */
    public AuthContext verifyAccess(String token) {
        Claims claims = parseClaims(token);
        requireType(claims, TYPE_ACCESS);
        return toAuthContext(claims);
    }

    /** Verify a refresh token. Returns the AuthContext to re-issue a new access token. */
    public AuthContext verifyRefresh(String token) {
        Claims claims = parseClaims(token);
        requireType(claims, TYPE_REFRESH);
        return toAuthContext(claims);
    }

    /**
     * Issue a new access token reusing the same jti (refresh token stays valid).
     * Caller must have already verified the refresh token via verifyRefresh().
     */
    public String reissueAccess(AuthContext ctx) {
        return buildToken(ctx.jti(), ctx.userId(), ctx.username(), ctx.role(), ctx.partnerId(),
                TYPE_ACCESS, accessTtl);
    }

    /** Add access token jti to Redis blacklist with TTL = remaining lifetime of the token. */
    public void blacklist(String token) {
        try {
            Claims claims = parseClaims(token);
            String jti = claims.getId();
            long remainingSecs = Math.max(0,
                    claims.getExpiration().toInstant().getEpochSecond() - Instant.now().getEpochSecond());
            if (remainingSecs > 0) {
                redis.opsForValue().set(REDIS_BLACKLIST_PREFIX + jti, "1", remainingSecs, TimeUnit.SECONDS);
            }
        } catch (JwtException ignored) {
            // Already invalid — nothing to blacklist
        }
    }

    /** Check if a jti has been blacklisted (logout). */
    public boolean isBlacklisted(String jti) {
        return Boolean.TRUE.equals(redis.hasKey(REDIS_BLACKLIST_PREFIX + jti));
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private String buildToken(String jti, Long userId, String username,
                              AdminRole role, Long partnerId, String type, Duration ttl) {
        Instant now = Instant.now();
        return Jwts.builder()
                .id(jti)
                .subject(String.valueOf(userId))
                .claim(CLAIM_USERNAME, username)
                .claim(CLAIM_ROLE, role.name())
                .claim(CLAIM_PARTNER_ID, partnerId)
                .claim(CLAIM_TYPE, type)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(secretKey)
                .compact();
    }

    private Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    private static void requireType(Claims claims, String expected) {
        String actual = claims.get(CLAIM_TYPE, String.class);
        if (!expected.equals(actual)) {
            throw new JwtException("Token type mismatch: expected " + expected + " got " + actual);
        }
    }

    private static AuthContext toAuthContext(Claims claims) {
        Long userId = Long.parseLong(claims.getSubject());
        String username = claims.get(CLAIM_USERNAME, String.class);
        AdminRole role = AdminRole.valueOf(claims.get(CLAIM_ROLE, String.class));
        Number partnerIdNum = claims.get(CLAIM_PARTNER_ID, Number.class);
        Long partnerId = partnerIdNum != null ? partnerIdNum.longValue() : null;
        String jti = claims.getId();
        return new AuthContext(userId, username, role, partnerId, jti);
    }

    private static SecretKey deriveKey(String rawSecret) {
        try {
            byte[] keyBytes = MessageDigest.getInstance("SHA-256")
                    .digest(rawSecret.getBytes(StandardCharsets.UTF_8));
            return Keys.hmacShaKeyFor(keyBytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static Duration parseDuration(String s) {
        s = s.trim();
        if (s.endsWith("d")) return Duration.ofDays(Long.parseLong(s.substring(0, s.length() - 1)));
        if (s.endsWith("h")) return Duration.ofHours(Long.parseLong(s.substring(0, s.length() - 1)));
        if (s.endsWith("m")) return Duration.ofMinutes(Long.parseLong(s.substring(0, s.length() - 1)));
        if (s.endsWith("s")) return Duration.ofSeconds(Long.parseLong(s.substring(0, s.length() - 1)));
        return Duration.parse(s); // ISO-8601 fallback (PT1H)
    }
}
