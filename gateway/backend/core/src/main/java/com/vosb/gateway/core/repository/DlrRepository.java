package com.vosb.gateway.core.repository;

import com.vosb.gateway.core.domain.Dlr;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DlrRepository extends JpaRepository<Dlr, Long> {

    List<Dlr> findByMessageIdOrderByReceivedAtDesc(UUID messageId);
}
