package com.smpp.core.repository;

import com.smpp.core.domain.PartnerApiKey;
import com.smpp.core.domain.enums.KeyStatus;
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
