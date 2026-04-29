package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.PartnerApiKey;
import com.vosb.gateway.core.domain.enums.KeyStatus;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PartnerApiKeyRepository extends JpaRepository<PartnerApiKey, Long> {

    Optional<PartnerApiKey> findByKeyId(String keyId);

    @EntityGraph(attributePaths = {"partner"})
    Optional<PartnerApiKey> findByKeyIdAndStatus(String keyId, KeyStatus status);

    List<PartnerApiKey> findByPartnerId(Long partnerId);
}
