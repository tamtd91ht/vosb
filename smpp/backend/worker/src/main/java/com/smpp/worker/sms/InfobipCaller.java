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
 * Infobip SMS HTTP API caller.
 * POST {base_url}/sms/2/text/advanced
 * Auth: App {api_key}
 * Response: {"bulkId":"...","messages":[{"messageId":"...","to":"...","status":{...}}]}
 */
@Component
public class InfobipCaller {

    private static final Logger log = LoggerFactory.getLogger(InfobipCaller.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public SmsSendResult send(JsonNode config, String sourceAddr, String destAddr, String content) {
        String baseUrl  = config.path("base_url").asText("").stripTrailing();
        String apiKey   = config.path("api_key").asText("");
        String sender   = config.path("sender").asText(sourceAddr);
        int timeoutMs   = config.path("timeout_ms").asInt(10_000);

        if (baseUrl.isEmpty()) {
            return new SmsSendResult(false, null, "Infobip base_url not configured");
        }

        String endpoint = baseUrl + "/sms/2/text/advanced";
        String body = String.format(
                "{\"messages\":[{\"from\":\"%s\",\"destinations\":[{\"to\":\"%s\"}],\"text\":%s}]}",
                sender, destAddr, MAPPER.valueToTree(content).toString());

        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(timeoutMs)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Authorization", "App " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            log.debug("Infobip response status={}: {}", resp.statusCode(), resp.body());

            if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
                return new SmsSendResult(false, null, "Infobip HTTP " + resp.statusCode());
            }
            JsonNode root = MAPPER.readTree(resp.body());
            JsonNode firstMsg = root.path("messages").path(0);
            String messageId = firstMsg.path("messageId").asText(null);
            return new SmsSendResult(true, messageId, null);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SmsSendResult(false, null, "Interrupted");
        } catch (Exception e) {
            log.error("Infobip call error: {}", e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }
}
