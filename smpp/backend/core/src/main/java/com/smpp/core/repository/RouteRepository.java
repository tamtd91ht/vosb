package com.smpp.core.repository;

import com.smpp.core.domain.Route;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RouteRepository extends JpaRepository<Route, Long> {

    // Used by RouteResolver: all enabled routes for a partner, sorted for longest-prefix + priority matching.
    // EntityGraph eagerly joins channel + fallbackChannel to avoid N+1 lazy-load per route.
    @EntityGraph(attributePaths = {"channel", "fallbackChannel"})
    List<Route> findByPartnerIdAndEnabledTrueOrderByPriorityDescMsisdnPrefixDesc(Long partnerId);

    Page<Route> findByPartnerId(Long partnerId, Pageable pageable);

    Page<Route> findByChannelId(Long channelId, Pageable pageable);
}
