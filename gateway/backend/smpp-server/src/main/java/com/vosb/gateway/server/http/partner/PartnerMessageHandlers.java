package com.vosb.gateway.server.http.partner;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.amqp.InboundMessageEvent;
import com.vosb.gateway.core.domain.Message;
import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.enums.InboundVia;
import com.vosb.gateway.core.domain.enums.MessageEncoding;
import com.vosb.gateway.core.domain.enums.MessageState;
import com.vosb.gateway.core.repository.MessageRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.server.auth.ApiKeyHmacAuthHandler;
import com.vosb.gateway.server.auth.PartnerContext;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import com.vosb.gateway.server.smpp.InboundMessagePublisher;
import io.vertx.ext.web.RoutingContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.*;

@Component
public class PartnerMessageHandlers {

    private final MessageRepository messageRepo;
    private final PartnerRepository partnerRepo;
    private final InboundMessagePublisher publisher;
    private final BlockingDispatcher blocking;

    public PartnerMessageHandlers(MessageRepository messageRepo,
                                  PartnerRepository partnerRepo,
                                  InboundMessagePublisher publisher,
                                  BlockingDispatcher blocking) {
        this.messageRepo = messageRepo;
        this.partnerRepo = partnerRepo;
        this.publisher = publisher;
        this.blocking = blocking;
    }

