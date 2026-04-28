package com.smpp.worker.sms;

public record SmsSendResult(boolean success, String providerMessageId, String error) {}
