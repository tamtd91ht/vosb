package com.vosb.gateway.server.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.amqp.AmqpConstants;
import com.vosb.gateway.core.amqp.DlrEvent;
import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.enums.DlrState;
import com.vosb.gateway.core.repository.PartnerRepository;
import com.vosb.gateway.server.smpp.SessionRegistry;
import org.jsmpp.InvalidResponseException;
import org.jsmpp.PDUException;
import org.jsmpp.bean.*;
import org.jsmpp.extra.NegativeResponseException;
import org.jsmpp.extra.ResponseTimeoutException;
import org.jsmpp.session.SMPPServerSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

@Component
public class DlrForwarder {

    private static final Logger log = LoggerFactory.getLogger(DlrForwarder.class);
    private static final DateTimeFormatter DLR_DATE = DateTimeFormatter.ofPattern("yyMMddHHmm").withZone(ZoneOffset.UTC);

    private final PartnerRepository partnerRepo;
    private final SessionRegistry sessionRegistry;
    private final HttpClient httpClient;

    public DlrForwarder(PartnerRepository partnerRepo,
                        SessionRegistry sessionRegistry,
                        @Value("${app.dlr.webhook-timeout-ms:5000}") int webhookTimeoutMs) {
        this.partnerRepo = partnerRepo;
        this.sessionRegistry = sessionRegistry;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(webhookTimeoutMs))
                .build();
    }

    @RabbitListener(queues = AmqpConstants.SMS_DLR_QUEUE)
    public void onDlr(DlrEvent event) {
        log.debug("DLR forward: msgId={} state={} partner={}", event.messageId(), event.state(), event.partnerId());

        List<SMPPServerSession> sessions = sessionRegistry.getActiveSessionsForPartner(event.partnerId());
        for (SMPPServerSession session : sessions) {
            try {
                sendDeliverSm(session, event);
                log.info("DLR forwarded via SMPP: msgId={} session={}", event.messageId(), session.getSessionId());
                return;
            } catch (PDUException | ResponseTimeoutException | InvalidResponseException | NegativeResponseException | IOException e) {
                log.warn("deliver_sm failed on session {}: {}", session.getSessionId(), e.getMessage());
            }
        }

        Partner partner = partnerRepo.findByIdAndIsDeletedFalse(event.partnerId()).orElse(null);
        if (partner == null) {
            log.info("DLR forward: partner {} not found or removed, DLR dropped for msgId={}",
                    event.partnerId(), event.messageId());
            return;
        }
        JsonNode webhook = partner.getDlrWebhook();
        if (webhook == null || !webhook.has("url") || webhook.get("url").asText().isBlank()) {
            log.info("DLR forward: partner {} has no webhook, DLR dropped for msgId={}", event.partnerId(), event.messageId());
            return;
        }
        sendWebhook(webhook, event);
    }

    private void sendDeliverSm(SMPPServerSession session, DlrEvent event)
            throws PDUException, ResponseTimeoutException, InvalidResponseException, NegativeResponseException, IOException {
        String doneDate = DLR_DATE.format(Instant.now());
        String stat = toStat(event.state());
        String err  = event.errorCode() != null ? event.errorCode() : "000";
        String msgId = event.messageId().toString().replace("-", "").substring(0, 16);

        String receipt = String.format(
                "id:%s sub:001 dlvrd:001 submit date:%s done date:%s stat:%s err:%s text:",
                msgId, doneDate, doneDate, stat, err);

        session.deliverShortMessage(
                "",
                TypeOfNumber.NATIONAL, NumberingPlanIndicator.ISDN, event.destAddr(),
                TypeOfNumber.NATIONAL, NumberingPlanIndicator.ISDN, event.sourceAddr(),
                new ESMClass(MessageMode.DEFAULT, MessageType.SMSC_DEL_RECEIPT, GSMSpecificFeature.DEFAULT),
                (byte) 0, (byte) 0,
                new RegisteredDelivery(SMSCDeliveryReceipt.DEFAULT),
                new GeneralDataCoding(),
                receipt.getBytes(StandardCharsets.ISO_8859_1));
    }

    private void sendWebhook(JsonNode webhook, DlrEvent event) {
        String url    = webhook.get("url").asText();
        String method = webhook.has("method") ? webhook.get("method").asText("POST").toUpperCase() : "POST";

        String body = buildWebhookBody(event);
        HttpRequest.Builder req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json; charset=utf-8");

        if (webhook.has("headers") && webhook.get("headers").isObject()) {
            webhook.get("headers").fields()
                    .forEachRemaining(e -> req.header(e.getKey(), e.getValue().asText()));
        }

        HttpRequest.BodyPublisher publisher = "GET".equalsIgnoreCase(method)
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8);

        try {
            HttpResponse<Void> resp = httpClient.send(req.method(method, publisher).build(),
                    HttpResponse.BodyHandlers.discarding());
            if (resp.statusCode() >= 200 && resp.statusCode() < 300) {
                log.info("DLR webhook ok: msgId={} partner={} status={}", event.messageId(), event.partnerId(), resp.statusCode());
            } else {
                log.warn("DLR webhook non-2xx: msgId={} partner={} status={}", event.messageId(), event.partnerId(), resp.statusCode());
            }
        } catch (IOException | InterruptedException e) {
            log.error("DLR webhook error: msgId={} partner={} url={} msg={}", event.messageId(), event.partnerId(), url, e.getMessage());
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        }
    }

    private static String buildWebhookBody(DlrEvent event) {
        String errValue = event.errorCode() != null
                ? "\"" + event.errorCode().replace("\"", "") + "\""
                : "null";
        return String.format(
                "{\"message_id\":\"%s\",\"state\":\"%s\",\"dest_addr\":\"%s\",\"error_code\":%s}",
                event.messageId(), event.state().name(), event.destAddr(), errValue);
    }

    private static String toStat(DlrState state) {
        return switch (state) {
            case DELIVERED -> "DELIVRD";
            case FAILED    -> "UNDELIV";
            case EXPIRED   -> "EXPIRED";
            default        -> "UNKNOWN";
        };
    }
}
