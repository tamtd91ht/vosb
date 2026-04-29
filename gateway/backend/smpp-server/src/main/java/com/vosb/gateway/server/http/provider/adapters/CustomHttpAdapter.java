package com.vosb.gateway.server.http.provider.adapters;

import com.vosb.gateway.core.domain.enums.DeliveryType;
import com.vosb.gateway.server.http.provider.HttpProviderAdapter;
import com.vosb.gateway.server.http.provider.ProviderField;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class CustomHttpAdapter implements HttpProviderAdapter {

    public String providerCode() { return "CUSTOM"; }

    public String providerName() { return "Tùy chỉnh (Custom HTTP)"; }

    public DeliveryType deliveryType() { return DeliveryType.SMS; }

    public List<ProviderField> fields() {
        return List.of(
                ProviderField.required("url", "Endpoint URL", "url"),
                ProviderField.optional("method", "HTTP Method", "POST"),
                ProviderField.optional("auth_type", "Auth Type", "Bearer", "Bearer | Basic | None | HMAC"),
                ProviderField.optional("auth_token", "Auth Token / API Key", null),
                ProviderField.optional("body_template", "Request Body Template (FreeMarker)", null,
                        "Variables: ${source_addr}, ${dest_addr}, ${content}, ${message_id}"),
                ProviderField.optional("response_id_path", "Response Message ID (JSONPath)", "$.id"),
                ProviderField.optional("response_status_path", "Response Status Field (JSONPath)", "$.status"),
                ProviderField.optional("response_status_success_values", "Success Values (comma-separated)", "ok,success,0")
        );
    }
}
