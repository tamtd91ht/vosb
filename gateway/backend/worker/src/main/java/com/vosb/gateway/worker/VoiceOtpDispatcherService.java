package com.vosb.gateway.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.worker.esl.FreeSwitchEslDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Dispatches VOICE_OTP delivery to the appropriate provider caller
 * based on channel.config.provider_code.
 */
@Service
public class VoiceOtpDispatcherService {

    private static final Logger log = LoggerFactory.getLogger(VoiceOtpDispatcherService.class);

    public record DispatchResult(boolean success, String providerMessageId, String error) {}

    private final TwoMobileVoiceCaller twoMobileCaller;
    private final FreeSwitchEslDispatcher eslDispatcher;

    public VoiceOtpDispatcherService(TwoMobileVoiceCaller twoMobileCaller,
                                     FreeSwitchEslDispatcher eslDispatcher) {
        this.twoMobileCaller = twoMobileCaller;
        this.eslDispatcher = eslDispatcher;
    }

    public DispatchResult dispatch(Channel channel, String destAddr, String content, UUID messageId) {
        JsonNode config = channel.getConfig();
        String providerCode = config.path("provider_code").asText("");

        log.info("Dispatching VOICE_OTP via provider={} to={}", providerCode, destAddr);

        return switch (providerCode) {
            case "2TMOBILE_VOICE" -> dispatchTwoMobile(config, destAddr, content);
            case "FREESWITCH_ESL" -> dispatchEsl(channel, destAddr, content, messageId);
            default -> {
                log.error("Unsupported Voice OTP provider: {}", providerCode);
                yield new DispatchResult(false, null, "Unsupported provider: " + providerCode);
            }
        };
    }

    private DispatchResult dispatchTwoMobile(JsonNode config, String destAddr, String content) {
        String url      = config.path("url").asText("http://123.30.145.12/voiceapi/call");
        String username = config.path("username").asText("");
        String password = config.path("password").asText("");
        String sender   = config.path("sender").asText("");
        int timeoutMs   = config.path("timeout_ms").asInt(10_000);

        TwoMobileVoiceCaller.CallResult result =
                twoMobileCaller.call(url, username, password, sender, destAddr, content, timeoutMs);

        if (result.success()) {
            log.info("2T-Mobile call success: callId={} pid={}", result.callId(), result.pid());
            return new DispatchResult(true, result.callId(), null);
        } else {
            String error = "2T-Mobile error code=" + result.code() + " desc=" + result.description();
            log.warn("2T-Mobile call failed: {}", error);
            return new DispatchResult(false, null, error);
        }
    }

    private DispatchResult dispatchEsl(Channel channel, String destAddr, String content, UUID messageId) {
        FreeSwitchEslDispatcher.DispatchResult r = eslDispatcher.dispatch(channel, destAddr, content, messageId);
        return new DispatchResult(r.success(), r.uuid(), r.error());
    }
}
