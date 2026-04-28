package com.smpp.server.http.admin.channel;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smpp.core.domain.Channel;
import com.smpp.core.domain.enums.ChannelStatus;
import com.smpp.core.domain.enums.ChannelType;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.repository.ChannelRepository;
import com.smpp.core.repository.MessageRepository;
import com.smpp.server.http.admin.dto.PageResponse;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import com.smpp.server.http.provider.HttpProviderRegistry;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class ChannelHandlers {

    private static final ObjectMapper MAPPER = HandlerUtils.mapper();
    private static final Set<String> HTTP_REQUIRED = Set.of("url", "method", "auth_type");
    private static final Set<String> ESL_REQUIRED = Set.of("host", "port", "password");
    private static final Set<String> SMPP_REQUIRED = Set.of("host", "port", "system_id", "password");

    private final ChannelRepository channelRepo;
    private final BlockingDispatcher dispatcher;
    private final HttpProviderRegistry providerRegistry;
    private final MessageRepository messageRepo;

    public ChannelHandlers(ChannelRepository channelRepo,
                           BlockingDispatcher dispatcher,
                           HttpProviderRegistry providerRegistry,
                           MessageRepository messageRepo) {
        this.channelRepo = channelRepo;
        this.dispatcher = dispatcher;
        this.providerRegistry = providerRegistry;
        this.messageRepo = messageRepo;
    }

    // POST /api/admin/channels
    public void create(RoutingContext ctx) {
        CreateChannelRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, CreateChannelRequest.class);
            validate(req);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"" + escape(e.getMessage()) + "\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            if (channelRepo.existsByCode(req.code())) {
                throw new IllegalArgumentException("Channel code already exists: " + req.code());
            }
            ChannelType type = ChannelType.valueOf(req.type().toUpperCase());
            Channel ch = new Channel();
            ch.setCode(req.code().toUpperCase());
            ch.setName(req.name());
            ch.setType(type);
            ch.setConfig(MAPPER.valueToTree(req.config()));
            DeliveryType dt = resolveDeliveryType(type, req.deliveryType());
            ch.setDeliveryType(dt);
            return toResponse(channelRepo.save(ch));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 201, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/channels
    public void list(RoutingContext ctx) {
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);
        String typeParam = ctx.queryParams().get("type");
        String statusParam = ctx.queryParams().get("status");

        dispatcher.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size);
            Page<Channel> paged;
            if (typeParam != null && statusParam != null) {
                paged = channelRepo.findByTypeAndStatus(
                        ChannelType.valueOf(typeParam.toUpperCase()),
                        ChannelStatus.valueOf(statusParam.toUpperCase()), pr);
            } else if (statusParam != null) {
                paged = channelRepo.findByStatus(ChannelStatus.valueOf(statusParam.toUpperCase()), pr);
            } else {
                paged = channelRepo.findAll(pr);
            }
            List<Map<String, Object>> items = paged.getContent().stream().map(this::toResponse).toList();
            return PageResponse.of(items, paged.getTotalElements(), page, size);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/channels/:id
    public void get(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            Channel ch = channelRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + id));
            return toResponse(ch);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // PUT /api/admin/channels/:id
    public void update(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        UpdateChannelRequest req;
        try {
            req = HandlerUtils.parseBody(ctx, UpdateChannelRequest.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid request body\"}");
            return;
        }

        dispatcher.executeAsync(() -> {
            Channel ch = channelRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + id));
            if (req.name() != null) ch.setName(req.name());
            if (req.status() != null) ch.setStatus(ChannelStatus.valueOf(req.status().toUpperCase()));
            if (req.config() != null) ch.setConfig(MAPPER.valueToTree(req.config()));
            if (req.deliveryType() != null) ch.setDeliveryType(DeliveryType.valueOf(req.deliveryType().toUpperCase()));
            return toResponse(channelRepo.save(ch));
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // DELETE /api/admin/channels/:id  (soft-delete → DISABLED)
    public void delete(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            Channel ch = channelRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + id));
            ch.setStatus(ChannelStatus.DISABLED);
            channelRepo.save(ch);
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // POST /api/admin/channels/:id/test-ping
    public void testPing(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        dispatcher.executeAsync(() -> {
            Channel ch = channelRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Channel not found: " + id));
            return ch.getType();
        }).onSuccess(type -> {
            if (type == ChannelType.HTTP_THIRD_PARTY) {
                HandlerUtils.respondJson(ctx, 200, Map.of(
                        "reachable", true,
                        "latency_ms", 0,
                        "message", "HTTP_THIRD_PARTY test-ping not yet implemented in Phase 2"
                ));
            } else {
                HandlerUtils.respondJson(ctx, 200, Map.of(
                        "supported", false,
                        "message", "test-ping not available for " + type.name() + " in this phase"
                ));
            }
        }).onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/channels/http-providers
    public void listHttpProviders(RoutingContext ctx) {
        HandlerUtils.respondJson(ctx, 200, providerRegistry.listMetadata());
    }

    // GET /api/admin/channels/:id/stats
    public void stats(RoutingContext ctx) {
        long id = HandlerUtils.pathLong(ctx, "id");
        String period = ctx.queryParams().get("period") != null ? ctx.queryParams().get("period") : "7d";
        dispatcher.executeAsync(() -> {
            channelRepo.findById(id).orElseThrow(() -> new EntityNotFoundException("Channel not found: " + id));
            OffsetDateTime from = switch (period) {
                case "today" -> OffsetDateTime.now().truncatedTo(ChronoUnit.DAYS);
                case "30d"   -> OffsetDateTime.now().minusDays(30);
                default      -> OffsetDateTime.now().minusDays(7);
            };
            List<Object[]> rows = messageRepo.countByStateForChannel(id, from);
            Map<String, Long> byState = new LinkedHashMap<>();
            long total = 0, delivered = 0, failed = 0;
            for (Object[] row : rows) {
                String state = row[0].toString();
                long count = ((Number) row[1]).longValue();
                byState.put(state, count);
                total += count;
                if ("DELIVERED".equals(state)) delivered = count;
                if ("FAILED".equals(state)) failed = count;
            }
            double deliveryRate = total > 0 ? (double) delivered / total : 0.0;
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("period", period);
            result.put("total", total);
            result.put("delivered", delivered);
            result.put("failed", failed);
            result.put("delivery_rate", Math.round(deliveryRate * 10000.0) / 10000.0);
            result.put("by_state", byState);
            return result;
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // ── Validation ────────────────────────────────────────────────────────────

    private void validate(CreateChannelRequest req) {
        if (req.code() == null || req.code().isBlank()) throw new IllegalArgumentException("code is required");
        if (req.name() == null || req.name().isBlank()) throw new IllegalArgumentException("name is required");
        if (req.type() == null || req.type().isBlank()) throw new IllegalArgumentException("type is required");
        ChannelType type;
        try {
            type = ChannelType.valueOf(req.type().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unknown channel type: " + req.type());
        }
        if (req.config() == null) throw new IllegalArgumentException("config is required");
        Map<String, Object> cfg = req.config();
        Set<String> required = switch (type) {
            case HTTP_THIRD_PARTY -> HTTP_REQUIRED;
            case FREESWITCH_ESL -> ESL_REQUIRED;
            case TELCO_SMPP -> SMPP_REQUIRED;
        };
        for (String field : required) {
            if (!cfg.containsKey(field) || cfg.get(field) == null) {
                throw new IllegalArgumentException("config." + field + " is required for type " + type.name());
            }
        }
    }

    private Map<String, Object> toResponse(Channel ch) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", ch.getId());
        m.put("code", ch.getCode());
        m.put("name", ch.getName());
        m.put("type", ch.getType().name());
        m.put("delivery_type", ch.getDeliveryType().name());
        m.put("config", ch.getConfig() != null ? ch.getConfig() : Map.of());
        m.put("status", ch.getStatus().name());
        m.put("created_at", ch.getCreatedAt() != null ? ch.getCreatedAt().toString() : "");
        m.put("updated_at", ch.getUpdatedAt() != null ? ch.getUpdatedAt().toString() : "");
        return m;
    }

    private DeliveryType resolveDeliveryType(ChannelType type, String requested) {
        return switch (type) {
            case FREESWITCH_ESL   -> DeliveryType.VOICE_OTP;
            case TELCO_SMPP       -> DeliveryType.SMS;
            case HTTP_THIRD_PARTY -> requested != null
                    ? DeliveryType.valueOf(requested.toUpperCase())
                    : DeliveryType.SMS;
        };
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public record CreateChannelRequest(
            String code,
            String name,
            String type,
            String deliveryType,
            Map<String, Object> config
    ) {}

    public record UpdateChannelRequest(
            String name,
            String status,
            String deliveryType,
            Map<String, Object> config
    ) {}
}
