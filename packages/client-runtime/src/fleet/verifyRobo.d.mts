export function verifyRoboIdentity(input: {
  token: string;
  issuer: string;
  audience: string;
  fetchJwks: (url: string) => Promise<Response>;
  now?: () => number;
  allowSyntheticTestSubject?: boolean;
}): Promise<{ subject: string; audience: string; expiresAtMs: number }>;
