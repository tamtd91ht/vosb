package com.smpp.server.http.admin;

import io.vertx.core.Vertx;
import io.vertx.ext.web.Router;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sub-router cho /api/admin/* (admin API, auth Bearer JWT role=ADMIN).
 * Phase 2: T10 mount /auth/*; T11-T19 mount business CRUD.
 */
@Configuration
public class AdminRouterFactory {

    @Bean("adminRouter")
    public Router adminRouter(Vertx vertx) {
        return Router.router(vertx);
    }
}
