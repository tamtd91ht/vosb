package com.vosb.gateway.core.domain;

import com.vosb.gateway.core.domain.enums.InboundVia;
import com.vosb.gateway.core.domain.enums.MessageEncoding;
import com.vosb.gateway.core.domain.enums.MessageState;
import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "message")
public class Message {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "partner_id", nullable = false)
    private Partner partner;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "channel_id")
    private Channel channel;

    @Column(nullable = false, length = 20)
    private String sourceAddr;

    @Column(nullable = false, length = 20)
    private String destAddr;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private MessageEncoding encoding = MessageEncoding.GSM7;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8)
    private InboundVia inboundVia;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private MessageState state = MessageState.RECEIVED;

    @Column(length = 64)
    private String messageIdTelco;

    @Column(length = 64)
    private String errorCode;

    @Version
    @Column(nullable = false)
    private int version;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private OffsetDateTime updatedAt;

    public UUID getId() { return id; }
    public Partner getPartner() { return partner; }
    public void setPartner(Partner partner) { this.partner = partner; }
    public Channel getChannel() { return channel; }
    public void setChannel(Channel channel) { this.channel = channel; }
    public String getSourceAddr() { return sourceAddr; }
    public void setSourceAddr(String sourceAddr) { this.sourceAddr = sourceAddr; }
    public String getDestAddr() { return destAddr; }
    public void setDestAddr(String destAddr) { this.destAddr = destAddr; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public MessageEncoding getEncoding() { return encoding; }
    public void setEncoding(MessageEncoding encoding) { this.encoding = encoding; }
    public InboundVia getInboundVia() { return inboundVia; }
    public void setInboundVia(InboundVia inboundVia) { this.inboundVia = inboundVia; }
    public MessageState getState() { return state; }
    public void setState(MessageState state) { this.state = state; }
    public String getMessageIdTelco() { return messageIdTelco; }
    public void setMessageIdTelco(String messageIdTelco) { this.messageIdTelco = messageIdTelco; }
    public String getErrorCode() { return errorCode; }
    public void setErrorCode(String errorCode) { this.errorCode = errorCode; }
    public int getVersion() { return version; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
