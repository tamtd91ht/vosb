package com.smpp.worker.sms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Vietguys HTTP API caller.
 * POST http://cloudsms.vietguys.biz:8088/api/
 * Phone format: local "0912345678" (strips E.164 "84" prefix).
 * Response: {"error":0,"sendid":"...","message":"OK"}
 */
@Component
public class VietguysCaller {

    private static final Logger log = LoggerFactory.getLogger(VietguysCaller.class);
    private static final String DEFAULT_ENDPOINT = "http://cloudsms.vietguys.biz:8088/api/";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public SmsSendResult send(JsonNode config, String sourceAddr, String destAddr, String content) {
        String username   = config.path("username").asText("");
        String password   = config.path("password").asText("");
        String brandname  = config.path("brandname").asText(sourceAddr);
        int timeoutMs     = config.path("timeout_ms").asInt(10_000);
        String endpoint   = config.path("url").asText(DEFAULT_ENDPOINT);

        String localPhone = toLocalFormat(destAddr);
        String body = String.format(
                "{\"u\":\"%s\",\"pwd\":%s,\"from\":\"%s\",\"phone\":\"%s\",\"sms\":%s,\"type\":\"0\",\"json\":\"1\"}",
                username, MAPPER.valueToTree(password).toString(),
                brandname, localPhone, MAPPER.valueToTree(content).toString());

        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(timeoutMs)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            log.debug("Vietguys response: {}", resp.body());

            JsonNode root = MAPPER.readTree(resp.body());
            int error = root.path("error").asInt(-1);
            if (error == 0) {
                String sendId = root.path("sendid").asText(null);
                return new SmsSendResult(true, sendId, null);
            }
            String msg = root.path("message").asText("unknown error");
            return new SmsSendResult(false, null, "Vietguys error=" + error + " " + msg);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SmsSendResult(false, null, "Interrupted");
        } catch (Exception e) {
            log.error("Vietguys call error: {}", e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }

    // Vietguys expects local format: "0912345678" not E.164 "84912345678"
    private static String toLocalFormat(String phone) {
        if (phone == null) return phone;
        String stripped = phone.startsWith("+") ? phone.substring(1) : phone;
        if (stripped.startsWith("84") && stripped.length() >= 10) {
            return "0" + stripped.substring(2);
        }
        return phone;
    }
}
