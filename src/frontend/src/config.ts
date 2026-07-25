// Migration shim: wraps @caffeineai/core-infrastructure createActorWithConfig
// with the local createActor factory so call sites can invoke it with no args.
import {
  createActorWithConfig as _createActorWithConfig,
  loadConfig,
} from "@caffeineai/core-infrastructure";
import { createActor } from "./backend";

export { loadConfig };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createActorWithConfig(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _createActorWithConfig(createActor as any);
}
