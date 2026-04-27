package com.smpp.server.http.partner;

import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sub-router cho /api/v1/* (Partner inbound API, auth API key + HMAC).
 * Phase 4 (T23-T24) sẽ gắn ApiKeyHmacAuthHandler + 3 message endpoint.
 * Hiện tại expose GET /ping cho smoke verify VertxConfig + sub-router mounting.
 */
@Configuration
public class PartnerRouterFactory {

    @Bean("partnerRouter")
    public Router partnerRouter(Vertx vertx) {
        Router r = Router.router(vertx);
        r.get("/ping").handler(ctx ->
                ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(new JsonObject().put("pong", true).put("group", "partner").encode()));
        return r;
    }
}
