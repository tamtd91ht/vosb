package com.vosb.gateway.server.http.common;

import io.vertx.core.Future;
import io.vertx.core.Vertx;
import org.springframework.stereotype.Component;

import java.util.concurrent.Callable;
import java.util.concurrent.CompletionException;

/**
 * Helper to run blocking code (JPA, Redis, AMQP) off the Vert.x event loop.
 *
 * In HTTP handlers (event loop): use executeAsync() and chain with onSuccess/onFailure.
 * In Spring services / AMQP listeners (already on thread pool): use execute() which joins.
 */
@Component
public class BlockingDispatcher {

    private final Vertx vertx;

    public BlockingDispatcher(Vertx vertx) {
        this.vertx = vertx;
    }

    /**
     * Async: runs task on Vert.x worker pool, returns Future.
     * Use in Vert.x handlers to avoid blocking the event loop.
     */
    public <T> Future<T> executeAsync(Callable<T> task) {
        return vertx.executeBlocking(() -> task.call(), false);
    }

    /**
     * Sync: blocks the calling thread until task completes.
     * Only call from non-event-loop threads (Spring @Service, @RabbitListener, etc.).
     */
    public <T> T execute(Callable<T> task) {
        try {
            return executeAsync(task).toCompletionStage().toCompletableFuture().join();
        } catch (CompletionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException re) throw re;
            throw new RuntimeException(cause);
        }
    }
}
