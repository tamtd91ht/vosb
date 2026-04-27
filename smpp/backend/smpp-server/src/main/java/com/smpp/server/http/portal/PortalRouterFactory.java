package com.smpp.server.http.portal;

import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sub-router cho /api/portal/* (partner self-service UI, auth Bearer JWT role=PARTNER).
 * Phase 9: T26 mount 6 endpoint.
 */
@Configuration
public class PortalRouterFactory {

    @Bean("portalRouter")
    public Router portalRouter(Vertx vertx) {
        return Router.router(vertx);
    }
}
