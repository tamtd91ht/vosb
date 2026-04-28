package com.smpp.core.repository;

import com.smpp.core.domain.Message;
import com.smpp.core.domain.enums.MessageState;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface MessageRepository extends JpaRepository<Message, UUID> {

    Page<Message> findByPartnerId(Long partnerId, Pageable pageable);

    Page<Message> findByPartnerIdAndState(Long partnerId, MessageState state, Pageable pageable);

    Page<Message> findByState(MessageState state, Pageable pageable);

    Page<Message> findByDestAddr(String destAddr, Pageable pageable);

    Page<Message> findByPartnerIdAndDestAddr(Long partnerId, String destAddr, Pageable pageable);

    Page<Message> findByCreatedAtBetween(Instant from, Instant to, Pageable pageable);

    Optional<Message> findByMessageIdTelco(String messageIdTelco);

    @Modifying
    @Transactional
    @Query("UPDATE Message m SET m.state = :state, m.errorCode = :errorCode WHERE m.id = :id")
    void updateState(@Param("id") UUID id, @Param("state") MessageState state, @Param("errorCode") String errorCode);

    @Modifying
    @Transactional
    @Query("UPDATE Message m SET m.state = :state, m.errorCode = :errorCode, m.messageIdTelco = :telcoId WHERE m.id = :id")
    void updateStateAndTelcoId(@Param("id") UUID id, @Param("state") MessageState state,
                               @Param("errorCode") String errorCode, @Param("telcoId") String telcoId);

    @Query("SELECT m.state, COUNT(m) FROM Message m GROUP BY m.state")
    List<Object[]> countByState();

    @Query("SELECT m.state, COUNT(m) FROM Message m WHERE m.partner.id = :partnerId GROUP BY m.state")
    List<Object[]> countByStateForPartner(@Param("partnerId") Long partnerId);

    @Query("SELECT m.state, COUNT(m) FROM Message m WHERE m.channel.id = :channelId AND m.createdAt >= :from GROUP BY m.state")
    List<Object[]> countByStateForChannel(@Param("channelId") Long channelId, @Param("from") OffsetDateTime from);

    @Query(value = """
            SELECT date_trunc(:granularity, created_at) AS bucket, state, COUNT(*) AS cnt
            FROM message
            WHERE created_at >= :from AND created_at < :to
            GROUP BY bucket, state
            ORDER BY bucket
            """, nativeQuery = true)
    List<Object[]> timeseries(
            @Param("granularity") String granularity,
            @Param("from") Instant from,
            @Param("to") Instant to
    );
}
