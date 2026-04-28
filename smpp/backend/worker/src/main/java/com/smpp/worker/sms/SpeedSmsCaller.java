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
import java.util.Base64;

/**
 * SpeedSMS HTTP API caller.
 * POST https://api.speedsms.vn/index.php/sms/send
 * Auth: Basic {base64(access_token:x)}
 * Response: {"status":"success","code":"OK","data":{"tranId":"..."}}
 */
@Component
public class SpeedSmsCaller {

    private static final Logger log = LoggerFactory.getLogger(SpeedSmsCaller.class);
    private static final String DEFAULT_ENDPOINT = "https://api.speedsms.vn/index.php/sms/send";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public SmsSendResult send(JsonNode config, String sourceAddr, String destAddr, String content) {
        String accessToken = config.path("access_token").asText("");
        String sender      = config.path("sender").asText(sourceAddr);
        int smsType        = config.path("sms_type").asInt(6);
        int timeoutMs      = config.path("timeout_ms").asInt(10_000);
        String endpoint    = config.path("url").asText(DEFAULT_ENDPOINT);

        String body = String.format(
                "{\"to\":[\"%s\"],\"content\":%s,\"type\":%d,\"sender\":\"%s\"}",
                destAddr, MAPPER.valueToTree(content).toString(), smsType, sender);

        String auth = Base64.getEncoder()
                .encodeToString((accessToken + ":x").getBytes(StandardCharsets.UTF_8));

        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(timeoutMs)).build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Basic " + auth)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            log.debug("SpeedSMS response: {}", resp.body());

            JsonNode root = MAPPER.readTree(resp.body());
            if ("success".equalsIgnoreCase(root.path("status").asText())) {
                String tranId = root.path("data").path("tranId").asText(null);
                return new SmsSendResult(true, tranId, null);
            }
            String msg = root.path("message").asText(root.path("code").asText("unknown error"));
            return new SmsSendResult(false, null, "SpeedSMS error: " + msg);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SmsSendResult(false, null, "Interrupted");
        } catch (Exception e) {
            log.error("SpeedSMS call error: {}", e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }
}
