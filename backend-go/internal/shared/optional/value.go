package optional

import (
	"bytes"
	"encoding/json"
)

type Value[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (v *Value[T]) UnmarshalJSON(data []byte) error {
	v.Set = true
	if bytes.Equal(data, []byte("null")) {
		v.Null = true
		var zero T
		v.Value = zero
		return nil
	}
	v.Null = false
	return json.Unmarshal(data, &v.Value)
}
