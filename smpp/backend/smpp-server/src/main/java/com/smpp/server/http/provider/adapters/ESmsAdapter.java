package com.smpp.server.http.provider.adapters;

import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.server.http.provider.HttpProviderAdapter;
import com.smpp.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ESmsAdapter implements HttpProviderAdapter {

    public String providerCode() { return "ESMS"; }

    public String providerName() { return "eSMS.vn"; }

    public DeliveryType deliveryType() { return DeliveryType.SMS; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("api_key", "API Key"),
                ProviderField.required("brandname", "Brandname (Sender ID)"),
                ProviderField.optional("sms_type", "SMS Type", "4", "4=brandname, 2=advertising")
        );
    }
}
