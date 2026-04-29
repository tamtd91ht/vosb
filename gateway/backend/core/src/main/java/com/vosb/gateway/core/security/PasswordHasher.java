package com.vosb.gateway.core.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class PasswordHasher {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder(10);

    public String hash(String plaintext) {
        return ENCODER.encode(plaintext);
    }

    public boolean matches(String plaintext, String hash) {
        return ENCODER.matches(plaintext, hash);
    }
}
