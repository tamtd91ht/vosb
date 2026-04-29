package com.vosb.gateway.server.smpp;

public class BindRejected extends RuntimeException {

    private final int errorCode;

    public BindRejected(int errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public int getErrorCode() {
        return errorCode;
    }
}
