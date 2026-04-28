package com.smpp.core.repository;

import com.smpp.core.domain.Dlr;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface DlrRepository extends JpaRepository<Dlr, Long> {

    List<Dlr> findByMessageIdOrderByReceivedAtDesc(UUID messageId);
}
