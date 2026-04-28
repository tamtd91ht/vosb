package com.smpp.server.auth;

import io.jsonwebtoken.JwtException;
import io.vertx.core.Handler;
import io.vertx.ext.web.RoutingContext;
import org.springframework.stereotype.Component;

/**
 * Vert.x middleware: extracts and verifies Bearer JWT on admin/portal routes.
 * On success: stores AuthContext in ctx.data("auth") and calls ctx.next().
 * On failure: ctx.fail(401) → ProblemJsonFailureHandler returns RFC 7807.
 *
 * Redis blacklist check runs off the event loop via ctx.vertx().executeBlocking().
 */
@Component
public class JwtAuthHandler implements Handler<RoutingContext> {

    static final String AUTH_CONTEXT_KEY = "auth";

    private final JwtService jwtService;

    public JwtAuthHandler(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public void handle(RoutingContext ctx) {
        String authHeader = ctx.request().getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            ctx.fail(401);
            return;
        }

        String token = authHeader.substring(7).strip();

        AuthContext authCtx;
        try {
            authCtx = jwtService.verifyAccess(token);
        } catch (JwtException | IllegalArgumentException e) {
            ctx.fail(401);
            return;
        }

        // Redis blacklist check is a blocking call — run off event loop
        AuthContext finalAuthCtx = authCtx;
        ctx.vertx().<Boolean>executeBlocking(() -> jwtService.isBlacklisted(finalAuthCtx.jti()), false)
                .onSuccess(blacklisted -> {
                    if (blacklisted) {
                        ctx.fail(401);
                    } else {
                        ctx.data().put(AUTH_CONTEXT_KEY, finalAuthCtx);
                        ctx.next();
                    }
                })
                .onFailure(err -> ctx.fail(500, err));
    }

    /** Helper for downstream handlers to retrieve the verified AuthContext. */
    public static AuthContext from(RoutingContext ctx) {
        AuthContext auth = (AuthContext) ctx.data().get(AUTH_CONTEXT_KEY);
        if (auth == null) throw new IllegalStateException("AuthContext missing — route not protected by JwtAuthHandler");
        return auth;
    }
}
