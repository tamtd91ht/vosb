package com.vosb.gateway.worker.telco;

import com.vosb.gateway.core.amqp.AmqpConstants;
import com.vosb.gateway.core.amqp.DlrEvent;
import com.vosb.gateway.core.domain.Dlr;
import com.vosb.gateway.core.domain.Message;
import com.vosb.gateway.core.domain.enums.DlrSource;
import com.vosb.gateway.core.domain.enums.DlrState;
import com.vosb.gateway.core.domain.enums.MessageState;
import com.vosb.gateway.core.repository.DlrRepository;
import com.vosb.gateway.core.repository.MessageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Processes incoming DLR receipts from a telco SMSC (via deliver_sm on
 * the outbound SMPP client session). Mirrors DlrIngressHandler but runs
 * on the jSMPP listener thread and uses DlrSource.TELCO_SMPP.
 */
@Component
public class TelcoDlrProcessor {

    private static final Logger log = LoggerFactory.getLogger(TelcoDlrProcessor.class);

    private final MessageRepository messageRepo;
    private final DlrRepository dlrRepo;
    private final RabbitTemplate rabbitTemplate;

    public TelcoDlrProcessor(MessageRepository messageRepo,
                             DlrRepository dlrRepo,
                             RabbitTemplate rabbitTemplate) {
        this.messageRepo = messageRepo;
        this.dlrRepo = dlrRepo;
        this.rabbitTemplate = rabbitTemplate;
    }

    @Transactional
    public void process(Long channelId, String telcoMessageId, DlrState state, String errorCode) {
        Message msg = messageRepo.findByMessageIdTelco(telcoMessageId).orElse(null);
        if (msg == null) {
            log.warn("Telco DLR: no message for telcoId={} channelId={}", telcoMessageId, channelId);
            return;
        }

        Dlr dlr = new Dlr();
        dlr.setMessage(msg);
        dlr.setState(state);
        dlr.setErrorCode(truncate(errorCode, 64));
        dlr.setSource(DlrSource.TELCO_SMPP);
        dlrRepo.save(dlr);

        MessageState newState = state == DlrState.DELIVERED ? MessageState.DELIVERED : MessageState.FAILED;
        messageRepo.updateState(msg.getId(), newState, truncate(errorCode, 64));

        Long partnerId = msg.getPartner().getId();
        DlrEvent event = new DlrEvent(
                msg.getId(), partnerId,
                msg.getSourceAddr(), msg.getDestAddr(),
                state, errorCode, telcoMessageId);
        rabbitTemplate.convertAndSend(AmqpConstants.SMS_DLR_EXCHANGE, "dlr." + partnerId, event);

        log.info("Telco DLR processed: telcoId={} state={} partner={}", telcoMessageId, state, partnerId);
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
