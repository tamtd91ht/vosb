package com.vosb.gateway.worker.telco;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.core.domain.enums.ChannelStatus;
import com.vosb.gateway.core.domain.enums.ChannelType;
import com.vosb.gateway.core.domain.enums.DlrState;
import com.vosb.gateway.core.repository.ChannelRepository;
import jakarta.annotation.PreDestroy;
import org.jsmpp.bean.*;
import org.jsmpp.extra.ProcessRequestException;
import org.jsmpp.extra.SessionState;
import org.jsmpp.session.*;
import org.jsmpp.util.DeliveryReceiptState;
import org.jsmpp.util.InvalidDeliveryReceiptException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Manages outbound SMPP client sessions to telco SMSCs.
 * One session per ACTIVE TELCO_SMPP channel. Auto-reconnects on disconnect.
 * Incoming deliver_sm (DLR receipts) are forwarded to TelcoDlrProcessor.
 */
@Component
public class TelcoSmppSessionPool {

    private static final Logger log = LoggerFactory.getLogger(TelcoSmppSessionPool.class);

    private final ChannelRepository channelRepo;
    private final TelcoDlrProcessor dlrProcessor;
    private final ConcurrentHashMap<Long, SMPPSession> sessions = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2,
            r -> { Thread t = new Thread(r, "smpp-reconnect"); t.setDaemon(true); return t; });

    public TelcoSmppSessionPool(ChannelRepository channelRepo, TelcoDlrProcessor dlrProcessor) {
        this.channelRepo = channelRepo;
        this.dlrProcessor = dlrProcessor;
    }

    // Called lazily from Spring lifecycle (lazy bean or @EventListener ApplicationReadyEvent)
    // to avoid blocking context startup if SMSC is down.
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    public void init() {
        List<Channel> telcoChannels;
        try {
            telcoChannels = channelRepo
                    .findByTypeAndStatus(ChannelType.TELCO_SMPP, ChannelStatus.ACTIVE, Pageable.unpaged())
                    .getContent();
        } catch (Exception e) {
            log.error("Failed to load TELCO_SMPP channels from DB: {}", e.getMessage());
            return;
        }

        for (Channel ch : telcoChannels) {
            JsonNode cfg = ch.getConfig();
            try {
                doConnect(ch.getId(), cfg);
            } catch (Exception e) {
                log.error("SMPP init failed for channel {} ({}:{}): {}",
                        ch.getCode(), cfg.path("host").asText(), cfg.path("port").asInt(),
                        e.getMessage());
                long delay = cfg.path("reconnect_delay_ms").asLong(5_000);
                scheduleReconnect(ch.getId(), delay);
            }
        }
    }

    public Optional<SMPPSession> getSession(Long channelId) {
        SMPPSession s = sessions.get(channelId);
        if (s != null && s.getSessionState().isBound()) return Optional.of(s);
        return Optional.empty();
    }

    private void doConnect(Long channelId, JsonNode config) throws IOException {
        String host       = config.path("host").asText();
        int    port       = config.path("port").asInt(2775);
        String systemId   = config.path("system_id").asText();
        String password   = config.path("password").asText();
        String systemType = config.path("system_type").asText("");
        int  enquireLinkMs = config.path("enquire_link_ms").asInt(30_000);
        long reconnectMs   = config.path("reconnect_delay_ms").asLong(5_000);

        SMPPSession session = new SMPPSession();
        session.setEnquireLinkTimer(enquireLinkMs);
        session.setMessageReceiverListener(new TelcoDlrListener(channelId, dlrProcessor));
        session.addSessionStateListener((newState, oldState, src) -> {
            if (!newState.isBound() && newState != SessionState.OPEN) {
                log.warn("SMPP session channel={} state {} → {} — reconnecting in {}ms",
                        channelId, oldState, newState, reconnectMs);
                sessions.remove(channelId);
                scheduleReconnect(channelId, reconnectMs);
            }
        });

        session.connectAndBind(host, port, new BindParameter(
                BindType.BIND_TRX, systemId, password, systemType,
                TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, null));

        sessions.put(channelId, session);
        log.info("SMPP session bound: channel={} system_id={} host={}:{}", channelId, systemId, host, port);
    }

    private void scheduleReconnect(Long channelId, long delayMs) {
        scheduler.schedule(() -> {
            Channel ch;
            try {
                ch = channelRepo.findById(channelId).orElse(null);
            } catch (Exception e) {
                log.error("Reconnect: DB unavailable for channel {}: {}", channelId, e.getMessage());
                scheduleReconnect(channelId, delayMs);
                return;
            }
            if (ch == null || ch.getStatus() != ChannelStatus.ACTIVE || ch.getType() != ChannelType.TELCO_SMPP) {
                log.info("SMPP reconnect skipped: channel {} is no longer active TELCO_SMPP", channelId);
                return;
            }
            try {
                doConnect(channelId, ch.getConfig());
            } catch (Exception e) {
                log.error("SMPP reconnect failed for channel {}: {}", channelId, e.getMessage());
                scheduleReconnect(channelId, delayMs);
            }
        }, delayMs, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    void shutdown() {
        scheduler.shutdown();
        sessions.values().forEach(s -> {
            try { s.unbindAndClose(); } catch (Exception ignored) {}
        });
        log.info("TelcoSmppSessionPool shut down, {} sessions closed", sessions.size());
    }

    // Per-session DLR receipt listener (plain object, not a Spring bean).
    private static final class TelcoDlrListener implements MessageReceiverListener {

        private static final Logger log = LoggerFactory.getLogger(TelcoDlrListener.class);

        private final Long channelId;
        private final TelcoDlrProcessor dlrProcessor;

        TelcoDlrListener(Long channelId, TelcoDlrProcessor dlrProcessor) {
            this.channelId = channelId;
            this.dlrProcessor = dlrProcessor;
        }

        @Override
        public void onAcceptDeliverSm(DeliverSm deliverSm) throws ProcessRequestException {
            // getEsmClass() returns raw byte in jSMPP 3.x — check DLR flag via MessageType.containedIn()
            if (MessageType.SMSC_DEL_RECEIPT.containedIn(deliverSm.getEsmClass())) {
                processReceipt(deliverSm);
            }
            // MO (mobile-originated) deliver_sm: not handled in this phase
        }

        private void processReceipt(DeliverSm deliverSm) {
            try {
                DeliveryReceipt receipt = deliverSm.getShortMessageAsDeliveryReceipt();

                String telcoId = receipt.getId();
                // getFinalStatus() returns DeliveryReceiptState enum in jSMPP 3.x
                DeliveryReceiptState finalStatus = receipt.getFinalStatus();

                DlrState state = switch (finalStatus) {
                    case DELIVRD          -> DlrState.DELIVERED;
                    case EXPIRED          -> DlrState.EXPIRED;
                    case UNDELIV, REJECTD, DELETED -> DlrState.FAILED;
                    default               -> DlrState.UNKNOWN;
                };

                // err field: jSMPP receipt text is "id:X ... err:000 ..."
                // Extract via raw text parse as err is not in jSMPP DeliveryReceipt
                String rawText = new String(deliverSm.getShortMessage(), StandardCharsets.ISO_8859_1);
                String err = extractField(rawText, "err:");

                log.debug("Telco DLR receipt: channel={} telcoId={} stat={} err={}", channelId, telcoId, finalStatus.name(), err);
                dlrProcessor.process(channelId, telcoId, state, err);

            } catch (InvalidDeliveryReceiptException e) {
                log.warn("Cannot parse delivery receipt for channel={}: {}", channelId, e.getMessage());
            } catch (Exception e) {
                log.error("DLR receipt error channel={}: {}", channelId, e.getMessage(), e);
            }
        }

        // Extract value of a "key:VALUE " field from SMSC receipt text.
        private static String extractField(String text, String key) {
            int idx = text.indexOf(key);
            if (idx < 0) return null;
            int start = idx + key.length();
            int end = text.indexOf(' ', start);
            return end < 0 ? text.substring(start) : text.substring(start, end);
        }

        @Override
        public void onAcceptAlertNotification(AlertNotification alertNotification) {}

        @Override
        public DataSmResult onAcceptDataSm(DataSm dataSm, Session source) throws ProcessRequestException {
            // 0x00000003 = ESME_RINVCMDID (invalid command id)
            throw new ProcessRequestException("data_sm not supported", 0x00000003);
        }
    }
}
