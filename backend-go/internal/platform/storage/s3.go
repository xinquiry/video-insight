package storage

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	"github.com/xinquiry/video-insight/backend-go/internal/videos"
)

type S3 struct {
	bucket        string
	client        *s3.Client
	publicPresign *s3.PresignClient
}

type Config struct {
	Endpoint       string
	PublicEndpoint string
	AccessKey      string
	SecretKey      string
	Region         string
	Bucket         string
}

func NewS3(ctx context.Context, config Config) (*S3, error) {
	credentialsProvider := credentials.NewStaticCredentialsProvider(config.AccessKey, config.SecretKey, "")
	base, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(config.Region),
		awsconfig.WithCredentialsProvider(credentialsProvider),
	)
	if err != nil {
		return nil, fmt.Errorf("load S3 config: %w", err)
	}
	client := s3.NewFromConfig(base, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(config.Endpoint)
		options.UsePathStyle = true
	})
	publicClient := s3.NewFromConfig(base, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(config.PublicEndpoint)
		options.UsePathStyle = true
	})
	return &S3{bucket: config.Bucket, client: client, publicPresign: s3.NewPresignClient(publicClient)}, nil
}

func (s *S3) CreateMultipartUpload(ctx context.Context, objectKey, contentType string) (string, error) {
	if err := s.ensureBucket(ctx); err != nil {
		return "", err
	}
	output, err := s.client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket: aws.String(s.bucket), Key: aws.String(objectKey), ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", fmt.Errorf("create multipart upload: %w", err)
	}
	if output.UploadId == nil || *output.UploadId == "" {
		return "", fmt.Errorf("create multipart upload: storage returned no upload ID")
	}
	return *output.UploadId, nil
}

func (s *S3) ensureBucket(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err == nil {
		return nil
	}
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) || (apiErr.ErrorCode() != "NoSuchBucket" && apiErr.ErrorCode() != "NotFound") {
		return fmt.Errorf("check bucket: %w", err)
	}
	if _, err := s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("create bucket: %w", err)
	}
	return nil
}

func (s *S3) PresignUploadPart(ctx context.Context, objectKey, uploadID string, partNumber int, expires time.Duration) (string, error) {
	request, err := s.publicPresign.PresignUploadPart(ctx, &s3.UploadPartInput{
		Bucket: aws.String(s.bucket), Key: aws.String(objectKey), UploadId: aws.String(uploadID), PartNumber: aws.Int32(int32(partNumber)),
	}, func(options *s3.PresignOptions) { options.Expires = expires })
	if err != nil {
		return "", fmt.Errorf("presign upload part: %w", err)
	}
	return request.URL, nil
}

func (s *S3) CompleteMultipartUpload(ctx context.Context, objectKey, uploadID string, parts []videos.CompletedPart) error {
	parts = append([]videos.CompletedPart(nil), parts...)
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
	completed := make([]types.CompletedPart, 0, len(parts))
	for _, part := range parts {
		completed = append(completed, types.CompletedPart{
			PartNumber: aws.Int32(int32(part.PartNumber)),
			ETag:       aws.String(strings.Trim(part.ETag, `"`)),
		})
	}
	_, err := s.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket: aws.String(s.bucket), Key: aws.String(objectKey), UploadId: aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{Parts: completed},
	})
	if err != nil {
		return fmt.Errorf("complete multipart upload: %w", err)
	}
	return nil
}

func (s *S3) AbortMultipartUpload(ctx context.Context, objectKey, uploadID string) error {
	_, err := s.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket: aws.String(s.bucket), Key: aws.String(objectKey), UploadId: aws.String(uploadID),
	})
	if err != nil {
		return fmt.Errorf("abort multipart upload: %w", err)
	}
	return nil
}

func (s *S3) PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error) {
	request, err := s.publicPresign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(objectKey),
	}, func(options *s3.PresignOptions) { options.Expires = expires })
	if err != nil {
		return "", fmt.Errorf("presign get object: %w", err)
	}
	return request.URL, nil
}

func (s *S3) DeleteObject(ctx context.Context, objectKey string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(objectKey)})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}
