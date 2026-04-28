package com.smpp.server.http.admin.message;

import com.smpp.core.domain.Message;
import com.smpp.core.domain.enums.MessageState;
import com.smpp.core.repository.MessageRepository;
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
public class MessageHandlers {

    private final MessageRepository messageRepo;
    private final BlockingDispatcher dispatcher;

    public MessageHandlers(MessageRepository messageRepo, BlockingDispatcher dispatcher) {
        this.messageRepo = messageRepo;
        this.dispatcher = dispatcher;
    }

    // GET /api/admin/messages
    public void list(RoutingContext ctx) {
        int page = HandlerUtils.getPage(ctx);
        int size = HandlerUtils.getSize(ctx);
        String partnerIdParam = ctx.queryParams().get("partner_id");
        String stateParam = ctx.queryParams().get("state");
        String destAddrParam = ctx.queryParams().get("dest_addr");

        dispatcher.executeAsync(() -> {
            PageRequest pr = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
            Page<Message> paged;

            if (partnerIdParam != null && stateParam != null) {
                paged = messageRepo.findByPartnerIdAndState(
                        Long.parseLong(partnerIdParam),
                        MessageState.valueOf(stateParam.toUpperCase()), pr);
            } else if (partnerIdParam != null && destAddrParam != null) {
                paged = messageRepo.findByPartnerIdAndDestAddr(Long.parseLong(partnerIdParam), destAddrParam, pr);
            } else if (partnerIdParam != null) {
                paged = messageRepo.findByPartnerId(Long.parseLong(partnerIdParam), pr);
            } else if (stateParam != null) {
                paged = messageRepo.findByState(MessageState.valueOf(stateParam.toUpperCase()), pr);
            } else if (destAddrParam != null) {
                paged = messageRepo.findByDestAddr(destAddrParam, pr);
            } else {
                paged = messageRepo.findAll(pr);
            }

            List<Map<String, Object>> items = paged.getContent().stream().map(this::toResponse).toList();
            return PageResponse.of(items, paged.getTotalElements(), page, size);
        }).onSuccess(result -> HandlerUtils.respondJson(ctx, 200, result))
          .onFailure(err -> HandlerUtils.handleError(ctx, err));
    }

    // GET /api/admin/messages/:id
    public void get(RoutingContext ctx) {
        String idStr = ctx.pathParam("id");
        dispatcher.executeAsync(() -> {
            UUID id = UUID.fromString(idStr);
            Message msg = messageRepo.findById(id)
                    .orElseThrow(() -> new EntityNotFoundException("Message not found: " + idStr));
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
        Map<String, Object> map = new HashMap<>();
        map.put("id", m.getId().toString());
        map.put("partner_id", m.getPartner().getId());
        map.put("channel_id", m.getChannel() != null ? m.getChannel().getId() : null);
        map.put("source_addr", m.getSourceAddr());
        map.put("dest_addr", m.getDestAddr());
        map.put("content", m.getContent());
        map.put("encoding", m.getEncoding().name());
        map.put("inbound_via", m.getInboundVia().name());
        map.put("state", m.getState().name());
        map.put("message_id_telco", m.getMessageIdTelco());
        map.put("error_code", m.getErrorCode());
        map.put("created_at", m.getCreatedAt() != null ? m.getCreatedAt().toString() : "");
        map.put("updated_at", m.getUpdatedAt() != null ? m.getUpdatedAt().toString() : "");
        return map;
    }
}
