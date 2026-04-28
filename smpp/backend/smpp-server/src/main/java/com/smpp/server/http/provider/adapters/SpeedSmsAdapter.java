package com.smpp.server.http.provider.adapters;

import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.server.http.provider.HttpProviderAdapter;
import com.smpp.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class SpeedSmsAdapter implements HttpProviderAdapter {

    public String providerCode() { return "SPEEDSMS"; }

    public String providerName() { return "SpeedSMS"; }

    public DeliveryType deliveryType() { return DeliveryType.SMS; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("access_token", "Access Token"),
                ProviderField.required("sender", "Sender ID"),
                ProviderField.optional("sms_type", "SMS Type", "6", "6=brandname")
        );
    }
}
