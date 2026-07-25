import { Skeleton } from "@/components/ui/skeleton";

/**
 * LoadingState — skeleton placeholder that mirrors the asset list row structure.
 * Displayed when the assets array is undefined or empty.
 */
export function LoadingState() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-0 px-6 py-5 border-b border-border"
        >
          <div className="hidden sm:block w-8 shrink-0">
            <Skeleton className="h-3 w-4 bg-white/5" />
          </div>
          <div className="flex-1">
            <Skeleton className="h-4 w-32 bg-white/5 mb-2" />
            <Skeleton className="h-3 w-48 bg-white/5" />
            <Skeleton className="h-[3px] w-full bg-white/5 mt-4 rounded-full" />
          </div>
          <div className="flex items-center gap-6 sm:gap-10">
            <Skeleton className="h-8 w-16 bg-white/5" />
            <Skeleton className="h-8 w-20 bg-white/5" />
            <Skeleton className="h-8 w-20 bg-white/5" />
            <Skeleton className="h-8 w-28 bg-white/5" />
          </div>
        </div>
      ))}
    </>
  );
}
