import { revokeUser, restoreUser } from "@/app/access-actions";

export default function UserAccessControls({
  email,
  isActive,
}: {
  email: string;
  isActive: boolean;
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
    </span>
  );
}
