package com.vosb.gateway.core.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.vosb.gateway.core.domain.converter.JsonNodeConverter;
import com.vosb.gateway.core.domain.enums.SmppAccountStatus;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "partner_smpp_account")
public class PartnerSmppAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "partner_id", nullable = false)
    private Partner partner;

    @Column(nullable = false, unique = true, length = 16)
    private String systemId;

    @Column(nullable = false, length = 72)
    private String passwordHash;

    @Column(nullable = false)
    private int maxBinds = 5;

    @Convert(converter = JsonNodeConverter.class)
    @Column(nullable = false, columnDefinition = "jsonb")
    private JsonNode ipWhitelist;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private SmppAccountStatus status = SmppAccountStatus.ACTIVE;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public Long getId() { return id; }
    public Partner getPartner() { return partner; }
    public void setPartner(Partner partner) { this.partner = partner; }
    public String getSystemId() { return systemId; }
    public void setSystemId(String systemId) { this.systemId = systemId; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public int getMaxBinds() { return maxBinds; }
    public void setMaxBinds(int maxBinds) { this.maxBinds = maxBinds; }
    public JsonNode getIpWhitelist() { return ipWhitelist; }
    public void setIpWhitelist(JsonNode ipWhitelist) { this.ipWhitelist = ipWhitelist; }
    public SmppAccountStatus getStatus() { return status; }
    public void setStatus(SmppAccountStatus status) { this.status = status; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
