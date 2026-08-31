// Shared across every AI provider and ai/aiService.js so error handling is
// uniform regardless of which provider generated the failure.
class AiAnalysisError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "AiAnalysisError";
    // Machine-readable classification, e.g.: missing_api_key | invalid_api_key |
    // ollama_unavailable | timeout | rate_limited | model_unavailable |
    // network_error | provider_error | invalid_json | invalid_schema |
    // unsupported_type | unknown_error
    this.code = code;
    this.cause = cause;
  }
}

module.exports = { AiAnalysisError };
