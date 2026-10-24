import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const params = await searchParams;
  return <SignUpForm plan={params.plan} />;
}
