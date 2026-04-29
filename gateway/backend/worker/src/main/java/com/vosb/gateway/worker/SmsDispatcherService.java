package com.vosb.gateway.worker;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.core.domain.enums.ChannelType;
import com.vosb.gateway.worker.sms.*;
import com.vosb.gateway.worker.telco.TelcoSmppDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Dispatches SMS delivery to the appropriate provider:
 *  - TELCO_SMPP channels: TelcoSmppDispatcher (outbound SMPP client)
 *  - HTTP_THIRD_PARTY channels: per-provider HTTP caller (SpeedSMS, eSMS, etc.)
 */
@Service
public class SmsDispatcherService {

    private static final Logger log = LoggerFactory.getLogger(SmsDispatcherService.class);

    public record DispatchResult(boolean success, String providerMessageId, String error) {}

    private final TelcoSmppDispatcher telcoSmppDispatcher;
    private final SpeedSmsCaller speedSmsCaller;
    private final ESmsCaller eSmsCaller;
    private final VietguysCaller vietguysCaller;
    private final AbenlaCaller abenlaCaller;
    private final InfobipCaller infobipCaller;
    private final CustomHttpSmsCaller customCaller;

    public SmsDispatcherService(TelcoSmppDispatcher telcoSmppDispatcher,
                                SpeedSmsCaller speedSmsCaller,
                                ESmsCaller eSmsCaller,
                                VietguysCaller vietguysCaller,
                                AbenlaCaller abenlaCaller,
                                InfobipCaller infobipCaller,
                                CustomHttpSmsCaller customCaller) {
        this.telcoSmppDispatcher = telcoSmppDispatcher;
        this.speedSmsCaller = speedSmsCaller;
        this.eSmsCaller = eSmsCaller;
        this.vietguysCaller = vietguysCaller;
        this.abenlaCaller = abenlaCaller;
        this.infobipCaller = infobipCaller;
        this.customCaller = customCaller;
    }

    public DispatchResult dispatch(Channel channel, String sourceAddr, String destAddr,
                                   String content, UUID messageId) {
        if (channel.getType() == ChannelType.TELCO_SMPP) {
            SmsSendResult raw = telcoSmppDispatcher.dispatch(channel, sourceAddr, destAddr, content);
            return new DispatchResult(raw.success(), raw.providerMessageId(), raw.error());
        }

        JsonNode config = channel.getConfig();
        String providerCode = config.path("provider_code").asText("");

        log.info("Dispatching SMS via provider={} to={}", providerCode, destAddr);

        SmsSendResult raw = switch (providerCode) {
            case "SPEEDSMS" -> speedSmsCaller.send(config, sourceAddr, destAddr, content);
            case "ESMS"     -> eSmsCaller.send(config, sourceAddr, destAddr, content);
            case "VIETGUYS" -> vietguysCaller.send(config, sourceAddr, destAddr, content);
            case "ABENLA"   -> abenlaCaller.send(config, sourceAddr, destAddr, content);
            case "INFOBIP"  -> infobipCaller.send(config, sourceAddr, destAddr, content);
            case "CUSTOM"   -> customCaller.send(config, sourceAddr, destAddr, content, messageId.toString());
            default -> {
                log.error("Unsupported SMS provider: {}", providerCode);
                yield new SmsSendResult(false, null, "Unsupported provider: " + providerCode);
            }
        };

        if (raw.success()) {
            log.info("SMS dispatched ok: provider={} msgId={} providerMsgId={}",
                    providerCode, messageId, raw.providerMessageId());
        } else {
            log.warn("SMS dispatch failed: provider={} msgId={} error={}",
                    providerCode, messageId, raw.error());
        }

        return new DispatchResult(raw.success(), raw.providerMessageId(), raw.error());
    }
}
