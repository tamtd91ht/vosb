package com.vosb.gateway.server.http.admin.route;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.Route;
import com.vosb.gateway.core.domain.enums.ChannelStatus;
import com.vosb.gateway.core.repository.ChannelRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.core.repository.RouteRepository;
import com.vosb.gateway.core.service.RateResolver;
import com.vosb.gateway.server.http.admin.dto.PageResponse;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class RouteHandlers {

    private static final Logger log = LoggerFactory.getLogger(RouteHandlers.class);

    private final RouteRepository routeRepo;
    private final PartnerRepository partnerRepo;
    private final ChannelRepository channelRepo;
    private final BlockingDispatcher dispatcher;
    private final RateResolver rateResolver;
    private final StringRedisTemplate redis;

    public RouteHandlers(RouteRepository routeRepo,
                         PartnerRepository partnerRepo,
                         ChannelRepository channelRepo,
                         BlockingDispatcher dispatcher,
                         RateResolver rateResolver,
                         StringRedisTemplate redis) {
        this.routeRepo = routeRepo;
        this.partnerRepo = partnerRepo;
        this.channelRepo = channelRepo;
        this.dispatcher = dispatcher;
        this.rateResolver = rateResolver;
        this.redis = redis;
    }

    /** Drop all cached route entries for the given partner. */
    private void invalidatePartnerRouteCache(Long partnerId) {
        try {
            Set<String> keys = redis.keys("route:partner:" + partnerId + ":*");
            if (keys != null && !keys.isEmpty()) redis.delete(keys);
        } catch (DataAccessException e) {
            log.warn("Route cache invalidation failed for partner {}: {}", partnerId, e.getMessage());
        }
    }

    // POST /api/admin/routes
    public void create(RoutingContext ctx) {
        CreateRouteRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, CreateRouteRequest.class);
            validateCreate(req);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Partner partner = partnerRepo.findById(req.partnerId())
                    .orElseThrow(() -> new EntityNotFoundException("Partner not found: " + req.partnerId()));
            Channel channel = channelRepo.findById(req.channelId())
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + req.channelId()));
            if (channel.getStatus() != ChannelStatus.ACTIVE) {
                throw new IllegalArgumentException("Channel is not ACTIVE: " + req.channelId());
            }

            Route route = new Route();
            route.setPartner(partner);
            if (req.carrier() != null && !req.carrier().isBlank()) {
                route.setCarrier(req.carrier().toUpperCase());
                route.setMsisdnPrefix("");
            } else {
                route.setMsisdnPrefix(normalizeMsisdnPrefix(req.msisdnPrefix()));
            }
            route.setChannel(channel);
            route.setPriority(req.priority() != null ? req.priority() : 100);

            if (req.fallbackChannelId() != null) {
                Channel fallback = channelRepo.findById(req.fallbackChannelId())
                        .orElseThrow(() -> new EntityNotFoundException("Fallback channel not found: " + req.fallbackChannelId()));
                if (fallback.getStatus() != ChannelStatus.ACTIVE) {
                    throw new IllegalArgumentException("Fallback channel is not ACTIVE: " + req.fallbackChannelId());
                }
                route.setFallbackChannel(fallback);
            }

            try {
                Route saved = routeRepo.save(route);
                invalidatePartnerRouteCache(partner.getId());
                Map<String, Object> resp = toResponse(saved);
                List<String> warnings = rateResolver.checkCoverage(
                        channel.getId(),
                        partner.getId(),
                        channel.getDeliveryType(),
                        saved.getCarrier(),
                        saved.getMsisdnPrefix());
                resp.put("warnings", warnings);
                return resp;
            } catch (DataIntegrityViolationException e) {
                throw new ConflictException("Route with same (partner_id, msisdn_prefix, priority) already exists");
            }
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 201, result))
          .onFailure(err -> {
              if (err instanceof ConflictException) {
                  ctx.response().setStatusCode(409)
                          .putHeader("Content-Type", "application/problem+json")
                          .end("{\"status\":409,\"title\":\"Conflict\",\"detail\":\"" + escape(err.getMessage()) + "\"}");
              } else {
                  HandlerUtils.handleError(ctx, err);
              }
          });
    }

    // GET /api/admin/routes
    public void list(RoutingContext ctx) {
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);
        String partnerIdParam = ctx.queryParams().get("partner_id");
        String channelIdParam = ctx.queryParams().get("channel_id");

        dispatcher.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size);
            Page<Route> paged;
            if (partnerIdParam != null) {
                paged = routeRepo.findByPartnerId(Long.parseLong(partnerIdParam), pr);
            } else if (channelIdParam != null) {
                paged = routeRepo.findByChannelId(Long.parseLong(channelIdParam), pr);
            } else {
                paged = routeRepo.findAll(pr);
            }
            List<Map<String, Object>> items = paged.getContent().stream().map(this::toResponse).toList();
            return PageResponse.of(items, paged.getTotalElements(), page, size);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // PUT /api/admin/routes/:id
    public void update(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        UpdateRouteRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, UpdateRouteRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid request body\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Route route = routeRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Route not found: " + id));
            if (req.carrier() != null && !req.carrier().isBlank()) {
                route.setCarrier(req.carrier().toUpperCase());
                route.setMsisdnPrefix("");
            } else if (req.msisdnPrefix() != null) {
                route.setCarrier(null);
                route.setMsisdnPrefix(normalizeMsisdnPrefix(req.msisdnPrefix()));
            }
            if (req.priority() != null) route.setPriority(req.priority());
            if (req.enabled() != null) route.setEnabled(req.enabled());
            if (req.channelId() != null) {
                Channel ch = channelRepo.findById(req.channelId())
                        .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + req.channelId()));
                route.setChannel(ch);
            }
            if (req.fallbackChannelId() != null) {
                Channel fb = channelRepo.findById(req.fallbackChannelId())
                        .orElseThrow(() -> new EntityNotFoundException("Fallback channel not found: " + req.fallbackChannelId()));
                route.setFallbackChannel(fb);
            }
            try {
                Route saved = routeRepo.save(route);
                invalidatePartnerRouteCache(saved.getPartner().getId());
                return toResponse(saved);
            } catch (DataIntegrityViolationException e) {
                throw new ConflictException("Route with same (partner_id, msisdn_prefix, priority) already exists");
            }
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> {
              if (err instanceof ConflictException) {
                  ctx.response().setStatusCode(409)
                          .putHeader("Content-Type", "application/problem+json")
                          .end("{\"status\":409,\"title\":\"Conflict\",\"detail\":\"" + escape(err.getMessage()) + "\"}");
              } else {
                  HandlerUtils.handleError(ctx, err);
              }
          });
    }

    // DELETE /api/admin/routes/:id
    public void delete(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            Route route = routeRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Route not found: " + id));
            route.setEnabled(false);
            routeRepo.save(route);
            invalidatePartnerRouteCache(route.getPartner().getId());
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static final java.util.Set<String> VALID_CARRIERS = java.util.Set.of(
            "VIETTEL", "MOBIFONE", "VINAPHONE", "VIETNAMOBILE", "GMOBILE", "REDDI");

    private void validateCreate(CreateRouteRequest req) {
        if (req.partnerId() == null) throw new IllegalArgumentException("partner_id is required");
        if (req.channelId() == null) throw new IllegalArgumentException("channel_id is required");
        boolean hasCarrier = req.carrier() != null && !req.carrier().isBlank();
        boolean hasPrefix  = req.msisdnPrefix() != null;
        if (!hasCarrier && !hasPrefix) {
            throw new IllegalArgumentException("Either carrier or msisdn_prefix is required");
        }
        if (hasCarrier && !VALID_CARRIERS.contains(req.carrier().toUpperCase())) {
            throw new IllegalArgumentException("Invalid carrier: " + req.carrier());
        }
    }

    private String normalizeMsisdnPrefix(String prefix) {
        if (prefix == null) return "";
        String p = prefix.strip();
        if (p.startsWith("+")) p = p.substring(1);
        return p;
    }

    private Map<String, Object> toResponse(Route r) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", r.getId());
        m.put("partner_id", r.getPartner().getId());
        m.put("carrier", r.getCarrier());
        m.put("msisdn_prefix", r.getMsisdnPrefix());
        m.put("channel_id", r.getChannel().getId());
        m.put("fallback_channel_id", r.getFallbackChannel() != null ? r.getFallbackChannel().getId() : null);
        m.put("priority", r.getPriority());
        m.put("enabled", r.isEnabled());
        m.put("created_at", r.getCreatedAt() != null ? r.getCreatedAt().toString() : "");
        return m;
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    static class ConflictException extends RuntimeException {
        ConflictException(String msg) { super(msg); }
    }

    public record CreateRouteRequest(
            @JsonProperty("partner_id") Long partnerId,
            String carrier,
            @JsonProperty("msisdn_prefix") String msisdnPrefix,
            @JsonProperty("channel_id") Long channelId,
            @JsonProperty("fallback_channel_id") Long fallbackChannelId,
            Integer priority
    ) {}

    public record UpdateRouteRequest(
            String carrier,
            @JsonProperty("msisdn_prefix") String msisdnPrefix,
            @JsonProperty("channel_id") Long channelId,
            @JsonProperty("fallback_channel_id") Long fallbackChannelId,
            Integer priority,
            Boolean enabled
    ) {}
}
