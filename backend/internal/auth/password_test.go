package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestVerifyPasswordAcceptsLegacyPBKDF2Hash(t *testing.T) {
	t.Parallel()
	hash := "pbkdf2_sha256$260000$00112233445566778899aabbccddeeff$1c1e47ef165c7cff8845f3f5a71f00c3b5aa5d2ba0518564477284427df40fe8"
	if !VerifyPassword("password123", hash) {
		t.Fatal("expected legacy PBKDF2 hash to verify")
	}
	if VerifyPassword("wrong", hash) {
		t.Fatal("wrong password unexpectedly verified")
	}
}

func TestHashPasswordRoundTrip(t *testing.T) {
	t.Parallel()
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("correct horse battery staple", hash) {
		t.Fatal("generated hash did not verify")
	}
}

func TestTokenManagerRoundTripAndExpiry(t *testing.T) {
	t.Parallel()
	userID := uuid.New()
	manager := NewTokenManager("secret", time.Hour)
	token, err := manager.Create(userID, "student")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := manager.Parse(token)
	if err != nil {
		t.Fatal(err)
	}
	if parsed != userID {
		t.Fatalf("got %s, want %s", parsed, userID)
	}

	expired := NewTokenManager("secret", -time.Second)
	token, err = expired.Create(userID, "student")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := expired.Parse(token); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}
