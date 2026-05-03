package com.vosb.gateway.server.http.error;

import io.vertx.core.Handler;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Global failure handler — chuyển mọi {@code ctx.fail(...)} hoặc exception trong handler
 * thành response RFC 7807 ({@code application/problem+json}).
 */
@Component
public class ProblemJsonFailureHandler implements Handler<RoutingContext> {

    private static final Logger log = LoggerFactory.getLogger(ProblemJsonFailureHandler.class);

    @Override
    public void handle(RoutingContext ctx) {
        int code = ctx.statusCode() > 0 ? ctx.statusCode() : 500;
        Throwable err = ctx.failure();

        if (code >= 500) {
            log.error("Failure on {} {}: status={}, err={}",
                    ctx.request().method(), ctx.request().path(), code,
                    err != null ? err.toString() : "<none>", err);
        } else if (log.isDebugEnabled()) {
            log.debug("Failure on {} {}: status={}, err={}",
                    ctx.request().method(), ctx.request().path(), code,
                    err != null ? err.toString() : "<none>");
        }

        JsonObject problem = new JsonObject()
                .put("type", "about:blank")
                .put("title", titleFor(code))
                .put("status", code)
                .put("instance", ctx.request().path());
        if (err != null && err.getMessage() != null) {
            problem.put("detail", err.getMessage());
        }

        if (ctx.response().ended()) {
            return;
        }
        ctx.response()
                .setStatusCode(code)
                .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                .end(problem.encode());
    }

    private static String titleFor(int code) {
        return switch (code) {
            case 400 -> "Bad Request";
            case 401 -> "Unauthorized";
            case 403 -> "Forbidden";
            case 404 -> "Not Found";
            case 405 -> "Method Not Allowed";
            case 409 -> "Conflict";
            case 415 -> "Unsupported Media Type";
            case 422 -> "Unprocessable Entity";
            case 429 -> "Too Many Requests";
            case 500 -> "Internal Server Error";
            case 502 -> "Bad Gateway";
            case 503 -> "Service Unavailable";
            case 504 -> "Gateway Timeout";
            default  -> "Error";
        };
    }
}
