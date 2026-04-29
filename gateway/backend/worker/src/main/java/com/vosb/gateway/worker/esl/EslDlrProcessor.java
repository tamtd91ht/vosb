package com.vosb.gateway.worker.esl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.vosb.gateway.core.domain.Dlr;
import com.vosb.gateway.core.domain.Message;
import com.vosb.gateway.core.domain.enums.DlrSource;
import com.vosb.gateway.core.domain.enums.DlrState;
import com.vosb.gateway.core.domain.enums.MessageState;
import com.vosb.gateway.core.repository.DlrRepository;
import com.vosb.gateway.core.repository.MessageRepository;
import link.thingscloud.freeswitch.esl.transport.event.EslEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Correlates FreeSWITCH {@code CHANNEL_HANGUP_COMPLETE} events with the
 * outgoing voice-OTP message that initiated the call. On match it writes a
 * row into {@code dlr} (source = FREESWITCH_ESL) and updates {@code Message.state}.
 *
 * Voice OTP has no partner DLR webhook in this phase, so unlike
 * {@code TelcoDlrProcessor} we do NOT publish to AMQP.
 */
@Component
public class EslDlrProcessor {

    private static final Logger log = LoggerFactory.getLogger(EslDlrProcessor.class);

    private static final Set<String> EXPIRED_CAUSES = Set.of(
            "NO_ANSWER", "USER_BUSY", "NO_USER_RESPONSE", "ALLOTTED_TIMEOUT",
            "CALL_REJECTED", "ORIGINATOR_CANCEL");

    private final MessageRepository messageRepo;
    private final DlrRepository dlrRepo;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, PendingCall> pending = new ConcurrentHashMap<>();
    private final ScheduledExecutorService cleaner = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "esl-pending-cleaner");
        t.setDaemon(true);
        return t;
    });

    public EslDlrProcessor(MessageRepository messageRepo,
                           DlrRepository dlrRepo,
                           ObjectMapper objectMapper) {
        this.messageRepo = messageRepo;
        this.dlrRepo = dlrRepo;
        this.objectMapper = objectMapper;
    }

    public void registerPending(String uuid, UUID messageId, Long channelId, int timeoutMs) {
        pending.put(uuid, new PendingCall(messageId, channelId));
        long ttl = (long) timeoutMs + 60_000L;
        cleaner.schedule(() -> {
            PendingCall removed = pending.remove(uuid);
            if (removed != null) {
                log.warn("ESL pending call expired without hangup: uuid={} msg={}", uuid, removed.messageId);
            }
        }, ttl, TimeUnit.MILLISECONDS);
    }

    public void onHangupComplete(Long channelId, EslEvent event) {
        Map<String, String> headers = event.getEventHeaders();
        String uuid = headers.get("Unique-ID");
        if (uuid == null) {
            log.debug("ESL hangup event without Unique-ID: channel={}", channelId);
            return;
        }
        PendingCall p = pending.remove(uuid);
        if (p == null) {
            // Might be an inbound or unrelated channel — ignore quietly.
            return;
        }

        String cause = headers.getOrDefault("Hangup-Cause", "UNKNOWN");
        DlrState state = mapCause(cause);
        process(p.messageId, channelId, state, cause, headers);
    }

    @Transactional
    void process(UUID messageId, Long channelId, DlrState state, String cause, Map<String, String> headers) {
        Message msg = messageRepo.findById(messageId).orElse(null);
        if (msg == null) {
            log.warn("ESL DLR: no message for id={} channel={}", messageId, channelId);
            return;
        }

        Dlr dlr = new Dlr();
        dlr.setMessage(msg);
        dlr.setState(state);
        dlr.setErrorCode(truncate(cause, 64));
        dlr.setSource(DlrSource.FREESWITCH_ESL);
        dlr.setRawPayload(objectMapper.valueToTree(headers));
        dlrRepo.save(dlr);

        MessageState newState = state == DlrState.DELIVERED
                ? MessageState.DELIVERED
                : MessageState.FAILED;
        messageRepo.updateState(msg.getId(), newState, truncate(cause, 64));

        log.info("ESL DLR processed: msg={} channel={} state={} cause={}",
                messageId, channelId, state, cause);
    }

    private static DlrState mapCause(String cause) {
        if ("NORMAL_CLEARING".equals(cause)) return DlrState.DELIVERED;
        if (EXPIRED_CAUSES.contains(cause)) return DlrState.EXPIRED;
        return DlrState.FAILED;
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    private record PendingCall(UUID messageId, Long channelId) {}
}
