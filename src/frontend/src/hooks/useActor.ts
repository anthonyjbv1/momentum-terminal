// Migration shim: wraps @caffeineai/core-infrastructure useActor with the
// local createActor factory so call sites can invoke useActor() with no args.
import { useActor as _useActor } from "@caffeineai/core-infrastructure";
import { createActor } from "../backend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _noop = (): any => null;

export function useActor() {
  // createActor from backend.ts matches createActorFunction<T> signature.
  // We cast the result to `any` so call sites can access methods freely
  // while backend.d.ts remains an empty interface (pre-bindgen state).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = _useActor(createActor as any);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actor: result.actor as any,
    isFetching: result.isFetching,
  };
}
void _noop;
