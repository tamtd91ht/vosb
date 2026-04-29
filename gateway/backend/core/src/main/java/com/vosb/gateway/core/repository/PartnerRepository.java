package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.Partner;
import com.vosb.gateway.core.domain.enums.PartnerStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Optional;

public interface PartnerRepository extends JpaRepository<Partner, Long> {

    Optional<Partner> findByCode(String code);

    Page<Partner> findByStatus(PartnerStatus status, Pageable pageable);

    boolean existsByCode(String code);

    /**
     * Atomically deducts {@code amount} from partner balance.
     * Returns 0 if balance is insufficient (no rows updated, no throw).
     */
    @Modifying
    @Transactional
    @Query("UPDATE Partner p SET p.balance = p.balance - :amount " +
           "WHERE p.id = :id AND p.balance >= :amount")
    int deductBalance(@Param("id") Long id, @Param("amount") BigDecimal amount);
}
