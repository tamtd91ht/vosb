package com.vosb.gateway.server.http.provider.adapters;

import com.vosb.gateway.core.domain.enums.DeliveryType;
import com.vosb.gateway.server.http.provider.HttpProviderAdapter;
import com.vosb.gateway.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class VietguysAdapter implements HttpProviderAdapter {

    public String providerCode() { return "VIETGUYS"; }

    public String providerName() { return "Vietguys"; }

    public DeliveryType deliveryType() { return DeliveryType.SMS; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("username", "Username"),
                ProviderField.password("password", "Password"),
                ProviderField.required("brandname", "Brandname (Sender ID)")
        );
    }
}
