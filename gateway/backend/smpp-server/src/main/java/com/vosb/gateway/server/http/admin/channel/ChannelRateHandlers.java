package com.vosb.gateway.server.http.admin.channel;

import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.core.domain.ChannelRate;
import com.vosb.gateway.core.domain.enums.RateUnit;
import com.vosb.gateway.core.repository.ChannelRateRepository;
import com.vosb.gateway.core.repository.ChannelRepository;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class ChannelRateHandlers {

    private final ChannelRateRepository rateRepo;
    private final ChannelRepository channelRepo;
    private final BlockingDispatcher dispatcher;

    public ChannelRateHandlers(ChannelRateRepository rateRepo,
                               ChannelRepository channelRepo,
                               BlockingDispatcher dispatcher) {
        this.rateRepo = rateRepo;
        this.channelRepo = channelRepo;
        this.dispatcher = dispatcher;
    }

    // GET /api/admin/channels/:id/rates
    public void list(RoutingContext ctx) {
        long channelId = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            channelRepo.findById(channelId)
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + channelId));
            return rateRepo.findByChannelIdOrderByPrefixDescEffectiveFromDesc(channelId)
                    .stream().map(this::toResponse).toList();
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 200, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // POST /api/admin/channels/:id/rates
    public void create(RoutingContext ctx) {
        long channelId = HandlerUtils.pathLong(ctx, "id");
        RateRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, RateRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Channel ch = channelRepo.findById(channelId)
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + channelId));
            ChannelRate r = new ChannelRate();
            r.setChannel(ch);
            r.setCarrier(req.carrier() != null ? req.carrier().toUpperCase() : null);
            r.setPrefix(req.carrier() != null ? "" : (req.prefix() != null ? req.prefix() : ""));
            r.setRate(new BigDecimal(String.valueOf(req.rate())));
            r.setCurrency(req.currency() != null ? req.currency() : "VND");
            r.setUnit(req.unit() != null ? RateUnit.valueOf(req.unit().toUpperCase()) : RateUnit.MESSAGE);
            r.setEffectiveFrom(req.effective_from() != null ? LocalDate.parse(req.effective_from()) : LocalDate.now());
            r.setEffectiveTo(req.effective_to() != null ? LocalDate.parse(req.effective_to()) : null);
            return toResponse(rateRepo.save(r));
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 201, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // PUT /api/admin/channels/:id/rates/:rateId
    public void update(RoutingContext ctx) {
        long channelId = HandlerUtils.pathLong(ctx, "id");
        long rateId = HandlerUtils.pathLong(ctx, "rateId");
        RateRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, RateRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            ChannelRate r = rateRepo.findById(rateId)
                    .orElseThrow(() -> new EntityNotFoundException("Rate not found: " + rateId));
            if (!r.getChannel().getId().equals(channelId))
                throw new EntityNotFoundException("Rate not found: " + rateId);
            if (req.carrier() != null) {
                r.setCarrier(req.carrier().toUpperCase());
                r.setPrefix("");
            } else if (req.prefix() != null) {
                r.setPrefix(req.prefix());
                r.setCarrier(null);
            }
            if (req.rate() != null) r.setRate(new BigDecimal(String.valueOf(req.rate())));
            if (req.currency() != null) r.setCurrency(req.currency());
            if (req.unit() != null) r.setUnit(RateUnit.valueOf(req.unit().toUpperCase()));
            if (req.effective_from() != null) r.setEffectiveFrom(LocalDate.parse(req.effective_from()));
            r.setEffectiveTo(req.effective_to() != null ? LocalDate.parse(req.effective_to()) : null);
            return toResponse(rateRepo.save(r));
        }).onSuccess(r -> HandlerUtils.respondJson(ctx, 200, r))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // DELETE /api/admin/channels/:id/rates/:rateId
    public void delete(RoutingContext ctx) {
        long channelId = HandlerUtils.pathLong(ctx, "id");
        long rateId = HandlerUtils.pathLong(ctx, "rateId");
        dispatcher.executeAsync(() -> {
            ChannelRate r = rateRepo.findById(rateId)
                    .orElseThrow(() -> new EntityNotFoundException("Rate not found: " + rateId));
            if (!r.getChannel().getId().equals(channelId))
                throw new EntityNotFoundException("Rate not found: " + rateId);
            rateRepo.delete(r);
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private Map<String, Object> toResponse(ChannelRate r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.getId());
        m.put("channel_id", r.getChannel().getId());
        m.put("carrier", r.getCarrier());
        m.put("prefix", r.getPrefix());
        m.put("rate", r.getRate());
        m.put("currency", r.getCurrency());
        m.put("unit", r.getUnit().name());
        m.put("effective_from", r.getEffectiveFrom() != null ? r.getEffectiveFrom().toString() : null);
        m.put("effective_to", r.getEffectiveTo() != null ? r.getEffectiveTo().toString() : null);
        m.put("created_at", r.getCreatedAt() != null ? r.getCreatedAt().toString() : null);
        return m;
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record RateRequest(String carrier, String prefix, Object rate, String currency, String unit,
                              String effective_from, String effective_to) {}
}
