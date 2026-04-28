package com.smpp.server.smpp;

import com.smpp.core.domain.enums.MessageEncoding;

import java.nio.charset.StandardCharsets;

final class EncodingUtils {

    private EncodingUtils() {}

    static String decode(byte[] payload, byte dataCoding) {
        return switch (dataCoding & 0x0F) {
            case 0x08 -> new String(payload, StandardCharsets.UTF_16BE);
            case 0x03 -> new String(payload, StandardCharsets.ISO_8859_1);
            default   -> new String(payload, StandardCharsets.ISO_8859_1);
        };
    }

    static MessageEncoding encodingOf(byte dataCoding) {
        return switch (dataCoding & 0x0F) {
            case 0x08 -> MessageEncoding.UCS2;
            case 0x03 -> MessageEncoding.LATIN1;
            default   -> MessageEncoding.GSM7;
        };
    }

    static String normalizeDestAddr(String dest) {
        if (dest == null) return "";
        String d = dest.trim().replaceAll("[\\s\\-]", "");
        if (d.startsWith("+")) d = d.substring(1);
        if (d.startsWith("00")) d = d.substring(2);
        if (d.startsWith("0")) d = "84" + d.substring(1);
        return d;
    }
}
