package com.vosb.gateway.server.http.provider.adapters;

import com.vosb.gateway.core.domain.enums.DeliveryType;
import com.vosb.gateway.server.http.provider.HttpProviderAdapter;
import com.vosb.gateway.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class InfobipAdapter implements HttpProviderAdapter {

    public String providerCode() { return "INFOBIP"; }

    public String providerName() { return "Infobip"; }

    public DeliveryType deliveryType() { return DeliveryType.SMS; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("base_url", "Base URL (your Infobip subdomain)", "url"),
                ProviderField.required("api_key", "API Key"),
                ProviderField.required("sender", "Sender Name")
        );
    }
}
