package smh

import "testing"

func TestEscapePath(t *testing.T) {
	cases := map[string]string{
		"videos/a.mp4":           "videos/a.mp4",
		"/videos/Chinese 文件.mp4": "videos/Chinese%20%E6%96%87%E4%BB%B6.mp4",
		"videos/with space.mp4":  "videos/with%20space.mp4",
		"a//b":                   "a//b",
		"spike-test/hello.txt":   "spike-test/hello.txt",
	}
	for input, want := range cases {
		if got := escapePath(input); got != want {
			t.Errorf("escapePath(%q) = %q, want %q", input, got, want)
		}
	}
}