    // POST /api/v1/messages
    public void send(RoutingContext ctx) {
        PartnerContext pc = ApiKeyHmacAuthHandler.from(ctx);
        JsonNode body;
        try {
            body = HandlerUtils.parseBody(ctx, JsonNode.class);
        } catch (Exception e) {
            ctx.fail(400, new IllegalArgumentException("Invalid JSON body"));
            return;
        }

        String sourceAddr = getString(body, "source_addr");
        String destAddr   = getString(body, "dest_addr");
        String content    = getString(body, "content");
        String clientRef  = getString(body, "client_ref");
        if (sourceAddr == null || sourceAddr.isBlank()) {
            ctx.fail(400, new IllegalArgumentException("source_addr is required"));
            return;
        }
        if (destAddr == null || destAddr.isBlank()) {
            ctx.fail(400, new IllegalArgumentException("dest_addr is required"));
            return;
        }
        if (content == null || content.isBlank()) {
            ctx.fail(400, new IllegalArgumentException("content is required"));
            return;
        }
        if (clientRef != null) {
            if (clientRef.length() > 64) {
                ctx.fail(400, new IllegalArgumentException("client_ref must be at most 64 characters"));
                return;
            }
            if (clientRef.isBlank()) clientRef = null;
        }

        String normalizedDest = normalizeDestAddr(destAddr);
        if (!normalizedDest.matches("\\d{7,15}")) {
            ctx.fail(400, new IllegalArgumentException("dest_addr must be 7-15 digits (E.164 without +)"));
            return;
        }

        String encodingStr = getStringOrDefault(body, "encoding", "GSM7");
        MessageEncoding encoding;
        try {
            encoding = MessageEncoding.valueOf(encodingStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            ctx.fail(400, new IllegalArgumentException("encoding must be GSM7, UCS2, or LATIN1"));
            return;
        }

        final String finalSource = sourceAddr.length() > 20 ? sourceAddr.substring(0, 20) : sourceAddr;
        final String finalDest   = normalizedDest;
        final MessageEncoding finalEncoding = encoding;
        final String finalClientRef = clientRef;

        blocking.executeAsync(() -> {
            // Idempotency: nếu cùng (partner_id, client_ref) đã có → trả lại message cũ.
            if (finalClientRef != null) {
                Optional<Message> existing =
                        messageRepo.findByPartnerIdAndClientRef(pc.partnerId(), finalClientRef);
                if (existing.isPresent()) {
                    Message m = existing.get();
                    return Map.of(
                            "message_id", m.getId().toString(),
                            "client_ref", finalClientRef,
                            "status", m.getState().name(),
                            "created_at", m.getCreatedAt().toString(),
                            "duplicate", true
                    );
                }
            }

            Partner partnerRef = partnerRepo.getReferenceById(pc.partnerId());
            Message msg = new Message();
            msg.setPartner(partnerRef);
            msg.setSourceAddr(finalSource);
            msg.setDestAddr(finalDest);
            msg.setContent(content);
            msg.setEncoding(finalEncoding);
            msg.setInboundVia(InboundVia.HTTP);
            msg.setState(MessageState.RECEIVED);
            msg.setClientRef(finalClientRef);
            Message saved = messageRepo.save(msg);

            InboundMessageEvent event = new InboundMessageEvent(
                    saved.getId(), pc.partnerId(), finalSource, finalDest,
                    content, finalEncoding.name(), "HTTP", null);
            publisher.publish(event);

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("message_id", saved.getId().toString());
            if (finalClientRef != null) resp.put("client_ref", finalClientRef);
            resp.put("status", "ACCEPTED");
            resp.put("created_at", saved.getCreatedAt().toString());
            return resp;
        }).onSuccess(result -> {
            int status = Boolean.TRUE.equals(result.get("duplicate")) ? 200 : 202;
            HandlerUtils.respondJson(ctx, status, result);
        }).onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/v1/messages/:id
    public void getById(RoutingContext ctx) {
        PartnerContext pc = ApiKeyHmacAuthHandler.from(ctx);
        String idStr = ctx.pathParam("id");
        UUID id;
        try {
            id = UUID.fromString(idStr);
        } catch (IllegalArgumentException e) {
            ctx.fail(400, new IllegalArgumentException("Invalid message id format"));
            return;
        }

        final UUID finalId = id;
        blocking.executeAsync(() -> {
            Message msg = messageRepo.findById(finalId)
                    .orElseThrow(() -> new jakarta.persistence.EntityNotFoundException("Message not found"));
            if (!msg.getPartner().getId().equals(pc.partnerId())) {
                throw new jakarta.persistence.EntityNotFoundException("Message not found");
            }
            return toResponse(msg);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/v1/messages
    //   ?state=RECEIVED|ROUTED|SUBMITTED|DELIVERED|FAILED
    //   ?dest_addr=8496xxxxxxxx
    //   ?from=2026-01-01T00:00:00Z &to=2026-12-31T23:59:59Z
    //   ?page=0 &size=20 (max 100)
    public void list(RoutingContext ctx) {
        PartnerContext pc = ApiKeyHmacAuthHandler.from(ctx);
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);

        // Optional filters
        MessageState state = null;
        String stateParam = ctx.queryParams().get("state");
        if (stateParam != null && !stateParam.isBlank()) {
            try {
                state = MessageState.valueOf(stateParam.toUpperCase());
            } catch (IllegalArgumentException e) {
                ctx.fail(400, new IllegalArgumentException(
                        "state must be one of RECEIVED/ROUTED/SUBMITTED/DELIVERED/FAILED"));
                return;
            }
        }

        String destAddr = ctx.queryParams().get("dest_addr");
        if (destAddr != null) {
            destAddr = destAddr.isBlank() ? null : normalizeDestAddr(destAddr);
        }

        OffsetDateTime from = parseIso(ctx, "from");
        if (ctx.response().ended()) return;
        OffsetDateTime to = parseIso(ctx, "to");
        if (ctx.response().ended()) return;

        final MessageState fState = state;
        final String fDest = destAddr;
        final OffsetDateTime fFrom = from;
        final OffsetDateTime fTo = to;

        blocking.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
            Page<Message> paged = messageRepo.searchPartnerMessages(
                    pc.partnerId(), fState, fDest, fFrom, fTo, pr);
            List<Map<String, Object>> items = paged.getContent().stream()
                    .map(this::toResponse)
                    .toList();
            return Map.of(
                    "items", items,
                    "page", paged.getNumber(),
                    "size", paged.getSize(),
                    "total", paged.getTotalElements()
            );
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    private OffsetDateTime parseIso(RoutingContext ctx, String name) {
        String v = ctx.queryParams().get(name);
        if (v == null || v.isBlank()) return null;
        try {
            return OffsetDateTime.parse(v);
        } catch (DateTimeParseException e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\""
                            + name + " must be ISO-8601 (vd 2026-01-01T00:00:00Z)\"}");
            return null;
        }
    }

    private Map<String, Object> toResponse(Message msg) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("message_id", msg.getId().toString());
        if (msg.getClientRef() != null) r.put("client_ref", msg.getClientRef());
        r.put("state", msg.getState().name());
        r.put("source_addr", msg.getSourceAddr());
        r.put("dest_addr", msg.getDestAddr());
        r.put("encoding", msg.getEncoding().name());
        r.put("inbound_via", msg.getInboundVia().name());
        r.put("error_code", msg.getErrorCode());
        r.put("message_id_telco", msg.getMessageIdTelco());
        r.put("created_at", msg.getCreatedAt().toString());
        r.put("updated_at", msg.getUpdatedAt().toString());
        return r;
    }

    private static String getString(JsonNode node, String field) {
        JsonNode n = node.get(field);
        return (n != null && !n.isNull()) ? n.asText(null) : null;
    }

    private static String getStringOrDefault(JsonNode node, String field, String def) {
        JsonNode n = node.get(field);
        return (n != null && !n.isNull()) ? n.asText(def) : def;
    }

    static String normalizeDestAddr(String dest) {
        if (dest == null) return "";
        String d = dest.trim().replaceAll("[\\s\\-]", "");
        if (d.startsWith("+")) d = d.substring(1);
        if (d.startsWith("00")) d = d.substring(2);
        if (d.startsWith("0")) d = "84" + d.substring(1);
        return d;
    }
}
