package com.vosb.gateway.worker.esl;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.Channel;
import link.thingscloud.freeswitch.esl.InboundClient;
import link.thingscloud.freeswitch.esl.transport.message.EslMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Dispatches a VOICE_OTP call via FreeSWITCH ESL. The originate command runs
 * synchronously and returns either {@code +OK <uuid>} or {@code -ERR <reason>}.
 * On success the UUID is registered with {@link EslDlrProcessor} so the
 * subsequent {@code CHANNEL_HANGUP_COMPLETE} event can be correlated back
 * to the message.
 */
@Component
public class FreeSwitchEslDispatcher {

    private static final Logger log = LoggerFactory.getLogger(FreeSwitchEslDispatcher.class);

    public record DispatchResult(boolean success, String uuid, String error) {}

    private final EslConnectionPool pool;
    private final EslDlrProcessor dlrProcessor;

    public FreeSwitchEslDispatcher(EslConnectionPool pool, EslDlrProcessor dlrProcessor) {
        this.pool = pool;
        this.dlrProcessor = dlrProcessor;
    }

    public DispatchResult dispatch(Channel channel, String destAddr, String content, UUID messageId) {
        Optional<String> addrOpt = pool.getAddr(channel.getId());
        Optional<InboundClient> clientOpt = pool.getClient();
        if (addrOpt.isEmpty() || clientOpt.isEmpty()) {
            return new DispatchResult(false, null,
                    "No active ESL connection for channel " + channel.getCode());
        }

        JsonNode config = channel.getConfig();
        String gateway      = config.path("gateway").asText();
        String wavFile      = config.path("wav_file").asText();
        String callerName   = config.path("caller_id_name").asText("OTP");
        String callerNumber = config.path("caller_id_number").asText("19001234");
        int timeoutMs       = config.path("timeout_ms").asInt(30_000);

        String args = String.format(
                "{origination_caller_id_name='%s',origination_caller_id_number='%s',originate_timeout=%d}sofia/gateway/%s/%s &playback(%s)",
                escape(callerName), escape(callerNumber),
                Math.max(1, timeoutMs / 1000),
                escape(gateway), escape(destAddr), escape(wavFile));

        try {
            EslMessage resp = clientOpt.get().sendSyncApiCommand(addrOpt.get(), "originate", args);
            List<String> body = resp.getBodyLines();
            String firstLine = body.isEmpty() ? "" : body.get(0).trim();
            if (firstLine.startsWith("+OK")) {
                String uuid = firstLine.substring(3).trim();
                dlrProcessor.registerPending(uuid, messageId, channel.getId(), timeoutMs);
                log.info("ESL originate ok: channel={} dest={} uuid={}", channel.getCode(), destAddr, uuid);
                return new DispatchResult(true, uuid, null);
            }
            log.warn("ESL originate failed: channel={} dest={} resp={}",
                    channel.getCode(), destAddr, firstLine);
            return new DispatchResult(false, null, firstLine.isEmpty() ? "Empty ESL response" : firstLine);
        } catch (Exception e) {
            log.error("ESL originate error: channel={} dest={}: {}",
                    channel.getCode(), destAddr, e.getMessage(), e);
            return new DispatchResult(false, null, e.getMessage());
        }
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("'", "");
    }
}
