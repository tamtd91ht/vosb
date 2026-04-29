package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.AdminUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AdminUserRepository extends JpaRepository<AdminUser, Long> {

    Optional<AdminUser> findByUsernameAndEnabledTrue(String username);

    boolean existsByUsername(String username);
}
