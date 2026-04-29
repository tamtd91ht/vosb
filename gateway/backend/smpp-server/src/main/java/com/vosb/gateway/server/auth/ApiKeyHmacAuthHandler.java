package com.vosb.gateway.server.auth;

import com.vosb.gateway.core.domain.PartnerApiKey;
import com.vosb.gateway.core.domain.enums.KeyStatus;
import com.vosb.gateway.core.repository.PartnerApiKeyRepository;
import com.vosb.gateway.core.security.HmacSigner;
import com.vosb.gateway.core.security.SecretCipher;
import io.vertx.core.Handler;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

@Component
public class ApiKeyHmacAuthHandler implements Handler<RoutingContext> {

    private static final Logger log = LoggerFactory.getLogger(ApiKeyHmacAuthHandler.class);
    static final String PARTNER_CONTEXT_KEY = "partnerContext";
    private static final Duration REPLAY_TTL = Duration.ofSeconds(600);

    private final PartnerApiKeyRepository apiKeyRepo;
    private final SecretCipher secretCipher;
    private final HmacSigner hmacSigner;
    private final StringRedisTemplate redis;
    private final long timestampSkewSeconds;

    public ApiKeyHmacAuthHandler(PartnerApiKeyRepository apiKeyRepo,
                                 SecretCipher secretCipher,
                                 HmacSigner hmacSigner,
                                 StringRedisTemplate redis,
                                 @Value("${app.hmac.timestamp-skew-seconds:300}") long timestampSkewSeconds) {
        this.apiKeyRepo = apiKeyRepo;
        this.secretCipher = secretCipher;
        this.hmacSigner = hmacSigner;
        this.redis = redis;
        this.timestampSkewSeconds = timestampSkewSeconds;
    }

    @Override
    public void handle(RoutingContext ctx) {
        String keyId = ctx.request().getHeader("X-Api-Key");
        String timestamp = ctx.request().getHeader("X-Timestamp");
        String signature = ctx.request().getHeader("X-Signature");

        if (keyId == null || timestamp == null || signature == null) {
            unauthorized(ctx, "Missing authentication headers");
            return;
        }

        ctx.vertx().<PartnerContext>executeBlocking(() -> {
            validateTimestamp(timestamp);
            PartnerApiKey apiKey = apiKeyRepo.findByKeyIdAndStatus(keyId, KeyStatus.ACTIVE)
                    .orElseThrow(() -> new SecurityException("Invalid or revoked API key"));

            byte[] rawSecret = secretCipher.decrypt(apiKey.getSecretEncrypted(), apiKey.getNonce());

            byte[] body = ctx.body().buffer() != null ? ctx.body().buffer().getBytes() : new byte[0];
            String method = ctx.request().method().name();
            String path = ctx.request().path();

            if (!hmacSigner.verify(rawSecret, signature, method, path, body, timestamp)) {
                throw new SecurityException("Invalid signature");
            }

            String replayKey = "hmac:replay:" + signature;
            Boolean isNew = redis.opsForValue().setIfAbsent(replayKey, "1", REPLAY_TTL);
            if (!Boolean.TRUE.equals(isNew)) {
                throw new SecurityException("Replay detected");
            }

            return new PartnerContext(apiKey.getPartner().getId(), keyId);
        }, false).onSuccess(pc -> {
            ctx.data().put(PARTNER_CONTEXT_KEY, pc);
            ctx.next();
        }).onFailure(err -> {
            log.warn("HMAC auth failed for key={}: {}", keyId, err.getMessage());
            unauthorized(ctx, err.getMessage());
        });
    }

    private void validateTimestamp(String timestamp) {
        long ts;
        try {
            ts = Long.parseLong(timestamp);
        } catch (NumberFormatException e) {
            throw new SecurityException("Invalid timestamp format");
        }
        long now = Instant.now().getEpochSecond();
        if (Math.abs(now - ts) > timestampSkewSeconds) {
            throw new SecurityException("Timestamp out of allowed window");
        }
    }

    private static void unauthorized(RoutingContext ctx, String detail) {
        ctx.response().setStatusCode(401)
                .putHeader("Content-Type", "application/problem+json")
                .end("{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"" + escape(detail) + "\"}");
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public static PartnerContext from(RoutingContext ctx) {
        PartnerContext pc = (PartnerContext) ctx.data().get(PARTNER_CONTEXT_KEY);
        if (pc == null) throw new IllegalStateException("PartnerContext missing");
        return pc;
    }
}
