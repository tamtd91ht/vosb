package com.vosb.gateway.server.http.provider;

import com.vosb.gateway.core.domain.enums.DeliveryType;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
public class HttpProviderRegistry {

    private final Map<String, HttpProviderAdapter> adapters;

    public HttpProviderRegistry(List<HttpProviderAdapter> adapters) {
        this.adapters = adapters.stream()
                .collect(Collectors.toMap(HttpProviderAdapter::providerCode, Function.identity()));
    }

    public Optional<HttpProviderAdapter> find(String code) {
        return Optional.ofNullable(adapters.get(code));
    }

    public List<Map<String, Object>> listMetadata() {
        return adapters.values().stream()
                .map(HttpProviderAdapter::metadata)
                .sorted((a, b) -> ((String) a.get("name")).compareToIgnoreCase((String) b.get("name")))
                .toList();
    }

    public List<Map<String, Object>> listMetadataByDeliveryType(DeliveryType type) {
        return adapters.values().stream()
                .filter(a -> a.deliveryType() == type)
                .map(HttpProviderAdapter::metadata)
                .sorted((a, b) -> ((String) a.get("name")).compareToIgnoreCase((String) b.get("name")))
                .toList();
    }
}
