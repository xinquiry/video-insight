package auth

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestVerifyAndObjectKey(t *testing.T) {
	dir := t.TempDir()
	keysPath := filepath.Join(dir, "keys.json")
	content := `{"projects":[{"name":"videoinsight","prefix":"projects/videoinsight","secret":"s1"},{"name":"projectb","prefix":"projects/b","secret":"s2"}]}`
	if err := os.WriteFile(keysPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(keysPath)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.Verify("videoinsight", "wrong"); err == nil {
		t.Fatal("expected error for wrong secret")
	}
	project, err := store.Verify("videoinsight", "s1")
	if err != nil {
		t.Fatal(err)
	}
	key, err := project.ObjectKey("videos/abc.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if key != "projects/videoinsight/videos/abc.mp4" {
		t.Fatalf("unexpected key: %s", key)
	}

	for _, bad := range []string{"../escape", "a/../../b", `back\slash`, "", "/"} {
		if _, err := project.ObjectKey(bad); err == nil {
			t.Fatalf("expected rejection for %q", bad)
		}
	}

	// hot-reload on file change
	updated := `{"projects":[{"name":"videoinsight","prefix":"projects/videoinsight","secret":"new-secret"}]}`
	if err := os.WriteFile(keysPath, []byte(updated), 0o600); err != nil {
		t.Fatal(err)
	}
	newMtime := store.mtime.Add(time.Hour) // force difference
	store.mtime = store.mtime.Add(-time.Minute)
	_ = newMtime
	if _, err := store.Verify("videoinsight", "s1"); err == nil {
		t.Fatal("expected old secret to stop working after reload")
	}
	if _, err := store.Verify("videoinsight", "new-secret"); err != nil {
		t.Fatalf("expected new secret to work: %v", err)
	}
}
