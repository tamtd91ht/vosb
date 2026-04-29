package com.vosb.gateway.server.http.portal.overview;

import com.vosb.gateway.core.repository.MessageRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.server.auth.AuthContext;
import com.vosb.gateway.server.auth.JwtAuthHandler;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class OverviewHandlers {

    private final PartnerRepository partnerRepo;
    private final MessageRepository messageRepo;
    private final BlockingDispatcher dispatcher;

    public OverviewHandlers(PartnerRepository partnerRepo,
                            MessageRepository messageRepo,
                            BlockingDispatcher dispatcher) {
        this.partnerRepo = partnerRepo;
        this.messageRepo = messageRepo;
        this.dispatcher = dispatcher;
    }

    // GET /api/portal/overview
    public void overview(RoutingContext ctx) {
        AuthContext auth = JwtAuthHandler.from(ctx);
        Long partnerId = auth.partnerId();
        if (partnerId == null) {
            ctx.fail(403);
            return;
        }

        dispatcher.executeAsync(() -> {
            var partner = partnerRepo.findById(partnerId)
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found"));

            List<Object[]> rows = messageRepo.countByStateForPartner(partnerId);
            Map<String, Long> stateCounts = new HashMap<>();
            for (Object[] row : rows) {
                stateCounts.put(row[0].toString(), ((Number) row[1]).longValue());
            }

            long delivered = stateCounts.getOrDefault("DELIVERED", 0L);
            long failed    = stateCounts.getOrDefault("FAILED", 0L);
            long total     = stateCounts.values().stream().mapToLong(Long::longValue).sum();
            double rate    = total > 0 ? (delivered * 100.0 / total) : 0.0;

            Map<String, Object> result = new HashMap<>();
            result.put("partner_id", partner.getId());
            result.put("partner_code", partner.getCode());
            result.put("partner_name", partner.getName());
            result.put("balance", partner.getBalance());
            result.put("stats", stateCounts);
            result.put("total", total);
            result.put("delivered", delivered);
            result.put("failed", failed);
            result.put("delivery_rate", Math.round(rate * 10.0) / 10.0);
            return result;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }
}
