import { ShellSkeleton, Skeleton, StatCardsSkeleton } from './skeleton';

// Root boundary: shown for the overview and for any page whose own loading.tsx isn't ready yet,
// so it names no page and highlights no nav item.
export default function Loading() {
  return (
    <ShellSkeleton>
      <StatCardsSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </ShellSkeleton>
  );
}
