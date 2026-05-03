package com.vosb.gateway.server.http.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.vertx.core.Future;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

public final class HandlerUtils {

    private static final Logger log = LoggerFactory.getLogger(HandlerUtils.class);
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .findAndRegisterModules()
            .configure(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);

    private HandlerUtils() {}

    public static void respondJson(RoutingContext ctx, int status, Object body) {
        try {
            String json = MAPPER.writeValueAsString(body);
            ctx.response()
                    .setStatusCode(status)
                    .putHeader("Content-Type", "application/json; charset=utf-8")
                    .end(json);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize response", e);
            ctx.fail(500, e);
        }
    }

    public static <T> T parseBody(RoutingContext ctx, Class<T> type) throws JsonProcessingException {
        return MAPPER.readValue(ctx.body().asString(), type);
    }

    public static int getPage(RoutingContext ctx) {
        try {
            int p = Integer.parseInt(ctx.queryParams().get("page"));
            return Math.max(0, p);
        } catch (Exception e) {
            return 0;
        }
    }

    public static int getSize(RoutingContext ctx) {
        try {
            int s = Integer.parseInt(ctx.queryParams().get("size"));
            return Math.min(Math.max(1, s), 100);
        } catch (Exception e) {
            return 20;
        }
    }

    public static long pathLong(RoutingContext ctx, String name) {
        return Long.parseLong(ctx.pathParam(name));
    }

    public static void handleError(RoutingContext ctx, Throwable err) {
        log.error("Handler error on {} {}: {}", ctx.request().method(), ctx.request().path(), err.getMessage(), err);
        if (err instanceof IllegalArgumentException) {
            ctx.response()
                    .setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"type\":\"about:blank\",\"title\":\"Bad Request\",\"status\":400,\"detail\":\""
                            + escape(err.getMessage()) + "\"}");
        } else if (err instanceof jakarta.persistence.EntityNotFoundException) {
            ctx.fail(404, err);
        } else {
            ctx.fail(500, err);
        }
    }

    public static <T> void asyncRespond(RoutingContext ctx, Future<T> future, int successStatus) {
        future.onSuccess(result -> respondJson(ctx, successStatus, result))
              .onFailure(err -> handleError(ctx, err));
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public static ObjectMapper mapper() {
        return MAPPER;
    }
}
