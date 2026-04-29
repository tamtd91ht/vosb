package com.vosb.gateway.worker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Calls the 2T-Mobile Voice OTP API (voiceapi/call).
 * API docs: GET http://123.30.145.12/voiceapi/call?username=...&password=...&sender=...&mobinumber=...&text=...
 * Response: XML <ROOT><CODE>100</CODE><DES>SUCCESS</DES><CALLID>...</CALLID><PID>...</PID></ROOT>
 * Code 100 = SUCCESS; all others = failure.
 */
@Component
public class TwoMobileVoiceCaller {

    private static final Logger log = LoggerFactory.getLogger(TwoMobileVoiceCaller.class);

    public record CallResult(boolean success, int code, String callId, String pid, String description) {}

    public CallResult call(String apiUrl, String username, String password,
                           String sender, String mobiNumber, String text, int timeoutMs) {
        try {
            String query = "username=" + encode(username)
                    + "&password=" + encode(password)
                    + "&sender=" + encode(sender)
                    + "&mobinumber=" + encode(mobiNumber)
                    + "&text=" + encode(text);

            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(timeoutMs))
                    .build();

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiUrl + "?" + query))
                    .timeout(Duration.ofMillis(timeoutMs))
                    .GET()
                    .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            log.debug("2T-Mobile response: {}", response.body());
            return parseXml(response.body());

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new CallResult(false, -1, null, null, "Interrupted");
        } catch (Exception e) {
            log.error("2T-Mobile call error: {}", e.getMessage(), e);
            return new CallResult(false, -1, null, null, e.getMessage());
        }
    }

    private CallResult parseXml(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(new InputSource(new StringReader(xml)));

            int code = Integer.parseInt(nodeText(doc, "CODE", "-1"));
            String callId = nodeText(doc, "CALLID", null);
            String pid = nodeText(doc, "PID", null);
            String des = nodeText(doc, "DES", "");

            return new CallResult(code == 100, code, callId, pid, des);
        } catch (Exception e) {
            log.error("Failed to parse 2T-Mobile XML response: {}", xml, e);
            return new CallResult(false, -1, null, null, "XML parse error: " + e.getMessage());
        }
    }

    private String nodeText(Document doc, String tag, String defaultVal) {
        NodeList nl = doc.getElementsByTagName(tag);
        if (nl.getLength() > 0) {
            return nl.item(0).getTextContent();
        }
        return defaultVal;
    }

    private String encode(String value) {
        if (value == null) return "";
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
