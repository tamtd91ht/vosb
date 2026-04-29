package com.vosb.gateway.core.domain;

import com.vosb.gateway.core.domain.enums.KeyStatus;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "partner_api_key")
public class PartnerApiKey {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "partner_id", nullable = false)
    private Partner partner;

    @Column(nullable = false, unique = true, length = 32)
    private String keyId;

    @Column(nullable = false)
    private byte[] secretEncrypted;

    @Column(nullable = false)
    private byte[] nonce;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private KeyStatus status = KeyStatus.ACTIVE;

    @Column(length = 64)
    private String label;

    private OffsetDateTime lastUsedAt;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public Long getId() { return id; }
    public Partner getPartner() { return partner; }
    public void setPartner(Partner partner) { this.partner = partner; }
    public String getKeyId() { return keyId; }
    public void setKeyId(String keyId) { this.keyId = keyId; }
    public byte[] getSecretEncrypted() { return secretEncrypted; }
    public void setSecretEncrypted(byte[] secretEncrypted) { this.secretEncrypted = secretEncrypted; }
    public byte[] getNonce() { return nonce; }
    public void setNonce(byte[] nonce) { this.nonce = nonce; }
    public KeyStatus getStatus() { return status; }
    public void setStatus(KeyStatus status) { this.status = status; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    public OffsetDateTime getLastUsedAt() { return lastUsedAt; }
    public void setLastUsedAt(OffsetDateTime lastUsedAt) { this.lastUsedAt = lastUsedAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
