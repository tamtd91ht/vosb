package com.smpp.core.repository;

import com.smpp.core.domain.CarrierPrefix;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Map;

public interface CarrierPrefixRepository extends JpaRepository<CarrierPrefix, String> {

    List<CarrierPrefix> findByCarrierOrderByPrefix(String carrier);

    @Query("SELECT cp.carrier FROM CarrierPrefix cp GROUP BY cp.carrier ORDER BY cp.carrier")
    List<String> findDistinctCarriers();
}
