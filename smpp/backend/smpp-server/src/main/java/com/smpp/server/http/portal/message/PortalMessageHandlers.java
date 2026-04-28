package com.smpp.server.http.portal.message;

import com.smpp.core.domain.Message;
import com.smpp.core.domain.enums.MessageState;
import com.smpp.core.repository.MessageRepository;
import com.smpp.server.auth.AuthContext;
import com.smpp.server.auth.JwtAuthHandler;
import com.smpp.server.http.admin.dto.PageResponse;
import com.smpp.server.http.common.BlockingDispatcher;
import com.smpp.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class PortalMessageHandlers {

    private final MessageRepository messageRepo;
    private final BlockingDispatcher dispatcher;

    public PortalMessageHandlers(MessageRepository messageRepo, BlockingDispatcher dispatcher) {
        this.messageRepo = messageRepo;
        this.dispatcher = dispatcher;
    }

    // GET /api/portal/messages
    public void list(RoutingContext ctx) {
        AuthContext auth = JwtAuthHandler.from(ctx);
        Long partnerId = auth.partnerId();
        if (partnerId == null) { ctx.fail(403); return; }

        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);
        String stateParam   = ctx.queryParams().get("state");
        String destAddrParam = ctx.queryParams().get("dest_addr");

        dispatcher.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
            Page<Message> paged;

            if (stateParam != null && destAddrParam != null) {
                paged = messageRepo.findByPartnerIdAndState(
                        partnerId, MessageState.valueOf(stateParam.toUpperCase()), pr);
            } else if (stateParam != null) {
                paged = messageRepo.findByPartnerIdAndState(
                        partnerId, MessageState.valueOf(stateParam.toUpperCase()), pr);
            } else if (destAddrParam != null) {
                paged = messageRepo.findByPartnerIdAndDestAddr(partnerId, destAddrParam, pr);
            } else {
                paged = messageRepo.findByPartnerId(partnerId, pr);
            }

            List<Map<String, Object>> items = paged.getContent().stream().map(this::toResponse).toList();
            return PageResponse.of(items, paged.getTotalElements(), page, size);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/portal/messages/:id
    public void get(RoutingContext ctx) {
        AuthContext auth = JwtAuthHandler.from(ctx);
        Long partnerId = auth.partnerId();
        if (partnerId == null) { ctx.fail(403); return; }

        String idStr = ctx.pathParam("id");
        dispatcher.executeAsync(() -> {
            UUID id;
            try {
                id = UUID.fromString(idStr);
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("Invalid UUID format");
            }
            Message msg = messageRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Message not found: " + idStr));
            // IDOR guard
            if (!msg.getPartner().getId().equals(partnerId)) {
                throw new EntityNotFoundException("Message not found: " + idStr);
            }
            return toResponse(msg);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> {
              if (err instanceof IllegalArgumentException) {
                  ctx.response().setStatusCode(400)
                          .putHeader("Content-Type", "application/problem+json")
                          .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid UUID format\"}");
              } else {
                  HandlerUtils.handleError(ctx, err);
              }
          });
    }

    private Map<String, Object> toResponse(Message m) {
        Map<String, Object> r = new HashMap<>();
        r.put("id", m.getId().toString());
        r.put("source_addr", m.getSourceAddr());
        r.put("dest_addr", m.getDestAddr());
        r.put("content", m.getContent());
        r.put("encoding", m.getEncoding().name());
        r.put("inbound_via", m.getInboundVia().name());
        r.put("state", m.getState().name());
        r.put("channel_id", m.getChannel() != null ? m.getChannel().getId() : null);
        r.put("message_id_telco", m.getMessageIdTelco());
        r.put("error_code", m.getErrorCode());
        r.put("created_at", m.getCreatedAt() != null ? m.getCreatedAt().toString() : null);
        r.put("updated_at", m.getUpdatedAt() != null ? m.getUpdatedAt().toString() : null);
        return r;
    }
}
