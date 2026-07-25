// Admin authentication utility for MVP
// Hard-coded admin key — separate from standard user authentication

export const ADMIN_KEY = "ADMIN_2026_MVP_KEY";
export const ADMIN_SECURITY_TOKEN = "SECURE-TOKEN-XYZ";

/**
 * Validates an input string against the hard-coded ADMIN_KEY.
 * Returns true if the key matches, false otherwise.
 */
export function validateAdminKey(input: string): boolean {
  return input === ADMIN_KEY;
}

/**
 * Validates both the access key and security token.
 * Returns true only when BOTH fields match their respective constants.
 */
export function validateAdminCredentials(
  accessKey: string,
  securityToken: string,
): boolean {
  return accessKey === ADMIN_KEY && securityToken === ADMIN_SECURITY_TOKEN;
}
