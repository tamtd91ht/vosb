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
import java.util.Arrays;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Generic configurable HTTP SMS caller.
 * Config fields: url, method (POST), auth_type (Bearer|Basic|None),
 *   auth_token, body_template, response_id_path ($.id),
 *   response_status_path ($.status), response_status_success_values (ok,success,0).
 *
 * Template variables in body_template and url:
 *   ${source_addr}, ${dest_addr}, ${content}, ${message_id}
 */
@Component
public class CustomHttpSmsCaller {

    private static final Logger log = LoggerFactory.getLogger(CustomHttpSmsCaller.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public SmsSendResult send(JsonNode config, String sourceAddr, String destAddr,
                              String content, String messageId) {
        String url        = config.path("url").asText("");
        String method     = config.path("method").asText("POST").toUpperCase();
        String authType   = config.path("auth_type").asText("None");
        String authToken  = config.path("auth_token").asText("");
        String bodyTpl    = config.path("body_template").asText("");
        String idPath     = config.path("response_id_path").asText("$.id");
        String statusPath = config.path("response_status_path").asText("$.status");
        String successVals= config.path("response_status_success_values").asText("ok,success,0");
        int timeoutMs     = config.path("timeout_ms").asInt(10_000);

        if (url.isBlank()) {
            return new SmsSendResult(false, null, "CUSTOM provider: url not configured");
        }

        String renderedUrl  = renderTemplate(url, sourceAddr, destAddr, content, messageId);
        String renderedBody = renderTemplate(bodyTpl, sourceAddr, destAddr, content, messageId);

        Set<String> successSet = Arrays.stream(successVals.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());

        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(timeoutMs)).build();

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(renderedUrl))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .header("Content-Type", "application/json");

            applyAuth(reqBuilder, authType, authToken);

            HttpRequest.BodyPublisher publisher = "GET".equals(method)
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(renderedBody, StandardCharsets.UTF_8);

            HttpResponse<String> resp = client.send(
                    reqBuilder.method(method, publisher).build(),
                    HttpResponse.BodyHandlers.ofString());

            log.debug("CUSTOM response status={}: {}", resp.statusCode(), resp.body());

            if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
                return new SmsSendResult(false, null, "HTTP " + resp.statusCode());
            }

            String respBody = resp.body();
            String extractedId = null;
            try {
                JsonNode root = MAPPER.readTree(respBody);
                extractedId = jsonPathGet(root, idPath);

                if (!statusPath.isBlank()) {
                    String statusVal = jsonPathGet(root, statusPath);
                    if (statusVal != null && !successSet.isEmpty()) {
                        boolean ok = successSet.contains(statusVal.toLowerCase())
                                || successSet.contains(statusVal);
                        if (!ok) {
                            return new SmsSendResult(false, null, "CUSTOM response status=" + statusVal);
                        }
                    }
                }
            } catch (Exception parseEx) {
                log.debug("CUSTOM response is not JSON, treating 2xx as success: {}", parseEx.getMessage());
            }

            return new SmsSendResult(true, extractedId, null);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SmsSendResult(false, null, "Interrupted");
        } catch (Exception e) {
            log.error("CUSTOM HTTP call error: {}", e.getMessage(), e);
            return new SmsSendResult(false, null, e.getMessage());
        }
    }

    private static String renderTemplate(String template, String sourceAddr,
                                         String destAddr, String content, String messageId) {
        if (template == null || template.isBlank()) return template;
        return template
                .replace("${source_addr}", escapeJson(sourceAddr))
                .replace("${dest_addr}", escapeJson(destAddr))
                .replace("${content}", escapeJson(content))
                .replace("${message_id}", escapeJson(messageId));
    }

    private static String escapeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }

    // Simple $.field.nested JSONPath navigator (no array index support).
    private static String jsonPathGet(JsonNode root, String path) {
        if (path == null || path.isBlank() || root == null) return null;
        String stripped = path.startsWith("$.") ? path.substring(2)
                        : path.startsWith("$") ? path.substring(1) : path;
        if (stripped.isBlank()) return root.asText(null);
        String[] parts = stripped.split("\\.");
        JsonNode current = root;
        for (String part : parts) {
            if (current == null || current.isMissingNode()) return null;
            // handle array index like messages[0]
            if (part.contains("[")) {
                String fieldName = part.substring(0, part.indexOf('['));
                int idx = Integer.parseInt(part.replaceAll(".*\\[(\\d+)\\].*", "$1"));
                current = current.path(fieldName).path(idx);
            } else {
                current = current.path(part);
            }
        }
        return current == null || current.isMissingNode() ? null : current.asText(null);
    }

    private static void applyAuth(HttpRequest.Builder req, String authType, String token) {
        switch (authType) {
            case "Bearer" -> req.header("Authorization", "Bearer " + token);
            case "Basic"  -> {
                String encoded = Base64.getEncoder()
                        .encodeToString((token + ":").getBytes(StandardCharsets.UTF_8));
                req.header("Authorization", "Basic " + encoded);
            }
            case "HMAC"   -> { /* HMAC signing not supported in CUSTOM — configure externally */ }
            default       -> { /* None */ }
        }
    }
}
