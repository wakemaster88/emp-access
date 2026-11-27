import { sesEnv, sesErrorText, sesGetAccount, sesGetIdentity, type SesAccount, type SesIdentity } from "./ses";

/** Stand bei AWS für die Seite „Einstellungen“: Konto, Domain, DKIM, MAIL FROM. */
export interface SesStatus {
  configured: boolean;
  region: string | null;
  account: SesAccount | null;
  accountError: string | null;
  /** Domain der Absender-Adresse, z. B. tuttenbrocksee.com */
  domain: string | null;
  /** null: Domain fehlt in SES. undefined: nicht geprüft. */
  identity: SesIdentity | null | undefined;
  identityError: string | null;
}

export async function loadSesStatus(fromEmail: string | null): Promise<SesStatus> {
  const env = sesEnv();
  const domain = fromEmail?.split("@")[1]?.toLowerCase() ?? null;
  if (!env) {
    return { configured: false, region: null, account: null, accountError: null, domain, identity: undefined, identityError: null };
  }
  const [account, identity] = await Promise.allSettled([
    sesGetAccount(env),
    domain ? sesGetIdentity(env, domain) : Promise.resolve(undefined),
  ]);
  return {
    configured: true,
    region: env.region,
    account: account.status === "fulfilled" ? account.value : null,
    accountError: account.status === "rejected" ? sesErrorText(account.reason) : null,
    domain,
    identity: identity.status === "fulfilled" ? identity.value : undefined,
    identityError: identity.status === "rejected" ? sesErrorText(identity.reason) : null,
  };
}
