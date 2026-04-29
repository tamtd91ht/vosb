package com.vosb.gateway.core.amqp;

import java.util.UUID;

public record InboundMessageEvent(
        UUID messageId,
        Long partnerId,
        String sourceAddr,
        String destAddr,
        String content,
        String encoding,
        String inboundVia,
        String clientRef
) {}
