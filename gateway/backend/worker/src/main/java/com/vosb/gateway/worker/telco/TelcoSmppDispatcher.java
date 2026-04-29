package com.vosb.gateway.worker.telco;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.worker.sms.SmsSendResult;
import org.jsmpp.bean.*;
import org.jsmpp.session.SMPPSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

/**
 * Dispatches SMS to a telco SMSC using an outbound SMPP client session
 * from TelcoSmppSessionPool. Requests DLR (registered_delivery = SUCCESS_FAILURE).
 */
@Component
public class TelcoSmppDispatcher {

    private static final Logger log = LoggerFactory.getLogger(TelcoSmppDispatcher.class);

    private final TelcoSmppSessionPool sessionPool;

    public TelcoSmppDispatcher(TelcoSmppSessionPool sessionPool) {
        this.sessionPool = sessionPool;
    }

    public SmsSendResult dispatch(Channel channel, String sourceAddr, String destAddr, String content) {
        Optional<SMPPSession> sessionOpt = sessionPool.getSession(channel.getId());
        if (sessionOpt.isEmpty()) {
            log.warn("No active SMPP session for channel={} dest={}", channel.getCode(), destAddr);
            return new SmsSendResult(false, null,
                    "No active SMPP session for channel " + channel.getCode());
        }

        SMPPSession session = sessionOpt.get();
        JsonNode config = channel.getConfig();

        String encodingCfg = config.path("encoding").asText("GSM7").toUpperCase();
        DataCoding dataCoding;
        byte[] msgBytes;
        if ("UCS2".equals(encodingCfg)) {
            dataCoding = new GeneralDataCoding(Alphabet.ALPHA_UCS2);
            msgBytes = content.getBytes(StandardCharsets.UTF_16BE);
        } else {
            dataCoding = new GeneralDataCoding(Alphabet.ALPHA_DEFAULT);
            msgBytes = content.getBytes(StandardCharsets.ISO_8859_1);
        }

        TypeOfNumber srcTon = ton(config.path("source_ton").asInt(5));
        NumberingPlanIndicator srcNpi = npi(config.path("source_npi").asInt(0));
        TypeOfNumber dstTon = ton(config.path("dest_ton").asInt(1));
        NumberingPlanIndicator dstNpi = npi(config.path("dest_npi").asInt(1));

        try {
            String telcoMsgId = session.submitShortMessage(
                    "",
                    srcTon, srcNpi, sourceAddr,
                    dstTon, dstNpi, destAddr,
                    new ESMClass(),
                    (byte) 0, (byte) 1,
                    null, null,
                    new RegisteredDelivery(SMSCDeliveryReceipt.SUCCESS_FAILURE),
                    (byte) 0,
                    dataCoding,
                    (byte) 0,
                    msgBytes).getMessageId();

            log.info("SMPP submit ok: channel={} dest={} telcoMsgId={}", channel.getCode(), destAddr, telcoMsgId);
            return new SmsSendResult(true, telcoMsgId, null);

        } catch (Exception e) {
            log.error("SMPP submit failed: channel={} dest={}: {}", channel.getCode(), destAddr, e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }

    private static TypeOfNumber ton(int v) {
        return switch (v) {
            case 1  -> TypeOfNumber.INTERNATIONAL;
            case 2  -> TypeOfNumber.NATIONAL;
            case 3  -> TypeOfNumber.NETWORK_SPECIFIC;
            case 4  -> TypeOfNumber.SUBSCRIBER_NUMBER;
            case 5  -> TypeOfNumber.ALPHANUMERIC;
            case 6  -> TypeOfNumber.ABBREVIATED;
            default -> TypeOfNumber.UNKNOWN;
        };
    }

    private static NumberingPlanIndicator npi(int v) {
        return switch (v) {
            case 1  -> NumberingPlanIndicator.ISDN;
            case 3  -> NumberingPlanIndicator.DATA;
            case 4  -> NumberingPlanIndicator.TELEX;
            case 6  -> NumberingPlanIndicator.LAND_MOBILE;
            case 8  -> NumberingPlanIndicator.NATIONAL;
            case 9  -> NumberingPlanIndicator.PRIVATE;
            default -> NumberingPlanIndicator.UNKNOWN;
        };
    }
}
