package com.smpp.server.http.admin.stats;

import com.smpp.core.repository.MessageRepository;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class StatsHandlers {

    private final MessageRepository messageRepo;
    private final BlockingDispatcher dispatcher;

    public StatsHandlers(MessageRepository messageRepo, BlockingDispatcher dispatcher) {
        this.messageRepo = messageRepo;
        this.dispatcher = dispatcher;
    }

    // GET /api/admin/stats/overview
    public void overview(RoutingContext ctx) {
        dispatcher.executeAsync(() -> {
            List<Object[]> rows = messageRepo.countByState();
            Map<String, Long> counts = new HashMap<>();
            for (Object[] row : rows) {
                counts.put(row[0].toString(), ((Number) row[1]).longValue());
            }
            return counts;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/stats/timeseries?granularity=hour&from=&to=
    public void timeseries(RoutingContext ctx) {
        String granularity = ctx.queryParams().contains("granularity")
                ? ctx.queryParams().get("granularity") : "hour";
        if (!granularity.equals("hour") && !granularity.equals("day")) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"granularity must be 'hour' or 'day'\"}");
            return;
        }

        Instant from;
        Instant to;
        try {
            String fromStr = ctx.queryParams().get("from");
            String toStr = ctx.queryParams().get("to");
            from = fromStr != null ? Instant.parse(fromStr) : Instant.now().minus(24, ChronoUnit.HOURS);
            to = toStr != null ? Instant.parse(toStr) : Instant.now();
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid date format, use ISO-8601\"}");
            return;
        }

        final Instant finalFrom = from;
        final Instant finalTo = to;
        final String finalGranularity = granularity;

        dispatcher.executeAsync(() -> {
            List<Object[]> rows = messageRepo.timeseries(finalGranularity, finalFrom, finalTo);
            List<Map<String, Object>> series = new ArrayList<>();
            for (Object[] row : rows) {
                Map<String, Object> point = new HashMap<>();
                point.put("bucket", row[0] != null ? row[0].toString() : null);
                point.put("state", row[1] != null ? row[1].toString() : null);
                point.put("count", ((Number) row[2]).longValue());
                series.add(point);
            }
            return Map.of(
                    "granularity", finalGranularity,
                    "from", finalFrom.toString(),
                    "to", finalTo.toString(),
                    "series", series
            );
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }
}
