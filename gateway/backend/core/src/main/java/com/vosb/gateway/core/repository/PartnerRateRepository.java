package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.PartnerRate;
import com.vosb.gateway.core.domain.enums.DeliveryType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface PartnerRateRepository extends JpaRepository<PartnerRate, Long> {

    List<PartnerRate> findByPartnerIdOrderByDeliveryTypeAscPrefixDescEffectiveFromDesc(Long partnerId);

    List<PartnerRate> findByPartnerIdAndDeliveryTypeOrderByPrefixDescEffectiveFromDesc(Long partnerId, DeliveryType deliveryType);

    // ── Rate resolution queries (used by RateResolver) ────────────────────────

    @Query("SELECT r FROM PartnerRate r WHERE r.partner.id = :partnerId AND r.deliveryType = :type " +
           "AND r.carrier = :carrier " +
           "AND r.effectiveFrom <= :today AND (r.effectiveTo IS NULL OR r.effectiveTo >= :today) " +
           "ORDER BY r.effectiveFrom DESC")
    List<PartnerRate> findActiveByPartnerAndTypeAndCarrier(@Param("partnerId") Long partnerId,
                                                           @Param("type") DeliveryType type,
                                                           @Param("carrier") String carrier,
                                                           @Param("today") LocalDate today);

    @Query("SELECT r FROM PartnerRate r WHERE r.partner.id = :partnerId AND r.deliveryType = :type " +
           "AND r.carrier IS NULL AND r.prefix = :prefix " +
           "AND r.effectiveFrom <= :today AND (r.effectiveTo IS NULL OR r.effectiveTo >= :today) " +
           "ORDER BY r.effectiveFrom DESC")
    List<PartnerRate> findActiveByPartnerAndTypeAndPrefix(@Param("partnerId") Long partnerId,
                                                          @Param("type") DeliveryType type,
                                                          @Param("prefix") String prefix,
                                                          @Param("today") LocalDate today);

    @Query("SELECT r FROM PartnerRate r WHERE r.partner.id = :partnerId AND r.deliveryType = :type " +
           "AND r.carrier IS NULL AND r.prefix = '' " +
           "AND r.effectiveFrom <= :today AND (r.effectiveTo IS NULL OR r.effectiveTo >= :today) " +
           "ORDER BY r.effectiveFrom DESC")
    List<PartnerRate> findActiveWildcardByPartnerAndType(@Param("partnerId") Long partnerId,
                                                          @Param("type") DeliveryType type,
                                                          @Param("today") LocalDate today);
}
