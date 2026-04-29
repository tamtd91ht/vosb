package com.vosb.gateway.core.amqp;

import com.vosb.gateway.core.domain.enums.DlrState;

import java.util.UUID;

public record DlrEvent(
        UUID messageId,
        Long partnerId,
        String sourceAddr,
        String destAddr,
        DlrState state,
        String errorCode,
        String messageIdTelco
) {}
