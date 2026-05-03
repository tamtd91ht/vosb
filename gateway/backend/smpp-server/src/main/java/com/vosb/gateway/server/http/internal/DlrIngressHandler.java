package com.vosb.gateway.server.http.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.amqp.AmqpConstants;
import com.vosb.gateway.core.amqp.DlrEvent;
import com.vosb.gateway.core.domain.Dlr;
import com.vosb.gateway.core.domain.Message;
import com.vosb.gateway.core.domain.enums.DlrSource;
import com.vosb.gateway.core.domain.enums.DlrState;
import com.vosb.gateway.core.domain.enums.MessageState;
import com.vosb.gateway.core.repository.DlrRepository;
import com.vosb.gateway.core.repository.MessageRepository;
import com.vosb.gateway.server.http.common.BlockingDispatcher;
import com.vosb.gateway.server.http.common.HandlerUtils;
import io.vertx.ext.web.RoutingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class DlrIngressHandler {

    private static final Logger log = LoggerFactory.getLogger(DlrIngressHandler.class);

    private final MessageRepository messageRepo;
    private final DlrRepository dlrRepo;
    private final RabbitTemplate rabbitTemplate;
    private final BlockingDispatcher dispatcher;
    private final String internalSecret;

    public DlrIngressHandler(MessageRepository messageRepo,
                             DlrRepository dlrRepo,
                             RabbitTemplate rabbitTemplate,
                             BlockingDispatcher dispatcher,
                             @Value("${app.internal.secret:dev-internal-secret-change-me}") String internalSecret) {
        this.messageRepo = messageRepo;
        this.dlrRepo = dlrRepo;
        this.rabbitTemplate = rabbitTemplate;
        this.dispatcher = dispatcher;
        this.internalSecret = internalSecret;
    }

    // POST /api/internal/dlr/:channelId
    public void ingestDlr(RoutingContext ctx) {
        String secret = ctx.request().getHeader("X-Internal-Secret");
        if (!internalSecret.equals(secret)) {
            ctx.response().setStatusCode(401)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":401,\"title\":\"Unauthorized\",\"detail\":\"Invalid internal secret\"}");
            return;
        }

        JsonNode body;
        try {
            body = HandlerUtils.parseBody(ctx, JsonNode.class);
        } catch (Exception e) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"Invalid JSON body\"}");
            return;
        }

        String telcoMsgId = getString(body, "telco_message_id");
        String stateStr   = getString(body, "state");
        String errorCode  = getString(body, "error_code");

        if (telcoMsgId == null || stateStr == null) {
            ctx.response().setStatusCode(400)
                    .putHeader("Content-Type", "application/problem+json; charset=utf-8")
                    .end("{\"status\":400,\"title\":\"Bad Request\",\"detail\":\"telco_message_id and state are required\"}");
            return;
        }

        DlrState dlrState;
        try {
            dlrState = DlrState.valueOf(stateStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            dlrState = DlrState.UNKNOWN;
        }

        final DlrState finalState = dlrState;
        final String finalErrorCode = errorCode != null ? errorCode.substring(0, Math.min(64, errorCode.length())) : null;
        final JsonNode rawPayload = body;

        dispatcher.executeAsync(() -> {
            Optional<Message> msgOpt = messageRepo.findByMessageIdTelco(telcoMsgId);
            if (msgOpt.isEmpty()) {
                log.warn("DLR ingress: no message found for telco_message_id={}", telcoMsgId);
                return null;
            }
            Message msg = msgOpt.get();

            Dlr dlr = new Dlr();
            dlr.setMessage(msg);
            dlr.setState(finalState);
            dlr.setErrorCode(finalErrorCode);
            dlr.setRawPayload(rawPayload);
            dlr.setSource(DlrSource.HTTP_WEBHOOK);
            dlrRepo.save(dlr);

            MessageState newState = switch (finalState) {
                case DELIVERED -> MessageState.DELIVERED;
                default -> MessageState.FAILED;
            };
            messageRepo.updateState(msg.getId(), newState, finalErrorCode);

            // partnerId accessible without session — Hibernate stores FK in proxy
            Long partnerId = msg.getPartner().getId();
            DlrEvent event = new DlrEvent(
                    msg.getId(), partnerId,
                    msg.getSourceAddr(), msg.getDestAddr(),
                    finalState, finalErrorCode, telcoMsgId);
            rabbitTemplate.convertAndSend(AmqpConstants.SMS_DLR_EXCHANGE, "dlr." + partnerId, event);
            log.info("DLR ingested: msgId={} state={} partner={}", msg.getId(), finalState, partnerId);
            return null;
        }).onSuccess(ignored -> ctx.response().setStatusCode(204).end())
          .onFailure(err -> {
              log.error("DLR ingress error: {}", err.getMessage(), err);
              HandlerUtils.handleError(ctx, err);
          });
    }

    private static String getString(JsonNode node, String field) {
        if (node == null) return null;
        JsonNode n = node.get(field);
        return (n != null && !n.isNull()) ? n.asText(null) : null;
    }
}
