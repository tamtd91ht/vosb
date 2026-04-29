package com.vosb.gateway.worker.sms;

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
 * eSMS.vn HTTP API caller.
 * POST https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/
 * Response: {"CodeResult":"100","SMSID":"...","CountRegenerate":0}
 * Success: CodeResult == "100"
 */
@Component
public class ESmsCaller {

    private static final Logger log = LoggerFactory.getLogger(ESmsCaller.class);
    private static final String ENDPOINT =
            "https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public SmsSendResult send(JsonNode config, String sourceAddr, String destAddr, String content) {
        String apiKey    = config.path("api_key").asText("");
        String brandname = config.path("brandname").asText(sourceAddr);
        String smsType   = config.path("sms_type").asText("4");
        int timeoutMs    = config.path("timeout_ms").asInt(10_000);

        String body = String.format(
                "{\"ApiKey\":\"%s\",\"Content\":%s,\"Phone\":\"%s\",\"Brandname\":\"%s\",\"SmsType\":\"%s\",\"IsUnicode\":\"0\"}",
                apiKey, MAPPER.valueToTree(content).toString(), destAddr, brandname, smsType);

        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(timeoutMs)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(ENDPOINT))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            log.debug("eSMS response: {}", resp.body());

            JsonNode root = MAPPER.readTree(resp.body());
            String code = root.path("CodeResult").asText("");
            if ("100".equals(code)) {
                String smsId = root.path("SMSID").asText(null);
                return new SmsSendResult(true, smsId, null);
            }
            return new SmsSendResult(false, null, "eSMS error CodeResult=" + code);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SmsSendResult(false, null, "Interrupted");
        } catch (Exception e) {
            log.error("eSMS call error: {}", e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }
}
