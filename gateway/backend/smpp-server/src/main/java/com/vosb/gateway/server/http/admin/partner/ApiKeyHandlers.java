package com.vosb.gateway.server.http.admin.partner;

import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.PartnerApiKey;
import com.vosb.gateway.core.domain.enums.KeyStatus;
import com.vosb.gateway.core.repository.PartnerApiKeyRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.core.security.SecretCipher;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class ApiKeyHandlers {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String KEY_ID_PREFIX = "ak_live_";
    private static final String CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    private final PartnerRepository partnerRepo;
    private final PartnerApiKeyRepository apiKeyRepo;
    private final SecretCipher secretCipher;
    private final BlockingDispatcher dispatcher;

    public ApiKeyHandlers(PartnerRepository partnerRepo,
                          PartnerApiKeyRepository apiKeyRepo,
                          SecretCipher secretCipher,
                          BlockingDispatcher dispatcher) {
        this.partnerRepo = partnerRepo;
        this.apiKeyRepo = apiKeyRepo;
        this.secretCipher = secretCipher;
        this.dispatcher = dispatcher;
    }

    // POST /api/admin/partners/:partnerId/api-keys
    public void create(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        String label;
        try {
            var body = HandlerUtils.parseBody(ctx, Map.class);
            label = body.get("label") != null ? body.get("label").toString() : null;
        } catch (Exception e) {
            label = null;
        }
        final String finalLabel = label;

        dispatcher.executeAsync(() -> {
            Partner partner = partnerRepo.findByIdAndIsDeletedFalse(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + partnerId));

            String keyId = KEY_ID_PREFIX + randomAlphanumeric(16);
            byte[] rawSecretBytes = new byte[32];
            SECURE_RANDOM.nextBytes(rawSecretBytes);
            String rawSecret = Base64.getUrlEncoder().withoutPadding().encodeToString(rawSecretBytes);

            SecretCipher.Encrypted encrypted = secretCipher.encrypt(rawSecretBytes);

            PartnerApiKey key = new PartnerApiKey();
            key.setPartner(partner);
            key.setKeyId(keyId);
            key.setSecretEncrypted(encrypted.ciphertext());
            key.setNonce(encrypted.nonce());
            key.setLabel(finalLabel);
            apiKeyRepo.save(key);

            return Map.of(
                    "key_id", keyId,
                    "raw_secret", rawSecret,
                    "label", finalLabel != null ? finalLabel : ""
            );
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 201, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/partners/:partnerId/api-keys
    public void list(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        dispatcher.executeAsync(() -> {
            partnerRepo.findByIdAndIsDeletedFalse(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + partnerId));
            List<Map<String, Object>> items = apiKeyRepo.findByPartnerId(partnerId)
                    .stream().map(this::toListResponse).toList();
            return items;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // DELETE /api/admin/partners/:partnerId/api-keys/:id  (revoke)
    public void revoke(RoutingContext ctx) {
        long partnerId = HandlerUtils.pathLong(ctx, "partnerId");
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            PartnerApiKey key = apiKeyRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("API key not found: " + id));
            if (!key.getPartner().getId().equals(partnerId)) {
                throw new EntityNotFoundException("API key not found: " + id);
            }
            key.setStatus(KeyStatus.REVOKED);
            apiKeyRepo.save(key);
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private Map<String, Object> toListResponse(PartnerApiKey key) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", key.getId());
        m.put("key_id", key.getKeyId());
        m.put("label", key.getLabel() != null ? key.getLabel() : "");
        m.put("status", key.getStatus().name());
        m.put("last_used_at", key.getLastUsedAt() != null ? key.getLastUsedAt().toString() : null);
        m.put("created_at", key.getCreatedAt() != null ? key.getCreatedAt().toString() : "");
        return m;
    }

    private static String randomAlphanumeric(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(CHARS.charAt(SECURE_RANDOM.nextInt(CHARS.length())));
        }
        return sb.toString();
    }
}
