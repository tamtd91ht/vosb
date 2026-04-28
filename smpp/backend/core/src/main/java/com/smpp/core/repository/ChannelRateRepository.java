package com.smpp.core.repository;

import com.smpp.core.domain.ChannelRate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface ChannelRateRepository extends JpaRepository<ChannelRate, Long> {

    List<ChannelRate> findByChannelIdOrderByPrefixDescEffectiveFromDesc(Long channelId);

    void deleteByChannelId(Long channelId);

    // ── Rate resolution queries (used by RateResolver) ────────────────────────

    @Query("SELECT r FROM ChannelRate r WHERE r.channel.id = :channelId AND r.carrier = :carrier " +
           "AND r.effectiveFrom <= :today AND (r.effectiveTo IS NULL OR r.effectiveTo >= :today) " +
           "ORDER BY r.effectiveFrom DESC")
    List<ChannelRate> findActiveByChannelAndCarrier(@Param("channelId") Long channelId,
                                                    @Param("carrier") String carrier,
                                                    @Param("today") LocalDate today);

    @Query("SELECT r FROM ChannelRate r WHERE r.channel.id = :channelId " +
           "AND r.carrier IS NULL AND r.prefix = :prefix " +
           "AND r.effectiveFrom <= :today AND (r.effectiveTo IS NULL OR r.effectiveTo >= :today) " +
           "ORDER BY r.effectiveFrom DESC")
    List<ChannelRate> findActiveByChannelAndPrefix(@Param("channelId") Long channelId,
                                                   @Param("prefix") String prefix,
                                                   @Param("today") LocalDate today);

    @Query("SELECT r FROM ChannelRate r WHERE r.channel.id = :channelId " +
           "AND r.carrier IS NULL AND r.prefix = '' " +
           "AND r.effectiveFrom <= :today AND (r.effectiveTo IS NULL OR r.effectiveTo >= :today) " +
           "ORDER BY r.effectiveFrom DESC")
    List<ChannelRate> findActiveWildcardByChannel(@Param("channelId") Long channelId,
                                                  @Param("today") LocalDate today);
}
