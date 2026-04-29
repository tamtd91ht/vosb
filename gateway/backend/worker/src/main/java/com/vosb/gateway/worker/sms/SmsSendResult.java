package com.vosb.gateway.worker.sms;

public record SmsSendResult(boolean success, String providerMessageId, String error) {}
