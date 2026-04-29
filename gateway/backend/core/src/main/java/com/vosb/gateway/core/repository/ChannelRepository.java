package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.Channel;
import com.vosb.gateway.core.domain.enums.ChannelStatus;
import com.vosb.gateway.core.domain.enums.ChannelType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ChannelRepository extends JpaRepository<Channel, Long> {

    Optional<Channel> findByCode(String code);

    Page<Channel> findByTypeAndStatus(ChannelType type, ChannelStatus status, Pageable pageable);

    Page<Channel> findByStatus(ChannelStatus status, Pageable pageable);

    boolean existsByCode(String code);
}
