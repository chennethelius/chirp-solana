import AsyncStorage from "@react-native-async-storage/async-storage";
import { PublicKey, PublicKeyInitData } from "@solana/web3.js";
import {
  Account as AuthorizedAccount,
  AuthorizationResult,
  AuthorizeAPI,
  AuthToken,
  Base64EncodedAddress,
  DeauthorizeAPI,
  SignInPayloadWithRequiredFields,
  SignInPayload,
} from "@solana-mobile/mobile-wallet-adapter-protocol";
import { toUint8Array } from "js-base64";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { CHIRP_CONFIG } from "../config";

const CHAIN = "solana";
const CLUSTER = CHIRP_CONFIG.cluster;
const CHAIN_IDENTIFIER = `${CHAIN}:${CLUSTER}`;

export type Account = Readonly<{
  address: Base64EncodedAddress;
  label?: string;
  publicKey: PublicKey;
}>;

type WalletAuthorization = Readonly<{
  accounts: Account[];
  authToken: AuthToken;
  selectedAccount: Account;
}>;

function getAccountFromAuthorizedAccount(account: AuthorizedAccount): Account {
  return {
    ...account,
    publicKey: getPublicKeyFromAddress(account.address),
  };
}

function getAuthorizationFromAuthorizationResult(
  authorizationResult: AuthorizationResult,
  previouslySelectedAccount?: Account
): WalletAuthorization {
  let selectedAccount: Account;
  if (
    // We have yet to select an account.
    previouslySelectedAccount == null ||
    // The previously selected account is no longer in the set of authorized addresses.
    !authorizationResult.accounts.some(
      ({ address }) => address === previouslySelectedAccount.address
    )
  ) {
    const firstAccount = authorizationResult.accounts[0];
    selectedAccount = getAccountFromAuthorizedAccount(firstAccount);
  } else {
    selectedAccount = previouslySelectedAccount;
  }
  return {
    accounts: authorizationResult.accounts.map(getAccountFromAuthorizedAccount),
    authToken: authorizationResult.auth_token,
    selectedAccount,
  };
}

function getPublicKeyFromAddress(address: Base64EncodedAddress): PublicKey {
  const publicKeyByteArray = toUint8Array(address);
  return new PublicKey(publicKeyByteArray);
}

function cacheReviver(key: string, value: any) {
  if (key === "publicKey") {
    return new PublicKey(value as PublicKeyInitData); // the PublicKeyInitData should match the actual data structure stored in AsyncStorage
  } else {
    return value;
  }
}

const AUTHORIZATION_STORAGE_KEY = "authorization-cache";

async function fetchAuthorization(): Promise<WalletAuthorization | null> {
  const cacheFetchResult = await AsyncStorage.getItem(
    AUTHORIZATION_STORAGE_KEY
  );
  if (!cacheFetchResult) return null;
  const parsed = JSON.parse(cacheFetchResult, cacheReviver);
  // Invalidate cache if cluster doesn't match (including missing cluster from
  // pre-tagging legacy entries) — stale auth tokens cause wallet to reject.
  if (parsed?.cluster !== CLUSTER) {
    console.log(
      `[auth] clearing stale cache: stored cluster ${parsed?.cluster ?? "(none)"} != current ${CLUSTER}`,
    );
    await AsyncStorage.removeItem(AUTHORIZATION_STORAGE_KEY);
    return null;
  }
  return parsed;
}

async function persistAuthorization(
  auth: WalletAuthorization | null
): Promise<void> {
  const tagged = auth ? { ...auth, cluster: CLUSTER } : null;
  await AsyncStorage.setItem(AUTHORIZATION_STORAGE_KEY, JSON.stringify(tagged));
}

export const APP_IDENTITY = {
  name: "Chirp",
  uri: "https://chirp.local",
};

export function useAuthorization() {
  const queryClient = useQueryClient();
  const { data: authorization, isLoading } = useQuery({
    queryKey: ["wallet-authorization"],
    queryFn: () => fetchAuthorization(),
  });
  const { mutate: setAuthorization } = useMutation({
    mutationFn: persistAuthorization,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-authorization"] });
    },
  });

  const handleAuthorizationResult = useCallback(
    async (
      authorizationResult: AuthorizationResult
    ): Promise<WalletAuthorization> => {
      const nextAuthorization = getAuthorizationFromAuthorizationResult(
        authorizationResult,
        authorization?.selectedAccount
      );
      await setAuthorization(nextAuthorization);
      return nextAuthorization;
    },
    [authorization]
  );
  const authorizeSession = useCallback(
    async (wallet: AuthorizeAPI) => {
      try {
        const authorizationResult = await wallet.authorize({
          identity: APP_IDENTITY,
          chain: CHAIN_IDENTIFIER,
          auth_token: authorization?.authToken,
        });
        return (await handleAuthorizationResult(authorizationResult))
          .selectedAccount;
      } catch (e: any) {
        const msg = String(e?.message ?? "").toLowerCase();
        const stale =
          msg.includes("auth token") ||
          msg.includes("not valid") ||
          msg.includes("authorization") ||
          e?.jsonRpcErrorCode === -1;
        if (!stale) throw e;
        console.log(
          "[auth] cached auth_token rejected — clearing and retrying without it",
        );
        await AsyncStorage.removeItem(AUTHORIZATION_STORAGE_KEY);
        const fresh = await wallet.authorize({
          identity: APP_IDENTITY,
          chain: CHAIN_IDENTIFIER,
        });
        return (await handleAuthorizationResult(fresh)).selectedAccount;
      }
    },
    [authorization, handleAuthorizationResult]
  );
  const authorizeSessionWithSignIn = useCallback(
    async (wallet: AuthorizeAPI, signInPayload: SignInPayload) => {
      const authorizationResult = await wallet.authorize({
        identity: APP_IDENTITY,
        chain: CHAIN_IDENTIFIER,
        auth_token: authorization?.authToken,
        sign_in_payload: signInPayload,
      });
      return (await handleAuthorizationResult(authorizationResult))
        .selectedAccount;
    },
    [authorization, handleAuthorizationResult]
  );
  const deauthorizeSession = useCallback(
    async (wallet: DeauthorizeAPI) => {
      if (authorization?.authToken == null) {
        return;
      }
      await wallet.deauthorize({ auth_token: authorization.authToken });
      await setAuthorization(null);
    },
    [authorization]
  );
  return useMemo(
    () => ({
      accounts: authorization?.accounts ?? null,
      authorizeSession,
      authorizeSessionWithSignIn,
      deauthorizeSession,
      selectedAccount: authorization?.selectedAccount ?? null,
      isLoading,
    }),
    [authorization, authorizeSession, deauthorizeSession]
  );
}
