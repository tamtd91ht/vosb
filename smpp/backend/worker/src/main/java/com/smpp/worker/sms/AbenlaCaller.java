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
 * Abenla SMS HTTP API caller.
 * POST https://abenla.com/api/gateway.php
 * Headers: Content-Type: application/json
 * Body: {apikey, brandname, phone, message}
 * Response: {"error":0,"msg":"success","sendid":"..."} or {"error":1,"msg":"..."}
 */
@Component
public class AbenlaCaller {

    private static final Logger log = LoggerFactory.getLogger(AbenlaCaller.class);
    private static final String DEFAULT_ENDPOINT = "https://abenla.com/api/gateway.php";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public SmsSendResult send(JsonNode config, String sourceAddr, String destAddr, String content) {
        String apiKey    = config.path("api_key").asText("");
        String brandName = config.path("brand_name").asText(sourceAddr);
        int timeoutMs    = config.path("timeout_ms").asInt(10_000);
        String endpoint  = config.path("url").asText(DEFAULT_ENDPOINT);

        String body = String.format(
                "{\"apikey\":%s,\"brandname\":\"%s\",\"phone\":\"%s\",\"message\":%s}",
                MAPPER.valueToTree(apiKey).toString(),
                brandName, destAddr, MAPPER.valueToTree(content).toString());

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
            log.debug("Abenla response: {}", resp.body());

            JsonNode root = MAPPER.readTree(resp.body());
            int error = root.path("error").asInt(-1);
            if (error == 0) {
                String sendId = root.path("sendid").asText(null);
                return new SmsSendResult(true, sendId, null);
            }
            String msg = root.path("msg").asText("unknown error");
            return new SmsSendResult(false, null, "Abenla error=" + error + " " + msg);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SmsSendResult(false, null, "Interrupted");
        } catch (Exception e) {
            log.error("Abenla call error: {}", e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }
}
