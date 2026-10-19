import { ShellSkeleton, Skeleton, TableSkeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="competitors" title="المنافسون">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-44 rounded-xl" />
      <Skeleton className="h-20 rounded-xl" />
      <TableSkeleton rows={5} cols={5} />
    </ShellSkeleton>
  );
}
