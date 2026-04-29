package com.vosb.gateway.server.http.provider;

public record ProviderField(
        String key,
        String label,
        String type,       // "text" | "password" | "url" | "number"
        boolean required,
        String defaultValue,
        String hint
) {
    public static ProviderField required(String key, String label) {
        return new ProviderField(key, label, "text", true, null, null);
    }

    public static ProviderField required(String key, String label, String type) {
        return new ProviderField(key, label, type, true, null, null);
    }

    public static ProviderField optional(String key, String label, String defaultValue) {
        return new ProviderField(key, label, "text", false, defaultValue, null);
    }

    public static ProviderField optional(String key, String label, String defaultValue, String hint) {
        return new ProviderField(key, label, "text", false, defaultValue, hint);
    }

    public static ProviderField password(String key, String label) {
        return new ProviderField(key, label, "password", true, null, null);
    }
}
