import { getUser } from '../../lib/auth';
import { redirect } from 'next/navigation';
export default async function Login({ searchParams }: { searchParams: Promise<{error?:string}> }) {
  if (await getUser()) redirect('/dashboard');
  const { error } = await searchParams;
  return <main className="loginScreen"><form className="loginCard" action="/api/login" method="post"><div className="logo">● Event Debugger</div><h1>Welcome back</h1><p>Sign in with an authorized email address.</p><label htmlFor="email">Email address</label><input id="email" type="email" name="email" placeholder="you@example.com" required autoFocus />{error && <p className="error">This email is not authorized.</p>}<button type="submit">Continue →</button></form></main>;
}
