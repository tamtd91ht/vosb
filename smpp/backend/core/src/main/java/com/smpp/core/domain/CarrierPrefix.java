package com.smpp.core.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "carrier_prefix")
public class CarrierPrefix {

    @Id
    @Column(length = 8)
    private String prefix;

    @Column(nullable = false, length = 20)
    private String carrier;

    public String getPrefix() { return prefix; }
    public void setPrefix(String prefix) { this.prefix = prefix; }

    public String getCarrier() { return carrier; }
    public void setCarrier(String carrier) { this.carrier = carrier; }
}
