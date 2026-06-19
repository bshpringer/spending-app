import { redirect } from "next/navigation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  const { profile } = await searchParams;
  const suffix = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  redirect(`/dashboard${suffix}`);
}
