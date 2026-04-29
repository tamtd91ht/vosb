package com.vosb.gateway.worker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication(scanBasePackages = {"com.vosb.gateway.worker", "com.vosb.gateway.core"})
@EntityScan(basePackages = "com.vosb.gateway.core.domain")
@EnableJpaRepositories(basePackages = "com.vosb.gateway.core.repository")
public class WorkerApplication {

    public static void main(String[] args) {
        SpringApplication.run(WorkerApplication.class, args);
    }
}
