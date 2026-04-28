package com.smpp.server.http.provider.adapters;

import com.smpp.core.domain.enums.DeliveryType;
import com.smpp.server.http.provider.HttpProviderAdapter;
import com.smpp.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class TwoMobileVoiceAdapter implements HttpProviderAdapter {

    public String providerCode() { return "2TMOBILE_VOICE"; }

    public String providerName() { return "2T-Mobile Voice OTP"; }

    public DeliveryType deliveryType() { return DeliveryType.VOICE_OTP; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.optional("url", "API URL", "http://123.30.145.12/voiceapi/call"),
                ProviderField.required("username", "Username"),
                ProviderField.password("password", "Password"),
                ProviderField.required("sender", "Sender (Brand name)"),
                ProviderField.optional("timeout_ms", "Timeout (ms)", "10000", "HTTP connect+read timeout in milliseconds")
        );
    }
}
