package com.smpp.core.repository;

import com.smpp.core.domain.PartnerRate;
import com.smpp.core.domain.enums.DeliveryType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PartnerRateRepository extends JpaRepository<PartnerRate, Long> {
    List<PartnerRate> findByPartnerIdOrderByDeliveryTypeAscPrefixDescEffectiveFromDesc(Long partnerId);
    List<PartnerRate> findByPartnerIdAndDeliveryTypeOrderByPrefixDescEffectiveFromDesc(Long partnerId, DeliveryType deliveryType);
}
