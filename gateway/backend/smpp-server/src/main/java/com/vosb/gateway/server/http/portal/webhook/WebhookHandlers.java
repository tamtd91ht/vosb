package com.vosb.gateway.server.http.portal.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.server.auth.AuthContext;
import com.vosb.gateway.server.auth.JwtAuthHandler;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.List;
import java.util.Map;

@Component
public class WebhookHandlers {

    private static final ObjectMapper MAPPER = HandlerUtils.mapper();
    private static final List<String> ALLOWED_METHODS = List.of("GET", "POST", "PUT", "PATCH");

    private final PartnerRepository partnerRepo;
    private final BlockingDispatcher dispatcher;

    public WebhookHandlers(PartnerRepository partnerRepo, BlockingDispatcher dispatcher) {
        this.partnerRepo = partnerRepo;
        this.dispatcher = dispatcher;
    }

    // PATCH /api/portal/webhook
    public void update(RoutingContext ctx) {
        AuthContext auth = JwtAuthHandler.from(ctx);
        Long partnerId = auth.partnerId();
        if (partnerId == null) { ctx.fail(403); return; }

        Map<?, ?> body;
        try {
            body = HandlerUtils.parseBody(ctx, Map.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid request body\"}");
            return;
        }

        Object webhookObj = body.get("dlr_webhook");
        JsonNode webhookNode;
        try {
            webhookNode = MAPPER.valueToTree(webhookObj);
            if (webhookNode == null || webhookNode.isNull()) {
                throw new IllegalArgumentException("dlr_webhook is required");
            }
            validateWebhook(webhookNode);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        final JsonNode finalWebhook = webhookNode;
        dispatcher.executeAsync(() -> {
            Partner partner = partnerRepo.findByIdAndIsDeletedFalse(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found"));
            partner.setDlrWebhook(finalWebhook);
            partnerRepo.save(partner);
            return Map.of(
                    "dlr_webhook", finalWebhook,
                    "message", "Webhook updated successfully"
            );
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private void validateWebhook(JsonNode node) {
        String url = node.path("url").asText(null);
        if (url == null || url.isBlank()) throw new IllegalArgumentException("dlr_webhook.url is required");
        try { URI.create(url); } catch (Exception e) { throw new IllegalArgumentException("dlr_webhook.url is not a valid URL"); }

        String method = node.path("method").asText("POST");
        if (!ALLOWED_METHODS.contains(method.toUpperCase())) {
            throw new IllegalArgumentException("dlr_webhook.method must be one of: " + ALLOWED_METHODS);
        }
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\"", "'");
    }
}
