package com.smpp.server.http.internal;

import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sub-router cho /api/internal/* (DLR webhook ingress từ 3rd-party, auth IP whitelist + shared secret).
 * Phase 6: T25 mount POST /dlr/{channelId}.
 */
@Configuration
public class InternalRouterFactory {

    @Bean("internalRouter")
    public Router internalRouter(Vertx vertx) {
        return Router.router(vertx);
    }
}
