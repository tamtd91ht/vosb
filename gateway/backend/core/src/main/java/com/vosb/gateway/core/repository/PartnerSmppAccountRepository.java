package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.PartnerSmppAccount;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PartnerSmppAccountRepository extends JpaRepository<PartnerSmppAccount, Long> {

    @EntityGraph(attributePaths = {"partner"})
    Optional<PartnerSmppAccount> findBySystemId(String systemId);

    List<PartnerSmppAccount> findByPartnerId(Long partnerId);

    boolean existsBySystemId(String systemId);
}
