package com.vosb.gateway.server.smpp;

import com.vosb.gateway.core.amqp.InboundMessageEvent;
import com.vosb.gateway.core.domain.Message;
import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.enums.InboundVia;
import com.vosb.gateway.core.domain.enums.MessageEncoding;
import com.vosb.gateway.core.domain.enums.MessageState;
import com.vosb.gateway.core.repository.MessageRepository;
import com.vosb.gateway.core.repository.PartnerRepository;
import org.jsmpp.PDUStringException;
import org.jsmpp.SMPPConstant;
import org.jsmpp.bean.*;
import org.jsmpp.extra.ProcessRequestException;
import org.jsmpp.session.*;
import org.jsmpp.util.MessageId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class MessageReceiverListenerImpl implements ServerMessageReceiverListener {

    private static final Logger log = LoggerFactory.getLogger(MessageReceiverListenerImpl.class);

    private final SessionRegistry sessionRegistry;
    private final MessageRepository messageRepo;
    private final PartnerRepository partnerRepo;
    private final InboundMessagePublisher publisher;

    public MessageReceiverListenerImpl(SessionRegistry sessionRegistry,
                                       MessageRepository messageRepo,
                                       PartnerRepository partnerRepo,
                                       InboundMessagePublisher publisher) {
        this.sessionRegistry = sessionRegistry;
        this.messageRepo = messageRepo;
        this.partnerRepo = partnerRepo;
        this.publisher = publisher;
    }

    @Override
    public SubmitSmResult onAcceptSubmitSm(SubmitSm submitSm, SMPPServerSession session)
            throws ProcessRequestException {
        String sessionId = session.getSessionId();

        Long partnerId = sessionRegistry.getPartnerId(sessionId).orElseThrow(() ->
                new ProcessRequestException("session not registered", SMPPConstant.STAT_ESME_RSYSERR));

        String destAddr = EncodingUtils.normalizeDestAddr(submitSm.getDestAddress());
        if (!destAddr.matches("\\d{7,15}")) {
            throw new ProcessRequestException("invalid dest_addr", SMPPConstant.STAT_ESME_RINVDSTADR);
        }

        byte[] payload = submitSm.getShortMessage();
        if (payload == null) payload = new byte[0];
        if (payload.length > 140) {
            throw new ProcessRequestException("message too long", SMPPConstant.STAT_ESME_RINVMSGLEN);
        }

        byte dataCoding = submitSm.getDataCoding();
        String content = EncodingUtils.decode(payload, dataCoding);
        MessageEncoding encoding = EncodingUtils.encodingOf(dataCoding);
        String sourceAddr = submitSm.getSourceAddr() != null ? submitSm.getSourceAddr() : "";

        Partner partnerRef = partnerRepo.getReferenceById(partnerId);

        Message msg = new Message();
        msg.setPartner(partnerRef);
        msg.setSourceAddr(sourceAddr);
        msg.setDestAddr(destAddr);
        msg.setContent(content);
        msg.setEncoding(encoding);
        msg.setInboundVia(InboundVia.SMPP);
        msg.setState(MessageState.RECEIVED);
        msg = messageRepo.save(msg);

        InboundMessageEvent event = new InboundMessageEvent(
                msg.getId(), partnerId, sourceAddr, destAddr,
                content, encoding.name(), "SMPP", null);
        publisher.publish(event);

        log.info("submit_sm accepted: msgId={} partner={} dest={}", msg.getId(), partnerId, destAddr);

        try {
            return new SubmitSmResult(new MessageId(msg.getId().toString()), new OptionalParameter[0]);
        } catch (PDUStringException e) {
            throw new ProcessRequestException("message id encoding error", SMPPConstant.STAT_ESME_RSYSERR);
        }
    }

    @Override
    public SubmitMultiResult onAcceptSubmitMulti(SubmitMulti submitMulti, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("submit_multi not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public QuerySmResult onAcceptQuerySm(QuerySm querySm, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("query_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public void onAcceptReplaceSm(ReplaceSm replaceSm, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("replace_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public void onAcceptCancelSm(CancelSm cancelSm, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("cancel_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public BroadcastSmResult onAcceptBroadcastSm(BroadcastSm broadcastSm, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("broadcast_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public void onAcceptCancelBroadcastSm(CancelBroadcastSm cancelBroadcastSm, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("cancel_broadcast_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public QueryBroadcastSmResult onAcceptQueryBroadcastSm(QueryBroadcastSm queryBroadcastSm, SMPPServerSession session)
            throws ProcessRequestException {
        throw new ProcessRequestException("query_broadcast_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }

    @Override
    public DataSmResult onAcceptDataSm(DataSm dataSm, Session session)
            throws ProcessRequestException {
        throw new ProcessRequestException("data_sm not supported", SMPPConstant.STAT_ESME_RSYSERR);
    }
}
