package com.smpp.core.amqp;

public final class AmqpConstants {

    private AmqpConstants() {}

    public static final String SMS_INBOUND_EXCHANGE = "sms.inbound";
    public static final String SMS_INBOUND_QUEUE    = "sms.inbound.q";
    public static final String SMS_DLR_EXCHANGE     = "sms.dlr";
    public static final String SMS_DLR_QUEUE        = "sms.dlr.q";
}
