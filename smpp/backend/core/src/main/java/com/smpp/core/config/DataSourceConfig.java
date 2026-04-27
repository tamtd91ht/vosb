package com.smpp.core.config;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@AutoConfiguration(after = DataSourceAutoConfiguration.class)
@EntityScan(basePackages = "com.smpp.core.domain")
@EnableJpaRepositories(basePackages = "com.smpp.core.repository")
public class DataSourceConfig {
}
