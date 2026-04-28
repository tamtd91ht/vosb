package com.smpp.core.repository;

import com.smpp.core.domain.ChannelRate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChannelRateRepository extends JpaRepository<ChannelRate, Long> {
    List<ChannelRate> findByChannelIdOrderByPrefixDescEffectiveFromDesc(Long channelId);
    void deleteByChannelId(Long channelId);
}
