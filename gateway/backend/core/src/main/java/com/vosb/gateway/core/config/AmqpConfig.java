package com.vosb.gateway.core.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.vosb.gateway.core.amqp.AmqpConstants;
import org.springframework.amqp.core.*;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.amqp.RabbitAutoConfiguration;
import org.springframework.context.annotation.Bean;

@AutoConfiguration(before = RabbitAutoConfiguration.class)
public class AmqpConfig {

    @Bean
    public MessageConverter amqpJsonConverter(ObjectMapper mapper) {
        return new Jackson2JsonMessageConverter(mapper);
    }

    @Bean
    public TopicExchange smsInboundExchange() {
        return new TopicExchange(AmqpConstants.SMS_INBOUND_EXCHANGE, true, false);
    }

    @Bean
    public Queue smsInboundQueue() {
        return QueueBuilder.durable(AmqpConstants.SMS_INBOUND_QUEUE).build();
    }

    @Bean
    public Binding smsInboundBinding(Queue smsInboundQueue, TopicExchange smsInboundExchange) {
        return BindingBuilder.bind(smsInboundQueue).to(smsInboundExchange).with("#");
    }

    @Bean
    public TopicExchange smsDlrExchange() {
        return new TopicExchange(AmqpConstants.SMS_DLR_EXCHANGE, true, false);
    }

    @Bean
    public Queue smsDlrQueue() {
        return QueueBuilder.durable(AmqpConstants.SMS_DLR_QUEUE).build();
    }

    @Bean
    public Binding smsDlrBinding(Queue smsDlrQueue, TopicExchange smsDlrExchange) {
        return BindingBuilder.bind(smsDlrQueue).to(smsDlrExchange).with("#");
    }
}
