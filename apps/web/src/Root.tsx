import { useEffect, useState } from "react";
import { App } from "./App";
import { AuthLanding } from "./AuthLanding";
import { DropboxStorageWorkspace } from "./DropboxStorageWorkspace";
import { PrivacyPage } from "./PrivacyPage";
import { ResetPasswordPage } from "./ResetPasswordPage";

type AccountState = "loading" | "authenticated" | "anonymous";

export function Root() {
  const pathname = window.location.pathname;
  const [accountState, setAccountState] = useState<AccountState>("loading");

  useEffect(() => {
    if (pathname === "/privacy" || pathname === "/reset-password") return;

    let active = true;
    void fetch("/api/account", { credentials: "same-origin" })
      .then((response) => {
        if (!active) return;
        setAccountState(response.ok ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (active) setAccountState("anonymous");
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  if (pathname === "/privacy") return <PrivacyPage />;
  if (pathname === "/reset-password") return <ResetPasswordPage />;

  if (accountState === "loading") {
    return (
      <div className="center-screen">
        <div className="loader" />
        <p>Opening HRTechify Podcast Studio…</p>
      </div>
    );
  }

  return accountState === "authenticated"
    ? <><App /><DropboxStorageWorkspace /></>
    : <AuthLanding />;
}
