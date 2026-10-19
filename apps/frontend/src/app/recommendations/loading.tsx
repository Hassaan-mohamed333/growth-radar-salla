import { CardListSkeleton, ShellSkeleton, Skeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="recommendations" title="التوصيات">
      <Skeleton className="h-4 w-3/4" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <CardListSkeleton count={3} />
    </ShellSkeleton>
  );
}
