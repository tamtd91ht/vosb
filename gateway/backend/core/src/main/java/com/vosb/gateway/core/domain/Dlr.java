package com.vosb.gateway.core.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.converter.JsonNodeConverter;
import com.vosb.gateway.core.domain.enums.DlrSource;
import com.vosb.gateway.core.domain.enums.DlrState;
import jakarta.persistence.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "dlr")
public class Dlr {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "message_id", nullable = false)
    private Message message;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DlrState state;

    @Column(length = 64)
    private String errorCode;

    @Convert(converter = JsonNodeConverter.class)
    @Column(columnDefinition = "jsonb")
    private JsonNode rawPayload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DlrSource source;

    @Column(nullable = false)
    private OffsetDateTime receivedAt;

    @PrePersist
    void prePersist() {
        if (receivedAt == null) receivedAt = OffsetDateTime.now();
    }

    public Long getId() { return id; }
    public Message getMessage() { return message; }
    public void setMessage(Message message) { this.message = message; }
    public DlrState getState() { return state; }
    public void setState(DlrState state) { this.state = state; }
    public String getErrorCode() { return errorCode; }
    public void setErrorCode(String errorCode) { this.errorCode = errorCode; }
    public JsonNode getRawPayload() { return rawPayload; }
    public void setRawPayload(JsonNode rawPayload) { this.rawPayload = rawPayload; }
    public DlrSource getSource() { return source; }
    public void setSource(DlrSource source) { this.source = source; }
    public OffsetDateTime getReceivedAt() { return receivedAt; }
}
