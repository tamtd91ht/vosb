package com.smpp.core.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.smpp.core.domain.converter.JsonNodeConverter;
import com.smpp.core.domain.enums.ChannelStatus;
import com.smpp.core.domain.enums.ChannelType;
import com.smpp.core.domain.enums.DeliveryType;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "channel")
public class Channel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 255)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ChannelType type;

    @Convert(converter = JsonNodeConverter.class)
    @Column(nullable = false, columnDefinition = "jsonb")
    private JsonNode config;

    @Enumerated(EnumType.STRING)
    @Column(name = "delivery_type", nullable = false, length = 20)
    private DeliveryType deliveryType = DeliveryType.SMS;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ChannelStatus status = ChannelStatus.ACTIVE;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private OffsetDateTime updatedAt;

    public Long getId() { return id; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public ChannelType getType() { return type; }
    public void setType(ChannelType type) { this.type = type; }
    public JsonNode getConfig() { return config; }
    public void setConfig(JsonNode config) { this.config = config; }
    public DeliveryType getDeliveryType() { return deliveryType; }
    public void setDeliveryType(DeliveryType deliveryType) { this.deliveryType = deliveryType; }
    public ChannelStatus getStatus() { return status; }
    public void setStatus(ChannelStatus status) { this.status = status; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
