package com.smpp.worker;

import com.smpp.core.amqp.AmqpConstants;
import com.smpp.core.amqp.InboundMessageEvent;
import com.smpp.core.domain.Channel;
import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.core.domain.enums.MessageState;
import com.smpp.core.repository.MessageRepository;
import com.smpp.core.service.PartnerBalanceService;
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
    private final SmsDispatcherService smsDispatcher;
    private final MessageRepository messageRepo;
    private final CarrierResolver carrierResolver;
    private final PartnerBalanceService partnerBalanceService;

    public InboundMessageConsumer(RouteResolver routeResolver,
                                  VoiceOtpDispatcherService voiceOtpDispatcher,
                                  SmsDispatcherService smsDispatcher,
                                  MessageRepository messageRepo,
                                  CarrierResolver carrierResolver,
                                  PartnerBalanceService partnerBalanceService) {
        this.routeResolver = routeResolver;
        this.voiceOtpDispatcher = voiceOtpDispatcher;
        this.smsDispatcher = smsDispatcher;
        this.messageRepo = messageRepo;
        this.carrierResolver = carrierResolver;
        this.partnerBalanceService = partnerBalanceService;
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
                handleSms(event, channel);
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
            chargePartner(event, channel);
        } else {
            messageRepo.updateState(
                    event.messageId(), MessageState.FAILED, truncate(result.error(), 64));
        }
    }

    private void handleSms(InboundMessageEvent event, Channel channel) {
        SmsDispatcherService.DispatchResult result = smsDispatcher.dispatch(
                channel, event.sourceAddr(), event.destAddr(), event.content(), event.messageId());

        if (result.success()) {
            messageRepo.updateStateAndTelcoId(
                    event.messageId(), MessageState.SUBMITTED, null, result.providerMessageId());
            chargePartner(event, channel);
        } else {
            messageRepo.updateState(
                    event.messageId(), MessageState.FAILED, truncate(result.error(), 64));
        }
    }

    private void chargePartner(InboundMessageEvent event, Channel channel) {
        try {
            String carrier = carrierResolver.resolve(event.destAddr()).orElse(null);
            partnerBalanceService.deductForMessage(
                    event.messageId(), event.partnerId(),
                    channel.getDeliveryType(), carrier, event.destAddr());
        } catch (Exception e) {
            log.error("Billing error for message {}: {}", event.messageId(), e.getMessage(), e);
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
