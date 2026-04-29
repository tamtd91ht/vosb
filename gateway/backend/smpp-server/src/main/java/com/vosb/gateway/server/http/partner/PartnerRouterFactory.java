package com.vosb.gateway.server.http.partner;

import com.vosb.gateway.server.auth.ApiKeyHmacAuthHandler;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class PartnerRouterFactory {

    @Bean("partnerRouter")
    public Router partnerRouter(Vertx vertx,
                                ApiKeyHmacAuthHandler hmacAuth,
                                PartnerMessageHandlers messages) {
        Router r = Router.router(vertx);

        r.get("/ping").handler(ctx ->
                ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(new JsonObject().put("pong", true).put("group", "partner").encode()));

        // Message endpoints — protected by HMAC auth
        r.post("/messages").handler(hmacAuth).handler(messages::send);
        r.get("/messages").handler(hmacAuth).handler(messages::list);
        r.get("/messages/:id").handler(hmacAuth).handler(messages::getById);

        return r;
    }
}
