import { redirect } from 'next/navigation';
import { currentCtx } from '@/server/services/page-context';

/** `/` sends signed-in people to their projects and everyone else to the log-in page. */
export default async function Home() {
  redirect((await currentCtx()) ? '/projects' : '/log-in');
}
