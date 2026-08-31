import { ApiError } from "./api-client";

type Translate = (key: string) => string;

const errorKeys: Record<string, string> = {
  annotation_timestamp_invalid: "errors.annotationTimestampInvalid",
  annotation_duration_invalid: "errors.annotationDurationInvalid",
  annotation_geometry_invalid: "errors.annotationGeometryInvalid",
  annotation_field_invalid: "errors.annotationFieldInvalid",
  annotation_color_invalid: "errors.annotationColorInvalid",
  annotation_custom_data_invalid: "errors.annotationCustomDataInvalid",
  annotation_content_invalid: "errors.annotationContentInvalid",
  annotation_content_too_large: "errors.annotationContentTooLarge",
  annotation_image_too_large: "errors.annotationImageTooLarge",
  annotation_image_type_unsupported: "errors.annotationImageTypeUnsupported",
  annotation_image_source_invalid: "errors.annotationImageSourceInvalid",
  annotation_image_invalid: "errors.annotationImageInvalid",
  invalid_request_body: "errors.invalidRequestBody",
  request_too_large: "errors.requestTooLarge",
};

export function getErrorMessage(
  error: unknown,
  translate: Translate,
  fallbackKey = "errors.unknown",
): string {
  if (error instanceof ApiError) {
    const key = error.code ? errorKeys[error.code] : undefined;
    if (key) return translate(key);
    if (error.status === 401) return translate("errors.unauthorized");
    if (error.status === 403) return translate("errors.forbidden");
    if (error.status === 404) return translate("errors.notFound");
    if (error.status === 409) return translate("errors.conflict");
    if (error.status === 413) return translate("errors.requestTooLarge");
    if (error.status >= 500) return translate("errors.server");
  }
  if (error instanceof TypeError) return translate("errors.network");
  return translate(fallbackKey);
}
