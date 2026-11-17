import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Showcase } from './showcase';

export const metadata: Metadata = { title: 'UI kit', robots: { index: false } };

/** Every component and state, inside the real shell, for chats A and B. Outside production only. */
export default async function DevUiPage({ searchParams }: { searchParams: Promise<{ checked?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { checked } = await searchParams;
  return <Showcase checked={checked === '1'} />;
}
