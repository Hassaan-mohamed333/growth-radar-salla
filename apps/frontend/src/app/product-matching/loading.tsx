import { ShellSkeleton, Skeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="matching" title="مقارنة المنتجات">
      <Skeleton className="h-4 w-3/4" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-xl" />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </ShellSkeleton>
  );
}
