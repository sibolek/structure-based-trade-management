export const V24_ROUTER_INVALID_DISABLE_CONFIG =
  "V24_RUNTIME_ROUTER_DISABLED_CONFIG_INVALID";

function normalized(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

export function interpretV24RouterDisableConfig(value) {
  const setting = normalized(value);

  if (setting === "" || setting === "false") {
    return Object.freeze({
      enabled: true,
      status: "STARTING",
      error: "",
    });
  }

  if (setting === "true") {
    return Object.freeze({
      enabled: false,
      status: "PAUSED",
      error: "",
    });
  }

  // Decision 22A + 22B:
  // malformed nonempty configuration is known-invalid and fails closed.
  return Object.freeze({
    enabled: false,
    status: "BLOCKED",
    error: V24_ROUTER_INVALID_DISABLE_CONFIG,
  });
}
