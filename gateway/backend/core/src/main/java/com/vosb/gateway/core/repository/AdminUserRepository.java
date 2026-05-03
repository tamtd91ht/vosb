package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.AdminUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface AdminUserRepository extends JpaRepository<AdminUser, Long> {

    Optional<AdminUser> findByUsernameAndEnabledTrue(String username);

    boolean existsByUsername(String username);

    @Query("SELECT COUNT(u) FROM AdminUser u WHERE u.partner.id = :partnerId")
    long countByPartnerId(@Param("partnerId") Long partnerId);
}
