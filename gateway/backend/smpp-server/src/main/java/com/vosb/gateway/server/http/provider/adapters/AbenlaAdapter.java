package com.vosb.gateway.server.http.provider.adapters;

import com.vosb.gateway.core.domain.enums.DeliveryType;
import com.vosb.gateway.server.http.provider.HttpProviderAdapter;
import com.vosb.gateway.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class AbenlaAdapter implements HttpProviderAdapter {

    public String providerCode() { return "ABENLA"; }

    public String providerName() { return "Abenla"; }

    public DeliveryType deliveryType() { return DeliveryType.SMS; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("api_key", "API Key"),
                ProviderField.required("brand_name", "Brand Name (Sender ID)")
        );
    }
}
