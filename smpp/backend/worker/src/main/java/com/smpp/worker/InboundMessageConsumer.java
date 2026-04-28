package com.smpp.worker;

import com.smpp.core.amqp.AmqpConstants;
import com.smpp.core.amqp.InboundMessageEvent;
import com.smpp.core.domain.Channel;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.domain.enums.MessageState;
import com.smpp.core.repository.MessageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class InboundMessageConsumer {

    private static final Logger log = LoggerFactory.getLogger(InboundMessageConsumer.class);

    private final RouteResolver routeResolver;
    private final VoiceOtpDispatcherService voiceOtpDispatcher;
    private final MessageRepository messageRepo;

    public InboundMessageConsumer(RouteResolver routeResolver,
                                  VoiceOtpDispatcherService voiceOtpDispatcher,
                                  MessageRepository messageRepo) {
        this.routeResolver = routeResolver;
        this.voiceOtpDispatcher = voiceOtpDispatcher;
        this.messageRepo = messageRepo;
    }

    @RabbitListener(queues = AmqpConstants.SMS_INBOUND_QUEUE)
    public void consume(InboundMessageEvent event) {
        log.info("Processing message id={} partner={} dest={} via={}",
                event.messageId(), event.partnerId(), event.destAddr(), event.inboundVia());

        Optional<Channel> channelOpt;
        try {
            channelOpt = routeResolver.resolve(event.partnerId(), event.destAddr());
        } catch (Exception e) {
            log.error("Route resolution failed for message {}: {}", event.messageId(), e.getMessage(), e);
            messageRepo.updateState(event.messageId(), MessageState.FAILED, "ROUTE_ERROR");
            return;
        }

        if (channelOpt.isEmpty()) {
            messageRepo.updateState(event.messageId(), MessageState.FAILED, "NO_ROUTE");
            return;
        }

        Channel channel = channelOpt.get();

        try {
            if (channel.getDeliveryType() == DeliveryType.VOICE_OTP) {
                handleVoiceOtp(event, channel);
            } else {
                // SMS dispatch handled in a future phase
                log.warn("SMS channel dispatch not yet implemented, message={} channel={}",
                        event.messageId(), channel.getCode());
                messageRepo.updateState(event.messageId(), MessageState.FAILED, "SMS_DISPATCH_NOT_IMPLEMENTED");
            }
        } catch (Exception e) {
            log.error("Dispatch error for message {}: {}", event.messageId(), e.getMessage(), e);
            messageRepo.updateState(event.messageId(), MessageState.FAILED, truncate(e.getMessage(), 64));
        }
    }

    private void handleVoiceOtp(InboundMessageEvent event, Channel channel) {
        VoiceOtpDispatcherService.DispatchResult result =
                voiceOtpDispatcher.dispatch(channel, event.destAddr(), event.content());

        if (result.success()) {
            messageRepo.updateStateAndTelcoId(
                    event.messageId(), MessageState.SUBMITTED, null, result.providerMessageId());
        } else {
            messageRepo.updateState(
                    event.messageId(), MessageState.FAILED, truncate(result.error(), 64));
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
