package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.Route;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RouteRepository extends JpaRepository<Route, Long> {

    // Used by RouteResolver step-1: carrier-based route lookup (single row, fast path).
    @EntityGraph(attributePaths = {"channel", "fallbackChannel"})
    Optional<Route> findByPartnerIdAndCarrierAndEnabledTrue(Long partnerId, String carrier);

    // Used by RouteResolver step-2: prefix-based routes only (carrier IS NULL), sorted for longest-prefix match.
    @EntityGraph(attributePaths = {"channel", "fallbackChannel"})
    List<Route> findByPartnerIdAndCarrierIsNullAndEnabledTrueOrderByPriorityDescMsisdnPrefixDesc(Long partnerId);

    Page<Route> findByPartnerId(Long partnerId, Pageable pageable);

    Page<Route> findByChannelId(Long channelId, Pageable pageable);
}
