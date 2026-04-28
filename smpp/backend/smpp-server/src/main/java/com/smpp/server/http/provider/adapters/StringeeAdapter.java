package com.smpp.server.http.provider.adapters;

import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.server.http.provider.HttpProviderAdapter;
import com.smpp.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class StringeeAdapter implements HttpProviderAdapter {

    public String providerCode() { return "STRINGEE"; }

    public String providerName() { return "Stringee"; }

    public DeliveryType deliveryType() { return DeliveryType.VOICE_OTP; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("account_sid", "Account SID"),
                ProviderField.password("auth_token", "Auth Token"),
                ProviderField.required("from_number", "From Number (SIP or PSTN)", "text"),
                ProviderField.required("answer_url", "Answer URL (TTS webhook)", "url")
        );
    }
}
