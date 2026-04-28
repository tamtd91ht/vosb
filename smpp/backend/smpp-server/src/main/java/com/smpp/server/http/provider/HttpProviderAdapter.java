package com.smpp.server.http.provider;

import com.smpp.core.domain.enums.DeliveryType;

import java.util.List;
import java.util.Map;

public interface HttpProviderAdapter {

    String providerCode();

    String providerName();

    DeliveryType deliveryType();

    List<ProviderField> fields();

    // send() will be used by worker dispatcher in Phase 4 — stub here
    default Map<String, Object> metadata() {
        return Map.of(
                "code", providerCode(),
                "name", providerName(),
                "delivery_type", deliveryType().name(),
                "fields", fields()
        );
    }
}
