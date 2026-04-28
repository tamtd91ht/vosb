package com.smpp.server.http.partner;

import com.fasterxml.jackson.databind.JsonNode;
import com.smpp.core.amqp.InboundMessageEvent;
import com.smpp.core.domain.Message;
import com.smpp.core.domain.Partner;
import com.smpp.core.domain.enums.InboundVia;
import com.smpp.core.domain.enums.MessageEncoding;
import com.smpp.core.domain.enums.MessageState;
import com.smpp.core.repository.MessageRepository;
import com.smpp.core.repository.PartnerRepository;
import com.smpp.server.auth.ApiKeyHmacAuthHandler;
import com.smpp.server.auth.PartnerContext;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import com.smpp.server.smpp.InboundMessagePublisher;
import io.vertx.ext.web.RoutingContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

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

        blocking.executeAsync(() -> {
            Partner partnerRef = partnerRepo.getReferenceById(pc.partnerId());
            Message msg = new Message();
            msg.setPartner(partnerRef);
            msg.setSourceAddr(finalSource);
            msg.setDestAddr(finalDest);
            msg.setContent(content);
            msg.setEncoding(finalEncoding);
            msg.setInboundVia(InboundVia.HTTP);
            msg.setState(MessageState.RECEIVED);
            Message saved = messageRepo.save(msg);

            InboundMessageEvent event = new InboundMessageEvent(
                    saved.getId(), pc.partnerId(), finalSource, finalDest,
                    content, finalEncoding.name(), "HTTP", null);
            publisher.publish(event);

            return Map.of(
                    "message_id", saved.getId().toString(),
                    "status", "ACCEPTED",
                    "created_at", saved.getCreatedAt().toString()
            );
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 202, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
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
    public void list(RoutingContext ctx) {
        PartnerContext pc = ApiKeyHmacAuthHandler.from(ctx);
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);

        blocking.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
            Page<Message> paged = messageRepo.findByPartnerId(pc.partnerId(), pr);
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

    private Map<String, Object> toResponse(Message msg) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("message_id", msg.getId().toString());
        r.put("state", msg.getState().name());
        r.put("source_addr", msg.getSourceAddr());
        r.put("dest_addr", msg.getDestAddr());
        r.put("encoding", msg.getEncoding().name());
        r.put("inbound_via", msg.getInboundVia().name());
        r.put("error_code", msg.getErrorCode());
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
