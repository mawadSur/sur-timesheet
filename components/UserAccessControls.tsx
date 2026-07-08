import { revokeUser, restoreUser, deleteUserAccount } from "@/app/access-actions";

export default function UserAccessControls({
  email,
  isActive,
  profileId,
}: {
  email: string;
  isActive: boolean;
  profileId?: string | null;
}) {
  if (isActive) {
    return (
      <form action={revokeUser}>
        <input type="hidden" name="email" value={email} />
        <button type="submit" className="link-btn">
          Revoke
        </button>
      </form>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      <span className="badge">Revoked</span>
      <form action={restoreUser}>
        <input type="hidden" name="email" value={email} />
        <button type="submit" className="link-btn">
          Restore
        </button>
      </form>
      {/* Permanent delete — only offered once the user is revoked, and only when a
          profile (auth account) actually exists to delete. */}
      {profileId ? (
        <form action={deleteUserAccount}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="profileId" value={profileId} />
          <button
            type="submit"
            className="btn-sm"
            style={{
              background: "var(--red)",
              color: "#fff",
              borderColor: "var(--red)",
            }}
            title="Permanently delete this account. This cannot be undone."
          >
            Delete account
          </button>
        </form>
      ) : null}
    </span>
  );
}
