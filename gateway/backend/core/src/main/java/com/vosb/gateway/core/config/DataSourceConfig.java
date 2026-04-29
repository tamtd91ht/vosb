package com.vosb.gateway.core.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@AutoConfiguration(after = DataSourceAutoConfiguration.class)
@EntityScan(basePackages = "com.vosb.gateway.core.domain")
@EnableJpaRepositories(basePackages = "com.vosb.gateway.core.repository")
public class DataSourceConfig {
}
