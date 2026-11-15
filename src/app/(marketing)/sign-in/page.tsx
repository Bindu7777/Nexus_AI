import { redirect } from "next/navigation";

// The website's "Sign in" link leads to the employee portal.
export default function SignInPage() {
  redirect("/portal/sign-in");
}
