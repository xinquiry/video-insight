package apperror

import (
	"errors"
	"fmt"
)

type Error struct {
	Status int
	Code   string
	Detail string
	Err    error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Detail, e.Err)
	}
	return e.Detail
}

func (e *Error) Unwrap() error { return e.Err }

func New(status int, detail string) *Error {
	return &Error{Status: status, Detail: detail}
}

func NewCode(status int, code, detail string) *Error {
	return &Error{Status: status, Code: code, Detail: detail}
}

func Wrap(status int, detail string, err error) *Error {
	return &Error{Status: status, Detail: detail, Err: err}
}

func As(err error) (*Error, bool) {
	var target *Error
	ok := errors.As(err, &target)
	return target, ok
}
