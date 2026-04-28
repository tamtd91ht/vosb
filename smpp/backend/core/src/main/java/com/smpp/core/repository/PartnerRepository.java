package com.smpp.core.repository;

import com.smpp.core.domain.Partner;
import com.smpp.core.domain.enums.PartnerStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PartnerRepository extends JpaRepository<Partner, Long> {

    Optional<Partner> findByCode(String code);

    Page<Partner> findByStatus(PartnerStatus status, Pageable pageable);

    boolean existsByCode(String code);
}
