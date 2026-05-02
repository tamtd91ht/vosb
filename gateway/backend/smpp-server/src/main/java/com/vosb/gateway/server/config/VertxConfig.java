package com.vosb.gateway.server.config;

import com.vosb.gateway.server.http.error.ProblemJsonFailureHandler;
import com.vosb.gateway.server.http.health.HealthHandlers;
import io.vertx.core.Vertx;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.http.HttpServer;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.handler.BodyHandler;
import io.vertx.ext.web.handler.CorsHandler;

import java.util.Arrays;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;

import java.util.concurrent.TimeUnit;

/**
 * Sở hữu {@link Vertx} singleton, root {@link Router}, {@link HttpServer}.
 * 4 sub-router (partner/admin/portal/internal) là @Bean ở các factory class trong package http.
 * Healthz + readyz mount tại root, ngoài 4 sub-router business.
 * Final route catch-all → 404 RFC 7807 qua {@link ProblemJsonFailureHandler}.
 */
@Configuration
@Lazy(false)   // override spring.main.lazy-initialization=true — HTTP server phải start ngay
public class VertxConfig {

    private static final Logger log = LoggerFactory.getLogger(VertxConfig.class);

    @Bean(destroyMethod = "close")
    public Vertx vertx() {
        return Vertx.vertx();
    }

    @Bean
    public Router rootRouter(Vertx vertx,
                             @Qualifier("partnerRouter")  Router partner,
                             @Qualifier("adminRouter")    Router admin,
                             @Qualifier("portalRouter")   Router portal,
                             @Qualifier("internalRouter") Router internal,
                             HealthHandlers health,
                             ProblemJsonFailureHandler onFailure,
                             @Value("${app.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}") String allowedOrigins) {
        Router root = Router.router(vertx);

        // CORS — phải đặt TRƯỚC BodyHandler để preflight OPTIONS không bị consume body.
        // Prod (Nginx reverse-proxy → same origin) không kích hoạt; chỉ cần cho dev.
        CorsHandler cors = CorsHandler.create()
                .allowedHeader("Authorization")
                .allowedHeader("Content-Type")
                .allowedHeader("X-Requested-With")
                .allowedMethod(HttpMethod.GET)
                .allowedMethod(HttpMethod.POST)
                .allowedMethod(HttpMethod.PUT)
                .allowedMethod(HttpMethod.PATCH)
                .allowedMethod(HttpMethod.DELETE)
                .allowedMethod(HttpMethod.OPTIONS)
                .allowCredentials(true);
        Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .forEach(cors::addOrigin);
        root.route().handler(cors);

        root.route().handler(BodyHandler.create());

        // Health probes (root-level, không qua auth).
        root.get("/healthz").handler(health::healthz);
        root.get("/readyz").handler(health::readyz);

        // 4 sub-router business.
        root.route("/api/v1/*").subRouter(partner);
        root.route("/api/admin/*").subRouter(admin);
        root.route("/api/portal/*").subRouter(portal);
        root.route("/api/internal/*").subRouter(internal);

        // Catch-all 404 — phải đặt sau cùng.
        root.route().handler(ctx -> ctx.fail(404));

        // Global RFC 7807 failure handler.
        root.route().failureHandler(onFailure);

        return root;
    }

    @Bean(destroyMethod = "close")
    public HttpServer httpServer(Vertx vertx,
                                 Router rootRouter,
                                 @Value("${app.http.port:8080}") int port) throws Exception {
        HttpServer server = vertx.createHttpServer().requestHandler(rootRouter);
        server.listen(port).toCompletionStage().toCompletableFuture().get(10, TimeUnit.SECONDS);
        log.info("Vert.x HTTP server listening on :{}", port);
        return server;
    }
}
