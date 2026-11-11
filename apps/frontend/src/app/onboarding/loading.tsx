import { ShellSkeleton, Skeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="overview" title="ابدأ من هنا">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </ShellSkeleton>
  );
}
