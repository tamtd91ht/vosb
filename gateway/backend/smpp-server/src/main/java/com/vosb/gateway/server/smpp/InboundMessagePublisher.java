package com.vosb.gateway.server.smpp;

import com.vosb.gateway.core.amqp.AmqpConstants;
import com.vosb.gateway.core.amqp.InboundMessageEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

@Component
public class InboundMessagePublisher {

    private static final Logger log = LoggerFactory.getLogger(InboundMessagePublisher.class);

    private final RabbitTemplate rabbitTemplate;

    public InboundMessagePublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public void publish(InboundMessageEvent event) {
        String routingKey = "partner." + event.partnerId();
        rabbitTemplate.convertAndSend(AmqpConstants.SMS_INBOUND_EXCHANGE, routingKey, event);
        log.debug("Published inbound message {} to AMQP (partner={})", event.messageId(), event.partnerId());
    }
}
