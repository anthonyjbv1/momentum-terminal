// Migration shim: re-export from @caffeineai/core-infrastructure
// This file exists to satisfy relative imports like `import { useInternetIdentity } from "../hooks/useInternetIdentity"`
// which reference the old inline hook that was removed during template migration.
export { useInternetIdentity } from "@caffeineai/core-infrastructure";
export type {
  InternetIdentityContext,
  Status,
} from "@caffeineai/core-infrastructure";
