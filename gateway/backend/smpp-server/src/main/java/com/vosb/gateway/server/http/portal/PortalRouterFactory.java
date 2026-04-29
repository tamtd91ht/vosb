package com.vosb.gateway.server.http.portal;

import com.vosb.gateway.server.auth.JwtAuthHandler;
import com.vosb.gateway.server.http.portal.apikey.PortalApiKeyHandlers;
import com.vosb.gateway.server.http.portal.message.PortalMessageHandlers;
import com.vosb.gateway.server.http.portal.overview.OverviewHandlers;
import com.vosb.gateway.server.http.portal.smpp.PortalSmppHandlers;
import com.vosb.gateway.server.http.portal.webhook.WebhookHandlers;
import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sub-router for /api/portal/* (partner self-service UI, auth Bearer JWT role=PARTNER).
 *
 * All routes protected by JwtAuthHandler. partner_id is always taken from JWT claim,
 * never from client-supplied params (IDOR prevention).
 *
 * Routes:
 *   GET  /overview
 *   GET  /messages              ?state= &dest_addr= &page= &size=
 *   GET  /messages/:id
 *   GET  /api-keys
 *   POST /api-keys              { label? }
 *   POST /api-keys/:id/revoke
 *   GET  /smpp-accounts
 *   POST /smpp-accounts/:id/change-password  { new_password }
 *   PATCH /webhook              { dlr_webhook: { url, method?, headers? } }
 */
@Configuration
public class PortalRouterFactory {

    @Bean("portalRouter")
    public Router portalRouter(Vertx vertx,
                               JwtAuthHandler jwtAuthHandler,
                               OverviewHandlers overview,
                               PortalMessageHandlers messages,
                               PortalApiKeyHandlers apiKeys,
                               PortalSmppHandlers smppAccounts,
                               WebhookHandlers webhook) {
        Router router = Router.router(vertx);

        // All portal routes require valid JWT
        router.route().handler(jwtAuthHandler);

        // ── Overview ──────────────────────────────────────────────────────────
        router.get("/overview").handler(overview::overview);

        // ── Messages ──────────────────────────────────────────────────────────
        router.get("/messages").handler(messages::list);
        router.get("/messages/:id").handler(messages::get);

        // ── API Keys ──────────────────────────────────────────────────────────
        router.get("/api-keys").handler(apiKeys::list);
        router.post("/api-keys").handler(apiKeys::create);
        router.post("/api-keys/:id/revoke").handler(apiKeys::revoke);

        // ── SMPP Accounts ─────────────────────────────────────────────────────
        router.get("/smpp-accounts").handler(smppAccounts::list);
        router.post("/smpp-accounts/:id/change-password").handler(smppAccounts::changePassword);

        // ── Webhook ───────────────────────────────────────────────────────────
        router.patch("/webhook").handler(webhook::update);

        return router;
    }
}
